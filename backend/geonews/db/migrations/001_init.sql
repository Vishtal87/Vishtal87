-- LIVE GEO NEWS — initial schema.
-- Principles:
--   * geography is a universal hierarchy (no country-specific tables, no city whitelists);
--   * nothing is destroyed: raw -> normalized -> analysis are all persisted;
--   * events aggregate articles but never replace them.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- NOTE: name normalization (casefold, Latin diacritics, ё->е, keeping 'й') is done in ONE place:
-- geonews/domain/text_norm.py. The database only stores and indexes its output.

------------------------------------------------------------------------------
-- GEOGRAPHY
------------------------------------------------------------------------------
-- kind: universal level of the hierarchy. Rank gives ordering (lower = bigger).
--   continent(1) country(2) admin1(3) admin2(4) admin3(5) admin4(6) admin5(7)
--   locality(8)  sublocality(9) street(10) point(11)
-- place_class: size/nature of a locality (city/town/village/hamlet/settlement/neighbourhood...)
-- local_type: the locally used type word taken from DATA (e.g. 'станица', 'хутор', 'Gemeinde'),
--             never hard-coded per country.
CREATE TABLE geo_entity (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source          text        NOT NULL,              -- geonames | osm | wof | manual
    source_id       text        NOT NULL,              -- id inside the source
    admin_code      text,                              -- e.g. 'RU', 'RU.38', 'RU.38.466879' (GeoNames code path)
    kind            text        NOT NULL CHECK (kind IN ('continent','country','admin1','admin2','admin3','admin4','admin5',
                                                         'locality','sublocality','street','point')),
    kind_rank       smallint    NOT NULL,
    place_class     text,
    local_type      text,
    feature_code    text,
    name            text        NOT NULL,              -- default (usually Latin/English) name
    names           jsonb       NOT NULL DEFAULT '{}', -- display names by language: {"ru": "...", "en": "..."}
    country_code    char(2),
    parent_id       bigint      REFERENCES geo_entity(id) ON DELETE SET NULL,
    ancestors       bigint[]    NOT NULL DEFAULT '{}', -- root..parent, materialized path
    continent_id    bigint,
    country_id      bigint,
    admin1_id       bigint,
    admin2_id       bigint,
    locality_id     bigint,                            -- for sublocality/street/point
    population      bigint      NOT NULL DEFAULT 0,
    importance      real        NOT NULL DEFAULT 0,    -- prior for disambiguation & ranking
    geom            geometry(Point, 4326),
    area            geometry(MultiPolygon, 4326),      -- optional boundary (Natural Earth/OSM/geoBoundaries)
    timezone        text,
    meta            jsonb       NOT NULL DEFAULT '{}',
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);
CREATE INDEX geo_entity_geom_gix      ON geo_entity USING gist (geom);
CREATE INDEX geo_entity_geog_gix      ON geo_entity USING gist ((geom::geography));
CREATE INDEX geo_entity_area_gix      ON geo_entity USING gist (area);
CREATE INDEX geo_entity_ancestors_gin ON geo_entity USING gin (ancestors);
CREATE INDEX geo_entity_parent_idx    ON geo_entity (parent_id);
CREATE INDEX geo_entity_kind_idx      ON geo_entity (kind, importance DESC);
CREATE INDEX geo_entity_admin1_idx    ON geo_entity (admin1_id) WHERE kind = 'locality';
CREATE UNIQUE INDEX geo_entity_admin_code_uq ON geo_entity (admin_code) WHERE admin_code IS NOT NULL;

-- All names (official, alternate, historical, colloquial, multilingual).
--   norm  : output of text_norm.norm() (search, prefix, trigram)
--   lemma : morphological normal form for inflected languages (ru/uk); = norm otherwise (geoparsing)
CREATE TABLE geo_name (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_id    bigint   NOT NULL REFERENCES geo_entity(id) ON DELETE CASCADE,
    name         text     NOT NULL,
    lang         text,                                -- ISO 639 when known, NULL otherwise
    script       text,                                -- latn | cyrl | hani | arab | ...
    norm         text     NOT NULL,
    lemma        text     NOT NULL,
    is_preferred boolean  NOT NULL DEFAULT false,
    is_colloquial boolean NOT NULL DEFAULT false,     -- 'Кубань', 'Подмосковье'
    is_historic  boolean  NOT NULL DEFAULT false,
    ntokens      smallint NOT NULL DEFAULT 1,
    UNIQUE (entity_id, name)
);
CREATE INDEX geo_name_lemma_idx ON geo_name (lemma);
CREATE INDEX geo_name_norm_prefix_idx ON geo_name (norm text_pattern_ops);
CREATE INDEX geo_name_norm_trgm ON geo_name USING gin (norm gin_trgm_ops);
CREATE INDEX geo_name_entity_idx ON geo_name (entity_id);

------------------------------------------------------------------------------
-- SOURCES
------------------------------------------------------------------------------
CREATE TABLE source (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug                text        NOT NULL UNIQUE,
    name                text        NOT NULL,
    source_type         text        NOT NULL CHECK (source_type IN (
                            'official','media','regional_media','local_media','tv','telegram','youtube',
                            'blog','aggregator','ugc','organization')),
    connector           text        NOT NULL,        -- rss | telegram_public | youtube_rss | html_list | gdelt
    url                 text        NOT NULL,
    config              jsonb       NOT NULL DEFAULT '{}',
    languages           text[]      NOT NULL DEFAULT '{}',
    country_code        char(2),
    home_geo_entity_id  bigint      REFERENCES geo_entity(id),  -- area the source covers (key for local disambiguation)
    timezone            text,                                    -- used when the feed omits a timezone
    trust_tier          smallint    NOT NULL DEFAULT 2,         -- 1 official .. 4 anonymous/ugc
    access_model        text        NOT NULL CHECK (access_model IN ('public_feed','official_api','public_web','partner')),
    legal_note          text,
    synthetic           boolean     NOT NULL DEFAULT false,     -- demo/test fixture source
    enabled             boolean     NOT NULL DEFAULT true,
    poll_interval_s     integer     NOT NULL DEFAULT 300,
    -- health
    next_poll_at        timestamptz NOT NULL DEFAULT now(),
    last_attempt_at     timestamptz,
    last_success_at     timestamptz,
    consecutive_failures integer    NOT NULL DEFAULT 0,
    last_error          text,
    http_etag           text,
    http_last_modified  text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_due_idx ON source (next_poll_at) WHERE enabled;

------------------------------------------------------------------------------
-- RAW -> ARTICLE -> ANALYSIS
------------------------------------------------------------------------------
CREATE TABLE raw_item (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id     bigint      NOT NULL REFERENCES source(id),
    external_id   text        NOT NULL,           -- guid / message id / url
    url           text,
    payload       text,                           -- exactly what we received (retention-limited)
    payload_type  text        NOT NULL,           -- rss-item-json | html | json
    payload_hash  text        NOT NULL,
    fetched_at    timestamptz NOT NULL DEFAULT now(),
    status        text        NOT NULL DEFAULT 'new' CHECK (status IN ('new','processed','failed','skipped')),
    error         text,
    UNIQUE (source_id, external_id, payload_hash)
);
CREATE INDEX raw_item_fetched_idx ON raw_item (fetched_at);

CREATE TABLE article (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id       bigint      NOT NULL REFERENCES source(id),
    raw_item_id     bigint      REFERENCES raw_item(id) ON DELETE SET NULL,
    external_id     text        NOT NULL,
    url             text,
    canonical_url   text,
    title           text        NOT NULL,
    text            text        NOT NULL DEFAULT '',  -- normalized plain text used for analysis
    excerpt         text        NOT NULL DEFAULT '',  -- short excerpt shown to users (copyright hygiene)
    lang            text,
    lang_confidence real,
    published_at    timestamptz NOT NULL,
    published_tz_assumed boolean NOT NULL DEFAULT false,
    fetched_at      timestamptz NOT NULL DEFAULT now(),
    event_time      timestamptz,                  -- when the thing happened (may differ from publication)
    is_live         boolean     NOT NULL DEFAULT true,   -- false for backfill / historical references
    content_hash    text        NOT NULL,
    simhash         bigint      NOT NULL,
    sh_b0 smallint NOT NULL, sh_b1 smallint NOT NULL, sh_b2 smallint NOT NULL, sh_b3 smallint NOT NULL,
    origin_group_id bigint,                       -- near-duplicate family (forwards/reposts share one)
    duplicate_of    bigint      REFERENCES article(id),
    version         integer     NOT NULL DEFAULT 1,
    category        text,
    status          text        NOT NULL DEFAULT 'new',
    UNIQUE (source_id, external_id)
);
CREATE INDEX article_published_idx ON article (published_at DESC);
CREATE INDEX article_hash_idx      ON article (content_hash);
CREATE INDEX article_canon_idx     ON article (canonical_url);
CREATE INDEX article_sh0 ON article (sh_b0, published_at);
CREATE INDEX article_sh1 ON article (sh_b1, published_at);
CREATE INDEX article_sh2 ON article (sh_b2, published_at);
CREATE INDEX article_sh3 ON article (sh_b3, published_at);
CREATE INDEX article_origin_idx ON article (origin_group_id);

CREATE TABLE article_version (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id  bigint      NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    version     integer     NOT NULL,
    title       text        NOT NULL,
    excerpt     text        NOT NULL,
    content_hash text       NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (article_id, version)
);

-- Every stage writes its output here: the audit trail of "why the system decided this".
CREATE TABLE article_analysis (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id  bigint      NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    stage       text        NOT NULL,          -- language | dates | geoparse | category | dedup | cluster | ...
    method      text        NOT NULL,          -- e.g. 'rules-v1'
    output      jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX article_analysis_article_idx ON article_analysis (article_id, stage);

CREATE TABLE article_location (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id    bigint   NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    geo_entity_id bigint   REFERENCES geo_entity(id),
    role          text     NOT NULL CHECK (role IN ('primary','secondary','near','mentioned','source_area')),
    relation      text,                         -- in | near | direction:N | street | coordinates
    distance_km   real,
    geom          geometry(Point, 4326),
    precision     text     NOT NULL,            -- point | street | sublocality | locality | admin2 | admin1 | country | area
    confidence    real     NOT NULL,
    evidence      jsonb    NOT NULL DEFAULT '{}',
    method        text     NOT NULL
);
CREATE INDEX article_location_article_idx ON article_location (article_id);
CREATE INDEX article_location_entity_idx  ON article_location (geo_entity_id);

------------------------------------------------------------------------------
-- EVENTS
------------------------------------------------------------------------------
CREATE TABLE event (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title                text        NOT NULL,
    summary              text        NOT NULL DEFAULT '',
    lang                 text,
    category             text        NOT NULL DEFAULT 'other',
    event_type           text,                      -- fine-grained (fire, road_accident, ...)
    status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','hidden')),
    merged_into          bigint      REFERENCES event(id),
    first_seen_at        timestamptz NOT NULL,
    last_article_at      timestamptz NOT NULL,
    event_time           timestamptz,
    is_live              boolean     NOT NULL DEFAULT true,
    -- location
    geo_entity_id        bigint      REFERENCES geo_entity(id),
    location_precision   text        NOT NULL,
    location_confidence  real        NOT NULL,
    location_relation    text        NOT NULL DEFAULT 'in',   -- in | near | region | source_area
    radius_m             integer,
    geom                 geometry(Point, 4326),
    continent_id         bigint,
    country_id           bigint,
    admin1_id            bigint,
    admin2_id            bigint,
    locality_id          bigint,
    ancestors            bigint[]    NOT NULL DEFAULT '{}',  -- includes geo_entity_id itself
    -- provenance & trust
    article_count        integer     NOT NULL DEFAULT 0,
    source_count         integer     NOT NULL DEFAULT 0,
    independent_count    integer     NOT NULL DEFAULT 0,
    source_types         text[]      NOT NULL DEFAULT '{}',
    has_official         boolean     NOT NULL DEFAULT false,
    trust_label          text        NOT NULL DEFAULT 'single_source',
    synthetic            boolean     NOT NULL DEFAULT false,
    terms                jsonb       NOT NULL DEFAULT '{}',  -- term vector used for clustering
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_last_idx        ON event (last_article_at DESC) WHERE status = 'active';
CREATE INDEX event_geom_gix        ON event USING gist (geom) WHERE status = 'active';
CREATE INDEX event_geog_gix        ON event USING gist ((geom::geography)) WHERE status = 'active';
CREATE INDEX event_ancestors_gin   ON event USING gin (ancestors) WHERE status = 'active';
CREATE INDEX event_locality_idx    ON event (locality_id, last_article_at DESC) WHERE status = 'active';
CREATE INDEX event_admin1_idx      ON event (admin1_id, last_article_at DESC) WHERE status = 'active';
CREATE INDEX event_entity_idx      ON event (geo_entity_id, last_article_at DESC) WHERE status = 'active';
CREATE INDEX event_category_idx    ON event (category, last_article_at DESC) WHERE status = 'active';
CREATE INDEX event_stypes_gin      ON event USING gin (source_types) WHERE status = 'active';

CREATE TABLE event_article (
    event_id    bigint      NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    article_id  bigint      NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    similarity  real        NOT NULL,
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, article_id)
);
CREATE UNIQUE INDEX event_article_article_uq ON event_article (article_id);

CREATE TABLE event_relation (
    event_id         bigint NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    related_event_id bigint NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    relation         text   NOT NULL,       -- same_place | follow_up | related
    score            real   NOT NULL,
    PRIMARY KEY (event_id, related_event_id)
);

-- Append-only change feed: realtime (SSE) resume via Last-Event-ID.
CREATE TABLE event_change_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id    bigint      NOT NULL,
    op          text        NOT NULL,       -- created | updated | merged
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_change_log_time_idx ON event_change_log (changed_at);

------------------------------------------------------------------------------
-- CATEGORIES (extensible, i18n)
------------------------------------------------------------------------------
CREATE TABLE category (
    slug        text PRIMARY KEY,
    names       jsonb    NOT NULL,          -- {"ru": "Происшествия", "en": "Incidents"}
    color       text     NOT NULL,
    icon        text     NOT NULL,
    sort        smallint NOT NULL DEFAULT 100,
    active      boolean  NOT NULL DEFAULT true
);

------------------------------------------------------------------------------
-- JOB QUEUE (Postgres, SKIP LOCKED)
------------------------------------------------------------------------------
CREATE TABLE job (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        text        NOT NULL,
    payload     jsonb       NOT NULL,
    status      text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    attempts    integer     NOT NULL DEFAULT 0,
    max_attempts integer    NOT NULL DEFAULT 5,
    run_after   timestamptz NOT NULL DEFAULT now(),
    locked_by   text,
    locked_at   timestamptz,
    last_error  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX job_ready_idx ON job (kind, run_after) WHERE status = 'queued';
CREATE INDEX job_running_idx ON job (locked_at) WHERE status = 'running';
