-- Every foreign key needs an index on the referencing column, or deleting a parent row scans the child table.
-- Found by the load test: deleting 1M events took >10 min because event.merged_into (self-reference) was unindexed.
CREATE INDEX IF NOT EXISTS event_merged_into_idx ON event (merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_relation_related_idx ON event_relation (related_event_id);
CREATE INDEX IF NOT EXISTS article_duplicate_of_idx ON article (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS article_raw_item_idx ON article (raw_item_id);
CREATE INDEX IF NOT EXISTS article_source_idx ON article (source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS raw_item_source_idx ON raw_item (source_id, id DESC);
CREATE INDEX IF NOT EXISTS event_geo_entity_fk_idx ON event (geo_entity_id);
CREATE INDEX IF NOT EXISTS article_location_geo_idx ON article_location (geo_entity_id);
CREATE INDEX IF NOT EXISTS source_home_idx ON source (home_geo_entity_id);
