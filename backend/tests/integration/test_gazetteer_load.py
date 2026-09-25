from pathlib import Path

import pytest

pytestmark = pytest.mark.db
FIX = Path(__file__).parent.parent / "fixtures" / "geonames"


def test_full_dump_builds_hierarchy_down_to_hamlets(db):
    from geonews.gazetteer.service import import_geonames

    import_geonames(FIX, ["TT"])
    import_geonames(FIX, ["TT"])  # idempotent re-import must not duplicate
    with db() as c:
        rows = {r["source_id"]: r for r in c.execute(
            "SELECT e.*, p.source_id AS parent_sid FROM geo_entity e LEFT JOIN geo_entity p ON p.id = e.parent_id"
            " WHERE e.source_id LIKE '9000000%%' OR e.source_id = '2017370'").fetchall()}
        assert len([r for r in rows if r.startswith("9000000")]) == 5
        hamlet = rows["90000003"]
        assert hamlet["parent_sid"] == "90000002" and hamlet["place_class"] == "hamlet"
        assert hamlet["admin1_id"] == rows["90000001"]["id"] and hamlet["country_id"] == rows["2017370"]["id"]
        assert rows["90000001"]["id"] in hamlet["ancestors"] and rows["2017370"]["id"] in hamlet["ancestors"]
        # PPLX is attached to the nearest locality, not to the admin area
        assert rows["90000005"]["parent_sid"] == "90000004"
        assert rows["90000005"]["locality_id"] == rows["90000004"]["id"]
        lemmas = {r["lemma"] for r in c.execute(
            "SELECT lemma FROM geo_name WHERE entity_id = %s", (hamlet["id"],)).fetchall()}
        assert "малый" in lemmas and "хутор малый" in lemmas
