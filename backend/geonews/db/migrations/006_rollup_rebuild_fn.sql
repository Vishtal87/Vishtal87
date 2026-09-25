-- Set-based rebuild of the activity rollup. Use after bulk loads/deletes (run them with the event_rollup_*
-- triggers disabled): per-row maintenance is right for streaming ingestion, wrong for millions of rows at once.
CREATE OR REPLACE FUNCTION rebuild_event_rollup() RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  TRUNCATE event_rollup;
  INSERT INTO event_rollup (level, hour, geo_id, category, smask, live, own, n, sx, sy, sz, last_at)
  SELECT lvl, date_trunc('hour', e.last_article_at), gid, e.category, source_mask(e.source_types), e.is_live,
         e.geo_entity_id = gid, count(*),
         sum(cos(radians(ST_Y(e.geom))) * cos(radians(ST_X(e.geom)))),
         sum(cos(radians(ST_Y(e.geom))) * sin(radians(ST_X(e.geom)))),
         sum(sin(radians(ST_Y(e.geom)))), max(e.last_article_at)
  FROM event e
  CROSS JOIN LATERAL (VALUES (0, e.continent_id), (1, e.country_id), (2, e.admin1_id), (3, e.admin2_id),
                             (4, e.locality_id)) v(lvl, gid)
  WHERE e.status = 'active' AND e.geom IS NOT NULL AND gid IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5, 6, 7;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
