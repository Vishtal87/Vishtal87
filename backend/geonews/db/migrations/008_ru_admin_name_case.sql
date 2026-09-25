-- GeoNames spells some Russian region names in title case ("Псковская Область", "Красноярский Край"); Russian
-- writes the generic part in lower case. Display names only: search keys are case-folded anyway. New imports are
-- fixed in geonames_dump.display_case.
UPDATE geo_entity
SET names = jsonb_set(names, '{ru}', to_jsonb(
      replace(replace(replace(replace(replace(replace(names->>'ru',
        ' Область', ' область'), ' Край', ' край'), ' Район', ' район'), ' Автономный', ' автономный'),
        ' Автономная', ' автономная'), ' Округ', ' округ')))
WHERE kind LIKE 'admin%' AND names->>'ru' ~ ' (Область|Край|Район|Автономн|Округ)';
