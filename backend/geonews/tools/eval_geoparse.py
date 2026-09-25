"""Evaluate the geoparser on the golden set: python -m geonews.tools.eval_geoparse [--verbose]"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import yaml

from geonews.db.pool import connect
from geonews.db.repos.gazetteer_lookup import PgGazetteer
from geonews.pipeline.geoparse.model import SourceContext
from geonews.pipeline.geoparse.resolver import geoparse
from geonews.pipeline.runner import MIN_MAP_CONFIDENCE

CASES = Path(__file__).resolve().parents[2] / "tests" / "golden" / "geoparse_cases.yaml"


def _source(conn, spec) -> SourceContext | None:
    if not spec:
        return None
    r = conn.execute(
        """SELECT id, kind, ancestors, ST_Y(geom) lat, ST_X(geom) lon, country_code FROM geo_entity
           WHERE name = %s AND country_code = %s AND kind = %s ORDER BY population DESC LIMIT 1""",
        (spec["name"], spec["cc"], spec["kind"])).fetchone()
    if not r:
        raise SystemExit(f"source place not found: {spec}")
    return SourceContext(home_id=r["id"], home_kind=r["kind"], home_ancestors=tuple(r["ancestors"]),
                         home_lat=r["lat"], home_lon=r["lon"], country_code=r["country_code"])


def evaluate(verbose: bool = False) -> dict:
    cases = yaml.safe_load(CASES.read_text())
    ok = 0
    fails = []
    t_total = 0.0
    with connect() as conn:
        gaz = PgGazetteer(conn)
        for c in cases:
            src = _source(conn, c.get("source"))
            t = time.time()
            res = geoparse(c["title"], c["body"], c["lang"], gaz, src, tuple(c["hint"]) if c.get("hint") else None)
            t_total += time.time() - t
            p = res.primary
            exp = c["expect"]
            got = None
            passed = False
            if p is not None and p.confidence >= MIN_MAP_CONFIDENCE:
                ref_id = p.anchor_id if p.relation == "near" and p.anchor_id else p.entity_id
                e = conn.execute(
                    """SELECT e.name, e.kind, e.country_code, a1.name AS admin1 FROM geo_entity e
                       LEFT JOIN geo_entity a1 ON a1.id = e.admin1_id WHERE e.id = %s""", (ref_id,)).fetchone()
                got = {**e, "relation": p.relation, "precision": p.precision, "confidence": p.confidence,
                       "attached_to_anchor": p.entity_id == p.anchor_id}
            if exp == "none":
                passed = got is None
            elif got:
                names = exp.get("any") or [exp["name"]]
                passed = got["name"] in names
                passed &= got["country_code"] in (exp.get("cc_any") or [exp["cc"]])
                if exp.get("kind"):
                    passed &= got["kind"] == exp["kind"]
                if exp.get("admin1"):
                    passed &= got["admin1"] == exp["admin1"]
                if exp.get("relation"):
                    passed &= got["relation"] == exp["relation"]
                if exp.get("relation") == "near" and got["kind"] == "locality" and (conn.execute(
                        "SELECT population FROM geo_entity WHERE name=%s AND country_code=%s ORDER BY population DESC LIMIT 1",
                        (got["name"], got["country_code"])).fetchone()["population"] > 10_000):
                    passed &= not got["attached_to_anchor"]  # "15 km from a city" must not be the city
            ok += passed
            if not passed:
                fails.append({"id": c["id"], "expect": exp, "got": got})
            if verbose:
                print(f"{'OK ' if passed else 'FAIL'} {c['id']:<32} -> {got and (got['name'], got['relation'], got['confidence'])}")
    n = len(cases)
    return {"cases": n, "correct": ok, "accuracy": round(ok / n, 3), "ms_per_doc": round(t_total / n * 1000, 1),
            "failures": fails}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", "-v", action="store_true")
    r = evaluate(ap.parse_args().verbose)
    print(f"\naccuracy {r['correct']}/{r['cases']} = {r['accuracy']}   ({r['ms_per_doc']} ms/doc)")
    for f in r["failures"]:
        print("FAIL", f)
    sys.exit(0 if r["accuracy"] >= 0.9 else 1)


if __name__ == "__main__":
    main()
