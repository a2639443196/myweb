from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import current_app

from backend.ai_registry import AgentDefinition, AgentRegistry
from backend.llm_gateway import LLMGateway
from liars_bar_llm import Game, Player


class GameAlreadyRunningError(RuntimeError):
    """Raised when attempting to start a new game while one is active."""


class GameNotFoundError(RuntimeError):
    """Raised when operations require an active game but none exists."""


class AgentBackedLLMClient:
    """Adapter that lets Liars Bar players talk to models managed by AgentRegistry."""

    def __init__(self, agent: AgentDefinition, gateway: LLMGateway) -> None:
        self._agent = agent
        self._gateway = gateway

    def chat(self, messages: List[Dict[str, Any]], model: Optional[str] = None) -> tuple[str, Optional[str]]:
        chat_messages: List[Dict[str, Any]] = []
        for message in messages:
            role = str(message.get("role", "user"))
            content = message.get("content", "")
            chat_messages.append({"role": role, "content": content})
        return self._gateway.send_chat(
            self._agent,
            chat_messages,  # type: ignore[arg-type]
            model_override=model,
        )


class LiarsBarGameManager:
    def __init__(self, registry: AgentRegistry) -> None:
        self._registry = registry
        self._gateway = LLMGateway()
        self._lock = threading.Lock()
        self._game: Optional[Game] = None
        self._game_thread: Optional[threading.Thread] = None
        self._history: List[Dict[str, Any]] = []
        self._state: Optional[Dict[str, Any]] = None
        self._player_state: Dict[str, Dict[str, Any]] = {}
        self._player_meta: Dict[str, Dict[str, Any]] = {}
        self._player_order: List[str] = []
        self._sockets: set[Any] = set()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def create_game(
        self,
        *,
        creator: Dict[str, Any],
        title: str,
        scenario: str,
        agent_ids: List[str],
    ) -> Dict[str, Any]:
        with self._lock:
            if self._game is not None and self._game_thread and self._game_thread.is_alive():
                raise GameAlreadyRunningError("已有游戏正在运行。")

            if len(agent_ids) < 2:
                raise ValueError("请选择至少 2 名 AI 玩家。")

            player_configs: List[Dict[str, Any]] = []
            self._player_meta = {}
            self._player_state = {}
            self._player_order = []

            for agent_id in agent_ids:
                agent = self._registry.get_agent(agent_id)
                display_name = agent.display_name or agent.agent_id
                model_name = self._resolve_model(agent)
                config = {"name": display_name, "model": model_name, "_agent": agent}
                player_configs.append(config)
                self._player_meta[display_name] = {
                    "agentId": agent.agent_id,
                    "provider": agent.provider,
                    "model": model_name,
                    "description": agent.description,
                }
                self._player_state[display_name] = {
                    "name": display_name,
                    "alive": True,
                    "handSize": 0,
                    "hand": [],
                    "bulletPosition": None,
                    "currentChamber": None,
                }
                self._player_order.append(display_name)

            game_id = str(uuid.uuid4())
            created_at = self._now_iso()
            self._state = {
                "id": game_id,
                "title": title or "AI 骗子酒馆对决",
                "scenario": scenario,
                "status": "preparing",
                "createdAt": created_at,
                "creator": {
                    "id": creator.get("id"),
                    "username": creator.get("username"),
                },
                "round": 0,
                "targetCard": None,
                "currentPlayer": None,
                "players": self._serialize_players_locked(),
                "winner": None,
            }
            self._history = []

            def factory(config: Dict[str, Any]) -> Player:
                agent = config.get("_agent")
                if not isinstance(agent, AgentDefinition):
                    raise RuntimeError("缺少与玩家配置关联的 Agent 定义。")
                llm_client = AgentBackedLLMClient(agent, self._gateway)
                return Player(config["name"], config["model"], llm_client=llm_client)

            self._game = Game(
                player_configs,
                player_factory=factory,
                event_callback=self._handle_event,
            )
            self._game_thread = threading.Thread(target=self._run_game, args=(self._game,), daemon=True)
            self._game_thread.start()

            snapshot = self._snapshot_locked()

        self._broadcast(snapshot)
        return snapshot

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            return self._snapshot_locked()

    def close_game(self) -> None:
        with self._lock:
            if self._game is None:
                raise GameNotFoundError("当前没有正在运行的游戏。")
            self._game.request_stop()
            thread = self._game_thread
        if thread:
            thread.join(timeout=5)
        with self._lock:
            if self._state:
                self._state["status"] = "stopped"
            snapshot = self._snapshot_locked()
        self._broadcast(snapshot)

    def register_socket(self, ws: Any) -> None:
        with self._lock:
            self._sockets.add(ws)
            snapshot = self._snapshot_locked()
        try:
            ws.send(json.dumps({"type": "game_state", **snapshot}, ensure_ascii=False))
        except Exception:
            self.unregister_socket(ws)

    def unregister_socket(self, ws: Any) -> None:
        with self._lock:
            self._sockets.discard(ws)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _run_game(self, game: Game) -> None:
        try:
            game.start_game()
            with self._lock:
                if self._state and self._state["status"] != "stopped":
                    self._state["status"] = "finished"
        except Exception as exc:  # pragma: no cover - defensive
            current_app.logger.exception("骗子酒馆游戏崩溃：%s", exc)
            with self._lock:
                if self._state:
                    self._state["status"] = "error"
                    self._state["error"] = str(exc)
                self._history.append(self._build_history_entry("error", {"message": str(exc)}))
        finally:
            with self._lock:
                self._game = None
                self._game_thread = None
                snapshot = self._snapshot_locked()
        self._broadcast(snapshot)

    def _handle_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        entry = self._build_history_entry(event_type, payload)
        with self._lock:
            self._apply_state_update(event_type, payload)
            if entry:
                self._history.append(entry)
                if len(self._history) > 300:
                    self._history = self._history[-300:]
            snapshot = self._snapshot_locked()
        self._broadcast(snapshot)

    def _broadcast(self, snapshot: Dict[str, Any]) -> None:
        if not self._sockets:
            return
        payload = json.dumps({"type": "game_state", **snapshot}, ensure_ascii=False)
        stale: List[Any] = []
        for ws in list(self._sockets):
            try:
                ws.send(payload)
            except Exception:
                stale.append(ws)
        if stale:
            with self._lock:
                for ws in stale:
                    self._sockets.discard(ws)

    def _apply_state_update(self, event_type: str, payload: Dict[str, Any]) -> None:
        if not self._state:
            return
        if event_type == "setup":
            players = payload.get("players", [])
            for player in players:
                name = player.get("name")
                if not name:
                    continue
                state = self._player_state.setdefault(name, {})
                state.update({
                    "name": name,
                    "alive": player.get("alive", True),
                    "handSize": player.get("handSize", 0),
                    "hand": player.get("hand", []),
                    "bulletPosition": player.get("bulletPosition"),
                    "currentChamber": player.get("currentChamber"),
                })
        elif event_type == "cards_dealt":
            for player in payload.get("players", []):
                name = player.get("name")
                if not name:
                    continue
                state = self._player_state.get(name)
                if state:
                    state.update({
                        "hand": player.get("hand", []),
                        "handSize": len(player.get("hand", [])),
                        "bulletPosition": player.get("bulletPosition"),
                        "currentChamber": player.get("currentChamber"),
                    })
            self._state["status"] = "running"
        elif event_type == "target_selected":
            self._state["targetCard"] = payload.get("targetCard")
        elif event_type == "round_started":
            self._state["round"] = payload.get("round", self._state.get("round", 0))
            starting = payload.get("startingPlayer")
            if starting:
                self._state["currentPlayer"] = starting
        elif event_type == "round_reset":
            self._state["round"] = payload.get("round", self._state.get("round", 0))
            current = payload.get("currentPlayer")
            if current:
                self._state["currentPlayer"] = current
        elif event_type == "turn_started":
            player = payload.get("player")
            if player:
                self._state["currentPlayer"] = player
                state = self._player_state.get(player)
                if state:
                    state["hand"] = payload.get("hand", state.get("hand", []))
                    state["handSize"] = len(state.get("hand", []))
        elif event_type == "play":
            player = payload.get("player")
            if player:
                state = self._player_state.get(player)
                if state:
                    state["hand"] = payload.get("remainingCards", state.get("hand", []))
                    state["handSize"] = len(state.get("hand", []))
        elif event_type == "challenge":
            pass
        elif event_type == "penalty":
            player = payload.get("player")
            if player:
                state = self._player_state.get(player)
                if state:
                    state["alive"] = payload.get("alive", state.get("alive", True))
        elif event_type == "system_challenge":
            pass
        elif event_type == "reflection":
            player = payload.get("player")
            if player:
                state = self._player_state.get(player)
                if state:
                    state["lastReflection"] = payload.get("insights")
        elif event_type == "game_finished":
            self._state["winner"] = payload.get("winner")
            self._state["status"] = "finished"
        elif event_type == "game_started":
            self._state["status"] = "running"

        self._state["players"] = self._serialize_players_locked()

    def _build_history_entry(self, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = payload.get("createdAt", self._now_iso())
        author = "系统"
        thinking = payload.get("thinking")
        summary = ""

        if event_type == "setup":
            names = [player.get("name") for player in payload.get("players", [])]
            summary = "参赛 AI：" + "、".join(filter(None, names))
        elif event_type == "game_started":
            summary = "骗子酒馆对决开始。"
        elif event_type == "cards_dealt":
            summary = "发牌完成，每位玩家获得 5 张牌。"
        elif event_type == "target_selected":
            summary = f"目标牌为 {payload.get('targetCard')}。"
        elif event_type == "round_started":
            summary = f"第 {payload.get('round')} 轮开始，{payload.get('startingPlayer')} 先手。"
        elif event_type == "turn_started":
            author = payload.get("player", author)
            summary = f"轮到 {author} 出牌。"
        elif event_type == "play":
            author = payload.get("player", author)
            cards = payload.get("playedCards", [])
            reason = payload.get("reason")
            summary = f"宣称打出 {len(cards)} 张牌：{'、'.join(cards)}。理由：{reason}"
        elif event_type == "challenge":
            author = payload.get("challenger", author)
            target = payload.get("target")
            success = payload.get("success")
            reason = payload.get("reason")
            if success is True:
                summary = f"质疑 {target} 成功：{reason}"
            elif success is False:
                summary = f"质疑 {target} 失败：{reason}"
            else:
                summary = f"选择不质疑 {target}：{reason}"
        elif event_type == "penalty":
            player = payload.get("player")
            summary = f"{player} 开枪，结果：{'存活' if payload.get('alive') else '阵亡'}。"
        elif event_type == "system_challenge":
            player = payload.get("player")
            if payload.get("success"):
                summary = f"系统质疑 {player} 成功，触发惩罚。"
            else:
                summary = f"系统质疑 {player} 失败，进入新一轮。"
        elif event_type == "reflection":
            author = payload.get("player", author)
            insights = payload.get("insights", {})
            targets = "；".join(f"{name}: {text}" for name, text in insights.items())
            summary = f"反思更新：{targets}" if targets else "完成反思。"
        elif event_type == "game_finished":
            summary = f"游戏结束，{payload.get('winner')} 获胜！"
        elif event_type == "error":
            summary = payload.get("message", "游戏出现异常。")

        return {
            "type": event_type,
            "author": author,
            "content": summary,
            "thinking": thinking,
            "details": payload,
            "createdAt": timestamp,
        }

    def _serialize_players_locked(self) -> List[Dict[str, Any]]:
        players: List[Dict[str, Any]] = []
        for name in self._player_order:
            state = self._player_state.get(name, {}).copy()
            meta = self._player_meta.get(name, {})
            state.update(meta)
            players.append(state)
        return players

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _resolve_model(agent: AgentDefinition) -> str:
        model = agent.metadata.get("model_override") if agent.metadata else None
        model = model or agent.model
        if not model:
            raise ValueError(f"Agent {agent.agent_id} 未配置模型。")
        return str(model)

    def _snapshot_locked(self) -> Dict[str, Any]:
        return {
            "game": json.loads(json.dumps(self._state, ensure_ascii=False)) if self._state else None,
            "history": json.loads(json.dumps(self._history, ensure_ascii=False)),
        }
