"""The Hidden Court - Padel ranking platform.

Flask backend:
  - Public ranking API
  - Admin dashboard with secure (PBKDF2-hashed) credential auth
  - Full CRUD over players
Credentials live in .env (SECRET_KEY, ADMIN_USERNAME, ADMIN_PASSWORD_HASH).
The password is never stored as plain text.
"""

import argparse
import json
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
SEED_PATH = BASE_DIR / "seed_players.json"


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


@app.after_request
def add_cache_and_security_headers(response):
    # Static assets are content-hashed via ?v= in the templates, so they can
    # be cached long; versioned URLs change whenever the file changes.
    if request.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "public, max-age=2592000")
    # HTML pages must never be cached: otherwise browsers keep running old
    # JavaScript that was written for elements that no longer exist.
    else:
        response.headers["Cache-Control"] = "no-store, max-age=0"
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
    """Migrate the players table to the newest schema if needed."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(players)").fetchall()}

    if "matches" in cols:
        # Legacy 'matches' schema → full rebuild into the current one
        conn.executescript(
            """
            ALTER TABLE players RENAME TO players_old;

            CREATE TABLE players (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                name                TEXT NOT NULL,
                points              INTEGER NOT NULL DEFAULT 0,
                team                TEXT NOT NULL DEFAULT '',
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL,
                points_changed_at   TEXT NOT NULL DEFAULT '',
                points_direction    INTEGER NOT NULL DEFAULT 0
            );

            INSERT INTO players (id, name, points, team, created_at, updated_at)
                SELECT id, name, COALESCE(points, 0), '', created_at, updated_at
                FROM players_old;

            DROP TABLE players_old;
            """
        )
        return

    # Partial upgrades: add any missing column (idempotent, no data loss)
    if "points" not in cols:
        conn.execute("ALTER TABLE players ADD COLUMN points INTEGER NOT NULL DEFAULT 0")
    if "team" not in cols:
        conn.execute("ALTER TABLE players ADD COLUMN team TEXT NOT NULL DEFAULT ''")
    if "points_changed_at" not in cols:
        conn.execute("ALTER TABLE players ADD COLUMN points_changed_at TEXT NOT NULL DEFAULT ''")
    if "points_direction" not in cols:
        conn.execute("ALTER TABLE players ADD COLUMN points_direction INTEGER NOT NULL DEFAULT 0")


def restore_from_seed(conn):
    """Re-populate an empty players table from the committed seed file.

    Railway gives every deploy a fresh disk, so the SQLite database starts
    empty each time. seed_players.json (kept under version control) serves as
    the free-of-charge backup: whenever the table is empty at startup we
    restore the last exported snapshot automatically.
    """
    if not SEED_PATH.exists():
        return False
    if conn.execute("SELECT COUNT(*) AS c FROM players").fetchone()["c"] > 0:
        return False
    try:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False

    seeded = 0
    for entry in data.get("players", []):
        name = (entry.get("name") or "").strip()
        if not name:
            continue
        try:
            points = max(0, int(entry.get("points", 0)))
        except (TypeError, ValueError):
            points = 0
        team = (entry.get("team") or "").strip()[:40]
        created = entry.get("created_at") or now_utc()
        updated = entry.get("updated_at") or created
        changed = entry.get("points_changed_at") or ""
        direction = entry.get("points_direction") or 0
        try:
            direction = max(-1, min(1, int(direction)))
        except (TypeError, ValueError):
            direction = 0
        cur = conn.execute(
            """INSERT INTO players
                   (name, points, team, created_at, updated_at, points_changed_at, points_direction)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (name, points, team, created, updated, changed, direction),
        )
        player_id = cur.lastrowid
        seeded += 1

        # If the seed snapshot contains a real points history replay it as-is
        # so profiles keep their progression (old -> current) across deploys.
        # Otherwise we create a single "0 -> points" baseline row (only for
        # players that have points; a fresh 0-point player keeps an empty
        # history so the profile starts clean).
        hist = entry.get("points_history") or []
        if hist:
            for h in hist:
                try:
                    old_p = max(0, int(h.get("old_points", 0)))
                    new_p = max(0, int(h.get("new_points", 0)))
                except (TypeError, ValueError):
                    continue
                delta = new_p - old_p if "delta" not in h else h.get("delta", 0)
                conn.execute(
                    """INSERT INTO point_history (player_id, old_points, new_points, delta, created_at)
                       VALUES (?, ?, ?, ?, ?)""",
                    (player_id, old_p, new_p, delta, h.get("created_at") or created),
                )
        elif points > 0:
            conn.execute("""INSERT INTO point_history (player_id, old_points, new_points, delta, created_at)
                   VALUES (?, ?, ?, ?, ?)""", (player_id, 0, points, points, created))
    return seeded > 0


def init_db():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS players (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                name                TEXT NOT NULL,
                points              INTEGER NOT NULL DEFAULT 0,
                team                TEXT NOT NULL DEFAULT '',
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL,
                points_changed_at   TEXT NOT NULL DEFAULT '',
                points_direction    INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS admins (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS point_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id   INTEGER NOT NULL,
                old_points  INTEGER NOT NULL DEFAULT 0,
                new_points  INTEGER NOT NULL DEFAULT 0,
                delta       INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_point_history_player
                ON point_history (player_id, created_at);
            """
        )
        migrate_players(conn)
        restore_from_seed(conn)
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


TREND_WINDOW_SECONDS = 3 * 24 * 60 * 60  # arrows stay visible for 3 days


def trend_for(row):
    """Return 'up', 'down' or '' based on the last points change.

    An indicator (up/down arrow) is shown for TREND_WINDOW_SECONDS after the
    points of a player changed; past that window it disappears.
    """
    direction = row["points_direction"]
    changed_at = row["points_changed_at"]
    if not direction or not changed_at:
        return ""
    try:
        changed = datetime.fromisoformat(changed_at)
        age = (datetime.now(timezone.utc) - changed).total_seconds()
    except (TypeError, ValueError):
        return ""
    if age < 0 or age > TREND_WINDOW_SECONDS:
        return ""
    return "up" if direction > 0 else "down"


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
                "trend": trend_for(row),
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


@app.route("/player/<int:player_id>")
def player_page(player_id):
    return render_template("player.html", player_id=player_id)


@app.route("/rules")
def rules_page():
    return render_template("rules.html")


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
@app.route("/api/ranking")
def api_ranking():
    with get_db() as conn:
        return jsonify(fetch_ranking(conn))


@app.route("/api/players/<int:player_id>/history")
def api_player_history(player_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM players WHERE id = ?", (player_id,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Player not found"}), 404

        history = conn.execute(
            """SELECT id, old_points, new_points, delta, created_at
               FROM point_history WHERE player_id = ?
               ORDER BY created_at ASC, id ASC""",
            (player_id,),
        ).fetchall()

        ranking = fetch_ranking(conn)["players"]
        player = next((p for p in ranking if p["id"] == player_id), None)

        # Season stats derived from the points history.
        season_points = sum(h["delta"] for h in history)
        peak = max((h["new_points"] for h in history), default=row["points"])
        matches = len(history)

        return jsonify({
            "player": player or {
                "id": row["id"], "rank": None, "name": row["name"],
                "points": row["points"], "team": row["team"],
                "created_at": row["created_at"], "updated_at": row["updated_at"],
                "trend": trend_for(row),
            },
            "history": [dict(h) for h in history],
            "stats": {
                "season_points": season_points,
                "peak": peak,
                "matches": matches,
            },
        })


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
        conn.execute(
            """INSERT INTO point_history (player_id, old_points, new_points, delta, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (new_id, 0, payload["points"], payload["points"], ts),
        )
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
        old_points = row["points"]
        new_points = payload["points"]
        changed_at = row["points_changed_at"]
        direction = row["points_direction"]

        if new_points != old_points:
            changed_at = ts
            direction = 1 if new_points > old_points else -1
            conn.execute(
                """INSERT INTO point_history
                       (player_id, old_points, new_points, delta, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (player_id, old_points, new_points, new_points - old_points, ts),
            )

        conn.execute(
            """UPDATE players
               SET name = ?, points = ?, team = ?, updated_at = ?,
                   points_changed_at = ?, points_direction = ?
               WHERE id = ?""",
            (
                payload["name"],
                new_points,
                payload["team"],
                ts,
                changed_at,
                direction,
                player_id,
            ),
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
        conn.execute("DELETE FROM point_history WHERE player_id = ?", (player_id,))
        return jsonify(fetch_ranking(conn))


@app.route("/api/backup")
@admin_required
def api_backup():
    """Download the current players as a seed_players.json snapshot.

    The exported file can replace seed_players.json in the repo, turning
    it into a version-controlled backup that survives Railway redeploys.
    """
    from flask import Response

    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, name, points, team, created_at, updated_at,
                      points_changed_at, points_direction
               FROM players ORDER BY points DESC, name COLLATE NOCASE ASC"""
        ).fetchall()
        players = []
        for r in rows:
            pl = dict(r)
            hist = conn.execute(
                """SELECT old_points, new_points, delta, created_at
                   FROM point_history
                   WHERE player_id = ? ORDER BY created_at ASC, id ASC""",
                (r["id"],),
            ).fetchall()
            pl["points_history"] = [dict(h) for h in hist]
            del pl["id"]
            players.append(pl)
    payload = {"players": players}
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    return Response(
        body,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=seed_players.json"},
    )


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