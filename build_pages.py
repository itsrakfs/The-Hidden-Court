# -*- coding: utf-8 -*-
"""Build the static GitHub Pages site into site/.

The public site (ranking / player / rules) is plain HTML+JS. It reads the
ranking from the Flask API and falls back to a baked snapshot so the page
never renders empty, even if the backend host is paused or down.

Usage:
    python build_pages.py                 # build with defaults
    python build_pages.py --api-base URL  # override the backend host
    python build_pages.py --no-snapshot   # skip baking the fallback JSON

Defaults point at the current live host. After the backend moves to
PythonAnywhere, rebuild with --api-base https://<user>.pythonanywhere.com
(or set TH_API_BASE).
"""
import argparse
import json
import pathlib
import re
import shutil
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"
OUT = ROOT / "site"

DEFAULT_API_BASE = "https://thehiddencourt.fun"
CUSTOM_DOMAIN = "thehiddencourt.fun"

PUBLIC_TEMPLATES = ("index.html", "player.html", "rules.html")

STATIC_URL_RE = re.compile(
    r"\{\{\s*url_for\(\s*'static'\s*,\s*filename='([^']+)'\s*\)\s*\}\}"
)
PLAYER_ID_RE = re.compile(r"var PLAYER_ID = \{\{\s*player_id\s*\}\};")


def transform(name, html, api_base, admin_url):
    html = STATIC_URL_RE.sub(lambda m: m.group(1), html)
    html = html.replace('href="/admin"', 'href="%s"' % admin_url)
    html = html.replace('href="/rules"', 'href="rules.html"')
    html = html.replace('href="/"', 'href="./"')
    html = PLAYER_ID_RE.sub("var PLAYER_ID = TH.playerId();", html)
    html = html.replace(
        "<html lang=\"ar\" dir=\"ltr\">",
        '<html lang="ar" dir="ltr" data-api-base="%s" data-player-url="player.html?id=" '
        'data-fallback="data/ranking.json">' % api_base,
        1,
    )
    return html


def copy_static():
    if (OUT / "css").exists():
        shutil.rmtree(OUT / "css")
    shutil.copytree(STATIC / "css", OUT / "css")
    (OUT / "js" / "vendor").mkdir(parents=True, exist_ok=True)
    for js in ("config.js", "public.js", "player.js", "share.js"):
        shutil.copy2(STATIC / "js" / js, OUT / "js" / js)
    shutil.copy2(
        STATIC / "js" / "vendor" / "html2canvas.min.js",
        OUT / "js" / "vendor" / "html2canvas.min.js",
    )
    for asset in ("og-cover.png",):
        src = STATIC / asset
        if src.exists():
            shutil.copy2(src, OUT / asset)


def bake_snapshot(api_base):
    """Freeze the current ranking so the page still renders when the API is down."""
    dest = OUT / "data" / "ranking.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = api_base.rstrip("/") + "/api/ranking"
    req = urllib.request.Request(url, headers={"User-Agent": "hidden-court-build"})
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read().decode("utf-8"))
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        f.write("\n")
    return len(data.get("players") or [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=None)
    ap.add_argument("--no-snapshot", action="store_true")
    args = ap.parse_args()

    api_base = (args.api_base or DEFAULT_API_BASE).rstrip("/")
    admin_url = api_base + "/admin"

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for name in PUBLIC_TEMPLATES:
        src = TEMPLATES / name
        html = transform(name, src.read_text(encoding="utf-8"), api_base, admin_url)
        (OUT / name).write_text(html, encoding="utf-8")
        print("  template ->", name)

    copy_static()
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    (OUT / "CNAME").write_text(CUSTOM_DOMAIN + "\n", encoding="utf-8")

    print("  api-base:", api_base)
    print("  admin   :", admin_url)

    if args.no_snapshot:
        print("  snapshot: skipped")
    else:
        try:
            n = bake_snapshot(api_base)
            print("  snapshot: baked data/ranking.json (%d players)" % n)
        except Exception as exc:  # keep building, the site still works online
            print("  snapshot: FAILED (%s)" % exc, file=sys.stderr)

    print("OK -> %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
