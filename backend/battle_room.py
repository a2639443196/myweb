from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from backend.ai_registry import AgentDefinition, AgentRegistry, build_dialogue_context
from backend.llm_gateway import LLMGateway, LLMGenerationError


logger = logging.getLogger(__name__)


llm_gateway = LLMGateway()


class RoomAlreadyExistsError(RuntimeError):
    """Raised when attempting to create a room while one is active."""


class RoomNotFoundError(RuntimeError):
    """Raised when operations require an active room but none exists."""


class RoomPermissionError(RuntimeError):
    """Raised when caller lacks permission to operate on the room."""


@dataclass
class Judge:
    id: int
    username: str

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "username": self.username}


class BattleRoom:
    def __init__(
        self,
        *,
        judge: Judge,
        game_name: str,
        game_rules: str,
        agents: Iterable[AgentDefinition],
    ) -> None:
        self.judge = judge
        self.game_name = game_name
        self.game_rules = game_rules
        self._agents: List[AgentDefinition] = list(agents)
        self._lock = threading.Lock()
        self._round = 0
        self._last_judge_message = ""
        self._history: List[Dict[str, Any]] = []
        self._created_at = datetime.now(timezone.utc).isoformat()

    def is_judge(self, account_id: int) -> bool:
        return self.judge.id == account_id

    def start_round(self, judge_message: str) -> int:
        with self._lock:
            self._round += 1
            round_number = self._round
            self._last_judge_message = judge_message.strip()
            self._append_message(
                message_type="system",
                author="系统",
                content=f"第 {round_number} 回合开始。",
                round_number=round_number,
            )
            if judge_message.strip():
                self._append_message(
                    message_type="judge",
                    author=self.judge.username,
                    content=judge_message.strip(),
                    round_number=round_number,
                )
            return round_number

    def run_agent_turn(self, agent: AgentDefinition, round_number: int) -> str:
        with self._lock:
            last_message = self._history[-1]["content"] if self._history else ""
            judge_message = self._last_judge_message
        context = build_dialogue_context(
            agent=agent,
            game_name=self.game_name,
            game_rules=self.game_rules,
            round_number=round_number,
            judge_message=judge_message,
            last_message=last_message,
        )
        response = ""
        try:
            response = llm_gateway.generate_response(agent, context)
        except LLMGenerationError as error:
            logger.warning(
                "使用外部模型为 %s 生成回复失败：%s，改用示例模版。",
                agent.agent_id,
                error,
            )
        except Exception as error:  # pragma: no cover - defensive fallback
            logger.exception("生成 %s 回复时出现未处理异常", agent.agent_id)

        if not response.strip():
            response = agent.render_dialogue(context)
        with self._lock:
            self._append_message(
                message_type="ai",
                author=agent.display_name,
                content=response,
                round_number=round_number,
                agent_id=agent.agent_id,
            )
        return response

    def append_initial_message(self) -> None:
        summary = (
            f"裁判 {self.judge.username} 创建了博弈《{self.game_name}》。规则：{self.game_rules}"
        )
        self._append_message(
            message_type="system",
            author="系统",
            content=summary,
            round_number=0,
        )

    def to_payload(self) -> Dict[str, Any]:
        with self._lock:
            room = {
                "id": "main",
                "gameName": self.game_name,
                "gameRules": self.game_rules,
                "round": self._round,
                "createdAt": self._created_at,
                "judge": self.judge.to_dict(),
                "agents": [
                    {
                        "id": agent.agent_id,
                        "displayName": agent.display_name,
                        "provider": agent.provider,
                        "description": agent.description,
                    }
                    for agent in self._agents
                ],
            }
            history = list(self._history)
        return {"room": room, "history": history}

    def get_agents(self) -> List[AgentDefinition]:
        return list(self._agents)

    def _append_message(
        self,
        *,
        message_type: str,
        author: str,
        content: str,
        round_number: int,
        agent_id: Optional[str] = None,
    ) -> None:
        entry = {
            "type": message_type,
            "author": author,
            "content": content,
            "round": round_number,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        if agent_id:
            entry["agentId"] = agent_id
        self._history.append(entry)


class BattleRoomManager:
    def __init__(self, registry: AgentRegistry) -> None:
        self._registry = registry
        self._lock = threading.Lock()
        self._room: Optional[BattleRoom] = None
        self._clients: set[Any] = set()

    def create_room(
        self,
        *,
        judge_account: Dict[str, Any],
        game_name: str,
        game_rules: str,
        agent_ids: List[str],
    ) -> BattleRoom:
        cleaned_ids = [agent_id.strip() for agent_id in agent_ids if str(agent_id).strip()]
        if len(cleaned_ids) < 4 or len(cleaned_ids) > 5:
            raise ValueError("必须选择 4 或 5 个 AI 参与博弈。")
        if len(set(cleaned_ids)) != len(cleaned_ids):
            raise ValueError("请勿重复选择相同的 AI。")

        name = game_name.strip()
        rules = game_rules.strip()
        if not name:
            raise ValueError("游戏名称不能为空。")
        if not rules:
            raise ValueError("游戏规则不能为空。")

        agents = [self._registry.get_agent(agent_id) for agent_id in cleaned_ids]

        judge = Judge(id=int(judge_account["id"]), username=str(judge_account["username"]))
        room = BattleRoom(judge=judge, game_name=name, game_rules=rules, agents=agents)
        room.append_initial_message()

        with self._lock:
            if self._room is not None:
                raise RoomAlreadyExistsError("房间已存在")
            self._room = room

        self._broadcast_state()
        return room

    def advance_round(self, *, account: Dict[str, Any], judge_message: str) -> BattleRoom:
        room = self._require_room()
        if not room.is_judge(int(account["id"])):
            raise RoomPermissionError("只有裁判可以触发回合。")

        round_number = room.start_round(judge_message)
        self._broadcast_state()
        for agent in room.get_agents():
            room.run_agent_turn(agent, round_number)
            self._broadcast_state()
        return room

    def close_room(self, *, account: Dict[str, Any]) -> None:
        with self._lock:
            room = self._room
            if room is None:
                raise RoomNotFoundError("房间不存在")
            if not room.is_judge(int(account["id"])):
                raise RoomPermissionError("只有裁判可以结束房间。")
            self._room = None
        self._broadcast_state()

    def get_state(self) -> Optional[Dict[str, Any]]:
        room = self._get_room()
        if not room:
            return None
        return room.to_payload()

    def register_socket(self, ws: Any) -> None:
        with self._lock:
            self._clients.add(ws)
            room = self._room
        if room is None:
            self._send(ws, {"type": "room_closed"})
        else:
            payload = room.to_payload()
            payload["type"] = "room_state"
            self._send(ws, payload)

    def unregister_socket(self, ws: Any) -> None:
        with self._lock:
            self._clients.discard(ws)

    def _require_room(self) -> BattleRoom:
        room = self._get_room()
        if room is None:
            raise RoomNotFoundError("房间不存在")
        return room

    def _get_room(self) -> Optional[BattleRoom]:
        with self._lock:
            return self._room

    def _broadcast_state(self) -> None:
        with self._lock:
            clients = list(self._clients)
            room = self._room

        if not clients:
            return

        if room is None:
            payload = {"type": "room_closed"}
        else:
            payload = room.to_payload()
            payload["type"] = "room_state"

        data = json.dumps(payload, ensure_ascii=False)

        stale: List[Any] = []
        for ws in clients:
            try:
                ws.send(data)
            except Exception:
                stale.append(ws)

        if stale:
            with self._lock:
                for ws in stale:
                    self._clients.discard(ws)

    @staticmethod
    def _send(ws: Any, payload: Dict[str, Any]) -> None:
        try:
            ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass

