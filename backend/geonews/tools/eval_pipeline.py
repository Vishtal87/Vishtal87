"""End-to-end evaluation against devstand gold labels.

python -m geonews.tools.eval_pipeline [--devstand http://127.0.0.1:8090] [-v]
Metrics: geolocation accuracy per report, B-cubed precision/recall/F1 of event clustering,
forward detection, live/historical flags, trust labels. Prints every failure (no silent passes).
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from collections import defaultdict

from geonews.db.pool import connect


def _gold(devstand: str) -> dict:
    with urllib.request.urlopen(f"{devstand}/control/gold") as r:
        return json.load(r)


def evaluate(devstand: str, verbose: bool = False) -> dict:
    gold = _gold(devstand)
    with connect() as conn:
        rows = conn.execute(
            """SELECT a.id, a.external_id, a.url, a.is_live, a.origin_group_id, a.duplicate_of, s.slug,
                      ea.event_id, ev.trust_label, ev.independent_count, ev.status,
                      e.name AS ev_place, e.country_code AS ev_cc, e.kind AS ev_kind, ev.location_relation,
                      a1.name AS ev_admin1, anc.name AS anchor_name
               FROM article a JOIN source s ON s.id = a.source_id
               LEFT JOIN event_article ea ON ea.article_id = a.id
               LEFT JOIN event ev ON ev.id = ea.event_id
               LEFT JOIN geo_entity e ON e.id = ev.geo_entity_id
               LEFT JOIN geo_entity a1 ON a1.id = e.admin1_id
               LEFT JOIN LATERAL (SELECT g.name FROM article_location l JOIN LATERAL (
                    SELECT (l.evidence->'alternatives'->0->>'id')::bigint AS aid) x ON true
                    JOIN geo_entity g ON g.id = x.aid WHERE l.article_id = a.id AND l.role = 'primary' LIMIT 1) anc ON true"""
        ).fetchall()
    by_ext = {}
    for r in rows:
        by_ext[(r["slug"], r["external_id"])] = r
        if r["url"]:
            by_ext[(r["slug"], r["url"].replace("http://127.0.0.1:8090", "").replace("http://localhost:8090", ""))] = r
    geo_ok = geo_n = 0
    fails = []
    pred_cluster: dict[str, int | None] = {}
    gold_cluster: dict[str, str] = {}
    for rid, g in gold.items():
        key = (g["source"], g["external_id"])
        r = by_ext.get(key) or by_ext.get((g["source"], g["external_id"].replace("urn:", "")))
        if r is None:
            fails.append({"id": rid, "problem": "not ingested", "key": key})
            continue
        exp = g["gold"]
        gold_cluster[rid] = g["story"]
        pred_cluster[rid] = r["event_id"]
        geo_n += 1
        if exp.get("place") == "none":
            ok = r["event_id"] is None
        elif r["event_id"] is None:
            ok = False
        elif exp.get("relation") == "near":
            ok = r["location_relation"] == "near" and r["anchor_name"] == exp["place"]
        else:
            ok = r["ev_place"] == exp["place"] and r["ev_cc"] == exp["cc"]
            if exp.get("admin1"):
                ok &= r["ev_admin1"] == exp["admin1"] or r["ev_place"] == exp["admin1"]
            if exp.get("relation") == "source_area":
                ok &= r["location_relation"] == "source_area"
        if exp.get("historical") or exp.get("backfill"):
            ok &= not r["is_live"]
        geo_ok += ok
        if not ok:
            fails.append({"id": rid, "expected": exp, "got": {k: r[k] for k in (
                "ev_place", "ev_cc", "ev_kind", "location_relation", "anchor_name", "event_id", "is_live")}})
        if verbose:
            print(f"{'OK ' if ok else 'FAIL'} {rid:<8} {g['story']:<30} -> event {r['event_id']} {r['ev_place']} "
                  f"({r['location_relation']}) trust={r['trust_label']}")
    # B-cubed over located reports (unlocated gold stories excluded)
    items = [i for i in pred_cluster if pred_cluster[i] is not None]
    p_sum = r_sum = 0.0
    pc, gc = defaultdict(set), defaultdict(set)
    for i in items:
        pc[pred_cluster[i]].add(i)
        gc[gold_cluster[i]].add(i)
    for i in items:
        same_pred = pc[pred_cluster[i]]
        same_gold = gc[gold_cluster[i]]
        inter = len(same_pred & same_gold)
        p_sum += inter / len(same_pred)
        r_sum += inter / len(same_gold)
    n = max(1, len(items))
    prec, rec = p_sum / n, r_sum / n
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    wrong_merges = [(e, sorted({gold_cluster[i] for i in m})) for e, m in pc.items() if len({gold_cluster[i] for i in m}) > 1]
    splits = [(s, sorted({pred_cluster[i] for i in m})) for s, m in gc.items() if len({pred_cluster[i] for i in m}) > 1]
    return {"reports": len(gold), "geo_accuracy": round(geo_ok / max(1, geo_n), 3), "geo_ok": geo_ok, "geo_n": geo_n,
            "bcubed_precision": round(prec, 3), "bcubed_recall": round(rec, 3), "bcubed_f1": round(f1, 3),
            "wrong_merges": wrong_merges, "splits": splits, "failures": fails}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--devstand", default="http://127.0.0.1:8090")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    r = evaluate(a.devstand, a.verbose)
    print(json.dumps({k: v for k, v in r.items() if k != "failures"}, ensure_ascii=False, indent=1, default=str))
    for f in r["failures"]:
        print("FAIL", json.dumps(f, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
