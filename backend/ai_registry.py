from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import threading

import yaml


class SafeFormatDict(dict):
    """Format helper that leaves unknown placeholders untouched."""

    def __missing__(self, key: str) -> str:  # pragma: no cover - trivial
        return "{" + key + "}"


@dataclass(slots=True)
class AgentDefinition:
    agent_id: str
    display_name: str
    provider: str
    description: str = ""
    model: Optional[str] = None
    sample_dialogue: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_public_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.agent_id,
            "displayName": self.display_name,
            "provider": self.provider,
            "description": self.description,
        }
        if self.model:
            payload["model"] = self.model
        # expose selected metadata that有助于前端展示/配置
        for key in ("api_key_env", "endpoint_env", "default_params", "config", "deployment"):
            if key in self.metadata:
                payload[key] = self.metadata[key]
        return payload

    def render_dialogue(self, context: Dict[str, Any]) -> str:
        template = (self.sample_dialogue or "{agent_name} 在第 {round} 回合采取默认行动。").strip()
        if not template:
            template = "{agent_name} 在第 {round} 回合采取默认行动。"
        return template.format_map(SafeFormatDict(context))


class AgentRegistry:
    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path
        self._lock = threading.Lock()
        self._agents: Dict[str, AgentDefinition] = {}
        self._loaded_at: Optional[str] = None
        self.reload()

    def reload(self) -> None:
        with self._lock:
            self._agents = self._load_agents()
            self._loaded_at = datetime.now(timezone.utc).isoformat()

    def list_agents(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [agent.to_public_dict() for agent in self._agents.values()]

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "agents": [agent.to_public_dict() for agent in self._agents.values()],
                "loadedAt": self._loaded_at,
            }

    def get_agent(self, agent_id: str) -> AgentDefinition:
        with self._lock:
            agent = self._agents.get(agent_id)
        if agent is None:
            raise KeyError(f"Unknown agent: {agent_id}")
        return agent

    def get_loaded_at(self) -> Optional[str]:
        with self._lock:
            return self._loaded_at

    def _load_agents(self) -> Dict[str, AgentDefinition]:
        if not self._config_path.exists():
            return {}

        content = self._config_path.read_text(encoding="utf-8")
        data = yaml.safe_load(content) or {}
        raw_agents = data.get("agents", [])
        agents: Dict[str, AgentDefinition] = {}
        for entry in raw_agents:
            if not isinstance(entry, dict):
                continue
            agent_id = str(entry.get("id") or "").strip()
            if not agent_id:
                continue
            display_name = str(entry.get("display_name") or entry.get("name") or agent_id)
            provider = str(entry.get("provider") or "template")
            description = str(entry.get("description") or "")
            model = entry.get("model")
            sample_dialogue = str(entry.get("sample_dialogue") or "")

            metadata: Dict[str, Any] = {}
            for key, value in entry.items():
                if key in {"id", "display_name", "name", "provider", "description", "model", "sample_dialogue"}:
                    continue
                metadata[key] = value

            agents[agent_id] = AgentDefinition(
                agent_id=agent_id,
                display_name=display_name,
                provider=provider,
                description=description,
                model=str(model) if isinstance(model, str) else None,
                sample_dialogue=sample_dialogue,
                metadata=metadata,
            )

        return agents


def build_dialogue_context(
    *,
    agent: AgentDefinition,
    game_name: str,
    game_rules: str,
    round_number: int,
    judge_message: str,
    last_message: str,
) -> Dict[str, Any]:
    preview = game_rules[:80]
    if len(game_rules) > 80:
        preview = preview + "…"
    return {
        "agent_name": agent.display_name,
        "agent_id": agent.agent_id,
        "game_name": game_name,
        "game_rules": game_rules,
        "game_rules_preview": preview,
        "round": round_number,
        "judge_message": judge_message,
        "last_message": last_message,
    }

