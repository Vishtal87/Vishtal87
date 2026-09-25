"""Processing pipeline for one raw item:

RAW -> NORMALIZATION -> LANGUAGE -> TEXT/DATE -> GEOLOCATION/PLACE -> EVENT EXTRACTION/CATEGORY
    -> DEDUPLICATION -> EVENT CLUSTERING -> EVENT RECOMPUTE -> NOTIFY (realtime)

Each stage writes its output to article_analysis, so every decision can be audited later.
Nothing is deleted: duplicates are linked (duplicate_of / origin_group_id), updates are versioned.
"""
from __future__ import annotations

import logging
import zlib
from collections import Counter
from datetime import datetime, timedelta, timezone

import psycopg

from geonews.config import settings
from geonews.db.repos import news_repo
from geonews.db.repos.gazetteer_lookup import PgGazetteer
from geonews.ingestion.entry import RawEntry
from geonews.pipeline import classify, clustering, dates, dedup, event_builder, language, normalize
from geonews.pipeline.geoparse.model import GeoResult, SourceContext
from geonews.pipeline.geoparse.resolver import geoparse
from geonews.domain.text_norm import tokenize

log = logging.getLogger(__name__)
METHOD = "rules-v1"
MIN_MAP_CONFIDENCE = 0.2   # below this a location is kept as analysis but not used to place events
MAX_MAP_AMBIGUITY = 0.45   # "Ивановка" with several equally plausible readings stays off the map


def event_features(ev: dict) -> clustering.Features:
    """Clustering features of an existing event row (see news_repo.EVENT_COLS + place_population)."""
    t = ev["terms"] or {}
    return clustering.Features(
        at=ev["event_time"] or ev["last_article_at"], category=ev["category"], event_type=ev["event_type"],
        locality_id=ev["locality_id"], admin2_id=ev["admin2_id"], admin1_id=ev["admin1_id"],
        country_id=ev["country_id"], lat=ev["lat"], lon=ev["lon"],
        radius_km=(ev["radius_m"] or 0) / 1000 or None, precision=ev["location_precision"],
        place_population=ev["place_population"], lang=ev["lang"], terms=Counter(t.get("terms") or {}),
        numbers=set(t.get("numbers") or []), names=set(t.get("names") or []))


def _mention_words(geo: GeoResult) -> set[str]:
    """Words naming the MAIN place: sharing the city name says nothing about being the same event.
    Secondary places (a district, a street) stay: they are strong same-event evidence, even across languages."""
    return {t.norm for m in geo.mentions if m.role == "primary" or (geo.primary and m.chosen.id == geo.primary.entity_id)
            for t in tokenize(m.text)}


def _recurring(other: dict, a: dict) -> bool:
    """Same source posting the same/similar text on another day (daily forecast, greeting): not a duplicate."""
    return other["source_id"] == a["source_id"] and \
        abs((other["published_at"] - a["published_at"]).total_seconds()) > 18 * 3600


class Processor:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.gaz = PgGazetteer(conn)
        self._src_ctx: dict[int, SourceContext] = {}

    # ------------------------------------------------------------------ helpers
    def source_context(self, raw: dict) -> SourceContext:
        sid = raw["source_id"]
        if sid not in self._src_ctx:
            ctx = SourceContext(country_code=raw["country_code"])
            if raw["home_geo_entity_id"]:
                e = self.conn.execute(
                    "SELECT id, kind, ancestors, ST_Y(geom) lat, ST_X(geom) lon FROM geo_entity WHERE id = %s",
                    (raw["home_geo_entity_id"],)).fetchone()
                if e:
                    ctx = SourceContext(home_id=e["id"], home_kind=e["kind"], home_ancestors=tuple(e["ancestors"]),
                                        home_lat=e["lat"], home_lon=e["lon"], country_code=raw["country_code"])
            self._src_ctx[sid] = ctx
        return self._src_ctx[sid]

    def _source_tz(self, raw: dict) -> str | None:
        if raw["source_tz"]:
            return raw["source_tz"]
        if raw["home_geo_entity_id"]:
            r = self.conn.execute(
                """SELECT coalesce(e.timezone, (SELECT l.timezone FROM geo_entity l WHERE l.admin1_id = e.admin1_id
                   AND l.timezone IS NOT NULL ORDER BY l.population DESC LIMIT 1)) tz
                   FROM geo_entity e WHERE e.id = %s""", (raw["home_geo_entity_id"],)).fetchone()
            return r["tz"] if r else None
        return None

    # ------------------------------------------------------------------ main
    def process_raw(self, raw_id: int) -> dict:
        conn = self.conn
        raw = news_repo.get_raw_with_source(conn, raw_id)
        if raw is None:
            return {"status": "missing"}
        entry = RawEntry.from_payload(raw["payload"])
        now = datetime.now(timezone.utc)

        # NORMALIZATION / TEXT EXTRACTION
        body = entry.body_text or normalize.html_to_text(entry.body_html)
        title = normalize.html_to_text(entry.title).replace("\n", " ") or body[:120]   # titles may carry markup too
        if title and body.startswith(title):  # page extractors often repeat the headline as the first line
            body = body[len(title):].lstrip(" \n.:—-")
        if not title and not body:
            news_repo.set_raw_status(conn, raw_id, "skipped", "empty item")
            conn.commit()
            return {"status": "empty"}
        chash = normalize.content_hash(title, body)
        existing = news_repo.find_article(conn, raw["source_id"], entry.external_id)
        if existing and existing["content_hash"] == chash:
            news_repo.set_raw_status(conn, raw_id, "processed")
            conn.commit()
            return {"status": "unchanged", "article_id": existing["id"]}

        # LANGUAGE
        lang, lang_conf = language.detect(f"{title}. {body}", entry.lang and [entry.lang] or list(raw["languages"] or []))
        # DATE / TIME
        tz = self._source_tz(raw)
        published, tz_assumed = dates.parse_published(entry.published, tz, fallback=raw["fetched_at"])
        et = dates.extract_event_time(f"{title}. {body}", published, lang, tz)
        live = dates.is_live(published, raw["fetched_at"], et.historical, settings.live_max_age_hours)
        # GEOLOCATION / PLACE RESOLUTION
        hint = (entry.lat, entry.lon) if entry.lat is not None and entry.lon is not None else None
        geo = geoparse(title, body, lang, self.gaz, self.source_context(raw), hint)
        # EVENT EXTRACTION / CATEGORY
        cls = classify.classify(title, body, lang, raw["source_type"])
        sh = dedup.simhash(f"{title} {body}")
        b = dedup.bands(sh)

        a = {
            "source_id": raw["source_id"], "raw_item_id": raw_id, "external_id": entry.external_id,
            "url": normalize.safe_url(entry.url), "canonical_url": normalize.canonical_url(normalize.safe_url(entry.url)), "title": title[:1000], "text": body[:20000],
            "excerpt": normalize.excerpt(body or title), "lang": lang, "lang_confidence": lang_conf,
            "published_at": published, "published_tz_assumed": tz_assumed, "event_time": et.at, "is_live": live,
            "content_hash": chash, "simhash": sh, "sh_b0": b[0], "sh_b1": b[1], "sh_b2": b[2], "sh_b3": b[3],
            "category": cls.category, "status": "processed",
        }
        old_event = None
        if existing:
            news_repo.save_version(conn, existing)
            news_repo.update_article(conn, existing["id"], a)
            article_id = existing["id"]
            old_event = news_repo.event_of_article(conn, article_id)
            op = "updated"
        else:
            article_id = news_repo.insert_article(conn, a)
            op = "created"

        terms, nums, names = clustering.salient_terms(title, body, lang, exclude=_mention_words(geo))
        self._write_analysis(article_id, lang, lang_conf, published, tz_assumed, tz, et, live, geo, cls, terms, nums, names)

        # DEDUPLICATION (exact, then near-duplicate via SimHash bands)
        dup_of, origin = self._dedup(article_id, a, title, body)
        news_repo.set_origin(conn, article_id, origin, dup_of)
        news_repo.add_analysis(conn, article_id, "dedup", METHOD, {"duplicate_of": dup_of, "origin_group_id": origin})

        # EVENT CLUSTERING
        event_id, sim, details = self._cluster(article_id, a, geo, cls, terms, nums, names, dup_of, lang, old_event)
        news_repo.add_analysis(conn, article_id, "cluster", METHOD, {"event_id": event_id, "similarity": sim, **details})
        changed = []
        if event_id:
            changed.append((event_id, "created" if details.get("new_event") else "updated"))
        if old_event and old_event != event_id:
            changed.append((old_event, "updated"))
        for eid, eop in changed:
            self.recompute_event(eid, eop)
        news_repo.set_raw_status(conn, raw_id, "processed")
        conn.commit()
        return {"status": op, "article_id": article_id, "event_id": event_id, "duplicate_of": dup_of,
                "location": geo.primary.entity_id if geo.primary else None}

    def _write_analysis(self, article_id, lang, lang_conf, published, tz_assumed, tz, et, live, geo: GeoResult, cls,
                        terms, nums, names) -> None:
        conn = self.conn
        news_repo.add_analysis(conn, article_id, "language", "lingua", {"lang": lang, "confidence": round(lang_conf, 3)})
        news_repo.add_analysis(conn, article_id, "dates", METHOD, {
            "published_utc": published.isoformat(), "tz_assumed": tz_assumed, "source_tz": tz,
            "event_time": et.at.isoformat() if et.at else None, "event_time_evidence": et.evidence,
            "historical": et.historical, "is_live": live})
        p = geo.primary
        news_repo.add_analysis(conn, article_id, "geoparse", geo.method, {
            "primary": None if not p else {"entity_id": p.entity_id, "lat": p.lat, "lon": p.lon,
                                           "precision": p.precision, "relation": p.relation,
                                           "confidence": p.confidence, "radius_km": p.radius_km,
                                           "anchor_id": p.anchor_id, "evidence": p.evidence},
            "mentions": [{"span": m.text, "start": m.start, "entity_id": m.chosen.id, "name": m.chosen.name,
                          "kind": m.chosen.kind, "role": m.role, "confidence": m.confidence} for m in geo.mentions],
        })
        news_repo.add_analysis(conn, article_id, "category", METHOD,
                               {"category": cls.category, "event_type": cls.event_type, "scores": cls.scores})
        news_repo.add_analysis(conn, article_id, "features", METHOD,
                               {"terms": dict(terms), "numbers": sorted(nums)[:30], "names": sorted(names)[:30],
                                "event_type": cls.event_type})
        rows = []
        if p:
            rows.append({"geo_entity_id": p.entity_id, "role": "source_area" if p.relation == "source_area" else "primary",
                         "relation": p.relation, "distance_km": p.radius_km, "lat": p.lat, "lon": p.lon,
                         "precision": p.precision, "confidence": p.confidence, "evidence": p.evidence,
                         "method": geo.method})
        for m in geo.mentions:
            if m.role == "primary":
                continue
            rows.append({"geo_entity_id": m.chosen.id, "role": m.role if m.role in ("secondary", "near") else "mentioned",
                         "relation": m.cues.relation, "distance_km": m.cues.distance_km, "lat": m.chosen.lat,
                         "lon": m.chosen.lon, "precision": m.chosen.kind, "confidence": m.confidence,
                         "evidence": {"span": m.text, "start": m.start, "role": m.role}, "method": geo.method})
        news_repo.replace_locations(conn, article_id, rows)

    def _dedup(self, article_id: int, a: dict, title: str, body: str) -> tuple[int | None, int]:
        since = a["published_at"] - timedelta(days=14)
        ex = news_repo.exact_duplicate(self.conn, a["content_hash"], a["canonical_url"], article_id, since)
        if ex and not _recurring(ex, a):
            return ex["id"], ex["origin_group_id"] or ex["id"]
        cands = news_repo.simhash_candidates(self.conn, (a["sh_b0"], a["sh_b1"], a["sh_b2"], a["sh_b3"]),
                                             a["published_at"] - timedelta(days=7), article_id)
        # short posts (Telegram) make SimHash noisy: identical first lines are a second candidate channel
        cands += news_repo.same_title_candidates(self.conn, title, a["published_at"] - timedelta(days=3), article_id)
        mine = dedup.shingles(f"{title} {body}")
        best = None
        seen: set[int] = set()
        for c in cands:
            if c["id"] in seen or _recurring(c, a):
                continue
            seen.add(c["id"])
            j = dedup.jaccard(mine, dedup.shingles(f"{c['title']} {c['text']}"))
            if j >= dedup.JACCARD_DUP and (best is None or j > best[1]):
                best = (c, j)
        if best:
            c = best[0]
            origin = c["origin_group_id"] or c["id"]
            if c["published_at"] > a["published_at"]:
                # processed out of order: the candidate is the copy, this article is the original
                news_repo.set_origin(self.conn, c["id"], origin, article_id)
                return None, origin
            return c["id"], origin
        return None, article_id

    def _cluster(self, article_id, a, geo: GeoResult, cls, terms, nums, names, dup_of, lang, old_event):
        conn = self.conn
        p = geo.primary
        if dup_of:
            ev = news_repo.event_of_article(conn, dup_of)
            if ev:
                news_repo.attach(conn, ev, article_id, 1.0)
                return ev, 1.0, {"reason": "duplicate_of_member"}
        if p is None or p.confidence < MIN_MAP_CONFIDENCE or p.ambiguity > MAX_MAP_AMBIGUITY:
            if old_event:
                news_repo.detach(conn, article_id)
            reason = "unlocated" if p is None else ("ambiguous_place" if p.ambiguity > MAX_MAP_AMBIGUITY
                                                    else "low_location_confidence")
            return None, 0.0, {"reason": reason}
        place = self.gaz.parents_of([p.entity_id]).get(p.entity_id) if p.entity_id else None
        feats = clustering.Features(
            at=a["event_time"] or a["published_at"], category=cls.category, event_type=cls.event_type,
            locality_id=place.locality_id if place else None, admin2_id=place.admin2_id if place else None,
            admin1_id=place.admin1_id if place else None, country_id=place.country_id if place else None,
            lat=p.lat, lon=p.lon, radius_km=p.radius_km, precision=p.precision,
            place_population=place.population if place else 0, lang=lang, terms=terms, numbers=set(nums),
            names=set(names))
        # serialize clustering per area: two workers must not create twin events for one fire
        lock_key = feats.admin1_id or feats.country_id or 0
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (zlib.crc32(f"cluster:{lock_key}".encode()),))
        best, best_s, best_d = None, 0.0, {}
        for ev in news_repo.candidate_events(conn, feats.at, feats.locality_id, feats.admin1_id, p.lat, p.lon):
            ef = event_features(ev)
            if clustering.recurring_series({a["source_id"]}, set(ev["member_sources"] or []),
                                           abs((ev["last_article_at"] - a["published_at"]).total_seconds()) / 3600):
                continue  # a source's recurring series (daily forecast, weekly digest) is not one event
            s, d = clustering.match_score(feats, ef)
            # the event may have started before; also compare with its latest activity
            if s < clustering.MATCH_THRESHOLD and ev["last_article_at"] != ef.at:
                ef.at = ev["last_article_at"]
                s2, d2 = clustering.match_score(feats, ef)
                if s2 > s:
                    s, d = s2, d2
            if s > best_s:
                best, best_s, best_d = ev, s, d
        if best is not None and best_s >= clustering.MATCH_THRESHOLD:
            news_repo.attach(conn, best["id"], article_id, best_s)
            return best["id"], best_s, {"matched": best_d, "candidates_checked": True}
        if old_event:
            news_repo.detach(conn, article_id)
        eid = news_repo.create_event(conn, feats.at, cls.category, a["title"])
        news_repo.attach(conn, eid, article_id, 1.0)
        return eid, 1.0, {"new_event": True, "best_rejected": {"event_id": best["id"] if best else None,
                                                               "score": best_s, **best_d}}

    def recompute_event(self, event_id: int, op: str) -> None:
        members = news_repo.event_members(self.conn, event_id)
        if not members:
            self.conn.execute("UPDATE event SET status = 'hidden', article_count = 0 WHERE id = %s", (event_id,))
            news_repo.log_change(self.conn, event_id, "removed")
            return
        loc_ids = [m["loc_id"] for m in members if m["loc_id"]]
        anc = {r["id"]: tuple(r["ancestors"]) for r in self.conn.execute(
            "SELECT id, ancestors FROM geo_entity WHERE id = ANY(%s)", (loc_ids,)).fetchall()} if loc_ids else {}
        fields = event_builder.build_event(members, anc)
        news_repo.update_event(self.conn, event_id, fields)
        news_repo.log_change(self.conn, event_id, op)
