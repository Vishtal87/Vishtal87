"""Source registry: loading a registry file with --prune turns off what it no longer lists."""
import pytest
import yaml

pytestmark = pytest.mark.db


def test_prune_disables_sources_no_longer_listed(db, tmp_path):
    from geonews.ingestion.registry import load_sources

    entry = {"slug": "reg-kept", "name": "Kept", "type": "media", "connector": "rss", "url": "https://kept.test/rss",
             "access_model": "public_feed"}
    both = tmp_path / "both.yaml"
    both.write_text(yaml.safe_dump({"sources": [entry, entry | {"slug": "reg-gone", "url": "https://gone.test/rss"}]}))
    one = tmp_path / "one.yaml"
    one.write_text(yaml.safe_dump({"sources": [entry]}))
    with db() as c:
        before = [r["slug"] for r in c.execute("SELECT slug FROM source WHERE enabled").fetchall()]
    try:
        assert load_sources(str(both)) == 2
        assert load_sources(str(one), prune=True) == 1
        with db() as c:
            state = {r["slug"]: r["enabled"] for r in c.execute("SELECT slug, enabled FROM source").fetchall()}
        assert state["reg-kept"] and not state["reg-gone"]
        assert not any(state[s] for s in before if s not in ("reg-kept", "reg-gone"))
    finally:
        with db() as c:
            c.execute("DELETE FROM source WHERE slug IN ('reg-kept', 'reg-gone')")
            c.execute("UPDATE source SET enabled = true WHERE slug = ANY(%s)", (before,))
            c.commit()
