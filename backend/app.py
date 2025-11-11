from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from flask import Flask, abort, jsonify, make_response, request, send_from_directory
from flask_sock import Sock
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR
DATABASE_PATH = Path(__file__).resolve().parent / "wellness.db"
SESSION_COOKIE_NAME = "session_token"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
ONLINE_THRESHOLD_SECONDS = 60
ONLINE_BROADCAST_INTERVAL = 10


class ChatManager:
    def __init__(self) -> None:
        self._clients: dict[Any, str] = {}
        self._lock = threading.Lock()

    def register(self, ws: Any, username: str) -> None:
        with self._lock:
            self._clients[ws] = username
        self.broadcast_user_list()
        self._send_history(ws)
        self.broadcast_system_message(f"用户 {username} 加入了聊天室")

    def unregister(self, ws: Any) -> None:
        username = None
        with self._lock:
            if ws in self._clients:
                username = self._clients.pop(ws)
        if username:
            self.broadcast_user_list()
            self.broadcast_system_message(f"用户 {username} 离开了聊天室")

    def broadcast_user_list(self) -> None:
        # 获取所有在线用户，包括不在聊天室的用户
        online_users = list_online_users()
        self.broadcast({
            "type": "user_list",
            "payload": {"users": online_users},
        })

    def broadcast_message(self, message: Dict[str, Any]) -> None:
        self.broadcast({
            "type": "chat_message",
            "payload": message,
        })

    def broadcast_system_message(self, text: str) -> None:
        message = {
            "text": text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.broadcast({
            "type": "system_message",
            "payload": message,
        })

    def broadcast(self, data: Dict[str, Any]) -> None:
        with self._lock:
            clients = list(self._clients.keys())
        if not clients:
            return

        payload = self._serialize(data)
        stale: list[Any] = []

        for ws in clients:
            try:
                ws.send(payload)
            except Exception:
                stale.append(ws)

        if stale:
            with self._lock:
                for ws in stale:
                    self._clients.pop(ws, None)

    def _send_history(self, ws: Any) -> None:
        try:
            history = [serialize_chat_message(msg) for msg in list_chat_messages()]
            ws.send(self._serialize({
                "type": "chat_history",
                "payload": history,
            }))
        except Exception:
            self.unregister(ws)

    @staticmethod
    def _serialize(payload: Dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False)


class OnlineUserNotifier:
    def __init__(self, fetch_users: Callable[[], list[Dict[str, Any]]], interval: int = ONLINE_BROADCAST_INTERVAL) -> None:
        self._fetch_users = fetch_users
        self._interval = interval
        self._clients: set[Any] = set()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def _poll_loop(self) -> None:
        while not self._stop.wait(self._interval):
            self.broadcast_current()

    def register(self, ws: Any) -> None:
        with self._lock:
            self._clients.add(ws)
        self._send_snapshot(ws)

    def unregister(self, ws: Any) -> None:
        with self._lock:
            self._clients.discard(ws)

    def shutdown(self) -> None:
        self._stop.set()
        self.broadcast([])

    def broadcast_current(self) -> None:
        self.broadcast(self._fetch_users())

    def broadcast(self, users: list[Dict[str, Any]]) -> None:
        with self._lock:
            clients = list(self._clients)
        if not clients:
            return

        payload = self._serialize({"type": "online_users", "users": users})
        stale: list[Any] = []

        for ws in clients:
            try:
                ws.send(payload)
            except Exception:
                stale.append(ws)

        if stale:
            with self._lock:
                for ws in stale:
                    self._clients.discard(ws)

    def notify(self) -> None:
        self.broadcast_current()

    def _send_snapshot(self, ws: Any) -> None:
        try:
            ws.send(
                self._serialize(
                    {
                        "type": "online_users",
                        "users": self._fetch_users(),
                    }
                )
            )
        except Exception:
            self.unregister(ws)

    @staticmethod
    def _serialize(payload: Dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False)


online_user_notifier: Optional[OnlineUserNotifier] = None
chat_manager = ChatManager()


def notify_online_users_change() -> None:
    if online_user_notifier is not None:
        online_user_notifier.notify()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    app.config["DATABASE"] = DATABASE_PATH

    sock = Sock(app)

    init_db(app.config["DATABASE"])

    global online_user_notifier
    if online_user_notifier is None:
        online_user_notifier = OnlineUserNotifier(list_online_users)

    @app.get("/api/healthz")
    def healthcheck() -> Any:
        return jsonify({"status": "ok"})

    @app.get("/api/session")
    def get_session() -> Any:
        token = request.cookies.get(SESSION_COOKIE_NAME)
        if not token:
            return jsonify({"error": "未登录"}), 401

        account = fetch_account_by_session_token(token)
        if not account:
            response = jsonify({"error": "会话无效"})
            response.set_cookie(
                SESSION_COOKIE_NAME,
                "",
                max_age=0,
                secure=False,
                httponly=True,
                samesite="Lax",
                path="/",
            )
            return response, 401

        update_session_last_seen(token)
        return jsonify({"user": serialize_account(account)})

    @app.post("/api/session/heartbeat")
    def session_heartbeat() -> Any:
        token = request.cookies.get(SESSION_COOKIE_NAME)
        if not token:
            return jsonify({"error": "未登录"}), 401

        if not update_session_last_seen(token):
            response = jsonify({"error": "会话无效"})
            response.set_cookie(
                SESSION_COOKIE_NAME,
                "",
                max_age=0,
                secure=False,
                httponly=True,
                samesite="Lax",
                path="/",
            )
            return response, 401

        return ("", 204)

    @app.post("/api/register")
    def register() -> Any:
        payload = request.get_json(silent=True) or {}
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", "")).strip()
        phone = str(payload.get("phone", "")).strip()

        if not username or not password or not phone:
            return jsonify({"error": "请完整填写用户名、密码和手机号。"}), 400

        if len(username) < 3:
            return jsonify({"error": "用户名至少 3 个字符。"}), 400

        if len(password) < 6:
            return jsonify({"error": "密码至少 6 个字符。"}), 400

        password_hash = hash_password(password)

        try:
            account = create_account(username=username, password_hash=password_hash, phone=phone)
        except sqlite3.IntegrityError:
            return jsonify({"error": "用户名已被注册。"}), 409
        except sqlite3.Error as error:
            return jsonify({"error": "注册失败", "details": str(error)}), 500

        token = create_session(account_id=account["id"])
        response = make_response(jsonify({"user": serialize_account(account)}))
        response.set_cookie(
            SESSION_COOKIE_NAME,
            token,
            max_age=SESSION_MAX_AGE,
            secure=False,
            httponly=True,
            samesite="Lax",
            path="/",
        )
        return response

    @app.post("/api/login")
    def login() -> Any:
        payload = request.get_json(silent=True) or {}
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", "")).strip()

        if not username or not password:
            return jsonify({"error": "请输入用户名和密码。"}), 400

        account = fetch_account_by_username(username)
        if not account or not verify_password(password, account["password_hash"]):
            return jsonify({"error": "用户名或密码不正确。"}), 401

        token = create_session(account_id=account["id"])
        response = make_response(jsonify({"user": serialize_account(account)}))
        response.set_cookie(
            SESSION_COOKIE_NAME,
            token,
            max_age=SESSION_MAX_AGE,
            secure=False,
            httponly=True,
            samesite="Lax",
            path="/",
        )
        return response

    @app.post("/api/logout")
    def logout() -> Any:
        token = request.cookies.get(SESSION_COOKIE_NAME)
        response = make_response(jsonify({"status": "ok"}))
        response.set_cookie(
            SESSION_COOKIE_NAME,
            "",
            max_age=0,
            secure=False,
            httponly=True,
            samesite="Lax",
            path="/",
        )

        if token:
            delete_session(token)

        return response

    @app.get("/api/online-users")
    def online_users() -> Any:
        users = list_online_users()
        return jsonify({"users": users})

    @app.post("/api/activity")
    def add_activity() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        payload = request.get_json(silent=True) or {}
        category = str(payload.get("category", "")).strip()
        action = str(payload.get("action", "")).strip()
        details = payload.get("details", {})

        if not category or not action:
            return jsonify({"error": "缺少必要的活动类型或动作。"}), 400

        if not isinstance(details, dict):
            return jsonify({"error": "活动详情格式不正确。"}), 400

        try:
            activity = create_activity(
                account_id=account["id"],
                category=category,
                action=action,
                details=details,
            )
        except sqlite3.Error as error:
            return jsonify({"error": "记录活动失败", "details": str(error)}), 500

        return jsonify({"activity": serialize_activity(activity)}), 201

    @app.get("/api/users/<username>")
    def get_user(username: str) -> Any:
        account = fetch_account_public(username)
        if not account:
            return jsonify({"error": "用户不存在"}), 404
        return jsonify({"user": serialize_account(account)})

    @app.get("/api/users/<username>/activity")
    def get_user_activity(username: str) -> Any:
        current = get_current_account()
        if not current:
            return jsonify({"error": "未登录"}), 401

        account = fetch_account_public(username)
        if not account:
            return jsonify({"error": "用户不存在"}), 404

        category = request.args.get("category")
        try:
            activities = list_user_activities(username=username, category=category)
        except sqlite3.Error as error:
            return jsonify({"error": "获取活动失败", "details": str(error)}), 500

        return jsonify({"activities": [serialize_activity(item) for item in activities]})

    @app.get("/api/schulte/records/me")
    def get_my_schulte_records() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        try:
            records = list_schulte_records_by_account(account_id=account["id"])
        except sqlite3.Error as error:
            return jsonify({"error": "获取个人成绩失败", "details": str(error)}), 500

        return jsonify({
            "records": [serialize_schulte_record(item) for item in records]
        })

    @app.get("/api/schulte/leaderboard")
    def schulte_leaderboard() -> Any:
        try:
            records = list_schulte_leaderboard()
        except sqlite3.Error as error:
            return jsonify({"error": "获取排行榜失败", "details": str(error)}), 500

        return jsonify({
            "records": [serialize_schulte_record(item, include_username=True) for item in records]
        })

    @app.post("/api/schulte/records")
    def submit_schulte_record() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        payload = request.get_json(silent=True) or {}
        grid_size = payload.get("gridSize")
        elapsed_ms = payload.get("elapsedMs")

        try:
            grid_size_int = int(grid_size)
            elapsed_ms_int = int(elapsed_ms)
        except (TypeError, ValueError):
            return jsonify({"error": "成绩数据格式不正确。"}), 400

        if not (3 <= grid_size_int <= 9):
            return jsonify({"error": "表格大小需在 3 到 9 之间。"}), 400

        if elapsed_ms_int <= 0:
            return jsonify({"error": "用时必须大于 0。"}), 400

        try:
            record, improved = upsert_schulte_record(
                account_id=account["id"],
                grid_size=grid_size_int,
                elapsed_ms=elapsed_ms_int,
            )
        except sqlite3.Error as error:
            return jsonify({"error": "保存成绩失败", "details": str(error)}), 500

        if improved:
            try:
                create_activity(
                    account_id=account["id"],
                    category="schulte",
                    action="best_record",
                    details={
                        "gridSize": grid_size_int,
                        "elapsedMs": elapsed_ms_int,
                    },
                )
            except sqlite3.Error:
                pass

        return jsonify({
            "record": serialize_schulte_record(record),
            "isNewBest": improved,
        })

    @app.get("/api/reaction/records/me")
    def get_my_reaction_records() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        try:
            records = list_reaction_records_by_account(account_id=account["id"])
        except sqlite3.Error as error:
            return jsonify({"error": "获取个人成绩失败", "details": str(error)}), 500

        return jsonify({
            "records": [serialize_reaction_record(item) for item in records]
        })

    @app.get("/api/reaction/leaderboard")
    def reaction_leaderboard() -> Any:
        try:
            records = list_reaction_leaderboard()
        except sqlite3.Error as error:
            return jsonify({"error": "获取排行榜失败", "details": str(error)}), 500

        return jsonify({
            "records": [
                serialize_reaction_record(item, include_username=True) for item in records
            ]
        })

    @app.post("/api/reaction/records")
    def submit_reaction_record() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        payload = request.get_json(silent=True) or {}
        reaction_time_ms = payload.get("reactionTimeMs")

        try:
            reaction_time_ms_int = int(reaction_time_ms)
        except (TypeError, ValueError):
            return jsonify({"error": "成绩数据格式不正确。"}), 400

        if reaction_time_ms_int <= 0:
            return jsonify({"error": "成绩必须大于 0。"}), 400

        try:
            record, improved = upsert_reaction_record(
                account_id=account["id"],
                reaction_time_ms=reaction_time_ms_int,
            )
        except sqlite3.Error as error:
            return jsonify({"error": "保存成绩失败", "details": str(error)}), 500

        if improved:
            try:
                create_activity(
                    account_id=account["id"],
                    category="reaction",
                    action="best_record",
                    details={"reactionTimeMs": reaction_time_ms_int},
                )
            except sqlite3.Error:
                pass

        return jsonify({
            "record": serialize_reaction_record(record),
            "isNewBest": improved,
        })

    @app.get("/api/memory-flip/records/me")
    def get_my_memory_records() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        try:
            records = list_memory_flip_records_by_account(account_id=account["id"])
        except sqlite3.Error as error:
            return jsonify({"error": "获取个人成绩失败", "details": str(error)}), 500

        return jsonify({
            "records": [serialize_memory_flip_record(item) for item in records]
        })

    @app.get("/api/memory-flip/leaderboard")
    def memory_flip_leaderboard() -> Any:
        try:
            records = list_memory_flip_leaderboard()
        except sqlite3.Error as error:
            return jsonify({"error": "获取排行榜失败", "details": str(error)}), 500

        return jsonify({
            "records": [
                serialize_memory_flip_record(item, include_username=True) for item in records
            ]
        })

    @app.post("/api/memory-flip/records")
    def submit_memory_record() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        payload = request.get_json(silent=True) or {}
        elapsed_ms = payload.get("elapsedMs")
        moves = payload.get("moves")

        try:
            elapsed_ms_int = int(elapsed_ms)
            moves_int = int(moves)
        except (TypeError, ValueError):
            return jsonify({"error": "成绩数据格式不正确。"}), 400

        if elapsed_ms_int <= 0 or moves_int <= 0:
            return jsonify({"error": "成绩必须大于 0。"}), 400

        try:
            record, improved = upsert_memory_flip_record(
                account_id=account["id"],
                elapsed_ms=elapsed_ms_int,
                moves=moves_int,
            )
        except sqlite3.Error as error:
            return jsonify({"error": "保存成绩失败", "details": str(error)}), 500

        if improved:
            try:
                create_activity(
                    account_id=account["id"],
                    category="memory-flip",
                    action="best_record",
                    details={"elapsedMs": elapsed_ms_int, "moves": moves_int},
                )
            except sqlite3.Error:
                pass

        return jsonify({
            "record": serialize_memory_flip_record(record),
            "isNewBest": improved,
        })

    @app.get("/api/sudoku/records/me")
    def get_my_sudoku_records() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        try:
            records = list_sudoku_records_by_account(account_id=account["id"])
        except sqlite3.Error as error:
            return jsonify({"error": "获取个人成绩失败", "details": str(error)}), 500

        return jsonify({
            "records": [serialize_sudoku_record(item) for item in records]
        })

    @app.get("/api/sudoku/leaderboard")
    def sudoku_leaderboard() -> Any:
        try:
            records = list_sudoku_leaderboard()
        except sqlite3.Error as error:
            return jsonify({"error": "获取排行榜失败", "details": str(error)}), 500

        return jsonify({
            "records": [
                serialize_sudoku_record(item, include_username=True) for item in records
            ]
        })

    @app.post("/api/sudoku/records")
    def submit_sudoku_record() -> Any:
        account = get_current_account()
        if not account:
            return jsonify({"error": "未登录"}), 401

        payload = request.get_json(silent=True) or {}
        difficulty = (payload.get("difficulty") or "").strip()
        elapsed_ms = payload.get("elapsedMs")
        mistakes = payload.get("mistakes")

        if difficulty not in {"easy", "medium", "hard"}:
            return jsonify({"error": "难度参数不正确。"}), 400

        try:
            elapsed_ms_int = int(elapsed_ms)
            mistakes_int = int(mistakes)
        except (TypeError, ValueError):
            return jsonify({"error": "成绩数据格式不正确。"}), 400

        if elapsed_ms_int <= 0 or mistakes_int < 0:
            return jsonify({"error": "成绩必须为有效正数。"}), 400

        try:
            record, improved = upsert_sudoku_record(
                account_id=account["id"],
                difficulty=difficulty,
                elapsed_ms=elapsed_ms_int,
                mistakes=mistakes_int,
            )
        except sqlite3.Error as error:
            return jsonify({"error": "保存成绩失败", "details": str(error)}), 500

        if improved:
            try:
                create_activity(
                    account_id=account["id"],
                    category="sudoku",
                    action="best_record",
                    details={
                        "difficulty": difficulty,
                        "elapsedMs": elapsed_ms_int,
                        "mistakes": mistakes_int,
                    },
                )
            except sqlite3.Error:
                pass

        return jsonify({
            "record": serialize_sudoku_record(record),
            "isNewBest": improved,
        })

    @sock.route("/ws/liars-bar")
    def liars_bar_socket(ws: Any) -> None:
        liars_bar_manager.register_socket(ws)
        try:
            while True:
                try:
                    message = ws.receive()
                except Exception:
                    break
                if message is None:
                    break
                if isinstance(message, str) and message.strip().lower() == "ping":
                    ws.send(json.dumps({"type": "pong"}, ensure_ascii=False))
        finally:
            liars_bar_manager.unregister_socket(ws)

    @sock.route("/ws/online")
    def online_users_socket(ws: Any) -> None:
        if online_user_notifier is None:
            return

        online_user_notifier.register(ws)
        try:
            while True:
                try:
                    message = ws.receive()
                except Exception:
                    break
                if message is None:
                    break
                if isinstance(message, str) and message.strip().lower() == "ping":
                    ws.send(json.dumps({"type": "pong"}, ensure_ascii=False))
        finally:
            online_user_notifier.unregister(ws)

    @sock.route("/ws/chat")
    def chat_socket(ws: Any) -> None:
        account = get_current_account()
        if not account:
            return

        username = account["username"]
        chat_manager.register(ws, username)

        try:
            while True:
                try:
                    message = ws.receive()
                except Exception:
                    break
                if message is None:
                    break

                try:
                    data = json.loads(message)
                    if data.get("type") == "chat_message":
                        text = data.get("payload", {}).get("text", "").strip()
                        if text:
                            msg = create_chat_message(account_id=account["id"], text=text)
                            full_msg = {**msg, "username": username}
                            chat_manager.broadcast_message(serialize_chat_message(full_msg))
                except (json.JSONDecodeError, AttributeError):
                    continue
        finally:
            chat_manager.unregister(ws)

    @app.route("/", defaults={"path": "index.html"})
    @app.route("/<path:path>")
    def serve_frontend(path: str) -> Any:
        if path.startswith("api/"):
            abort(404)

        requested_path = (FRONTEND_DIR / path).resolve()
        try:
            requested_path.relative_to(FRONTEND_DIR)
        except ValueError:
            abort(404)

        if not requested_path.exists():
            abort(404)

        if requested_path.is_dir():
            requested_path = requested_path / "index.html"
            if not requested_path.exists():
                abort(404)

        relative_path = requested_path.relative_to(FRONTEND_DIR)
        directory = requested_path.parent
        return send_from_directory(directory, relative_path.name)

    return app


def init_db(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                phone TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                account_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_activities_account_created ON activities(account_id, created_at)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schulte_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                grid_size INTEGER NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(account_id, grid_size),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_schulte_records_elapsed ON schulte_records(elapsed_ms)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reaction_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                reaction_time_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(account_id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_reaction_records_time ON reaction_records(reaction_time_ms)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS memory_flip_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                moves INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(account_id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_memory_flip_elapsed ON memory_flip_records(elapsed_ms)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sudoku_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                difficulty TEXT NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                mistakes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(account_id, difficulty),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sudoku_records_elapsed ON sudoku_records(elapsed_ms)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )
        connection.commit()


def get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash


def create_account(username: str, password_hash: str, phone: str) -> Dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO accounts (username, password_hash, phone, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, phone, created_at),
        )
        account_id = cursor.lastrowid
        connection.commit()

    return {
        "id": account_id,
        "username": username,
        "phone": phone,
        "created_at": created_at,
    }


def fetch_account_by_username(username: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT id, username, password_hash, phone, created_at FROM accounts WHERE username = ?",
            (username,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def fetch_account_by_session_token(token: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as connection:
        row = connection.execute(
            """
            SELECT accounts.id, accounts.username, accounts.phone, accounts.created_at
            FROM sessions
            JOIN accounts ON accounts.id = sessions.account_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def fetch_account_public(username: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT id, username, phone, created_at FROM accounts WHERE username = ?",
            (username,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def create_session(account_id: int) -> str:
    token = secrets.token_urlsafe(32)
    timestamp = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        connection.execute(
            "INSERT INTO sessions (token, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)",
            (token, account_id, timestamp, timestamp),
        )
        connection.commit()
    notify_online_users_change()
    return token


def update_session_last_seen(token: str) -> bool:
    timestamp = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        cursor = connection.execute(
            "UPDATE sessions SET last_seen = ? WHERE token = ?",
            (timestamp, token),
        )
        connection.commit()
        if cursor.rowcount > 0:
            notify_online_users_change()
            return True
        return False


def delete_session(token: str) -> None:
    with get_db_connection() as connection:
        connection.execute("DELETE FROM sessions WHERE token = ?", (token,))
        connection.commit()
    notify_online_users_change()


def list_online_users() -> list[Dict[str, Any]]:
    threshold = datetime.now(timezone.utc) - timedelta(seconds=ONLINE_THRESHOLD_SECONDS)
    users: list[Dict[str, Any]] = []
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                accounts.username,
                accounts.phone,
                accounts.created_at,
                MAX(sessions.last_seen) AS last_seen
            FROM accounts
            LEFT JOIN sessions ON sessions.account_id = accounts.id
            GROUP BY accounts.id
            ORDER BY accounts.username COLLATE NOCASE
            """,
        ).fetchall()

    for row in rows:
        last_seen_str = row["last_seen"]
        last_seen_dt: Optional[datetime] = None
        if last_seen_str:
            try:
                last_seen_dt = datetime.fromisoformat(last_seen_str)
            except ValueError:
                last_seen_dt = None
            if last_seen_dt and last_seen_dt.tzinfo is None:
                last_seen_dt = last_seen_dt.replace(tzinfo=timezone.utc)
        is_online = bool(last_seen_dt and last_seen_dt >= threshold)

        users.append(
            {
                "username": row["username"],
                "phone": row["phone"],
                "createdAt": row["created_at"],
                "lastSeen": last_seen_str if last_seen_str else None,
                "online": is_online,
            }
        )

    return users


def serialize_account(account: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": account.get("id"),
        "username": account["username"],
        "phone": account["phone"],
        "createdAt": account["created_at"],
    }


def create_activity(account_id: int, category: str, action: str, details: Dict[str, Any]) -> Dict[str, Any]:
    timestamp = datetime.now(timezone.utc).isoformat()
    details_json = json.dumps(details, ensure_ascii=False)
    with get_db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO activities (account_id, category, action, details, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (account_id, category, action, details_json, timestamp),
        )
        activity_id = cursor.lastrowid
        connection.commit()

    return {
        "id": activity_id,
        "account_id": account_id,
        "category": category,
        "action": action,
        "details": details,
        "created_at": timestamp,
    }


def list_user_activities(username: str, category: Optional[str] = None, limit: int = 200) -> list[Dict[str, Any]]:
    sql = (
        """
        SELECT activities.id, activities.account_id, activities.category, activities.action, activities.details, activities.created_at
        FROM activities
        JOIN accounts ON accounts.id = activities.account_id
        WHERE accounts.username = ?
        """
    )
    params: list[Any] = [username]
    if category:
        sql += " AND activities.category = ?"
        params.append(category)

    sql += " ORDER BY activities.created_at DESC, activities.id DESC LIMIT ?"
    params.append(limit)

    items: list[Dict[str, Any]] = []
    with get_db_connection() as connection:
        rows = connection.execute(sql, tuple(params)).fetchall()

    for row in rows:
        details_raw = row["details"]
        try:
            details = json.loads(details_raw) if details_raw else {}
        except json.JSONDecodeError:
            details = {}
        items.append(
            {
                "id": row["id"],
                "account_id": row["account_id"],
                "category": row["category"],
                "action": row["action"],
                "details": details,
                "created_at": row["created_at"],
            }
        )

    return items


def serialize_activity(activity: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": activity.get("id"),
        "category": activity.get("category"),
        "action": activity.get("action"),
        "details": activity.get("details", {}),
        "createdAt": activity.get("created_at"),
    }


def serialize_schulte_record(
    record: Dict[str, Any], *, include_username: bool = False
) -> Dict[str, Any]:
    payload = {
        "id": record.get("id"),
        "gridSize": record.get("grid_size"),
        "elapsedMs": record.get("elapsed_ms"),
        "createdAt": record.get("created_at"),
        "updatedAt": record.get("updated_at"),
    }
    if include_username and record.get("username"):
        payload["username"] = record["username"]
    return payload


def serialize_reaction_record(
    record: Dict[str, Any], *, include_username: bool = False
) -> Dict[str, Any]:
    payload = {
        "id": record.get("id"),
        "reactionTimeMs": record.get("reaction_time_ms"),
        "createdAt": record.get("created_at"),
        "updatedAt": record.get("updated_at"),
    }
    if include_username and record.get("username"):
        payload["username"] = record["username"]
    return payload


def serialize_memory_flip_record(
    record: Dict[str, Any], *, include_username: bool = False
) -> Dict[str, Any]:
    payload = {
        "id": record.get("id"),
        "elapsedMs": record.get("elapsed_ms"),
        "moves": record.get("moves"),
        "createdAt": record.get("created_at"),
        "updatedAt": record.get("updated_at"),
    }
    if include_username and record.get("username"):
        payload["username"] = record["username"]
    return payload


def serialize_sudoku_record(
    record: Dict[str, Any], *, include_username: bool = False
) -> Dict[str, Any]:
    payload = {
        "id": record.get("id"),
        "difficulty": record.get("difficulty"),
        "elapsedMs": record.get("elapsed_ms"),
        "mistakes": record.get("mistakes"),
        "createdAt": record.get("created_at"),
        "updatedAt": record.get("updated_at"),
    }
    if include_username and record.get("username"):
        payload["username"] = record["username"]
    return payload


def upsert_schulte_record(
    *, account_id: int, grid_size: int, elapsed_ms: int
) -> tuple[Dict[str, Any], bool]:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        existing = connection.execute(
            """
            SELECT id, elapsed_ms
            FROM schulte_records
            WHERE account_id = ? AND grid_size = ?
            """,
            (account_id, grid_size),
        ).fetchone()

        improved = False
        record_id: Optional[int]

        if existing:
            if int(existing["elapsed_ms"]) > elapsed_ms:
                connection.execute(
                    """
                    UPDATE schulte_records
                    SET elapsed_ms = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (elapsed_ms, now, existing["id"]),
                )
                connection.commit()
                improved = True
            record_id = int(existing["id"])
        else:
            cursor = connection.execute(
                """
                INSERT INTO schulte_records (
                    account_id, grid_size, elapsed_ms, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (account_id, grid_size, elapsed_ms, now, now),
            )
            connection.commit()
            record_id = cursor.lastrowid
            improved = True

        row = connection.execute(
            """
            SELECT id, account_id, grid_size, elapsed_ms, created_at, updated_at
            FROM schulte_records
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()

    if not row:
        raise sqlite3.Error("未能保存舒尔特成绩")

    return dict(row), improved


def list_schulte_records_by_account(*, account_id: int) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, account_id, grid_size, elapsed_ms, created_at, updated_at
            FROM schulte_records
            WHERE account_id = ?
            ORDER BY grid_size ASC
            """,
            (account_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_schulte_leaderboard(limit: int = 20) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                sr.id,
                sr.account_id,
                sr.grid_size,
                sr.elapsed_ms,
                sr.created_at,
                sr.updated_at,
                a.username
            FROM schulte_records sr
            JOIN accounts a ON sr.account_id = a.id
            ORDER BY sr.elapsed_ms ASC, sr.updated_at ASC
            """,
        ).fetchall()

    best_by_account: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        account_id = int(row["account_id"])
        existing = best_by_account.get(account_id)
        if existing is None:
            best_by_account[account_id] = dict(row)
            continue
        if int(row["elapsed_ms"]) < int(existing["elapsed_ms"]):
            best_by_account[account_id] = dict(row)
        elif (
            int(row["elapsed_ms"]) == int(existing["elapsed_ms"])
            and str(row["updated_at"]) < str(existing["updated_at"])
        ):
            best_by_account[account_id] = dict(row)

    best = sorted(
        best_by_account.values(),
        key=lambda item: (int(item["elapsed_ms"]), str(item["updated_at"]))
    )

    return best[:limit]


def upsert_reaction_record(
    *, account_id: int, reaction_time_ms: int
) -> tuple[Dict[str, Any], bool]:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        existing = connection.execute(
            """
            SELECT id, reaction_time_ms
            FROM reaction_records
            WHERE account_id = ?
            """,
            (account_id,),
        ).fetchone()

        improved = False
        record_id: Optional[int]

        if existing:
            if int(existing["reaction_time_ms"]) > reaction_time_ms:
                connection.execute(
                    """
                    UPDATE reaction_records
                    SET reaction_time_ms = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (reaction_time_ms, now, existing["id"]),
                )
                connection.commit()
                improved = True
            record_id = int(existing["id"])
        else:
            cursor = connection.execute(
                """
                INSERT INTO reaction_records (
                    account_id, reaction_time_ms, created_at, updated_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (account_id, reaction_time_ms, now, now),
            )
            connection.commit()
            record_id = cursor.lastrowid
            improved = True

        row = connection.execute(
            """
            SELECT id, account_id, reaction_time_ms, created_at, updated_at
            FROM reaction_records
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()

    if not row:
        raise sqlite3.Error("未能保存反应力成绩")

    return dict(row), improved


def list_reaction_records_by_account(*, account_id: int) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, account_id, reaction_time_ms, created_at, updated_at
            FROM reaction_records
            WHERE account_id = ?
            ORDER BY reaction_time_ms ASC
            """,
            (account_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_reaction_leaderboard(limit: int = 20) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                rr.id,
                rr.account_id,
                rr.reaction_time_ms,
                rr.created_at,
                rr.updated_at,
                a.username
            FROM reaction_records rr
            JOIN accounts a ON rr.account_id = a.id
            ORDER BY rr.reaction_time_ms ASC, rr.updated_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_memory_flip_record(
    *, account_id: int, elapsed_ms: int, moves: int
) -> tuple[Dict[str, Any], bool]:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        existing = connection.execute(
            """
            SELECT id, elapsed_ms, moves
            FROM memory_flip_records
            WHERE account_id = ?
            """,
            (account_id,),
        ).fetchone()

        improved = False
        record_id: Optional[int]

        if existing:
            better_time = int(existing["elapsed_ms"]) > elapsed_ms
            same_time_better_moves = (
                int(existing["elapsed_ms"]) == elapsed_ms
                and int(existing["moves"]) > moves
            )
            if better_time or same_time_better_moves:
                connection.execute(
                    """
                    UPDATE memory_flip_records
                    SET elapsed_ms = ?, moves = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (elapsed_ms, moves, now, existing["id"]),
                )
                connection.commit()
                improved = True
            record_id = int(existing["id"])
        else:
            cursor = connection.execute(
                """
                INSERT INTO memory_flip_records (
                    account_id, elapsed_ms, moves, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (account_id, elapsed_ms, moves, now, now),
            )
            connection.commit()
            record_id = cursor.lastrowid
            improved = True

        row = connection.execute(
            """
            SELECT id, account_id, elapsed_ms, moves, created_at, updated_at
            FROM memory_flip_records
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()

    if not row:
        raise sqlite3.Error("未能保存翻牌成绩")

    return dict(row), improved


def list_memory_flip_records_by_account(*, account_id: int) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, account_id, elapsed_ms, moves, created_at, updated_at
            FROM memory_flip_records
            WHERE account_id = ?
            ORDER BY elapsed_ms ASC, moves ASC
            """,
            (account_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_memory_flip_leaderboard(limit: int = 20) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                mr.id,
                mr.account_id,
                mr.elapsed_ms,
                mr.moves,
                mr.created_at,
                mr.updated_at,
                a.username
            FROM memory_flip_records mr
            JOIN accounts a ON mr.account_id = a.id
            ORDER BY mr.elapsed_ms ASC, mr.moves ASC, mr.updated_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_sudoku_record(
    *, account_id: int, difficulty: str, elapsed_ms: int, mistakes: int
) -> tuple[Dict[str, Any], bool]:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        existing = connection.execute(
            """
            SELECT id, elapsed_ms, mistakes
            FROM sudoku_records
            WHERE account_id = ? AND difficulty = ?
            """,
            (account_id, difficulty),
        ).fetchone()

        improved = False
        record_id: Optional[int]

        if existing:
            better_time = int(existing["elapsed_ms"]) > elapsed_ms
            same_time_better_mistakes = (
                int(existing["elapsed_ms"]) == elapsed_ms
                and int(existing["mistakes"]) > mistakes
            )
            if better_time or same_time_better_mistakes:
                connection.execute(
                    """
                    UPDATE sudoku_records
                    SET elapsed_ms = ?, mistakes = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (elapsed_ms, mistakes, now, existing["id"]),
                )
                connection.commit()
                improved = True
            record_id = int(existing["id"])
        else:
            cursor = connection.execute(
                """
                INSERT INTO sudoku_records (
                    account_id, difficulty, elapsed_ms, mistakes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (account_id, difficulty, elapsed_ms, mistakes, now, now),
            )
            connection.commit()
            record_id = cursor.lastrowid
            improved = True

        row = connection.execute(
            """
            SELECT id, account_id, difficulty, elapsed_ms, mistakes, created_at, updated_at
            FROM sudoku_records
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()

    if not row:
        raise sqlite3.Error("未能保存数独成绩")

    return dict(row), improved


def list_sudoku_records_by_account(*, account_id: int) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, account_id, difficulty, elapsed_ms, mistakes, created_at, updated_at
            FROM sudoku_records
            WHERE account_id = ?
            ORDER BY difficulty ASC
            """,
            (account_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_sudoku_leaderboard(limit: int = 20) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                sr.id,
                sr.account_id,
                sr.difficulty,
                sr.elapsed_ms,
                sr.mistakes,
                sr.created_at,
                sr.updated_at,
                a.username
            FROM sudoku_records sr
            JOIN accounts a ON sr.account_id = a.id
            ORDER BY sr.elapsed_ms ASC, sr.mistakes ASC, sr.updated_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_chat_message(account_id: int, text: str) -> Dict[str, Any]:
    timestamp = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO chat_messages (account_id, text, created_at) VALUES (?, ?, ?)",
            (account_id, text, timestamp),
        )
        message_id = cursor.lastrowid
        connection.commit()

    return {
        "id": message_id,
        "account_id": account_id,
        "text": text,
        "created_at": timestamp,
    }


def list_chat_messages(limit: int = 50) -> list[Dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT cm.id, cm.account_id, cm.text, cm.created_at, a.username
            FROM chat_messages cm
            JOIN accounts a ON cm.account_id = a.id
            ORDER BY cm.created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def serialize_chat_message(message: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": message.get("id"),
        "sender": message.get("username"),
        "text": message.get("text"),
        "timestamp": message.get("created_at"),
    }


def get_current_account() -> Optional[Dict[str, Any]]:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return fetch_account_by_session_token(token)


if __name__ == "__main__":
    application = create_app()
    application.run(host="0.0.0.0", port=8000, debug=False)
