from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from backend.ai_registry import AgentDefinition, SafeFormatDict


logger = logging.getLogger(__name__)


DEFAULT_SYSTEM_PROMPT = (
    "你是 {agent_name}，正在参与一个需要多智能体协作的回合制博弈。"
    "请结合自身专长，输出兼顾策略性与可执行性的中文回复。"
)

DEFAULT_USER_PROMPT = (
    "【博弈名称】{game_name}\n"
    "【当前回合】第 {round} 回合\n"
    "【规则摘要】{game_rules}\n"
    "【裁判提示】{judge_message or '（无）'}\n"
    "【上一条消息】{last_message or '（无）'}\n\n"
    "请基于上述情境做出回应，回复中可以包含条目符号或步骤列表，"
    "强调下一步应采取的行动或需要关注的风险。"
)


class LLMGenerationError(RuntimeError):
    """Raised when an AI provider cannot produce a response."""


@dataclass(frozen=True)
class _OpenAISettings:
    api_key: str
    base_url: Optional[str]
    model: str
    params: Dict[str, Any]


class LLMGateway:
    """Utility class that proxies calls to different model providers."""

    _PROVIDER_DEFAULTS: Dict[str, Dict[str, Any]] = {
        "doubao": {
            "api_key_env": "ARK_API_KEY",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        },
        "deepseekr1": {
            "api_key_env": "DEEPSEEK_API_KEY",
            "base_url": "https://api.deepseek.com/v1",
        },
        "qianwen": {
            "api_key_env": "QIANWEN_API_KEY",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        "gpt": {
            "api_key_env": "OPENAI_API_KEY",
            "base_url": "https://api.openai.com/v1",
        },
    }

    def __init__(self) -> None:
        self._openai_clients: Dict[Tuple[str, Optional[str]], OpenAI] = {}

    def generate_response(self, agent: AgentDefinition, context: Dict[str, Any]) -> str:
        provider_key = agent.provider.lower().strip()
        try:
            if provider_key in {"doubao", "deepseekr1", "qianwen", "gpt"}:
                return self._generate_openai_chat(agent, context, provider_key)
            raise LLMGenerationError(f"Provider '{agent.provider}' 未实现。")
        except LLMGenerationError:
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("调用外部模型失败：%s", exc)
            raise LLMGenerationError("调用外部模型失败。") from exc

    # ------------------------------------------------------------------
    # OpenAI-compatible providers
    # ------------------------------------------------------------------
    def _generate_openai_chat(
        self,
        agent: AgentDefinition,
        context: Dict[str, Any],
        provider_key: str,
    ) -> str:
        settings = self._resolve_openai_settings(agent, provider_key)
        messages = self._build_chat_messages(agent, context)
        if not messages:
            raise LLMGenerationError("缺少可用于生成的提示信息。")

        client = self._get_openai_client(settings)
        try:
            response = client.chat.completions.create(
                model=settings.model,
                messages=messages,
                **settings.params,
            )
        except Exception as exc:  # pragma: no cover - network errors
            logger.exception("OpenAI 接口调用失败：%s", exc)
            raise LLMGenerationError("OpenAI 接口调用失败。") from exc

        choice = response.choices[0] if response.choices else None
        if not choice or not getattr(choice.message, "content", ""):  # pragma: no cover - safety
            raise LLMGenerationError("模型未返回内容。")

        content = choice.message.content
        if isinstance(content, list):  # 一些实现会返回分段内容
            joined_parts = "".join(part.get("text", "") for part in content if isinstance(part, dict))
            content_text = joined_parts.strip()
        else:
            content_text = str(content).strip()

        if not content_text:
            raise LLMGenerationError("模型返回内容为空。")

        return content_text

    def _resolve_openai_settings(
        self, agent: AgentDefinition, provider_key: str
    ) -> _OpenAISettings:
        metadata = agent.metadata or {}
        defaults = self._PROVIDER_DEFAULTS.get(provider_key, {})

        api_key_env = str(metadata.get("api_key_env") or defaults.get("api_key_env") or "").strip()
        if not api_key_env:
            raise LLMGenerationError("未配置 API Key 环境变量名称。")

        api_key = os.environ.get(api_key_env)
        if not api_key:
            raise LLMGenerationError(f"缺少环境变量 {api_key_env}。")

        endpoint_env = str(metadata.get("endpoint_env") or defaults.get("endpoint_env") or "").strip()
        base_url = None
        if endpoint_env:
            base_url = os.environ.get(endpoint_env)

        if not base_url:
            base_url = str(metadata.get("base_url") or defaults.get("base_url") or "").strip() or None

        model = str(metadata.get("model_override") or agent.model or "").strip()
        if not model:
            raise LLMGenerationError("未指定可用的模型名称。")

        params: Dict[str, Any] = {}
        raw_params = metadata.get("default_params")
        if isinstance(raw_params, dict):
            params.update(raw_params)

        params.setdefault("temperature", 0.7)

        return _OpenAISettings(api_key=api_key, base_url=base_url, model=model, params=params)

    def _get_openai_client(self, settings: _OpenAISettings) -> OpenAI:
        cache_key = (settings.api_key, settings.base_url)
        client = self._openai_clients.get(cache_key)
        if client is None:
            client = OpenAI(api_key=settings.api_key, base_url=settings.base_url)
            self._openai_clients[cache_key] = client
        return client

    def _build_chat_messages(
        self, agent: AgentDefinition, context: Dict[str, Any]
    ) -> List[ChatCompletionMessageParam]:
        metadata = agent.metadata or {}
        formatted_context = {**context, "agent_display_name": agent.display_name}

        system_template = str(metadata.get("system_prompt") or DEFAULT_SYSTEM_PROMPT)
        user_template = str(metadata.get("user_prompt_template") or DEFAULT_USER_PROMPT)

        system_prompt = system_template.format_map(SafeFormatDict(formatted_context)).strip()
        user_prompt = user_template.format_map(SafeFormatDict(formatted_context)).strip()

        messages: List[ChatCompletionMessageParam] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if user_prompt:
            messages.append({"role": "user", "content": user_prompt})
        return messages

