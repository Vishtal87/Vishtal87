-- Hourly activity rollup per hierarchy level. Keeps global map aggregates fast with millions of events.
-- Maintained by a trigger on `event`, so every path (pipeline, merge job, backfills) stays consistent.
-- level: 0 continent, 1 country, 2 admin1, 3 admin2, 4 locality
-- smask: bit set of source groups (1 telegram, 2 media, 4 youtube, 8 official, 16 blogs, 32 aggregators)
-- own:   the event is attached to this entity itself (region-wide news), not to something inside it
-- sx/sy/sz: sums of unit vectors of event points -> activity-weighted bubble position (antimeridian-safe)

CREATE TABLE IF NOT EXISTS event_rollup (
    level    smallint         NOT NULL,
    hour     timestamptz      NOT NULL,
    geo_id   bigint           NOT NULL,
    category text             NOT NULL,
    smask    smallint         NOT NULL,
    live     boolean          NOT NULL,
    own      boolean          NOT NULL,
    n        integer          NOT NULL DEFAULT 0,
    sx       double precision NOT NULL DEFAULT 0,
    sy       double precision NOT NULL DEFAULT 0,
    sz       double precision NOT NULL DEFAULT 0,
    last_at  timestamptz,
    PRIMARY KEY (level, hour, geo_id, category, smask, live, own)
);

CREATE OR REPLACE FUNCTION source_mask(types text[]) RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(sum(DISTINCT CASE
      WHEN t = 'telegram' THEN 1
      WHEN t IN ('media', 'regional_media', 'local_media', 'tv') THEN 2
      WHEN t = 'youtube' THEN 4
      WHEN t IN ('official', 'organization') THEN 8
      WHEN t IN ('blog', 'ugc') THEN 16
      WHEN t = 'aggregator' THEN 32 ELSE 0 END), 0)::smallint
  FROM unnest(types) AS t
$$;

CREATE OR REPLACE FUNCTION event_rollup_apply(ev event, sign integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  h timestamptz;
  m smallint;
  x double precision; y double precision; z double precision;
  ids bigint[];
  i integer;
BEGIN
  IF ev.status <> 'active' OR ev.geom IS NULL THEN
    RETURN;
  END IF;
  h := date_trunc('hour', ev.last_article_at);
  m := source_mask(ev.source_types);
  x := cos(radians(ST_Y(ev.geom))) * cos(radians(ST_X(ev.geom)));
  y := cos(radians(ST_Y(ev.geom))) * sin(radians(ST_X(ev.geom)));
  z := sin(radians(ST_Y(ev.geom)));
  ids := ARRAY[ev.continent_id, ev.country_id, ev.admin1_id, ev.admin2_id, ev.locality_id];
  FOR i IN 1..5 LOOP                      -- fixed order: consistent row locking across writers
    CONTINUE WHEN ids[i] IS NULL;
    INSERT INTO event_rollup AS r (level, hour, geo_id, category, smask, live, own, n, sx, sy, sz, last_at)
    VALUES (i - 1, h, ids[i], ev.category, m, ev.is_live, ev.geo_entity_id = ids[i], sign, sign * x, sign * y, sign * z,
            ev.last_article_at)
    ON CONFLICT (level, hour, geo_id, category, smask, live, own) DO UPDATE
      SET n = r.n + EXCLUDED.n, sx = r.sx + EXCLUDED.sx, sy = r.sy + EXCLUDED.sy, sz = r.sz + EXCLUDED.sz,
          last_at = greatest(r.last_at, EXCLUDED.last_at);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION event_rollup_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM event_rollup_apply(OLD, -1);
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    PERFORM event_rollup_apply(NEW, 1);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS event_rollup_ins ON event;
DROP TRIGGER IF EXISTS event_rollup_upd ON event;
DROP TRIGGER IF EXISTS event_rollup_del ON event;
CREATE TRIGGER event_rollup_ins AFTER INSERT ON event FOR EACH ROW EXECUTE FUNCTION event_rollup_trigger();
CREATE TRIGGER event_rollup_del AFTER DELETE ON event FOR EACH ROW EXECUTE FUNCTION event_rollup_trigger();
CREATE TRIGGER event_rollup_upd AFTER UPDATE ON event FOR EACH ROW
  WHEN ((OLD.status, date_trunc('hour', OLD.last_article_at), OLD.category, OLD.source_types, OLD.is_live, OLD.geo_entity_id,
         OLD.continent_id, OLD.country_id, OLD.admin1_id, OLD.admin2_id, OLD.locality_id, ST_AsBinary(OLD.geom))
        IS DISTINCT FROM
        (NEW.status, date_trunc('hour', NEW.last_article_at), NEW.category, NEW.source_types, NEW.is_live, NEW.geo_entity_id,
         NEW.continent_id, NEW.country_id, NEW.admin1_id, NEW.admin2_id, NEW.locality_id, ST_AsBinary(NEW.geom)))
  EXECUTE FUNCTION event_rollup_trigger();

-- backfill from existing events (set-based)
TRUNCATE event_rollup;
INSERT INTO event_rollup (level, hour, geo_id, category, smask, live, own, n, sx, sy, sz, last_at)
SELECT lvl, date_trunc('hour', e.last_article_at), gid, e.category, source_mask(e.source_types), e.is_live,
       e.geo_entity_id = gid, count(*),
       sum(cos(radians(ST_Y(e.geom))) * cos(radians(ST_X(e.geom)))),
       sum(cos(radians(ST_Y(e.geom))) * sin(radians(ST_X(e.geom)))),
       sum(sin(radians(ST_Y(e.geom)))), max(e.last_article_at)
FROM event e
CROSS JOIN LATERAL (VALUES (0, e.continent_id), (1, e.country_id), (2, e.admin1_id), (3, e.admin2_id), (4, e.locality_id)) v(lvl, gid)
WHERE e.status = 'active' AND e.geom IS NOT NULL AND gid IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7;
ANALYZE event_rollup;
