-- Viewport queries: look up rollup rows of the entities inside the bbox (instead of scanning a level globally).
CREATE INDEX IF NOT EXISTS event_rollup_geo_idx ON event_rollup (level, geo_id, hour);
