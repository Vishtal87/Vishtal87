"""Page-based collection: broken feed repair, news sitemaps, generic listing pages, per-source robots override."""
import re
from datetime import UTC, datetime, timedelta

import httpx

import pytest

from geonews.ingestion.connectors import CONNECTORS
from geonews.ingestion.connectors import article
from geonews.ingestion.connectors.article import article_links
from geonews.ingestion.connectors.rss import parse_feed
from geonews.ingestion.connectors.sitemap_news import parse_sitemap
from geonews.ingestion.fetcher import Fetcher
from geonews.ingestion.verify import check_candidate, verified_entry

@pytest.fixture(autouse=True)
def _fresh_rejections():
    article._rejected.clear()


PARAGRAPH = ("В станице Динской Краснодарского края в среду вечером загорелся склад на улице Красной. "
             "На место прибыли пять пожарных расчётов, огонь локализовали за два часа, пострадавших нет. ")


def _article(title: str, when: datetime) -> str:
    return (f'<html><head><title>{title} | Новости</title><meta property="og:title" content="{title}">'
            f'<meta property="article:published_time" content="{when.isoformat()}"></head><body>'
            f'<nav><a href="/">Главная</a></nav><article><h1>{title}</h1>'
            + "".join(f"<p>{PARAGRAPH}</p>" for _ in range(4)) + "</article></body></html>")


def _fetcher(pages: dict[str, tuple[int, str]]) -> tuple[Fetcher, list[str]]:
    hits: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hits.append(request.url.path)
        status, body = pages.get(request.url.path, (404, ""))
        return httpx.Response(status, text=body)

    f = Fetcher(min_interval_s=0)
    f.client = httpx.Client(transport=httpx.MockTransport(handler))
    return f, hits


NOW = datetime.now(UTC)
LISTING = ('<html><body><a href="/news">Новости</a><a href="/tags/pozhar">Все новости с тегом пожар</a>'
           '<a href="/news/2026/09/sklad-v-dinskoy">Склад загорелся в станице Динской вечером в среду</a>'
           '<a href="https://other.test/news/1/x">Материал другого сайта со ссылкой на новость</a>'
           '<a href="/news/12345">Короткий</a>'
           '<a href="/news/2026/09/sklad-v-dinskoy#comments">Склад загорелся в станице Динской (комментарии)</a>'
           "</body></html>")


def test_broken_feed_is_repaired_instead_of_rejected():
    broken = ('<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>Пожар & дым</title>'
              "<link>https://news.test/1</link><guid>1</guid><description>текст<br>ещё</description></item>"
              "</channel></rss>")
    entries, _ = parse_feed(broken)
    assert [e.external_id for e in entries] == ["1"]


def test_article_links_keep_same_site_articles_only():
    assert article_links(LISTING, "https://news.test/") == ["https://news.test/news/2026/09/sklad-v-dinskoy"]


def test_html_list_skips_pages_without_publication_date():
    undated = re.sub(r'<meta property="article:published_time"[^>]*>', "", _article("Раздел", NOW))
    listing = '<a href="/news/sklad-v-dinskoy">Склад загорелся в станице Динской вечером в среду</a>'
    f, _ = _fetcher({"/": (200, listing), "/news/sklad-v-dinskoy": (200, undated)})
    assert CONNECTORS["html_list"].fetch({"url": "https://news.test/"}, f).entries == []
    article._rejected.clear()
    kept = CONNECTORS["html_list"].fetch({"url": "https://news.test/", "config": {"allow_undated": True}}, f)
    assert len(kept.entries) == 1


def test_html_list_collects_articles_and_skips_known():
    f, _ = _fetcher({"/": (200, LISTING),
                     "/news/2026/09/sklad-v-dinskoy": (200, _article("Склад загорелся в Динской", NOW))})
    res = CONNECTORS["html_list"].fetch({"url": "https://news.test/"}, f)
    [e] = res.entries
    assert e.title == "Склад загорелся в Динской" and "пожарных расчётов" in e.body_text and e.published
    again = CONNECTORS["html_list"].fetch({"url": "https://news.test/", "known_ids": [e.external_id]}, f)
    assert again.entries == []


SITEMAP_INDEX = ('<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 "<sitemap><loc>https://news.test/sitemap-pages.xml</loc></sitemap>"
                 "<sitemap><loc>https://news.test/sitemap-news.xml</loc></sitemap></sitemapindex>")


def _news_sitemap(*items: tuple[str, str, datetime]) -> str:
    body = "".join(f"<url><loc>https://news.test{path}</loc><news:news><news:title>{title}</news:title>"
                   f"<news:publication_date>{when.isoformat()}</news:publication_date></news:news></url>"
                   for path, title, when in items)
    return ('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            f'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">{body}</urlset>')


def test_sitemap_parsing_reads_index_and_news_tags():
    assert parse_sitemap(SITEMAP_INDEX) == ([], ["https://news.test/sitemap-pages.xml",
                                                 "https://news.test/sitemap-news.xml"])
    items, children = parse_sitemap(_news_sitemap(("/a", "Заголовок", NOW)))
    assert children == [] and items[0].url == "https://news.test/a" and items[0].title == "Заголовок"


def test_sitemap_news_takes_fresh_articles_newest_first():
    sm = _news_sitemap(("/old", "Старая новость", NOW - timedelta(days=10)),
                       ("/a", "Первая новость", NOW - timedelta(hours=5)),
                       ("/b", "Вторая новость", NOW - timedelta(hours=1)))
    f, hits = _fetcher({"/sitemap.xml": (200, SITEMAP_INDEX), "/sitemap-news.xml": (200, sm),
                        "/a": (200, _article("a", NOW)), "/b": (200, _article("b", NOW)),
                        "/old": (200, _article("old", NOW))})
    res = CONNECTORS["sitemap_news"].fetch({"url": "https://news.test/sitemap.xml"}, f)
    assert [e.title for e in res.entries] == ["Вторая новость", "Первая новость"]   # title from the sitemap
    assert "/old" not in hits and "/sitemap-pages.xml" not in hits


def test_robots_override_is_per_source():
    pages = {"/robots.txt": (200, "User-agent: *\nDisallow: /\n"), "/": (200, LISTING),
             "/news/2026/09/sklad-v-dinskoy": (200, _article("Склад", NOW))}
    f, _ = _fetcher(pages)
    spec = {"slug": "closed", "homepage": "https://news.test/"}
    assert not check_candidate(spec, f).ok
    spec["config"] = {"respect_robots": False}
    chk = check_candidate(spec, f)
    assert chk.ok and chk.connector == "html_list"
    entry = verified_entry(spec, chk)
    assert entry["access_model"] == "public_web" and "owner's decision" in entry["legal_note"]


def test_verify_prefers_news_sitemap_over_listing_when_no_feed():
    robots = "User-agent: *\nAllow: /\nSitemap: https://news.test/sitemap-news.xml\n"
    sm = _news_sitemap(("/a", "Новость из карты сайта", NOW - timedelta(hours=2)))
    f, _ = _fetcher({"/robots.txt": (200, robots), "/": (200, LISTING), "/sitemap-news.xml": (200, sm),
                     "/a": (200, _article("a", NOW)),
                     "/news/2026/09/sklad-v-dinskoy": (200, _article("Склад", NOW))})
    chk = check_candidate({"slug": "no-feed", "homepage": "https://news.test/"}, f)
    assert chk.ok and chk.connector == "sitemap_news" and chk.url == "https://news.test/sitemap-news.xml"


def test_check_sources_keeps_previously_verified_on_temporary_failure(tmp_path, monkeypatch):
    import yaml

    from geonews import cli
    from geonews.ingestion import verify
    from geonews.ingestion.verify import Check

    cand = tmp_path / "cand.yaml"
    cand.write_text(yaml.safe_dump({"sources": [{"slug": "up", "homepage": "https://a.test/"},
                                                {"slug": "down", "homepage": "https://b.test/"},
                                                {"slug": "new-bad", "homepage": "https://c.test/"}]}))
    out = tmp_path / "out.yaml"
    out.write_text(yaml.safe_dump({"sources": [{"slug": "down", "url": "https://b.test/rss", "connector": "rss"}]}))
    monkeypatch.setattr(verify, "check_candidate", lambda spec, f: Check(
        slug=spec["slug"], ok=spec["slug"] == "up", url="https://a.test/rss" if spec["slug"] == "up" else None,
        entries=1, newest=NOW, error=None if spec["slug"] == "up" else "HTTP 503"))
    cli.main(["check-sources", str(cand), "--out", str(out), "--keep-previous"])
    kept = {s["slug"]: s for s in yaml.safe_load(out.read_text())["sources"]}
    assert set(kept) == {"up", "down"} and kept["down"]["url"] == "https://b.test/rss"


def test_previous_channel_stays_only_while_its_site_names_no_other(tmp_path, monkeypatch):
    import yaml

    from geonews import cli
    from geonews.ingestion import verify
    from geonews.ingestion.verify import Check

    cand = tmp_path / "cand.yaml"
    cand.write_text(yaml.safe_dump({"sources": [
        {"slug": "down", "name": "Down", "homepage": "https://b.test/"},
        {"slug": "regional", "name": "Regional", "homepage": "https://c.test/"},   # now links to its federal parent
        {"slug": "tg-federal", "name": "Federal", "connector": "telegram_public", "url": "https://t.me/s/federal"}]}))
    out = tmp_path / "out.yaml"
    out.write_text(yaml.safe_dump({"sources": [
        {"slug": "down-tg", "url": "https://t.me/s/down_news", "derived_from": "down"},
        {"slug": "regional-tg", "url": "https://t.me/s/wrong_one", "derived_from": "regional"}]}))
    monkeypatch.setattr(verify, "check_candidate", lambda spec, f: Check(
        slug=spec["slug"], ok=spec["slug"] != "down", url=spec.get("url") or spec.get("homepage"), entries=1,
        newest=NOW, error="HTTP 503" if spec["slug"] == "down" else None,
        telegram=["federal"] if spec["slug"] == "regional" else []))
    cli.main(["check-sources", str(cand), "--out", str(out), "--keep-previous"])
    kept = {s["slug"] for s in yaml.safe_load(out.read_text())["sources"]}
    assert kept == {"regional", "tg-federal", "down-tg"}


def test_listing_polls_are_polite():
    links = "".join(f'<a href="/news/section-{i}">Раздел номер {i} с длинным названием для ссылки</a>' for i in range(30))
    undated = re.sub(r'<meta property="article:published_time"[^>]*>', "", _article("Раздел", NOW))
    f, hits = _fetcher({"/": (200, links), **{f"/news/section-{i}": (200, undated) for i in range(30)}})
    src = {"url": "https://news.test/", "config": {"max_new": 3}}
    assert CONNECTORS["html_list"].fetch(src, f).entries == []
    first = [h for h in hits if h.startswith("/news/")]
    assert len(first) == 6                                   # at most 2 x max_new pages per poll
    CONNECTORS["html_list"].fetch(src, f)
    second = [h for h in hits if h.startswith("/news/")][len(first):]
    assert len(second) == 6 and not set(second) & set(first)  # rejected pages are not fetched again


def _tg_page(title: str, when: datetime) -> str:
    return (f'<html><head><meta property="og:title" content="{title}"></head><body>'
            f'<div class="tgme_channel_info_header_title"><span>{title}</span></div>'
            f'<div class="tgme_widget_message" data-post="kubnews/101"><div class="tgme_widget_message_text">'
            f'Пожар в Динской<br>На место прибыли пять расчётов</div>'
            f'<a class="tgme_widget_message_date" href="https://t.me/kubnews/101"><time datetime="{when.isoformat()}"></time></a>'
            f'</div></body></html>')


def test_outlet_channel_found_on_its_site_is_checked_and_kept_with_its_publisher(tmp_path):
    import yaml

    from geonews import cli
    from geonews.ingestion import verify

    home = '<html><head></head><body><a href="https://t.me/kubnews">Мы в Telegram</a>' + LISTING[12:]
    pages = {"/": (200, home), "/news/2026/09/sklad-v-dinskoy": (200, _article("Склад", NOW)),
             "/s/kubnews": (200, _tg_page("Кубанские новости", NOW))}

    def fake_fetcher():
        f, _ = _fetcher(pages)
        return f
    cand = tmp_path / "cand.yaml"
    cand.write_text(yaml.safe_dump({"sources": [{"slug": "kubnews", "name": "Кубанские новости", "type": "regional_media",
                                                 "access_model": "public_feed", "homepage": "https://news.test/"}]}))
    out = tmp_path / "out.yaml"
    import geonews.ingestion.fetcher as fetcher_mod
    orig = fetcher_mod.Fetcher
    try:
        fetcher_mod.Fetcher = fake_fetcher   # the CLI builds its own Fetcher; all hosts answer from `pages`
        cli.main(["check-sources", str(cand), "--out", str(out)])
    finally:
        fetcher_mod.Fetcher = orig
    got = {s["slug"]: s for s in yaml.safe_load(out.read_text())["sources"]}
    assert set(got) == {"kubnews", "kubnews-tg"}
    tg = got["kubnews-tg"]
    assert tg["url"] == "https://t.me/s/kubnews" and tg["connector"] == "telegram_public"
    assert tg["config"]["publisher"] == "kubnews" and tg["derived_from"] == "kubnews"
    assert verify.telegram_channels(home) == ["kubnews"]


def test_channel_with_an_unexpected_name_is_rejected():
    from geonews.ingestion.verify import check_candidate

    f, _ = _fetcher({"/s/rian_ru": (200, _tg_page("Фейковые новости", NOW))})
    spec = {"slug": "tg-ria", "connector": "telegram_public", "url": "https://t.me/s/rian_ru",
            "config": {"expect_title": "РИА"}}
    chk = check_candidate(spec, f)
    assert not chk.ok and "expected" in chk.error


def test_preview_pictures_come_from_what_the_publisher_attached():
    from geonews.ingestion.connectors.article import fetch_article, image_url
    from geonews.ingestion.connectors.telegram_public import parse_preview

    feed = ('<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title>'
            '<item><title>A</title><link>https://a.test/1</link><guid>1</guid>'
            '<enclosure url="https://a.test/i.jpg" type="image/jpeg" length="1"/></item>'
            '<item><title>B</title><link>https://a.test/2</link><guid>2</guid>'
            '<media:content url="https://a.test/v.mp4" medium="video"/><media:content url="https://a.test/m.jpg" medium="image"/></item>'
            '<item><title>C</title><link>https://a.test/x/3</link><guid>3</guid>'
            '<description>&lt;img src="/counter.gif"&gt;&lt;img src="/pic.jpg"&gt; текст</description></item>'
            '<item><title>D</title><link>https://a.test/4</link><guid>4</guid><description>без картинки</description></item>'
            '</channel></rss>')
    assert [e.image for e in parse_feed(feed)[0]] == ["https://a.test/i.jpg", "https://a.test/m.jpg",
                                                       "https://a.test/pic.jpg", None]
    post = ('<div class="tgme_widget_message" data-post="c/1"><a class="tgme_widget_message_photo_wrap" '
            "style=\"width:800px;background-image:url('https://cdn.test/file/abc.jpg')\"></a>"
            '<div class="tgme_widget_message_text">Пожар<br>текст</div></div>')
    assert parse_preview(post, "https://t.me/s/c")[0].image == "https://cdn.test/file/abc.jpg"
    page = _article("Склад", NOW).replace("</head>", '<meta property="og:image" content="/img/sklad.jpg"></head>')
    f, _ = _fetcher({"/a": (200, page)})
    assert fetch_article(f, "https://news.test/a").image == "https://news.test/img/sklad.jpg"
    assert image_url("javascript:alert(1)") is None and image_url("/logo.png", "https://x.test/") is None
