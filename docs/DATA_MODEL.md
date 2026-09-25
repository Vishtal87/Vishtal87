# Модель данных (PostgreSQL 16 + PostGIS 3.4)

Схема задаётся SQL-миграциями `backend/geonews/db/migrations/001–007` и применяется командой `geonews migrate`.
Все времена хранятся в `timestamptz` (UTC), все координаты — в `geometry(…, 4326)`.

## Газеттир

**`geo_entity`** — любое место планеты, одна строка на объект.

| Поле | Смысл |
|---|---|
| `source`, `source_id` | происхождение (`geonames:524901`), уникальная пара; импорт идемпотентен (upsert) |
| `kind` | универсальный уровень: `continent / country / admin1..admin5 / locality / sublocality / street / point` |
| `place_class`, `local_type`, `feature_code` | город / посёлок / деревня / хутор; местный тип из данных («станица»); код GeoNames (PPL, PPLA2, PPLX…) |
| `name`, `names jsonb` | имя по умолчанию и отображаемые имена по языкам |
| `parent_id`, `ancestors bigint[]` | родитель и материализованный путь от корня |
| `continent_id … locality_id` | денормализованные уровни иерархии для быстрых фильтров |
| `population`, `importance` | априорная значимость (разрешение омонимов, ранжирование поиска) |
| `geom` Point, `area` MultiPolygon | точка и (если есть) граница; сейчас границы есть у стран |

**`geo_name`** — все названия объекта (альтернативные, исторические, разговорные): `name`, `lang`, `norm`
(casefold, без диакритики, ё→е), `lemma` (лемматизированная форма ru/uk, та же функция, что и для текста), `ntokens`.

## Источники и сырьё

- **`source`** — реестр: тип (official / media / regional_media / local_media / tv / telegram / youtube / blog /
  aggregator / ugc / organization), коннектор, URL, конфиг, языки, домашнее место (`home_geo_entity_id`),
  часовой пояс, `trust_tier`, `access_model` (public_feed / official_api / public_web), `legal_note`,
  `synthetic`, `enabled`, здоровье (`last_success_at`, `consecutive_failures`, `next_poll_at`, `last_error`),
  `http_etag` и `http_last_modified` для условных запросов. `access_model` допускает ещё `partner` (по договору).
- **`raw_item`** — ответ источника как есть (payload, тип, хэш, время получения, статус обработки). Уникален по
  (`source_id`, `external_id`, `payload_hash`): изменённая публикация даёт новую строку, так сохраняется история
  правок. Удаляется по истечении `GEONEWS_RAW_RETENTION_DAYS`.

## Статьи и анализ

- **`article`** — нормализованная публикация: URL и канонический URL, заголовок, текст для анализа,
  **отрывок ≤300 символов** для показа, язык, `published_at` и признак «часовой пояс предположен»,
  `event_time`, `is_live`, `content_hash`, `simhash` + 4 бэнда по 16 бит, `origin_group_id` (семья копий),
  `duplicate_of`, `version`, категория.
- **`article_version`** — прежние версии той же публикации (правки), с временем.
- **`article_analysis`** — трасса каждой стадии: `stage`, `method`, `version`, `output jsonb`. Отсюда
  карточка «откуда система это взяла» (`/api/articles/{id}/provenance`).
- **`article_location`** — все найденные места статьи: роль (primary / secondary / near / mentioned / source_area),
  отношение (in / near / direction / street / coordinates), расстояние, точка, точность, confidence,
  доказательства (фрагмент текста, кандидаты, баллы), метод.

## События

- **`event`** — кластер публикаций об одном происшествии: заголовок, краткое содержание, категория и тип
  (`fire`, `road_accident`, …), статус (`active / merged / hidden`, `merged_into`), `first_seen_at`,
  `last_article_at`, `event_time`, `is_live`. Место: `geo_entity_id`, точность, confidence, отношение
  (in / near / region / source_area), `radius_m` для «в 15 км от», точка и денормализованные уровни плюс
  `ancestors`. Доверие: счётчики статей, источников и независимых источников, `source_types[]`,
  `has_official`, `trust_label`. Также вектор терминов для кластеризации.
- **`event_article`** — состав события: статья (уникальна — одна статья принадлежит одному событию),
  similarity, время добавления.
- **`event_relation`** — связи между событиями. Сейчас пишется `merged` (фоновое слияние, со скором).
  Схема допускает `related` / `follow_up` / `same_place`, но «связанные события» в карточке вычисляются на лету.
- **`event_change_log`** — журнал изменений для SSE: resume по `Last-Event-ID` и ключ кэша агрегатов.
- **`event_rollup`** — почасовая сводка для карты (уровень 0–4 = континент…н.п., час, объект, категория,
  маска групп источников, live, own, n, суммы единичных векторов для центра пузыря, last_at). Ведётся
  триггерами на `event`. Проверка согласованности — `scripts/check_rollup.sql`, пересборка —
  `geonews rebuild-rollup`.
- **`category`**, **`job`** (очередь: kind, payload, status, attempts, run_after, locked_at, error).

## Индексы под обязательные запросы

| Запрос | Индекс / приём |
|---|---|
| События в радиусе R от точки | `event_geog_gix` — GiST по `geom::geography` (частичный, `status='active'`) + `ST_DWithin` |
| События внутри административного объекта | `event_ancestors_gin` — GIN по `ancestors` (`ancestors @> ARRAY[id]`); для регионов также `event_admin1_idx (admin1_id, last_article_at)` |
| События конкретного н.п. | `event_locality_idx (locality_id, last_article_at DESC)`, `event_entity_idx (geo_entity_id, …)` |
| Последние N часов | `event_last_idx (last_article_at DESC)`, `event_category_idx (category, last_article_at)`, `event_stypes_gin` |
| Агрегаты карты (континенты…н.п.) | `event_rollup` PK `(level, hour, geo_id, …)` + `event_rollup_geo_idx (level, geo_id, hour)`; объекты вьюпорта передаются массивом id |
| Точные дубли | `article_canon_idx`, `article_hash_idx`, `article_title_md5_idx (md5(lower(title)), published_at)` |
| Near-dup кандидаты | `article_sh0..sh3 (sh_bN, published_at)` — совпадение хотя бы одного 16-битного бэнда |
| Поиск мест | `geo_name_lemma_idx`, `geo_name_norm_prefix_idx (text_pattern_ops)`, `geo_name_norm_trgm` (GIN pg_trgm) |
| Обратное геокодирование | `geo_entity_geom_gix` (KNN `<->`), `geo_entity_geog_gix` |
| Очередь | `job_ready_idx (kind, run_after) WHERE status='queued'` + `FOR UPDATE SKIP LOCKED` |
| Каскады и массовые удаления | индексы на внешних ключах (миграция 007), включая `event_merged_into_idx`: без него удаление 1 млн событий шло >20 мин, с ним — 30 с |
