from pathlib import Path

from geonews.gazetteer.geonames_dump import iter_records

FIX = Path(__file__).parent.parent / "fixtures" / "geonames"


def test_parses_hierarchy_codes_and_skips_non_places():
    recs = {r.source_id: r for r in iter_records(FIX, "TT.txt", "alternatenames_TT.txt")}
    assert "90000006" not in recs  # PPLH historical place skipped
    assert "90000007" not in recs  # hills are not places
    krai = recs["90000001"]
    assert krai.kind == "admin1" and krai.admin_code == "RU.T1" and krai.parent_codes == ("RU",)
    rayon = recs["90000002"]
    assert rayon.kind == "admin2" and rayon.admin_code == "RU.T1.90000002"
    assert rayon.parent_codes == ("RU.T1", "RU")
    hamlet = recs["90000003"]
    assert hamlet.kind == "locality" and hamlet.population == 50
    assert hamlet.parent_codes[0] == "RU.T1.90000002"
    assert hamlet.names["ru"] == "Малый"
    city = recs["90000004"]
    names = {a.name: a for a in city.alt_names}
    assert "TSG" not in names  # IATA codes filtered
    assert names["Старотестовск"].historic
    assert recs["90000005"].kind == "sublocality"
    assert recs["2017370"].kind == "country" and recs["2017370"].parent_codes == ("CONT:EU",)
