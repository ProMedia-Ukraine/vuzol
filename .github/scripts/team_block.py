#!/usr/bin/env python3
"""Build the «Команда» block of the homepage from content/team.json.

The team list is edited in the admin panel (admin/), which commits
content/team.json and photos in content/team/ to this repository. At deploy
time this script:

- copies the photos to assets/team/portraits/ in the published site;
- writes the team cards straight into the HTML (visible to search engines
  and without JavaScript);
- removes the old hard-coded list and the script that drew it.

Runs after the archive is restored, so it also works when the team uploads a
new archive. If content/team.json is missing or broken, the page is left as
it is and the deploy goes on.
"""
import html
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / "content"
PUBLIC = Path(os.environ.get("PUBLIC_DIR") or Path(os.environ.get("RUNNER_TEMP", ".")) / "public")
PHOTO_DIR = "assets/team/portraits"
INSTAGRAM_ICON = "https://cdn.simpleicons.org/instagram/013131"


def esc(value):
    return html.escape(str(value or ""), quote=True)


def safe_url(value):
    value = (value or "").strip()
    return value if re.match(r"^https?://", value, re.I) else ""


def card(member):
    name, role = member.get("name", "").strip(), member.get("role", "").strip()
    link = safe_url(member.get("instagram"))
    photo = f'{PHOTO_DIR}/{member["photo"]}' if member.get("photo") else ""
    alt = f"{name} — {role}" if role else name
    img = f'<img src="{esc(photo)}" alt="{esc(alt)}" loading="lazy">' if photo else ""
    if link:
        photo_html = (f'<a class="team-photo" href="{esc(link)}" target="_blank" rel="noreferrer" '
                      f'aria-label="Instagram: {esc(name)}">{img}</a>')
        insta = (f'<a class="team-instagram" href="{esc(link)}" target="_blank" rel="noreferrer" '
                 f'aria-label="Відкрити Instagram: {esc(name)}"><img src="{INSTAGRAM_ICON}" alt=""></a>')
    else:
        photo_html, insta = f'<span class="team-photo">{img}</span>', ""
    return (f'<article class="team-card">{photo_html}<div class="team-card-copy">'
            f'<h3>{esc(name)}</h3><p class="team-role">{esc(role)}</p>{insta}</div></article>')


def main():
    index = PUBLIC / "index.html"
    try:
        data = json.loads((CONTENT / "team.json").read_text(encoding="utf-8"))
        members = [m for m in data["members"] if (m.get("name") or "").strip()]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print("team.json unavailable, team block left as is:", exc)
        return 0

    page = index.read_text(encoding="utf-8")

    grid_re = re.compile(r'<div class="team-grid" data-team-grid[^>]*>.*?</div>(\s*<template id="team-card-template">.*?</template>)?', re.S)
    if not grid_re.search(page):
        print("Team grid not found in index.html, team block left as is")
        return 0
    cards = "".join(card(m) for m in members)
    hidden = "" if members else " hidden"
    page = grid_re.sub(lambda _: f'<div class="team-grid" data-team-grid{hidden}>{cards}</div>', page, count=1)

    # The old inline list and the code that drew it are no longer needed.
    page, n = re.subn(
        r"\n?[ \t]*// Team members are managed here\..*?teamGrid\.hidden = teamMembers\.length === 0;[ \t]*\n?",
        "\n", page, count=1, flags=re.S)
    if n != 1:
        print("Warning: old team script not found; it may already be gone")

    target = PUBLIC / PHOTO_DIR
    target.mkdir(parents=True, exist_ok=True)
    for m in members:
        src = CONTENT / "team" / (m.get("photo") or "")
        if m.get("photo") and src.is_file():
            shutil.copyfile(src, target / src.name)
        elif m.get("photo"):
            print("Warning: photo not found:", src)

    index.write_text(page, encoding="utf-8")
    print(f"Team block built: {len(members)} people")
    return 0


if __name__ == "__main__":
    sys.exit(main())
