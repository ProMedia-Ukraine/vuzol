#!/usr/bin/env python3
"""Small search and speed fixes applied to the homepage at deploy time.

Runs after "Add analytics and search tags". Doing it here instead of in the
zipped dist/ means the fixes survive when the team uploads a new archive.

- title and meta description that say what the site is about and carry
  the Cyrillic name «Вузол» (the visible page text is not changed);
- social profiles (sameAs) and a fuller description in the schema.org block;
- heavy images (over 400 KB) referenced by the page are resized and
  recompressed; PNGs without transparency become JPEGs;
- images get loading="lazy", except the header logo, the first screen and
  the photo sliders (lazy images in hidden slides flicker when shown).

Every part is optional: if Pillow is missing, images are left as they are.
"""
import json
import os
import re
from pathlib import Path

PUBLIC = Path(os.environ.get("PUBLIC_DIR") or Path(os.environ.get("RUNNER_TEMP", ".")) / "public")
SITE = os.environ.get("SITE_URL", "https://vuzol.org.ua/").rstrip("/") + "/"

TITLE = "VUZOL (Вузол) — медіа про історію української музики"
DESCRIPTION = ("VUZOL (Вузол) — медіа про історію української музики: гонорари й луки "
               "артистів минулого, музиканти, яких боявся СРСР, архівні історії та зустрічі наживо.")
SAME_AS = [
    "https://www.instagram.com/vuzol.media/",
    "https://www.youtube.com/@vuzolmedia",
    "https://www.tiktok.com/@vuzol.media",
    "https://www.threads.com/@vuzol.media",
]
ALT_NAMES = ["Вузол", "ВУЗОЛ", "Vuzol", "медіа Вузол"]
HEAVY_BYTES = 400 * 1024
MAX_SIDE = 1600


def attr(value):
    return value.replace("&", "&amp;").replace('"', "&quot;")


def set_meta(content):
    content = re.sub(r"<title>.*?</title>", f"<title>{TITLE}</title>", content, count=1, flags=re.S)
    for pattern in (r'(<meta name="description" content=")[^"]*(")',
                    r'(<meta property="og:description" content=")[^"]*(")',
                    r'(<meta name="twitter:description" content=")[^"]*(")'):
        content = re.sub(pattern, lambda m: m.group(1) + attr(DESCRIPTION) + m.group(2), content, count=1)
    return content


def enrich_schema(content):
    m = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', content, re.S)
    if not m:
        return content
    try:
        data = json.loads(m.group(2))
    except ValueError:
        return content
    for node in data.get("@graph", [data]):
        names = node.get("alternateName", [])
        node["alternateName"] = names + [n for n in ALT_NAMES if n not in names]
        if node.get("@type") == "Organization":
            node["sameAs"] = SAME_AS
            node["description"] = "Медіа про історію української музики"
            node["logo"] = SITE + "assets/vuzol-logo-dark-cropped.png"
            node["email"] = "vuzolmedia@gmail.com"
    block = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return content[:m.start(2)] + block + content[m.end(2):]


def optimize_images(content):
    try:
        from PIL import Image
    except ImportError:
        print("Pillow is not installed: images left as they are")
        return content
    saved = 0
    for src in sorted(set(re.findall(r'src="(assets/[^"?]+\.(?:png|jpe?g))"', content, re.I))):
        path = PUBLIC / src
        if not path.is_file() or path.stat().st_size <= HEAVY_BYTES:
            continue
        before = path.stat().st_size
        im = Image.open(path)
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        has_alpha = im.mode in ("RGBA", "LA") and im.getextrema()[-1][0] < 255
        if path.suffix.lower() == ".png" and not has_alpha:
            new = path.with_suffix(".jpg")
            if new.exists():
                new = path.with_name(path.stem + "-opt.jpg")
            im.convert("RGB").save(new, quality=82, optimize=True, progressive=True)
            new_src = new.relative_to(PUBLIC).as_posix()
            content = content.replace(f'src="{src}"', f'src="{new_src}"')
            after = new.stat().st_size
        elif path.suffix.lower() == ".png":
            im.save(path, optimize=True)
            after = path.stat().st_size
        else:
            im.convert("RGB").save(path, quality=82, optimize=True, progressive=True)
            after = path.stat().st_size
        saved += before - after
        print(f"Image {src}: {before // 1024} KB -> {after // 1024} KB")
    print(f"Images: saved {saved // 1024} KB")
    return content


def lazy_images(content):
    first_screen_end = content.find("</section>")  # end of the green header/hero block
    count = 0

    def repl(m):
        nonlocal count
        tag = m.group(0)
        if m.start() < first_screen_end or "loading=" in tag or 'src=""' in tag:
            return tag
        if re.search(r'<figure class="event-slide[^"]*">\s*$', content[max(0, m.start() - 120):m.start()]):
            return tag
        count += 1
        return tag[:-1].rstrip("/").rstrip() + ' loading="lazy" decoding="async">'

    content = re.sub(r"<img\b[^>]*>", repl, content)
    print(f"Lazy loading added to {count} images")
    return content


def main():
    index = PUBLIC / "index.html"
    content = index.read_text(encoding="utf-8")
    content = set_meta(content)
    content = enrich_schema(content)
    content = optimize_images(content)
    content = lazy_images(content)
    index.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
