#!/usr/bin/env python3
"""Build one page per VUZOL YouTube video, plus a /video/ index.

Runs inside the deploy workflow after the static site is restored to
$PUBLIC_DIR. Reads public data from the YouTube Data API v3 with the
YOUTUBE_API_KEY secret. Without a key, or if YouTube fails, it does
nothing and the deploy goes on as before.

Also rewrites sitemap.xml so it lists every page of the site, and points
the homepage episode cards to the new on-site pages.

For local testing: YOUTUBE_FIXTURE=path/to/videos.json skips the API.
"""
import datetime
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SITE = os.environ.get("SITE_URL", "https://vuzol.org.ua/").rstrip("/") + "/"
PUBLIC = Path(os.environ.get("PUBLIC_DIR") or Path(os.environ.get("RUNNER_TEMP", ".")) / "public")
CHANNEL_HANDLE = os.environ.get("YOUTUBE_CHANNEL_HANDLE", "vuzolmedia")
CHANNEL_URL = "https://www.youtube.com/@" + CHANNEL_HANDLE
API = "https://www.googleapis.com/youtube/v3/"

# Short clips with a tiny description make thin pages that search engines
# treat as low value, so a video gets a page only if it is longer than
# this, or if its description has some substance.
MIN_SECONDS = 181
MIN_DESCRIPTION_CHARS = 300

e = html.escape


def api(path, **params):
    params["key"] = os.environ["YOUTUBE_API_KEY"]
    url = API + path + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.load(resp)


def fetch_videos():
    """Return a list of video dicts in API 'videos' resource shape."""
    fixture = os.environ.get("YOUTUBE_FIXTURE")
    if fixture:
        return json.loads(Path(fixture).read_text(encoding="utf-8"))
    ch = api("channels", part="contentDetails", forHandle=CHANNEL_HANDLE)
    if not ch.get("items"):
        raise SystemExit("YouTube channel @%s not found" % CHANNEL_HANDLE)
    uploads = ch["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
    ids, token = [], None
    while True:
        params = dict(part="contentDetails", playlistId=uploads, maxResults=50)
        if token:
            params["pageToken"] = token
        page = api("playlistItems", **params)
        ids += [it["contentDetails"]["videoId"] for it in page.get("items", [])]
        token = page.get("nextPageToken")
        if not token or len(ids) >= 1000:
            break
    videos = []
    for i in range(0, len(ids), 50):
        chunk = api("videos", part="snippet,contentDetails,status,statistics", id=",".join(ids[i:i + 50]), maxResults=50)
        videos += chunk.get("items", [])
    return videos


def seconds(iso):
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s


def human_duration(total):
    h, rest = divmod(total, 3600)
    m, s = divmod(rest, 60)
    return "%d:%02d:%02d" % (h, m, s) if h else "%d:%02d" % (m, s)


MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня",
          "серпня", "вересня", "жовтня", "листопада", "грудня"]


def human_date(iso):
    d = datetime.date.fromisoformat(iso[:10])
    return "%d %s %d" % (d.day, MONTHS[d.month - 1], d.year)


def best_thumb(snippet, vid):
    thumbs = snippet.get("thumbnails", {})
    for k in ("maxres", "standard", "high", "medium", "default"):
        if k in thumbs:
            return thumbs[k]["url"]
    return "https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid


def clean_text(text):
    """Description without links, hashtags and timestamps, for meta tags."""
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"(^|\s)#[\wЀ-ӿ]+", " ", text)
    text = re.sub(r"(?m)^\s*\d{1,2}:\d{2}(?::\d{2})?\s.*$", "", text)
    return re.sub(r"\s+", " ", text).strip()


def meta_description(title, desc):
    text = clean_text(desc)
    if len(text) < 60:
        text = "%s — випуск VUZOL (Вузол), медіа про історію української музики." % title
    if len(text) > 158:
        text = text[:155].rsplit(" ", 1)[0].rstrip(",.;:—-") + "…"
    return text


TS = re.compile(r"(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\d:])")
URL = re.compile(r"https?://[^\s<]+[^\s<.,;:!?)»\"']")


def ts_seconds(ts):
    parts = [int(p) for p in ts.split(":")]
    total = 0
    for p in parts:
        total = total * 60 + p
    return total


def render_description(desc):
    """Escape the description and turn URLs and timestamps into links."""
    if not desc.strip():
        return ""
    out = []
    for para in re.split(r"\n\s*\n", desc.strip()):
        lines = []
        for line in para.split("\n"):
            pieces, pos = [], 0
            for m in URL.finditer(line):
                pieces.append(("text", line[pos:m.start()]))
                pieces.append(("url", m.group(0)))
                pos = m.end()
            pieces.append(("text", line[pos:]))
            rendered = ""
            for kind, chunk in pieces:
                if kind == "url":
                    shown = re.sub(r"^https?://(www\.)?", "", chunk)
                    if len(shown) > 60:
                        shown = shown[:57] + "…"
                    rendered += '<a href="%s" rel="nofollow noopener" target="_blank">%s</a>' % (e(chunk), e(shown))
                else:
                    rendered += TS.sub(
                        lambda m: '<a href="#video" class="ts" data-t="%d">%s</a>' % (ts_seconds(m.group(1)), m.group(1)),
                        e(chunk),
                    )
            lines.append(rendered)
        out.append("<p>" + "<br>".join(lines) + "</p>")
    return "\n".join(out)


STYLE = """
@font-face { font-family:"Fixel Text"; src:url("/assets/fonts/FixelText-Regular.woff2") format("woff2"); font-weight:400; font-display:swap; }
@font-face { font-family:"Fixel Text"; src:url("/assets/fonts/FixelText-Bold.woff2") format("woff2"); font-weight:700 900; font-display:swap; }
@font-face { font-family:"NAMU 1400"; src:url("/assets/fonts/NAMU-1400.woff2") format("woff2"); font-weight:400 900; font-display:swap; }
:root { --green:#013131; --orange:#E67F16; --cream:#E6D9CB; --ink:#102827; --paper:#f6efe8; --headline:"NAMU 1400", Impact, sans-serif; }
* { box-sizing:border-box; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:"Fixel Text",system-ui,sans-serif; }
a { color:inherit; }
.wrap { width:min(calc(100% - 48px), 1180px); margin:0 auto; }
.narrow { width:min(calc(100% - 48px), 860px); margin:0 auto; }
.top { background:var(--green); color:var(--cream); }
.top .wrap { display:flex; align-items:center; justify-content:space-between; gap:16px; height:84px; }
.brand img { display:block; width:170px; height:auto; }
.top nav { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
.top nav a { font-weight:800; font-size:14px; padding:10px 16px; border:1px solid rgba(230,217,203,.45); border-radius:10px; text-decoration:none; }
.top nav a:hover { color:var(--orange); border-color:var(--orange); }
.crumbs { font-size:14px; padding:26px 0 0; opacity:.75; }
.crumbs a { text-decoration:none; } .crumbs a:hover { color:var(--orange); }
.eyebrow { color:var(--orange); font-weight:900; font-size:13px; letter-spacing:.1em; text-transform:uppercase; }
h1 { font:900 clamp(30px,4.6vw,52px)/1.02 var(--headline); text-transform:uppercase; color:var(--green); margin:12px 0 18px; }
.meta { font-size:15px; opacity:.75; margin:0 0 24px; }
.player { position:relative; aspect-ratio:16/9; border-radius:18px; overflow:hidden; background:var(--green); box-shadow:0 16px 30px rgba(1,49,49,.18); }
.player button { all:unset; cursor:pointer; position:absolute; inset:0; display:block; }
.player img, .player iframe { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border:0; }
.player .play { position:absolute; left:50%; top:50%; width:84px; height:84px; margin:-42px 0 0 -42px; border-radius:50%; background:var(--orange); box-shadow:0 8px 24px rgba(0,0,0,.3); }
.player .play::after { content:""; position:absolute; left:34px; top:26px; border-style:solid; border-width:16px 0 16px 26px; border-color:transparent transparent transparent var(--green); }
.player button:hover .play { transform:scale(1.06); }
.desc { font-size:18px; line-height:1.6; margin:30px 0; overflow-wrap:anywhere; }
.desc a { color:#a55a0c; }
.actions { display:flex; gap:12px; flex-wrap:wrap; margin:10px 0 50px; }
.button { display:inline-flex; align-items:center; border:1px solid var(--green); border-radius:12px; padding:14px 20px; font-weight:800; font-size:15px; text-decoration:none; }
.button.orange { background:var(--orange); border-color:var(--orange); color:var(--green); }
.more { background:#ece2d6; padding:44px 0 56px; }
h2 { font:900 clamp(26px,3.4vw,38px)/1 var(--headline); text-transform:uppercase; color:var(--green); margin:0 0 24px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:22px; }
.card { text-decoration:none; display:block; }
.card img { width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:12px; display:block; }
.card h3 { font-size:17px; line-height:1.3; margin:10px 0 4px; }
.card span { font-size:13px; opacity:.7; }
.card:hover h3 { color:#a55a0c; }
.intro { padding:40px 0 30px; } .intro p { font-size:18px; line-height:1.55; max-width:720px; }
.list { padding:10px 0 60px; }
footer { background:var(--green); color:var(--cream); padding:30px 0; font-size:14px; }
footer .wrap { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
footer a { text-decoration:none; } footer a:hover { color:var(--orange); }
@media (max-width:640px) { .brand img { width:130px; } .top nav a { padding:8px 10px; font-size:13px; } .top nav a.hide-sm { display:none; } }
"""

PLAYER_JS = """
(function(){
  var box=document.getElementById('video'); if(!box) return;
  function load(t){
    var f=document.createElement('iframe');
    f.src='https://www.youtube-nocookie.com/embed/'+box.dataset.id+'?autoplay=1&rel=0'+(t?'&start='+t:'');
    f.title=box.dataset.title; f.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen=true; f.referrerPolicy='strict-origin-when-cross-origin';
    box.innerHTML=''; box.appendChild(f);
  }
  var b=box.querySelector('button'); if(b) b.addEventListener('click',function(){load(0);});
  document.querySelectorAll('a.ts').forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();load(a.dataset.t);box.scrollIntoView({behavior:'smooth',block:'center'});});});
})();
"""


def head(title, desc, url, image, extra=""):
    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <link rel="canonical" href="{e(url)}">
  <meta property="og:locale" content="uk_UA">
  <meta property="og:site_name" content="VUZOL">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{e(url)}">
  <meta property="og:image" content="{e(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  {extra}
  <style>{STYLE}</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/" aria-label="VUZOL — на головну"><img src="/assets/vuzol-logo-light-cropped.png" alt="VUZOL (Вузол) — медіа про історію української музики" width="170" height="37"></a><nav><a href="/video/">Усі відео</a><a class="hide-sm" href="/">На головну</a></nav></div></header>
"""


FOOT = f"""<footer><div class="wrap"><span>© VUZOL · медіа про історію української музики</span><span><a href="/">vuzol.org.ua</a> · <a href="{CHANNEL_URL}" target="_blank" rel="noopener">YouTube</a> · <a href="https://www.instagram.com/vuzol.media/" target="_blank" rel="noopener">Instagram</a></span></div></footer>
"""


def card(v, depth_prefix="/video/"):
    return (f'<a class="card" href="{depth_prefix}{e(v["id"])}/"><img src="{e(v["thumb_md"])}" alt="" loading="lazy" decoding="async" width="320" height="180">'
            f'<h3>{e(v["title"])}</h3><span>{e(v["date_h"])} · {e(v["dur_h"])}</span></a>')


def ld_json(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def video_page(v, others):
    url = f"{SITE}video/{v['id']}/"
    title = f"{v['title']} — VUZOL (Вузол)"
    desc = meta_description(v["title"], v["description"])
    schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "VideoObject",
                "name": v["title"],
                "description": clean_text(v["description"])[:4900] or desc,
                "thumbnailUrl": [v["thumb"]],
                "uploadDate": v["published"],
                "duration": v["duration"],
                "embedUrl": f"https://www.youtube.com/embed/{v['id']}",
                "url": url,
                "inLanguage": "uk",
                "publisher": {"@type": "Organization", "@id": SITE + "#org", "name": "VUZOL",
                              "logo": {"@type": "ImageObject", "url": SITE + "assets/vuzol-logo-dark-cropped.png"}},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "VUZOL", "item": SITE},
                    {"@type": "ListItem", "position": 2, "name": "Відео", "item": SITE + "video/"},
                    {"@type": "ListItem", "position": 3, "name": v["title"], "item": url},
                ],
            },
        ],
    }
    if v.get("views") is not None:
        schema["@graph"][0]["interactionStatistic"] = {
            "@type": "InteractionCounter",
            "interactionType": {"@type": "WatchAction"},
            "userInteractionCount": v["views"],
        }
    extra = '<meta property="og:type" content="video.other">\n  ' + ld_json(schema)
    body = f"""<main>
<div class="narrow">
  <nav class="crumbs" aria-label="Навігація"><a href="/">VUZOL</a> › <a href="/video/">Відео</a></nav>
  <span class="eyebrow">YouTube · VUZOL</span>
  <h1>{e(v['title'])}</h1>
  <p class="meta"><time datetime="{e(v['published'][:10])}">{e(v['date_h'])}</time> · {e(v['dur_h'])}</p>
  <div class="player" id="video" data-id="{e(v['id'])}" data-title="{e(v['title'])}">
    <button type="button" aria-label="Відтворити відео «{e(v['title'])}»"><img src="{e(v['thumb'])}" alt="Обкладинка відео «{e(v['title'])}»" width="1280" height="720"><span class="play"></span></button>
  </div>
  <div class="desc">
{render_description(v['description'])}
  </div>
  <div class="actions"><a class="button orange" href="https://www.youtube.com/watch?v={e(v['id'])}" target="_blank" rel="noopener">Дивитися на YouTube</a><a class="button" href="{CHANNEL_URL}?sub_confirmation=1" target="_blank" rel="noopener">Підписатися на канал</a></div>
</div>
</main>
<section class="more"><div class="wrap"><h2>Ще відео VUZOL</h2><div class="grid">{''.join(card(o) for o in others)}</div></div></section>
{FOOT}<script>{PLAYER_JS}</script>
</body>
</html>
"""
    return head(title, desc, url, v["thumb"], extra) + body


def index_page(videos):
    url = SITE + "video/"
    title = "Відео VUZOL (Вузол) — історія української музики"
    desc = "Усі відео VUZOL (Вузол): випуски «Поясни за українську музику» та інші історії про українських музикантів, пісні й події."
    schema = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Відео VUZOL",
        "url": url,
        "inLanguage": "uk",
        "isPartOf": {"@id": SITE + "#website"},
        "mainEntity": {
            "@type": "ItemList",
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "url": f"{SITE}video/{v['id']}/"} for i, v in enumerate(videos)
            ],
        },
    }
    image = videos[0]["thumb"] if videos else SITE + "assets/vuzol-social-preview-v2.jpg"
    body = f"""<main>
<div class="wrap intro">
  <nav class="crumbs" aria-label="Навігація"><a href="/">VUZOL</a> › Відео</nav>
  <span class="eyebrow">YouTube-канал VUZOL</span>
  <h1>Відео VUZOL</h1>
  <p>Струшуємо пил із бронзових пам’ятників музикантів минулого й показуємо їх насамперед як людей. Усі випуски нашого YouTube-каналу — тут, на одній сторінці.</p>
</div>
<div class="wrap list"><div class="grid">{''.join(card(v) for v in videos)}</div>
<div class="actions" style="margin-top:36px"><a class="button orange" href="{CHANNEL_URL}?sub_confirmation=1" target="_blank" rel="noopener">Підписатися на YouTube</a></div></div>
</main>
{FOOT}</body>
</html>
"""
    return head(title, desc, url, image, '<meta property="og:type" content="website">\n  ' + ld_json(schema)) + body


def prepare(raw):
    videos = []
    for it in raw:
        sn, cd, st = it.get("snippet", {}), it.get("contentDetails", {}), it.get("status", {})
        if st.get("privacyStatus", "public") != "public" or st.get("embeddable") is False:
            continue
        if sn.get("liveBroadcastContent", "none") != "none":
            continue
        secs = seconds(cd.get("duration", ""))
        desc = sn.get("description", "") or ""
        if secs < MIN_SECONDS and len(clean_text(desc)) < MIN_DESCRIPTION_CHARS:
            continue
        vid = it["id"]
        thumbs = sn.get("thumbnails", {})
        md = (thumbs.get("medium") or thumbs.get("high") or {}).get("url") or f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"
        views = it.get("statistics", {}).get("viewCount")
        videos.append({
            "id": vid,
            "title": sn.get("title", "").strip(),
            "description": desc,
            "published": sn.get("publishedAt", ""),
            "date_h": human_date(sn.get("publishedAt", "1970-01-01")),
            "duration": cd.get("duration", "PT0S"),
            "dur_h": human_duration(secs),
            "thumb": best_thumb(sn, vid),
            "thumb_md": md,
            "views": int(views) if views is not None else None,
        })
    videos.sort(key=lambda v: v["published"], reverse=True)
    return videos


def link_homepage(videos):
    """Point homepage YouTube links for videos we have pages for to those pages."""
    index = PUBLIC / "index.html"
    content = index.read_text(encoding="utf-8")
    have = {v["id"] for v in videos}
    changed = 0

    def repl(m):
        nonlocal changed
        tag, vid = m.group(0), m.group(2)
        if vid not in have:
            return tag
        changed += 1
        tag = re.sub(r'href="[^"]*"', f'href="video/{vid}/"', tag, count=1)
        tag = re.sub(r'\s+target="_blank"', "", tag)
        tag = re.sub(r'\s+rel="[^"]*"', "", tag)
        return tag.replace(" ↗", "")

    content = re.sub(r'<a\b[^>]*href="https://(www\.)?youtube\.com/watch\?v=([\w-]{11})[^"]*"[^>]*>(?:[^<]*</a>)?', repl, content)
    # "All episodes" button in the YouTube section -> on-site list.
    content, n = re.subn(
        r'(<p class="episodes-more"><a class="button[^"]*") href="https://www\.youtube\.com/@[^"]*" target="_blank" rel="noreferrer">',
        r'\1 href="video/">', content, count=1)
    index.write_text(content, encoding="utf-8")
    print(f"Homepage: {changed} episode links and {n} 'all episodes' button now point to on-site pages")


def write_sitemap():
    today = datetime.date.today().isoformat()
    urls = [SITE]
    for page in sorted(PUBLIC.rglob("index.html")):
        rel = page.parent.relative_to(PUBLIC).as_posix()
        if rel in (".", "") or rel.startswith("assets"):
            continue
        urls.append(SITE + rel + "/")
    body = "".join(f"  <url><loc>{e(u)}</loc><lastmod>{today}</lastmod></url>\n" for u in urls)
    (PUBLIC / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + body + "</urlset>\n", encoding="utf-8")
    print(f"Sitemap: {len(urls)} pages")


def main():
    if not (os.environ.get("YOUTUBE_API_KEY") or os.environ.get("YOUTUBE_FIXTURE")):
        print("YOUTUBE_API_KEY is not set: skipping video pages")
        write_sitemap()
        return
    try:
        raw = fetch_videos()
    except Exception as exc:  # never break the deploy because of YouTube
        print(f"::warning::YouTube API failed, video pages skipped: {exc}")
        write_sitemap()
        return
    videos = prepare(raw)
    print(f"YouTube: {len(raw)} videos on the channel, {len(videos)} get a page")
    if videos:
        out = PUBLIC / "video"
        for i, v in enumerate(videos):
            others = [o for o in videos if o["id"] != v["id"]][:6]
            page = out / v["id"] / "index.html"
            page.parent.mkdir(parents=True, exist_ok=True)
            page.write_text(video_page(v, others), encoding="utf-8")
        (out / "index.html").write_text(index_page(videos), encoding="utf-8")
        link_homepage(videos)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as f:
                f.write(f"### Сторінки відео\n\nСтворено {len(videos)} сторінок із {len(raw)} відео на каналі.\n\n")
                for v in videos:
                    f.write(f"- [{v['title']}]({SITE}video/{v['id']}/)\n")
    write_sitemap()


if __name__ == "__main__":
    main()
