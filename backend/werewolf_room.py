from __future__ import annotations

import json
import logging
import random
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from backend.ai_registry import AgentDefinition, AgentRegistry
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


@dataclass
class WerewolfPlayer:
    agent: AgentDefinition
    role: str
    alive: bool = True
    knowledge: List[str] = field(default_factory=list)

    def to_public_dict(self, *, reveal_role: bool = False) -> Dict[str, Any]:
        payload = {
            "id": self.agent.agent_id,
            "displayName": self.agent.display_name,
            "provider": self.agent.provider,
            "description": self.agent.description,
            "alive": self.alive,
        }
        if reveal_role:
            payload["role"] = self.role
        return payload


ROLE_TITLES: Dict[str, str] = {
    "werewolf": "狼人",
    "seer": "预言家",
    "witch": "女巫",
    "hunter": "猎人",
    "villager": "村民",
}

ROLE_BEHAVIORS: Dict[str, str] = {
    "werewolf": "你是一名狼人，与同伴在夜晚暗中合作袭击村民，白天需要伪装成好人并转移怀疑。",
    "seer": "你是预言家，夜晚可以探查一名玩家的阵营，白天要谨慎地引导村民。",
    "witch": "你是女巫，手握一瓶解药和一瓶毒药。你知道夜晚的被袭击者，可以选择救或毒。",
    "hunter": "你是猎人，如果被处决可以发动最后一枪带走一名嫌疑人。",
    "villager": "你是普通村民，没有技能，依靠逻辑与直觉找出狼人。",
}

PHASE_TITLES: Dict[str, str] = {
    "setup": "准备阶段",
    "night": "夜晚",
    "day": "白天",
    "ended": "游戏结束",
}


class WerewolfRoom:
    def __init__(
        self,
        *,
        judge: Judge,
        village_name: str,
        background: str,
        special_rules: str,
        agents: Iterable[AgentDefinition],
    ) -> None:
        self.judge = judge
        self.village_name = village_name
        self.background = background
        self.special_rules = special_rules
        self._agents: List[AgentDefinition] = list(agents)
        self._players: List[WerewolfPlayer] = self._assign_roles(self._agents)
        self._lock = threading.Lock()
        self._phase = "setup"
        self._day = 0
        self._last_judge_message = ""
        self._history: List[Dict[str, Any]] = []
        self._created_at = datetime.now(timezone.utc).isoformat()
        self._consumed_save = False
        self._consumed_poison = False
        random.shuffle(self._players)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def is_judge(self, account_id: int) -> bool:
        return self.judge.id == account_id

    def start_game(self, judge_message: str) -> None:
        with self._lock:
            if self._phase != "setup":
                return
            self._day = 1
            self._phase = "night"
            self._last_judge_message = judge_message.strip()
            self._append_message(
                message_type="system",
                author="主持人",
                content=(
                    f"AI 狼人杀《{self.village_name}》开局。背景：{self.background}"
                    + (f" 特殊规则：{self.special_rules}" if self.special_rules else "")
                ),
                phase=self._phase,
            )
            if judge_message.strip():
                self._append_message(
                    message_type="judge",
                    author=self.judge.username,
                    content=judge_message.strip(),
                    phase=self._phase,
                )
            self._append_message(
                message_type="system",
                author="主持人",
                content=self._format_player_lineup(),
                phase=self._phase,
            )

    def advance(self, judge_message: str) -> str:
        with self._lock:
            if self._phase == "ended":
                raise RuntimeError("游戏已结束")

            cleaned_message = judge_message.strip()
            if cleaned_message:
                self._append_message(
                    message_type="judge",
                    author=self.judge.username,
                    content=cleaned_message,
                    phase=self._phase,
                )
                self._last_judge_message = cleaned_message

            if self._phase == "setup":
                self.start_game(cleaned_message)
                self._run_night_phase()
            elif self._phase == "night":
                self._run_night_phase()
            elif self._phase == "day":
                self._run_day_phase()
            else:
                raise RuntimeError(f"未知阶段：{self._phase}")

            return self._phase

    def to_payload(self) -> Dict[str, Any]:
        with self._lock:
            room = {
                "id": "werewolf",
                "gameName": self.village_name,
                "background": self.background,
                "specialRules": self.special_rules,
                "phase": self._phase,
                "phaseTitle": PHASE_TITLES.get(self._phase, self._phase),
                "day": self._day,
                "createdAt": self._created_at,
                "judge": self.judge.to_dict(),
                "players": [
                    player.to_public_dict(reveal_role=self._phase == "ended")
                    for player in self._players
                ],
                "lastJudgeMessage": self._last_judge_message,
            }
            history = list(self._history)
        return {"room": room, "history": history}

    def get_players(self) -> List[WerewolfPlayer]:
        with self._lock:
            return list(self._players)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _run_night_phase(self) -> None:
        self._phase = "night"
        self._night_target = None
        self._seer_reveal = None
        self._append_message(
            message_type="system",
            author="主持人",
            content=f"第 {self._day} 天夜晚降临，所有玩家闭眼。",
            phase="night",
        )

        self._execute_werewolf_actions()
        self._execute_seer_action()
        self._execute_witch_action()

        outcome = self._resolve_night_outcome()
        self._append_message(
            message_type="system",
            author="主持人",
            content=outcome,
            phase="night",
        )

        if self._phase != "ended":
            self._phase = "day"
            self._append_message(
                message_type="system",
                author="主持人",
                content=f"天亮了，第 {self._day} 天白天开始。",
                phase="day",
            )
            self._run_day_phase()

    def _run_day_phase(self) -> None:
        if self._phase != "day":
            self._phase = "day"
        speeches = self._collect_day_speeches()
        for speech in speeches:
            self._history.append(speech)

        elimination = self._execute_vote()
        if elimination:
            self._append_message(
                message_type="system",
                author="主持人",
                content=elimination,
                phase="day",
            )

        self._check_game_end()

        if self._phase != "ended":
            self._day += 1
            self._phase = "night"
            self._append_message(
                message_type="system",
                author="主持人",
                content=f"进入第 {self._day} 天夜晚。",
                phase="night",
            )

    def _execute_werewolf_actions(self) -> None:
        wolves = [player for player in self._players if player.role == "werewolf" and player.alive]
        if not wolves:
            return
        others = [player for player in self._players if player.role != "werewolf" and player.alive]
        target = random.choice(others) if others else None
        target_name = target.agent.display_name if target else "无人"

        for wolf in wolves:
            context = self._build_context(
                player=wolf,
                phase="夜晚",
                objective=f"与你的狼同伴确定袭击目标，目前倾向于：{target_name}",
            )
            response = self._call_agent(wolf.agent, context)
            self._append_message(
                message_type="ai",
                author=wolf.agent.display_name,
                content=response,
                phase="night",
                agent_id=wolf.agent.agent_id,
            )
        self._night_target = target

    def _execute_seer_action(self) -> None:
        seers = [player for player in self._players if player.role == "seer" and player.alive]
        if not seers:
            return
        seer = seers[0]
        candidates = [player for player in self._players if player != seer and player.alive]
        if not candidates:
            return
        target = random.choice(candidates)
        info = f"你今夜查验 {target.agent.display_name}，他/她的身份是：{ROLE_TITLES.get(target.role, target.role)}"
        context = self._build_context(
            player=seer,
            phase="夜晚",
            objective=info,
        )
        response = self._call_agent(seer.agent, context)
        self._append_message(
            message_type="ai",
            author=seer.agent.display_name,
            content=response,
            phase="night",
            agent_id=seer.agent.agent_id,
        )
        self._seer_reveal = target

    def _execute_witch_action(self) -> None:
        witch_players = [player for player in self._players if player.role == "witch" and player.alive]
        if not witch_players:
            return
        witch = witch_players[0]
        target_name = self._night_target.agent.display_name if getattr(self, "_night_target", None) else "无人"

        actions: List[str] = []
        if self._night_target and not self._consumed_save:
            actions.append("救援")
        if not self._consumed_poison:
            actions.append("放毒")
        if not actions:
            actions.append("旁观")

        chosen_action = random.choice(actions)
        if chosen_action == "救援":
            self._consumed_save = True
            decision = f"你决定使用解药救下 {target_name}" if target_name != "无人" else "今晚没有人遇袭，无需使用解药"
            self._night_target = None
        elif chosen_action == "放毒":
            self._consumed_poison = True
            victims = [player for player in self._players if player.role != "witch" and player.alive]
            poison_target = random.choice(victims) if victims else None
            if poison_target:
                poison_target.alive = False
                decision = f"你暗中对 {poison_target.agent.display_name} 使用了毒药。"
            else:
                decision = "你没有找到合适的对象，保留毒药。"
        else:
            decision = "你选择保持沉默，今晚不使用药水。"

        context = self._build_context(
            player=witch,
            phase="夜晚",
            objective=f"{decision} 当前夜晚信息：可能的袭击目标是 {target_name}",
        )
        response = self._call_agent(witch.agent, context)
        self._append_message(
            message_type="ai",
            author=witch.agent.display_name,
            content=response,
            phase="night",
            agent_id=witch.agent.agent_id,
        )

    def _resolve_night_outcome(self) -> str:
        victim = getattr(self, "_night_target", None)
        self._night_target = None
        if victim and victim.alive:
            victim.alive = False
            if victim.role == "hunter":
                self._trigger_hunter_revenge(victim)
            return f"天亮后发现 {victim.agent.display_name} 遭遇不幸，真实身份是 {ROLE_TITLES.get(victim.role, victim.role)}。"
        return "天亮后没有发现伤亡。"

    def _trigger_hunter_revenge(self, hunter: WerewolfPlayer) -> None:
        alive_targets = [player for player in self._players if player.alive and player != hunter]
        if not alive_targets:
            return
        target = random.choice(alive_targets)
        target.alive = False
        self._append_message(
            message_type="system",
            author="主持人",
            content=(
                f"猎人 {hunter.agent.display_name} 临死前开枪带走了 {target.agent.display_name}。"
                f"他/她的身份是 {ROLE_TITLES.get(target.role, target.role)}。"
            ),
            phase=self._phase,
        )

    def _collect_day_speeches(self) -> List[Dict[str, Any]]:
        speeches: List[Dict[str, Any]] = []
        alive_players = [player for player in self._players if player.alive]
        history_preview = self._history[-3:]
        history_text = "\n".join(entry["content"] for entry in history_preview)

        for player in alive_players:
            perspective = self._describe_perspective(player)
            context = self._build_context(
                player=player,
                phase="白天",
                objective=f"公开发表立场并投出怀疑票。{perspective}",
                history=history_text,
            )
            response = self._call_agent(player.agent, context)
            speeches.append(
                {
                    "type": "ai",
                    "author": player.agent.display_name,
                    "content": response,
                    "phase": PHASE_TITLES.get("day", "白天"),
                    "phaseCode": "day",
                    "round": self._day,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "agentId": player.agent.agent_id,
                }
            )
        return speeches

    def _describe_perspective(self, player: WerewolfPlayer) -> str:
        if player.role == "werewolf":
            wolves = [p.agent.display_name for p in self._players if p.role == "werewolf" and p != player]
            allies = "、".join(wolves) if wolves else "无同伴"
            return f"你是狼人，需要保护同伴（{allies}）并误导投票。"
        if player.role == "seer":
            target = getattr(self, "_seer_reveal", None)
            if target:
                return f"你昨夜查验 {target.agent.display_name}，真实身份为 {ROLE_TITLES.get(target.role, target.role)}。"
            return "你昨晚未获得额外情报。"
        if player.role == "witch":
            return "你知道夜晚的袭击情况，可根据局势透露信息或隐藏身份。"
        if player.role == "hunter":
            return "若你被投票出局，可以发动猎人技能，请在发言中暗示或威慑狼阵营。"
        return "你是普通村民，根据公开线索推理出狼人。"

    def _execute_vote(self) -> Optional[str]:
        alive_players = [player for player in self._players if player.alive]
        if len(alive_players) <= 2:
            return None
        suspects = [player for player in alive_players if player.role != "werewolf"]
        if not suspects:
            suspects = alive_players
        voted = random.choice(suspects)
        voted.alive = False
        if voted.role == "hunter":
            self._trigger_hunter_revenge(voted)
        return (
            f"公开投票中，{voted.agent.display_name} 被多数人选中出局，身份为 {ROLE_TITLES.get(voted.role, voted.role)}。"
        )

    def _check_game_end(self) -> None:
        wolves_alive = sum(1 for player in self._players if player.role == "werewolf" and player.alive)
        villagers_alive = sum(1 for player in self._players if player.role != "werewolf" and player.alive)
        if wolves_alive == 0:
            self._phase = "ended"
            self._append_message(
                message_type="system",
                author="主持人",
                content="狼人全部被消灭，村民阵营获胜！",
                phase="ended",
            )
        elif wolves_alive >= villagers_alive:
            self._phase = "ended"
            self._append_message(
                message_type="system",
                author="主持人",
                content="狼人数量不再劣势，夜幕笼罩村庄，狼人阵营胜利。",
                phase="ended",
            )

    def _build_context(
        self,
        *,
        player: WerewolfPlayer,
        phase: str,
        objective: str,
        history: str | None = None,
    ) -> Dict[str, Any]:
        alive_names = [p.agent.display_name for p in self._players if p.alive]
        return {
            "agent_name": player.agent.display_name,
            "agent_id": player.agent.agent_id,
            "game_name": f"{self.village_name} 的狼人杀",
            "game_rules": self._compose_rules_text(),
            "round": self._day,
            "judge_message": self._last_judge_message,
            "phase": phase,
            "role": ROLE_TITLES.get(player.role, player.role),
            "role_brief": ROLE_BEHAVIORS.get(player.role, ""),
            "objective": objective,
            "alive_players": ", ".join(alive_names),
            "history_summary": history or "",
        }

    def _compose_rules_text(self) -> str:
        rules = [f"背景：{self.background}"]
        if self.special_rules:
            rules.append(f"特殊规则：{self.special_rules}")
        return " | ".join(rules)

    def _call_agent(self, agent: AgentDefinition, context: Dict[str, Any]) -> str:
        response = ""
        try:
            response = llm_gateway.generate_response(agent, context)
        except LLMGenerationError as error:
            logger.warning("使用外部模型为 %s 生成狼人杀发言失败：%s", agent.agent_id, error)
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception("生成 %s 狼人杀发言时出现异常", agent.agent_id)
        if not response.strip():
            response = self._fallback_dialogue(agent, context)
        return response

    def _fallback_dialogue(self, agent: AgentDefinition, context: Dict[str, Any]) -> str:
        template = (
            "我是 {agent_name}，当前阶段为 {phase}，身份是 {role}。"
            "我的任务：{objective}。当前仍在场的玩家：{alive_players}。"
        )
        try:
            return template.format(**context)
        except Exception:
            return (
                f"{agent.display_name} 在{context.get('phase', '狼人杀')}阶段给出默认回应。"
            )

    def _append_message(
        self,
        *,
        message_type: str,
        author: str,
        content: str,
        phase: str,
        agent_id: Optional[str] = None,
    ) -> None:
        phase_label = PHASE_TITLES.get(phase, phase)
        entry: Dict[str, Any] = {
            "type": message_type,
            "author": author,
            "content": content,
            "phase": phase_label,
            "phaseCode": phase,
            "round": self._day,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        if agent_id:
            entry["agentId"] = agent_id
        self._history.append(entry)

    def _format_player_lineup(self) -> str:
        names = ", ".join(player.agent.display_name for player in self._players)
        return f"参战 AI 阵容：{names}。身份已秘密分配。"

    @staticmethod
    def _assign_roles(agents: Iterable[AgentDefinition]) -> List[WerewolfPlayer]:
        agent_list = list(agents)
        if len(agent_list) < 5:
            raise ValueError("狼人杀至少需要 5 名玩家。")
        roles = ["werewolf", "werewolf", "seer", "villager", "villager"]
        if len(agent_list) >= 6:
            roles.append("witch")
        if len(agent_list) >= 7:
            roles.append("hunter")
        while len(roles) < len(agent_list):
            roles.append("villager")
        random.shuffle(roles)
        players: List[WerewolfPlayer] = []
        for agent, role in zip(agent_list, roles):
            players.append(WerewolfPlayer(agent=agent, role=role))
        return players


class WerewolfRoomManager:
    def __init__(self, registry: AgentRegistry) -> None:
        self._registry = registry
        self._lock = threading.Lock()
        self._room: Optional[WerewolfRoom] = None
        self._clients: set[Any] = set()

    def create_room(
        self,
        *,
        judge_account: Dict[str, Any],
        village_name: str,
        background: str,
        special_rules: str,
        agent_ids: List[str],
        opening_brief: str,
    ) -> WerewolfRoom:
        cleaned_ids = [agent_id.strip() for agent_id in agent_ids if str(agent_id).strip()]
        if len(cleaned_ids) < 5:
            raise ValueError("必须至少选择 5 个 AI 参与狼人杀。")
        if len(set(cleaned_ids)) != len(cleaned_ids):
            raise ValueError("请勿重复选择相同的 AI。")

        name = village_name.strip()
        story = background.strip()
        if not name:
            raise ValueError("村庄名称不能为空。")
        if not story:
            raise ValueError("背景故事不能为空。")

        rules = special_rules.strip()

        agents = [self._registry.get_agent(agent_id) for agent_id in cleaned_ids]
        judge = Judge(id=int(judge_account["id"]), username=str(judge_account["username"]))
        room = WerewolfRoom(
            judge=judge,
            village_name=name,
            background=story,
            special_rules=rules,
            agents=agents,
        )

        with self._lock:
            if self._room is not None:
                raise RoomAlreadyExistsError("狼人杀房间已存在")
            self._room = room

        room.start_game(opening_brief)

        self._broadcast_state()
        return room

    def advance_phase(self, *, account: Dict[str, Any], judge_message: str) -> WerewolfRoom:
        room = self._require_room()
        if not room.is_judge(int(account["id"])):
            raise RoomPermissionError("只有主持人可以推进阶段。")

        room.advance(judge_message)
        self._broadcast_state()
        return room

    def close_room(self, *, account: Dict[str, Any]) -> None:
        with self._lock:
            room = self._room
            if room is None:
                raise RoomNotFoundError("房间不存在")
            if not room.is_judge(int(account["id"])):
                raise RoomPermissionError("只有主持人可以结束房间。")
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

    def _require_room(self) -> WerewolfRoom:
        room = self._get_room()
        if room is None:
            raise RoomNotFoundError("房间不存在")
        return room

    def _get_room(self) -> Optional[WerewolfRoom]:
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
