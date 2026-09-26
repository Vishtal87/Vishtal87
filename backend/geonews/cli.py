"""Command line entry point: `python -m geonews.cli <command>`."""
from __future__ import annotations

import argparse
import logging
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="geonews")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply SQL migrations")
    io = sub.add_parser("import-offline", help="import the offline gazetteer bundle (GeoNames cities500 + admin names)")
    io.add_argument("--if-empty", action="store_true", help="skip when the gazetteer is already loaded")
    g = sub.add_parser("import-geonames", help="import full GeoNames dumps (every village/hamlet)")
    g.add_argument("countries", nargs="+", help="country codes (RU DE US ...) or allCountries")
    g.add_argument("--dir", default=None, help="dump directory (default: data/geonames)")
    g.add_argument("--download", action="store_true", help="download missing dump files first (needs network)")
    fg = sub.add_parser("fetch-geonames", help="download full GeoNames dumps (CC-BY 4.0) without importing them")
    fg.add_argument("countries", nargs="+", help="country codes (RU DE US ...) or allCountries")
    fg.add_argument("--dir", default=None, help="dump directory (default: data/geonames)")
    s = sub.add_parser("load-sources", help="load/refresh source registry from a YAML file")
    s.add_argument("file", nargs="?", default=None)
    cs = sub.add_parser("check-sources", help="verify candidate sources (robots.txt, feed discovery, parse, freshness)")
    cs.add_argument("file", help="registry YAML with candidates (url or homepage per entry)")
    cs.add_argument("--out", default=None, help="write verified sources (enabled, with the working feed URL) here")
    cs.add_argument("--keep-previous", action="store_true",
                    help="a candidate that fails now but is verified in the existing --out file stays there "
                         "(a site that is down for an hour is not dropped; ingestion backs off by itself)")
    sub.add_parser("load-categories", help="load/refresh categories from config/categories.yaml")
    sub.add_parser("reset-news", help="DANGER: delete all ingested news/events/jobs (keeps gazetteer & sources)")
    sub.add_parser("rebuild-rollup", help="rebuild the map activity rollup from events (after bulk operations)")
    w = sub.add_parser("worker", help="run a background worker")
    w.add_argument("kind", choices=["ingest", "process", "maintenance", "all"])
    w.add_argument("--once", action="store_true", help="drain available work and exit")
    a = sub.add_parser("api", help="run the HTTP API")
    a.add_argument("--host", default="127.0.0.1")
    a.add_argument("--port", type=int, default=8000)
    a.add_argument("--workers", type=int, default=1, help="uvicorn worker processes (each keeps its own SSE broker)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.cmd == "migrate":
        from geonews.db.migrate import migrate

        print("applied:", migrate() or "nothing")
    elif args.cmd == "import-offline":
        from geonews.db.pool import connect
        from geonews.gazetteer.service import import_offline

        if args.if_empty:
            with connect() as conn:
                n = conn.execute("SELECT count(*) AS n FROM geo_entity WHERE kind = 'locality'").fetchone()["n"]
            if n > 0:
                print(f"gazetteer already loaded ({n} localities), skipping")
                return
        print("entities:", import_offline())
    elif args.cmd == "import-geonames":
        from geonews.config import settings
        from geonews.gazetteer.service import import_geonames

        d = Path(args.dir) if args.dir else settings.data_dir / "geonames"
        if args.download:
            from geonews.gazetteer.geonames_fetch import fetch_geonames

            fetch_geonames(d, args.countries)
        print("entities:", import_geonames(d, args.countries))
    elif args.cmd == "fetch-geonames":
        from geonews.config import settings
        from geonews.gazetteer.geonames_fetch import fetch_geonames

        d = Path(args.dir) if args.dir else settings.data_dir / "geonames"
        for f in fetch_geonames(d, args.countries):
            print(f, f"{f.stat().st_size / 1e6:.1f} MB")
    elif args.cmd == "load-sources":
        from geonews.ingestion.registry import load_sources

        print("sources:", load_sources(args.file))
    elif args.cmd == "check-sources":
        import yaml

        from geonews.ingestion.fetcher import Fetcher
        from geonews.ingestion.registry import read_registry
        from geonews.ingestion.verify import check_candidate, derived_telegram, verified_entry

        previous = {}
        if args.keep_previous and args.out and Path(args.out).exists():
            previous = {s["slug"]: s for s in read_registry(args.out)}
        fetcher, ok = Fetcher(), []
        queue = read_registry(args.file)
        slugs = {s["slug"] for s in queue}
        for spec in queue:          # grows while iterating: channels found on the candidates' own sites
            chk = check_candidate(spec, fetcher)
            if chk.telegram and spec.get("homepage") and f"{spec['slug']}-tg" not in slugs:
                queue.append(derived_telegram(spec, chk.telegram[0]))
                slugs.add(queue[-1]["slug"])
            status = "OK   " if chk.ok else ("KEEP " if spec["slug"] in previous else "FAIL ")
            detail = f"{chk.entries} items, newest {chk.age_h} h ago -> {chk.url}" if chk.url else ""
            print(f"{status}{spec['slug']:<28} {detail} {chk.error or ''}".rstrip(), flush=True)
            if chk.ok:
                ok.append(verified_entry(spec, chk))
            elif spec["slug"] in previous:
                ok.append(previous[spec["slug"]])
        done = {s["slug"] for s in ok}
        ok += [s for slug, s in previous.items()          # a site that was down this time: keep its channel too
               if slug not in done and slug not in slugs and s.get("derived_from") in slugs]
        print(f"verified {len(ok)} sources")
        if not ok:
            raise SystemExit("nothing verified, no registry written (network access? robots.txt? feed URLs?)")
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write("# Generated by `geonews check-sources`: verified, enabled sources. Review before loading.\n")
                yaml.safe_dump({"sources": ok}, f, allow_unicode=True, sort_keys=False, width=120)
    elif args.cmd == "load-categories":
        from geonews.pipeline.classify import load_categories_into_db

        print("categories:", load_categories_into_db())
    elif args.cmd == "reset-news":
        from geonews.db.pool import connect

        with connect() as conn:
            conn.execute("TRUNCATE event_change_log, event_relation, event_article, event, article_location, "
                         "article_analysis, article_version, article, raw_item, job, event_rollup RESTART IDENTITY CASCADE")
            conn.execute("UPDATE source SET next_poll_at = now(), consecutive_failures = 0, last_error = NULL, "
                         "http_etag = NULL, http_last_modified = NULL")
            conn.commit()
        print("news data reset")
    elif args.cmd == "rebuild-rollup":
        from geonews.db.pool import connect

        with connect() as conn:
            n = conn.execute("SELECT rebuild_event_rollup() AS n").fetchone()["n"]
            conn.commit()
        print("rollup rows:", n)
    elif args.cmd == "worker":
        from geonews.workers.run import run_worker

        run_worker(args.kind, once=args.once)
    elif args.cmd == "api":
        import uvicorn

        uvicorn.run("geonews.api.app:app", host=args.host, port=args.port, workers=args.workers, log_level="info",
                    proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
