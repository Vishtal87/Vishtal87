-- Consistency check: trigger-maintained rollup == direct counts, per level. Expect 0 mismatches.
WITH lv(level, col) AS (VALUES (0, 'continent_id'), (1, 'country_id'), (2, 'admin1_id'), (3, 'admin2_id'), (4, 'locality_id')),
direct AS (
  SELECT 0 AS level, continent_id AS gid, count(*) n FROM event WHERE status='active' AND geom IS NOT NULL AND continent_id IS NOT NULL GROUP BY 2
  UNION ALL SELECT 1, country_id, count(*) FROM event WHERE status='active' AND geom IS NOT NULL AND country_id IS NOT NULL GROUP BY 2
  UNION ALL SELECT 2, admin1_id, count(*) FROM event WHERE status='active' AND geom IS NOT NULL AND admin1_id IS NOT NULL GROUP BY 2
  UNION ALL SELECT 3, admin2_id, count(*) FROM event WHERE status='active' AND geom IS NOT NULL AND admin2_id IS NOT NULL GROUP BY 2
  UNION ALL SELECT 4, locality_id, count(*) FROM event WHERE status='active' AND geom IS NOT NULL AND locality_id IS NOT NULL GROUP BY 2),
roll AS (SELECT level, geo_id AS gid, sum(n) n FROM event_rollup GROUP BY 1, 2 HAVING sum(n) <> 0)
SELECT d.level, count(*) FILTER (WHERE d.n IS DISTINCT FROM r.n) AS mismatches, sum(d.n) AS direct_total, sum(r.n) AS rollup_total
FROM direct d FULL JOIN roll r ON r.level = d.level AND r.gid = d.gid GROUP BY 1 ORDER BY 1;
