"""Пульс VUZOL: щоденний звіт Google Analytics у Telegram.

Секрети/змінні (Settings → Secrets and variables → Actions):
  GA_SERVICE_ACCOUNT_JSON  — секрет, JSON-ключ сервісного акаунта Google з доступом «Переглядач» до ресурсу GA
  TELEGRAM_BOT_TOKEN       — секрет, токен бота від @BotFather
  TELEGRAM_CHAT_ID         — змінна, ID чату/каналу; якщо порожньо, скрипт виводить знайдені чати в підсумок запуску
"""
import datetime as dt
import html
import json
import os
import sys
import urllib.parse
import urllib.request

PROPERTY_ID = os.environ.get("GA_PROPERTY_ID", "565940743")
SITE = "vuzol.org.ua"
TZ = dt.timezone(dt.timedelta(hours=2))  # для підписів; дати рахує сам GA у часовому поясі ресурсу


def summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    print(text)


def tg(method, params=None):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    data = urllib.parse.urlencode(params or {}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=data)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def discover_chats():
    res = tg("getUpdates")
    chats = {}
    for u in res.get("result", []):
        for key in ("message", "channel_post", "my_chat_member", "edited_message"):
            m = u.get(key)
            if m and "chat" in m:
                c = m["chat"]
                chats[c["id"]] = c.get("title") or c.get("username") or c.get("first_name") or ""
    if not chats:
        summary("TELEGRAM_CHAT_ID не задано, і бот ще не бачив жодного чату. "
                "Напишіть боту /start (або додайте його в групу/канал і напишіть там) і запустіть workflow ще раз.")
    else:
        summary("TELEGRAM_CHAT_ID не задано. Знайдені чати — скопіюйте потрібний ID у змінну TELEGRAM_CHAT_ID:\n")
        for cid, name in chats.items():
            summary(f"- `{cid}` — {name}")


def ga_client():
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.oauth2 import service_account
    info = json.loads(os.environ["GA_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/analytics.readonly"])
    return BetaAnalyticsDataClient(credentials=creds)


def run(client, dims, metrics, start, end, limit=None, order_metric=None):
    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, OrderBy, RunReportRequest)
    req = RunReportRequest(
        property=f"properties/{PROPERTY_ID}",
        dimensions=[Dimension(name=d) for d in dims],
        metrics=[Metric(name=m) for m in metrics],
        date_ranges=[DateRange(start_date=start, end_date=end)],
    )
    if limit:
        req.limit = limit
    if order_metric:
        req.order_bys = [OrderBy(metric=OrderBy.MetricOrderBy(metric_name=order_metric), desc=True)]
    resp = client.run_report(req)
    return [([d.value for d in r.dimension_values], [float(m.value) for m in r.metric_values]) for r in resp.rows]


def collect(client, weekly):
    if weekly:
        cur, prev = ("7daysAgo", "yesterday"), ("14daysAgo", "8daysAgo")
    else:
        cur, prev = ("yesterday", "yesterday"), ("8daysAgo", "8daysAgo")
    m = ["activeUsers", "screenPageViews", "sessions", "averageSessionDuration"]
    tot = run(client, [], m, *cur)
    old = run(client, [], m, *prev)
    return {
        "cur": tot[0][1] if tot else [0, 0, 0, 0],
        "prev": old[0][1] if old else [0, 0, 0, 0],
        "sources": run(client, ["sessionSource"], ["sessions"], *cur, limit=5, order_metric="sessions"),
        "pages": run(client, ["pageTitle", "pagePath"], ["screenPageViews"], *cur, limit=5, order_metric="screenPageViews"),
        "countries": run(client, ["country"], ["activeUsers"], *cur, limit=5, order_metric="activeUsers"),
    }


def delta(c, p):
    if not p:
        return ""
    d = round((c - p) / p * 100)
    return f" ({'+' if d >= 0 else ''}{d}%)"


def fmt_dur(sec):
    sec = int(sec)
    return f"{sec // 60} хв {sec % 60:02d} с"


def render(data, weekly, today):
    e = html.escape
    users, views, sessions, dur = data["cur"]
    pu, pv, ps, _ = data["prev"]
    if weekly:
        title = "Пульс VUZOL — тиждень"
        period = f"{(today - dt.timedelta(days=7)):%d.%m}–{(today - dt.timedelta(days=1)):%d.%m}"
        cmp_ = "до попереднього тижня"
    else:
        title = "Пульс VUZOL"
        period = f"{(today - dt.timedelta(days=1)):%d.%m.%Y}"
        cmp_ = "до того ж дня тиждень тому"
    lines = [
        f"<b>{title}</b> · {period}",
        f"<a href=\"https://{SITE}\">{SITE}</a>",
        "",
        f"👥 Читачі: <b>{int(users)}</b>{delta(users, pu)}",
        f"👁 Перегляди: <b>{int(views)}</b>{delta(views, pv)}",
        f"🔁 Сесії: {int(sessions)}{delta(sessions, ps)}",
        f"⏱ Середня сесія: {fmt_dur(dur)}",
        f"<i>Зміна — {cmp_}</i>",
    ]
    if data["sources"]:
        lines += ["", "<b>Джерела</b>"] + [f"• {e(d[0])} — {int(v[0])}" for d, v in data["sources"]]
    if data["pages"]:
        lines += ["", "<b>Що читали</b>"]
        for d, v in data["pages"]:
            name = d[0] if d[0] and d[0] != "(not set)" else d[1]
            lines.append(f"• <a href=\"https://{SITE}{e(d[1])}\">{e(name[:70])}</a> — {int(v[0])}")
    if data["countries"]:
        lines += ["", "<b>Країни</b>", " · ".join(f"{e(d[0])} {int(v[0])}" for d, v in data["countries"])]
    if not users:
        lines += ["", "Відвідувань не зафіксовано. Якщо це несподівано, перевірте, чи код GA є на сайті."]
    return "\n".join(lines)


def main():
    if not os.environ.get("TELEGRAM_BOT_TOKEN"):
        summary("Не задано секрет TELEGRAM_BOT_TOKEN — пульс пропущено.")
        return
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not chat:
        discover_chats()
        return
    if not os.environ.get("GA_SERVICE_ACCOUNT_JSON"):
        summary("Не задано секрет GA_SERVICE_ACCOUNT_JSON — пульс пропущено.")
        return
    today = dt.datetime.now(TZ).date()
    mode = os.environ.get("PULSE_MODE", "auto")
    weekly = mode == "weekly" or (mode == "auto" and today.weekday() == 0)
    text = render(collect(ga_client(), weekly), weekly, today)
    res = tg("sendMessage", {"chat_id": chat, "text": text, "parse_mode": "HTML",
                             "disable_web_page_preview": "true"})
    if not res.get("ok"):
        sys.exit(f"Telegram error: {res}")
    summary("Пульс надіслано в Telegram.\n\n" + text)


if __name__ == "__main__":
    main()
