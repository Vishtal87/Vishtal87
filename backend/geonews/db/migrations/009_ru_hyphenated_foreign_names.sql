-- The offline bundle's Russian display names of foreign cities were picked without language tags and came out
-- as 'Ню Йорк', 'Абу Даби'. Russian hyphenates such names: take the hyphenated variant the gazetteer already
-- has for the same place (Нью-Йорк, Абу-Даби). New imports choose it directly (records.pick_ru_display).
WITH cand AS (
    SELECT e.id, n.name,
           row_number() OVER (PARTITION BY e.id ORDER BY (n.name !~ '[ёЁ]') DESC,
                              abs(length(n.name) - length(e.names->>'ru')), n.name) AS rk
    FROM geo_entity e JOIN geo_name n ON n.entity_id = e.id
    WHERE e.kind = 'locality' AND e.country_code <> 'RU' AND (e.names->>'ru') ~ '^[А-ЯЁа-яё]+ [А-ЯЁа-яё]+$'
      AND n.name ~ '^[А-ЯЁа-яё]+-[А-ЯЁа-яё]+$'
)
UPDATE geo_entity e SET names = jsonb_set(e.names, '{ru}', to_jsonb(c.name))
FROM cand c WHERE c.id = e.id AND c.rk = 1;
