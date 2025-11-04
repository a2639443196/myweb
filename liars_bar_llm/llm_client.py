from __future__ import annotations

import os
from typing import Iterable, Tuple

from openai import OpenAI


class LLMClient:
    """Minimal OpenAI compatible wrapper used by the standalone scripts."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        resolved_key = api_key or os.getenv("LIARS_BAR_API_KEY")
        if not resolved_key:
            raise RuntimeError("Missing OpenAI compatible API key. Set LIARS_BAR_API_KEY or pass api_key explicitly.")

        resolved_base = base_url or os.getenv("LIARS_BAR_API_BASE")
        self.client = OpenAI(api_key=resolved_key, base_url=resolved_base or None)

    def chat(self, messages: Iterable[dict], model: str = "deepseek-ai/DeepSeek-R1") -> Tuple[str, str | None]:
        """与LLM交互"""
        try:
            response = self.client.chat.completions.create(model=model, messages=list(messages))
        except Exception as error:  # pragma: no cover - external dependency
            print(f"LLM调用出错: {error}")
            return "", None

        if not response.choices:
            return "", None

        message = response.choices[0].message
        content = message.content or ""
        if isinstance(content, list):
            text = "".join(part.get("text", "") for part in content if isinstance(part, dict)).strip()
        else:
            text = str(content).strip()

        reasoning_raw = getattr(message, "reasoning_content", None)
        if isinstance(reasoning_raw, list):
            reasoning = "".join(part.get("text", "") for part in reasoning_raw if isinstance(part, dict)).strip() or None
        elif reasoning_raw:
            reasoning = str(reasoning_raw).strip() or None
        else:
            reasoning = None

        return text, reasoning
