"""Command line entry point: `python -m geonews.cli <command>`."""
from __future__ import annotations

import argparse
import logging
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="geonews")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply SQL migrations")
    sub.add_parser("import-offline", help="import the offline gazetteer bundle (GeoNames cities500 + admin names)")
    g = sub.add_parser("import-geonames", help="import full GeoNames dumps (every village/hamlet)")
    g.add_argument("countries", nargs="+", help="country codes (RU DE US ...) or allCountries")
    g.add_argument("--dir", default=None, help="dump directory (default: data/geonames)")
    s = sub.add_parser("load-sources", help="load/refresh source registry from a YAML file")
    s.add_argument("file", nargs="?", default=None)
    sub.add_parser("load-categories", help="load/refresh categories from config/categories.yaml")
    sub.add_parser("reset-news", help="DANGER: delete all ingested news/events/jobs (keeps gazetteer & sources)")
    sub.add_parser("rebuild-rollup", help="rebuild the map activity rollup from events (after bulk operations)")
    w = sub.add_parser("worker", help="run a background worker")
    w.add_argument("kind", choices=["ingest", "process", "maintenance", "all"])
    w.add_argument("--once", action="store_true", help="drain available work and exit")
    a = sub.add_parser("api", help="run the HTTP API")
    a.add_argument("--host", default="127.0.0.1")
    a.add_argument("--port", type=int, default=8000)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.cmd == "migrate":
        from geonews.db.migrate import migrate

        print("applied:", migrate() or "nothing")
    elif args.cmd == "import-offline":
        from geonews.gazetteer.service import import_offline

        print("entities:", import_offline())
    elif args.cmd == "import-geonames":
        from geonews.config import settings
        from geonews.gazetteer.service import import_geonames

        d = Path(args.dir) if args.dir else settings.data_dir / "geonames"
        print("entities:", import_geonames(d, args.countries))
    elif args.cmd == "load-sources":
        from geonews.ingestion.registry import load_sources

        print("sources:", load_sources(args.file))
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

        uvicorn.run("geonews.api.app:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
