from __future__ import annotations

import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Flask, abort, jsonify, make_response, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR
DATABASE_PATH = Path(__file__).resolve().parent / "wellness.db"
SESSION_COOKIE_NAME = "session_token"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    app.config["DATABASE"] = DATABASE_PATH

    init_db(app.config["DATABASE"])

    @app.get("/api/healthz")
    def healthcheck() -> Any:
        return jsonify({"status": "ok"})

    @app.get("/api/session")
    def get_session() -> Any:
        token = request.cookies.get(SESSION_COOKIE_NAME)
        if not token:
            return jsonify({"error": "未登录"}), 401

        user = fetch_user_by_token(token)
        if not user:
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

        return jsonify({"user": user})

    @app.post("/api/session")
    def create_session() -> Any:
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        goal = str(payload.get("goal", "")).strip()
        focus = str(payload.get("focus", "")).strip()
        tagline = str(payload.get("tagline", "")).strip()

        if not name or not goal or not focus:
            return jsonify({"error": "请填写必填项"}), 400

        token = secrets.token_urlsafe(32)
        user = {
            "name": name,
            "goal": goal,
            "focus": focus,
            "tagline": tagline,
        }

        try:
            stored_user = insert_user(token=token, **user)
        except sqlite3.Error as error:
            return jsonify({"error": "保存用户失败", "details": str(error)}), 500

        response = make_response(jsonify({"user": stored_user}))
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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                goal TEXT NOT NULL,
                focus TEXT NOT NULL,
                tagline TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


def get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def fetch_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT name, goal, focus, COALESCE(tagline, '') AS tagline, created_at FROM users WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        return {
            "name": row["name"],
            "goal": row["goal"],
            "focus": row["focus"],
            "tagline": row["tagline"],
            "createdAt": row["created_at"],
        }


def insert_user(token: str, name: str, goal: str, focus: str, tagline: str) -> Dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    with get_db_connection() as connection:
        connection.execute(
            "INSERT INTO users (token, name, goal, focus, tagline, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (token, name, goal, focus, tagline or None, created_at),
        )
        connection.commit()

    return {
        "name": name,
        "goal": goal,
        "focus": focus,
        "tagline": tagline,
        "createdAt": created_at,
    }


if __name__ == "__main__":
    application = create_app()
    application.run(host="0.0.0.0", port=8000, debug=False)
