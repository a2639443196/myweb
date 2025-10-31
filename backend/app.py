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


def get_current_account() -> Optional[Dict[str, Any]]:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return fetch_account_by_session_token(token)


if __name__ == "__main__":
    application = create_app()
    application.run(host="0.0.0.0", port=8000, debug=False)
