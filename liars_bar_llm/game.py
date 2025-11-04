from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from .game_record import GameRecord, PlayerInitialState
from .player import Player

EventCallback = Callable[[str, Dict[str, object]], None]
PlayerFactory = Callable[[Dict[str, str]], Player]


class Game:
    def __init__(
        self,
        player_configs: List[Dict[str, str]],
        *,
        player_factory: Optional[PlayerFactory] = None,
        event_callback: Optional[EventCallback] = None,
    ) -> None:
        """初始化游戏"""
        factory = player_factory or (lambda config: Player(config["name"], config["model"]))
        self.players = [factory(config) for config in player_configs]
        for player in self.players:
            player.init_opinions(self.players)

        self.deck: List[str] = []
        self.target_card: Optional[str] = None
        self.current_player_idx: int = random.randint(0, len(self.players) - 1)
        self.last_shooter_name: Optional[str] = None
        self.game_over: bool = False
        self._stop_requested = False
        self._event_callback = event_callback

        self.game_record: GameRecord = GameRecord()
        self.game_record.start_game([p.name for p in self.players])
        self.round_count = 0

        self._emit_event(
            "setup",
            {
                "players": self._serialize_players(include_hand=True),
                "createdAt": self._now_iso(),
            },
        )

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------
    def request_stop(self) -> None:
        self._stop_requested = True

    # ------------------------------------------------------------------
    # 核心流程
    # ------------------------------------------------------------------
    def _create_deck(self) -> List[str]:
        deck = ["Q"] * 6 + ["K"] * 6 + ["A"] * 6 + ["Joker"] * 2
        random.shuffle(deck)
        return deck

    def deal_cards(self) -> None:
        self.deck = self._create_deck()
        for player in self.players:
            if player.alive:
                player.hand.clear()
        for _ in range(5):
            for player in self.players:
                if player.alive and self.deck:
                    player.hand.append(self.deck.pop())
                    player.print_status()
        self._emit_event(
            "cards_dealt",
            {
                "players": self._serialize_players(include_hand=True),
                "round": self.round_count + 1,
                "createdAt": self._now_iso(),
            },
        )

    def choose_target_card(self) -> None:
        self.target_card = random.choice(["Q", "K", "A"])
        self._emit_event(
            "target_selected",
            {
                "targetCard": self.target_card,
                "round": self.round_count + 1,
                "createdAt": self._now_iso(),
            },
        )

    def start_round_record(self) -> None:
        self.round_count += 1
        starting_player = self.players[self.current_player_idx].name
        player_initial_states = [
            PlayerInitialState(
                player_name=player.name,
                bullet_position=player.bullet_position,
                current_gun_position=player.current_bullet_position,
                initial_hand=player.hand.copy(),
            )
            for player in self.players
            if player.alive
        ]

        round_players = [player.name for player in self.players if player.alive]

        player_opinions: Dict[str, Dict[str, str]] = {}
        for player in self.players:
            player_opinions[player.name] = {}
            for target, opinion in player.opinions.items():
                player_opinions[player.name][target] = opinion

        self.game_record.start_round(
            round_id=self.round_count,
            target_card=self.target_card,
            round_players=round_players,
            starting_player=starting_player,
            player_initial_states=player_initial_states,
            player_opinions=player_opinions,
        )

        self._emit_event(
            "round_started",
            {
                "round": self.round_count,
                "targetCard": self.target_card,
                "startingPlayer": starting_player,
                "playerInitialStates": [state.to_dict() for state in player_initial_states],
                "createdAt": self._now_iso(),
            },
        )

    def is_valid_play(self, cards: List[str]) -> bool:
        return all(card == self.target_card or card == "Joker" for card in cards)

    def find_next_player_with_cards(self, start_idx: int) -> int:
        idx = start_idx
        for _ in range(len(self.players)):
            idx = (idx + 1) % len(self.players)
            if self.players[idx].alive and self.players[idx].hand:
                return idx
        return start_idx

    def perform_penalty(self, player: Player) -> None:
        print(f"玩家 {player.name} 开枪！")
        still_alive = player.process_penalty()
        self.last_shooter_name = player.name
        self.game_record.record_shooting(
            shooter_name=player.name,
            bullet_hit=not still_alive,
        )

        self._emit_event(
            "penalty",
            {
                "player": player.name,
                "alive": still_alive,
                "bulletHit": not still_alive,
                "createdAt": self._now_iso(),
            },
        )

        if not still_alive:
            print(f"{player.name} 已死亡！")

        if not self.check_victory():
            self.reset_round(record_shooter=True)

    def reset_round(self, record_shooter: bool) -> None:
        print("小局游戏重置，开始新的一局！")
        alive_players, _ = self.handle_reflection()
        self.deal_cards()
        self.choose_target_card()

        if record_shooter and self.last_shooter_name:
            shooter_idx = next(
                (i for i, p in enumerate(self.players) if p.name == self.last_shooter_name),
                None,
            )
            if shooter_idx is not None and self.players[shooter_idx].alive:
                self.current_player_idx = shooter_idx
            else:
                print(f"{self.last_shooter_name} 已死亡，顺延至下一个存活且有手牌的玩家")
                self.current_player_idx = self.find_next_player_with_cards(shooter_idx or 0)
        else:
            self.last_shooter_name = None
            if alive_players:
                self.current_player_idx = self.players.index(random.choice(alive_players))

        self.start_round_record()
        self._emit_event(
            "round_reset",
            {
                "round": self.round_count,
                "currentPlayer": self.players[self.current_player_idx].name,
                "createdAt": self._now_iso(),
            },
        )
        print(f"从 {self.players[self.current_player_idx].name} 开始新的一轮！")

    def check_victory(self) -> bool:
        alive_players = [p for p in self.players if p.alive]
        if len(alive_players) == 1:
            winner = alive_players[0]
            print(f"\n{winner.name} 获胜！")
            self.game_record.finish_game(winner.name)
            self.game_over = True
            self._emit_event(
                "game_finished",
                {
                    "winner": winner.name,
                    "createdAt": self._now_iso(),
                },
            )
            return True
        return False

    def check_other_players_no_cards(self, current_player: Player) -> bool:
        others = [p for p in self.players if p != current_player and p.alive]
        return all(not p.hand for p in others)

    def handle_play_cards(
        self,
        current_player: Player,
        next_player: Player,
    ) -> List[str]:
        round_base_info = self.game_record.get_latest_round_info()
        round_action_info = self.game_record.get_latest_round_actions(current_player.name, include_latest=True)
        play_decision_info = self.game_record.get_play_decision_info(
            current_player.name,
            next_player.name,
        )

        play_result, reasoning = current_player.choose_cards_to_play(
            round_base_info,
            round_action_info,
            play_decision_info,
        )

        self.game_record.record_play(
            player_name=current_player.name,
            played_cards=play_result["played_cards"].copy(),
            remaining_cards=current_player.hand.copy(),
            play_reason=play_result["play_reason"],
            behavior=play_result["behavior"],
            next_player=next_player.name,
            play_thinking=reasoning,
        )

        self._emit_event(
            "play",
            {
                "player": current_player.name,
                "playedCards": play_result["played_cards"].copy(),
                "remainingCards": current_player.hand.copy(),
                "behavior": play_result["behavior"],
                "reason": play_result["play_reason"],
                "thinking": reasoning,
                "nextPlayer": next_player.name,
                "round": self.round_count,
                "createdAt": self._now_iso(),
            },
        )

        return play_result["played_cards"]

    def handle_challenge(
        self,
        current_player: Player,
        next_player: Player,
        played_cards: List[str],
    ) -> Optional[Player]:
        round_base_info = self.game_record.get_latest_round_info()
        round_action_info = self.game_record.get_latest_round_actions(next_player.name, include_latest=False)
        challenge_decision_info = self.game_record.get_challenge_decision_info(
            next_player.name,
            current_player.name,
        )
        challenging_player_behavior = self.game_record.get_latest_play_behavior()
        extra_hint = "注意：其他玩家手牌均已打空。" if self.check_other_players_no_cards(next_player) else ""

        challenge_result, reasoning = next_player.decide_challenge(
            round_base_info,
            round_action_info,
            challenge_decision_info,
            challenging_player_behavior,
            extra_hint,
        )

        if challenge_result["was_challenged"]:
            is_valid = self.is_valid_play(played_cards)
            self.game_record.record_challenge(
                was_challenged=True,
                reason=challenge_result["challenge_reason"],
                result=not is_valid,
                challenge_thinking=reasoning,
            )
            penalised = next_player if is_valid else current_player
            self._emit_event(
                "challenge",
                {
                    "challenger": next_player.name,
                    "target": current_player.name,
                    "success": not is_valid,
                    "reason": challenge_result["challenge_reason"],
                    "thinking": reasoning,
                    "round": self.round_count,
                    "createdAt": self._now_iso(),
                },
            )
            return penalised

        self.game_record.record_challenge(
            was_challenged=False,
            reason=challenge_result["challenge_reason"],
            result=None,
            challenge_thinking=reasoning,
        )
        self._emit_event(
            "challenge",
            {
                "challenger": next_player.name,
                "target": current_player.name,
                "success": None,
                "reason": challenge_result["challenge_reason"],
                "thinking": reasoning,
                "round": self.round_count,
                "createdAt": self._now_iso(),
            },
        )
        return None

    def handle_system_challenge(self, current_player: Player) -> None:
        print(f"系统自动质疑 {current_player.name} 的手牌！")
        all_cards = current_player.hand.copy()
        current_player.hand.clear()

        self.game_record.record_play(
            player_name=current_player.name,
            played_cards=all_cards,
            remaining_cards=[],
            play_reason="最后一人，自动出牌",
            behavior="无",
            next_player="无",
            play_thinking="",
        )

        is_valid = self.is_valid_play(all_cards)
        self.game_record.record_challenge(
            was_challenged=True,
            reason="系统自动质疑",
            result=not is_valid,
            challenge_thinking="",
        )

        self._emit_event(
            "system_challenge",
            {
                "player": current_player.name,
                "cards": all_cards,
                "success": not is_valid,
                "round": self.round_count,
                "createdAt": self._now_iso(),
            },
        )

        if is_valid:
            print(f"系统质疑失败！{current_player.name} 的手牌符合规则。")
            self.game_record.record_shooting(
                shooter_name="无",
                bullet_hit=False,
            )
            self.reset_round(record_shooter=False)
        else:
            print(f"系统质疑成功！{current_player.name} 的手牌违规，将执行射击惩罚。")
            self.perform_penalty(current_player)

    def handle_reflection(self) -> tuple[List[Player], Dict[str, Dict[str, str]]]:
        alive_players = [p for p in self.players if p.alive]
        alive_player_names = [p.name for p in alive_players]
        round_base_info = self.game_record.get_latest_round_info()
        reflections_summary: Dict[str, Dict[str, str]] = {}

        for player in alive_players:
            round_action_info = self.game_record.get_latest_round_actions(player.name, include_latest=True)
            round_result = self.game_record.get_latest_round_result(player.name)
            insights = player.reflect(
                alive_players=alive_player_names,
                round_base_info=round_base_info,
                round_action_info=round_action_info,
                round_result=round_result,
            )
            if insights:
                reflections_summary[player.name] = insights
                self._emit_event(
                    "reflection",
                    {
                        "player": player.name,
                        "insights": insights,
                        "round": self.round_count,
                        "createdAt": self._now_iso(),
                    },
                )

        return alive_players, reflections_summary

    def play_round(self) -> None:
        current_player = self.players[self.current_player_idx]

        if self.check_other_players_no_cards(current_player):
            self.handle_system_challenge(current_player)
            return

        self._emit_event(
            "turn_started",
            {
                "player": current_player.name,
                "hand": current_player.hand.copy(),
                "round": self.round_count,
                "createdAt": self._now_iso(),
            },
        )
        print(f"\n轮到 {current_player.name} 出牌, 目标牌是 {self.target_card}")
        current_player.print_status()

        next_idx = self.find_next_player_with_cards(self.current_player_idx)
        next_player = self.players[next_idx]
        played_cards = self.handle_play_cards(current_player, next_player)

        if next_player != current_player:
            player_to_penalize = self.handle_challenge(current_player, next_player, played_cards)
            if player_to_penalize:
                self.perform_penalty(player_to_penalize)
                return
            else:
                print(f"{next_player.name} 选择不质疑，游戏继续。")

        self.current_player_idx = next_idx

    def start_game(self) -> None:
        self._emit_event(
            "game_started",
            {
                "players": [player.name for player in self.players],
                "createdAt": self._now_iso(),
            },
        )
        self.deal_cards()
        self.choose_target_card()
        self.start_round_record()
        while not self.game_over and not self._stop_requested:
            self.play_round()

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------
    def _emit_event(self, event: str, payload: Dict[str, object]) -> None:
        if self._event_callback:
            try:
                self._event_callback(event, payload)
            except Exception:  # pragma: no cover - defensive
                pass

    def _serialize_players(self, *, include_hand: bool = False) -> List[Dict[str, object]]:
        players: List[Dict[str, object]] = []
        for player in self.players:
            info: Dict[str, object] = {
                "name": player.name,
                "alive": player.alive,
                "handSize": len(player.hand),
                "bulletPosition": player.bullet_position,
                "currentChamber": player.current_bullet_position,
            }
            if include_hand:
                info["hand"] = player.hand.copy()
            players.append(info)
        return players

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()
