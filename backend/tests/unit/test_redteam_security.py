"""Red-team: hostile source content must not become script, and crawling must stay on the source's site."""
from geonews.pipeline.normalize import canonical_url, html_to_text, safe_url


def test_only_http_links_survive():
    assert safe_url("javascript:alert(1)") is None
    assert safe_url(" JaVaScRiPt:alert(1)") is None
    assert safe_url("data:text/html,<script>alert(1)</script>") is None
    assert safe_url("//evil.example/x") is None
    assert safe_url("https://example.com/a?b=1") == "https://example.com/a?b=1"
    assert canonical_url(safe_url("javascript:alert(1)")) is None


def test_markup_in_titles_and_bodies_is_removed():
    t = html_to_text('Пожар <img src=x onerror="alert(1)"> в <b>станице</b>')
    assert "<" not in t and "onerror" not in t and "станице" in t
