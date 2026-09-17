"""The Hidden Court - Padel ranking platform.

Flask backend:
  - Public ranking API
  - Admin dashboard with secure (PBKDF2-hashed) credential auth
  - Full CRUD over players
Credentials live in .env (SECRET_KEY, ADMIN_USERNAME, ADMIN_PASSWORD_HASH).
The password is never stored as plain text.
"""

import argparse
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
DB_PATH = BASE_DIR / "players.db"


# --------------------------------------------------------------------------
# Minimal .env loader (no external dependency)
# --------------------------------------------------------------------------
def load_env():
    data = {}
    if not ENV_PATH.exists():
        return data
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        data[key.strip()] = value.strip()
    return data


def env_config():
    """Config resolution order: real environment vars > .env file."""
    file_cfg = load_env()
    merged = dict(file_cfg)
    for key in ("SECRET_KEY", "ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "ADMIN_PASSWORD"):
        if os.environ.get(key):
            merged[key] = os.environ[key]
    return merged


def save_env(data):
    self_hash = data.get("ADMIN_PASSWORD_HASH", "")
    lines = [
        "# The Hidden Court - Environment Configuration",
        "# IMPORTANT: Never commit this file or expose its contents.",
        "",
        "# Flask session signing key (auto-generated). Regenerate at any time.",
        f"SECRET_KEY={data.get('SECRET_KEY', '')}",
        "",
        "# Admin account (username stored in plain text - this is normal and safe)",
        f"ADMIN_USERNAME={data.get('ADMIN_USERNAME', 'Rakfs')}",
        "",
        "# Admin password stored as a PBKDF2-SHA256 hash, NEVER plain text",
        "# To change the password, run: python server.py --set-password",
        f"ADMIN_PASSWORD_HASH={self_hash}",
    ]
    try:
        ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError:
        pass


config = env_config()
if not config.get("SECRET_KEY"):
    config["SECRET_KEY"] = secrets.token_hex(32)
    save_env(config)

SECRET_KEY = config["SECRET_KEY"]
ADMIN_USERNAME = config.get("ADMIN_USERNAME") or "Rakfs"
ADMIN_PASSWORD_HASH = config.get("ADMIN_PASSWORD_HASH") or ""
# Keep plaintext password support ONLY as env-var convenience;
# it is hashed at startup and never stored as plain text in the database.
if not ADMIN_PASSWORD_HASH and config.get("ADMIN_PASSWORD"):
    ADMIN_PASSWORD_HASH = generate_password_hash(
        config["ADMIN_PASSWORD"], method="pbkdf2:sha256"
    )

app = Flask(__name__)
app.secret_key = SECRET_KEY

# Longer-lived caching for static assets (fonts, css, js), refreshed on deploys
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 86400  # 1 day


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrate_players(conn):
    """Rebuild the players table into the points+team schema if needed."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(players)").fetchall()}
    if "matches" not in cols and "points" in cols and "team" in cols:
        return  # already the new schema

    # Intermediate state: points schema from an older version (no team yet)
    had_points = "points" in cols and "team" not in cols

    conn.executescript(
        """
        ALTER TABLE players RENAME TO players_old;

        CREATE TABLE players (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            points      INTEGER NOT NULL DEFAULT 0,
            team        TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        INSERT INTO players (id, name, points, team, created_at, updated_at)
            SELECT id, name, COALESCE(points, 0), '', created_at, updated_at
            FROM players_old;

        DROP TABLE players_old;
        """
    )


def init_db():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS players (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                points      INTEGER NOT NULL DEFAULT 0,
                team        TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS admins (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            );
            """
        )
        migrate_players(conn)
        if ADMIN_PASSWORD_HASH:
            existing = conn.execute(
                "SELECT 1 FROM admins WHERE username = ?", (ADMIN_USERNAME,)
            ).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
                    (ADMIN_USERNAME, ADMIN_PASSWORD_HASH),
                )


# Run on import so gunicorn workers (cloud) pick up DB + admin seed automatically
try:
    init_db()
except Exception:
    pass


def now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_ranking(conn):
    """Return players sorted by points desc -> name, with rank."""
    rows = conn.execute(
        """SELECT * FROM players
           ORDER BY points DESC, name COLLATE NOCASE ASC"""
    ).fetchall()

    players = []
    last_updated = None
    for i, row in enumerate(rows, start=1):
        players.append(
            {
                "id": row["id"],
                "rank": i,
                "name": row["name"],
                "points": row["points"],
                "team": row["team"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )
        if last_updated is None or row["updated_at"] > last_updated:
            last_updated = row["updated_at"]

    return {"players": players, "last_updated": last_updated}


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("admin"):
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, **kwargs)

    return wrapper


def csrf_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
        if not token or token != session.get("csrf_token"):
            return jsonify({"error": "Invalid CSRF token"}), 403
        return fn(*args, **kwargs)

    return wrapper


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin")
def admin_page():
    return render_template("admin.html")


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
@app.route("/api/ranking")
def api_ranking():
    with get_db() as conn:
        return jsonify(fetch_ranking(conn))


@app.route("/api/auth/me")
def api_me():
    if session.get("admin"):
        if not session.get("csrf_token"):
            session["csrf_token"] = secrets.token_hex(24)
        return jsonify({
            "authenticated": True,
            "username": session.get("admin"),
            "csrf": session["csrf_token"],
        })
    return jsonify({"authenticated": False}), 401


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM admins WHERE username = ?", (username,)
        ).fetchone()

    secret_ok = bool(
        ADMIN_PASSWORD_HASH
        and username == ADMIN_USERNAME
        and check_password_hash(ADMIN_PASSWORD_HASH, password)
    )
    db_ok = bool(row and check_password_hash(row["password_hash"], password))

    if not (secret_ok or db_ok):
        return jsonify({"error": "Invalid username or password"}), 401

    session.clear()
    session["admin"] = row["username"] if row else ADMIN_USERNAME
    session["csrf_token"] = secrets.token_hex(24)
    return jsonify(
        {"authenticated": True, "username": session["admin"], "csrf": session["csrf_token"]}
    )


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# Admin API (CRUD)
# --------------------------------------------------------------------------
def validate_player(data):
    name = (data.get("name") or "").strip()
    if not name:
        return None, "Player name is required"

    try:
        points = max(0, int(data.get("points", 0)))
    except (TypeError, ValueError):
        points = 0

    team = (data.get("team") or "").strip()[:40]

    return {"name": name, "points": points, "team": team}, None


@app.route("/api/players", methods=["POST"])
@admin_required
@csrf_required
def api_add_player():
    data = request.get_json(silent=True) or {}
    payload, error = validate_player(data)
    if error:
        return jsonify({"error": error}), 400

    ts = now_utc()
    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO players (name, points, team, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (payload["name"], payload["points"], payload["team"], ts, ts),
        )
        new_id = cursor.lastrowid
        return jsonify(fetch_ranking(conn) | {"created_id": new_id}), 201


@app.route("/api/players/<int:player_id>", methods=["PUT"])
@admin_required
@csrf_required
def api_update_player(player_id):
    data = request.get_json(silent=True) or {}
    payload, error = validate_player(data)
    if error:
        return jsonify({"error": error}), 400

    with get_db() as conn:
        row = conn.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
        if not row:
            return jsonify({"error": "Player not found"}), 404

        ts = now_utc()
        conn.execute(
            """UPDATE players
               SET name = ?, points = ?, team = ?, updated_at = ?
               WHERE id = ?""",
            (payload["name"], payload["points"], payload["team"], ts, player_id),
        )
        return jsonify(fetch_ranking(conn))


@app.route("/api/players/<int:player_id>", methods=["DELETE"])
@admin_required
@csrf_required
def api_delete_player(player_id):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
        if not row:
            return jsonify({"error": "Player not found"}), 404
        conn.execute("DELETE FROM players WHERE id = ?", (player_id,))
        return jsonify(fetch_ranking(conn))


# --------------------------------------------------------------------------
# CLI: set / change admin password (stores only the hash)
# --------------------------------------------------------------------------
def set_password(username, password):
    config["ADMIN_USERNAME"] = username
    config["ADMIN_PASSWORD_HASH"] = generate_password_hash(password, method="pbkdf2:sha256")
    save_env(config)

    with get_db() as conn:
        conn.execute("DELETE FROM admins WHERE username = ?", (username,))
        conn.execute(
            "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
            (username, config["ADMIN_PASSWORD_HASH"]),
        )
    print(f"Password updated for user '{username}' (stored as PBKDF2 hash only).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="The Hidden Court server")
    parser.add_argument("--set-password", nargs=2, metavar=("USERNAME", "PASSWORD"),
                        help="Set/change the admin credentials (stores a hash).")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5000)))
    args = parser.parse_args()

    if args.set_password:
        init_db()
        set_password(args.set_password[0], args.set_password[1])
    else:
        app.run(host=args.host, port=args.port, debug=False)