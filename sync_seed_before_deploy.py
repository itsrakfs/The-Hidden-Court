# -*- coding: utf-8 -*-
"""Pull the latest live backup and write it as seed_players.json.

Run before every deploy so the committed snapshot always matches the newest
live data (streaks, wins, MVP, points, league rounds). Nothing gets wiped.
"""
import json
import os
import pathlib
import sys

import requests

BASE = "https://thehiddencourt.fun"
ENV_PATH = pathlib.Path(__file__).resolve().parent / ".env"


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


def main():
    env = load_env()
    username = env.get("ADMIN_USERNAME") or "Rakfs"
    password = os.environ.get("ADMIN_PASSWORD_PLAIN") or env.get("ADMIN_PASSWORD_PLAIN") or ""
    if not password:
        p = input("Admin password: ")
        password = p.strip()

    s = requests.Session()
    r = s.post(BASE + "/api/auth/login", json={"username": username, "password": password}, timeout=20)
    ok = r.json().get("authenticated")
    if not ok:
        print("login FAILED")
        return 1

    b = s.get(BASE + "/api/backup", timeout=30).json()
    seed_path = ENV_PATH.parent / "seed_players.json"
    with open(seed_path, "w", encoding="utf-8") as f:
        json.dump(b, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("OK -> seed_players.json updated")
    print("  players:", len(b["players"]), "| total_tournaments:", b.get("total_tournaments"))
    non_zero = sum(1 for p in b["players"] if p.get("streak") or p.get("mvp_count") or p.get("tournaments"))
    print("  players with streak/mvp/tournaments:", non_zero)
    return 0


if __name__ == "__main__":
    sys.exit(main())