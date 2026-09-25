"""devstand — local simulator of news sources (SYNTHETIC data) for offline end-to-end verification.

Serves the same formats real sources use: RSS 2.0, Atom, Telegram public preview HTML (t.me/s/…),
YouTube channel feeds, a municipal/official website (list page + article pages), GDELT DOC API JSON,
plus robots.txt. Control API: release held "live" items, inject failures, inspect state.

Run: python -m devstand.server --port 8090   (from the repository root)
"""
from __future__ import annotations

import argparse
import html
import threading
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response

CORPUS = Path(__file__).parent / "fixtures" / "corpus.yaml"
UTC = timezone.utc


class Stand:
    def __init__(self, corpus_path: Path = CORPUS):
        data = yaml.safe_load(corpus_path.read_text())
        self.sources: dict[str, dict] = data["sources"]
        self.t0 = datetime.now(UTC).replace(microsecond=0)
        self.reports: list[dict] = []
        for story in data["stories"]:
            for r in story["reports"]:
                self.reports.append({**r, "story": story["key"], "gold": story["gold"]})
        self.released: set[str] = {r["id"] for r in self.reports if r.get("release") != "live"}
        self.queue: list[str] = [r["id"] for r in sorted(self.reports, key=lambda r: r["at"]) if r["id"] not in self.released]
        self.requests: dict[str, int] = {}
        self.failures: dict[str, str] = {}
        self.released_at: dict[str, datetime] = {}
        self.lock = threading.Lock()

    # ------------------------------------------------------------------ items
    def published(self, r: dict) -> datetime:
        if r["id"] in self.released_at:          # live items are "published" when released
            return self.released_at[r["id"]]
        return self.t0 + timedelta(minutes=r["at"])

    def items(self, source: str) -> list[dict]:
        """Current visible items of a source; an update replaces its original (same guid)."""
        visible = [r for r in self.reports if r["source"] == source and r["id"] in self.released]
        replaced = {r["update_of"] for r in visible if r.get("update_of")}
        out = [r for r in visible if r["id"] not in replaced]
        return sorted(out, key=self.published, reverse=True)

    def guid(self, r: dict) -> str:
        return r.get("update_of") or r["id"]

    def external_id(self, r: dict) -> str:
        """The id a connector will see for this report (differs per wire format)."""
        fmt = self.sources.get(r["source"], {}).get("format")
        g = self.guid(r)
        return {"rss": f"{r['source']}:{g}", "atom": f"urn:{r['source']}:{g}", "youtube": f"yt:video:{g}",
                "telegram": f"{r['source']}/{self.tg_post_id(r)}", "gdelt": f"https://demo-gdelt.example/{g}",
                }.get(fmt, f"/site/{r['source']}/news/{g}")

    def tg_post_id(self, r: dict) -> int:
        return 100 + self.reports.index(r)

    def release(self, n: int = 1) -> list[str]:
        with self.lock:
            out = []
            for _ in range(n):
                if not self.queue:
                    break
                rid = self.queue.pop(0)
                self.released.add(rid)
                self.released_at[rid] = datetime.now(UTC).replace(microsecond=0)
                out.append(rid)
            return out

    def check_failure(self, source: str) -> None:
        cfg = self.sources.get(source, {})
        with self.lock:
            self.requests[source] = self.requests.get(source, 0) + 1
            n = self.requests[source]
        mode = self.failures.get(source)
        if mode is None and cfg.get("fail") and n <= cfg["fail"].get("first_requests", 0):
            mode = str(cfg["fail"]["mode"])
        if mode == "503":
            raise HTTPException(503, "Service temporarily unavailable (injected)")
        if mode == "timeout":
            import time
            time.sleep(30)


def _date(dt: datetime, style: str, tz: str | None) -> str:
    off = timezone(timedelta(hours=int(tz[:3]), minutes=int(tz[0] + tz[4:6]))) if tz else UTC
    local = dt.astimezone(off)
    if style == "rfc822_offset":
        return format_datetime(local)
    if style == "rfc822_gmt":
        return format_datetime(dt.astimezone(UTC), usegmt=True)
    if style == "naive_local":   # no timezone at all: reader must assume the source's local time (Moscow)
        return dt.astimezone(timezone(timedelta(hours=3))).strftime("%Y-%m-%d %H:%M:%S")
    if style == "iso_z":
        return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return local.isoformat()


def create_app(stand: Stand) -> FastAPI:
    app = FastAPI(title="devstand (synthetic sources)")
    base = {"url": ""}

    @app.middleware("http")
    async def remember_base(request: Request, call_next):
        base["url"] = str(request.base_url).rstrip("/")
        return await call_next(request)

    def link(r: dict) -> str:
        return f"{base['url']}/site/{r['source']}/news/{stand.guid(r)}"

    @app.get("/robots.txt", response_class=PlainTextResponse)
    def robots():
        return "User-agent: *\nDisallow: /private/\n"

    @app.get("/rss/{slug}.xml")
    def rss(slug: str):
        cfg = stand.sources.get(slug) or {}
        stand.check_failure(slug)
        if cfg.get("format") == "broken":
            return Response("<rss><channel><item><title>broken & unescaped <b></channel>", media_type="application/rss+xml")
        items = []
        for r in stand.items(slug):
            geo = f"<georss:point>{r['lat']} {r['lon']}</georss:point>" if r.get("lat") is not None else ""
            items.append(
                f"<item><title>{html.escape(r['title'])}</title><link>{link(r)}</link>"
                f"<guid isPermaLink=\"false\">{slug}:{stand.guid(r)}</guid>"
                f"<pubDate>{_date(stand.published(r), cfg.get('date_style', 'rfc822_offset'), cfg.get('tz'))}</pubDate>"
                f"<description>{html.escape('<p>' + r['body'] + '</p>')}</description>{geo}</item>")
        xml = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:georss="http://www.georss.org/georss">'
               f"<channel><title>{slug} (DEMO)</title><link>{base['url']}/site/{slug}/</link>"
               f"<description>Synthetic demo feed</description>{''.join(items)}</channel></rss>")
        return Response(xml, media_type="application/rss+xml; charset=utf-8")

    @app.get("/atom/{slug}.xml")
    def atom(slug: str):
        cfg = stand.sources.get(slug) or {}
        stand.check_failure(slug)
        entries = "".join(
            f"<entry><id>urn:{slug}:{stand.guid(r)}</id><title>{html.escape(r['title'])}</title>"
            f"<link rel=\"alternate\" href=\"{link(r)}\"/><updated>{_date(stand.published(r), 'iso', cfg.get('tz'))}</updated>"
            f"<summary type=\"html\">{html.escape(r['body'])}</summary></entry>" for r in stand.items(slug))
        xml = (f'<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>{slug} (DEMO)</title>'
               f"<id>urn:{slug}</id><updated>{datetime.now(UTC).isoformat()}</updated>{entries}</feed>")
        return Response(xml, media_type="application/atom+xml; charset=utf-8")

    @app.get("/tg/s/{channel}", response_class=HTMLResponse)
    def telegram(channel: str):
        stand.check_failure(channel)
        msgs = []
        for i, r in enumerate(reversed(stand.items(channel))):
            fwd = ""
            if r.get("forward"):
                orig = next(x for x in stand.reports if x["id"] == r["forward"])
                fwd = (f'<div class="tgme_widget_message_forwarded_from">Forwarded from <a class="tgme_widget_message_forwarded_from_name" '
                       f'href="{base["url"]}/tg/s/{orig["source"]}">{orig["source"]}</a></div>')
            video = '<div class="tgme_widget_message_video_player"></div>' if r.get("media") == "video" else ""
            body = html.escape(r["title"]) + "<br/>" + html.escape(r["body"])
            msgs.append(
                f'<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" '
                f'data-post="{channel}/{stand.tg_post_id(r)}">{fwd}{video}'
                f'<div class="tgme_widget_message_text js-message_text" dir="auto">{body}</div>'
                f'<div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="{base["url"]}/tg/{channel}/{stand.tg_post_id(r)}">'
                f'<time datetime="{stand.published(r).isoformat()}" class="time">{stand.published(r):%H:%M}</time></a></div></div></div>')
        return f'<html><body><div class="tgme_channel_history js-message_history">{"".join(msgs)}</div></body></html>'

    @app.get("/yt/feeds/videos.xml")
    def youtube(channel_id: str):
        stand.check_failure(channel_id)
        entries = "".join(
            f"<entry><id>yt:video:{stand.guid(r)}</id><yt:videoId>{stand.guid(r)}</yt:videoId><yt:channelId>{channel_id}</yt:channelId>"
            f"<title>{html.escape(r['title'])}</title><link rel=\"alternate\" href=\"{base['url']}/yt/watch?v={stand.guid(r)}\"/>"
            f"<published>{stand.published(r).isoformat()}</published><media:group><media:title>{html.escape(r['title'])}</media:title>"
            f"<media:description>{html.escape(r['body'])}</media:description></media:group></entry>"
            for r in stand.items(channel_id))
        xml = ('<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" '
               'xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">'
               f"<title>{channel_id} (DEMO)</title>{entries}</feed>")
        return Response(xml, media_type="application/atom+xml; charset=utf-8")

    @app.get("/site/{slug}/", response_class=HTMLResponse)
    def site_list(slug: str):
        stand.check_failure(slug)
        lis = "".join(f'<li><a class="news-link" href="/site/{slug}/news/{stand.guid(r)}">{html.escape(r["title"])}</a></li>'
                      for r in stand.items(slug))
        return f"<html><body><h1>{slug} (DEMO)</h1><ul class='news'>{lis}</ul><a href='/private/admin'>admin</a></body></html>"

    @app.get("/site/{slug}/news/{rid}", response_class=HTMLResponse)
    def site_article(slug: str, rid: str):
        cands = [r for r in stand.items(slug) if stand.guid(r) == rid] or \
                [r for r in stand.reports if stand.guid(r) == rid and r["id"] in stand.released]
        if not cands:
            raise HTTPException(404)
        r = cands[0]
        return (f"<html><head><title>{html.escape(r['title'])}</title></head><body><nav>Главная · Новости · Контакты</nav>"
                f"<article><h1>{html.escape(r['title'])}</h1><time datetime=\"{stand.published(r).isoformat()}\">"
                f"{stand.published(r):%d.%m.%Y %H:%M}</time><p>{html.escape(r['body'])}</p>"
                f"<p>Источник: демонстрационные синтетические данные.</p></article><footer>© DEMO</footer></body></html>")

    def _post_page(r: dict, extra: str = "") -> str:
        return (f"<html><head><title>{html.escape(r['title'])}</title></head><body><article>"
                f"<p><b>{html.escape(r['source'])}</b> · {stand.published(r):%d.%m.%Y %H:%M} UTC · DEMO</p>{extra}"
                f"<h1>{html.escape(r['title'])}</h1><p>{html.escape(r['body'])}</p>"
                f"<p><small>Синтетические демонстрационные данные.</small></p></article></body></html>")

    @app.get("/tg/{channel}/{post_id}", response_class=HTMLResponse)
    def telegram_post(channel: str, post_id: int):
        r = next((x for x in stand.reports if x["source"] == channel and stand.tg_post_id(x) == post_id
                  and x["id"] in stand.released), None)
        if not r:
            raise HTTPException(404)
        return _post_page(r)

    @app.get("/yt/watch", response_class=HTMLResponse)
    def youtube_watch(v: str):
        r = next((x for x in stand.reports if stand.guid(x) == v and x["id"] in stand.released), None)
        if not r:
            raise HTTPException(404)
        return _post_page(r, "<div style='background:#000;color:#fff;padding:40px'>▶ video (demo)</div>")

    @app.get("/gdelt/api/v2/doc/doc")
    def gdelt(query: str = "", format: str = "json", mode: str = "artlist", maxrecords: int = 75, sort: str = ""):
        stand.check_failure("demo-gdelt")
        arts = [{"url": f"https://demo-gdelt.example/{stand.guid(r)}", "url_mobile": "", "title": r["title"],
                 "seendate": stand.published(r).strftime("%Y%m%dT%H%M%SZ"), "socialimage": "",
                 "domain": f"demo-{i}.example", "language": "English", "sourcecountry": "Demo"}
                for i, r in enumerate(stand.items("demo-gdelt"))]
        return JSONResponse({"articles": arts[:maxrecords]})

    @app.get("/private/admin")
    def private():
        return PlainTextResponse("disallowed for bots")

    # ------------------------------------------------------------------ control
    @app.post("/control/release")
    def control_release(n: int = 1):
        return {"released": stand.release(n), "remaining": len(stand.queue)}

    @app.post("/control/fail")
    def control_fail(slug: str, mode: str = "503"):
        stand.failures[slug] = mode
        return {"failing": stand.failures}

    @app.post("/control/recover")
    def control_recover(slug: str):
        stand.failures.pop(slug, None)
        return {"failing": stand.failures}

    @app.get("/control/state")
    def control_state():
        return {"t0": stand.t0.isoformat(), "released": len(stand.released), "queued": stand.queue,
                "requests": stand.requests, "failing": stand.failures}

    @app.get("/control/gold")
    def control_gold():
        """Gold labels for evaluation: external id -> story/place/category (only released items)."""
        out = {}
        for r in stand.reports:
            if r["id"] in stand.released:
                out[r["id"]] = {"story": r["story"], "gold": r["gold"], "source": r["source"], "guid": stand.guid(r),
                                "external_id": stand.external_id(r)}
        return out

    return app


def main() -> None:
    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--auto-release-every", type=float, default=0, help="seconds between automatic live releases")
    a = ap.parse_args()
    stand = Stand()
    if a.auto_release_every > 0:
        def loop():
            import time
            while stand.queue:
                time.sleep(a.auto_release_every)
                stand.release(1)
        threading.Thread(target=loop, daemon=True).start()
    uvicorn.run(create_app(stand), host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
