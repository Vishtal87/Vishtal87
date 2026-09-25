-- Keep the original publication time of superseded versions (timeline shows first report AND the update).
ALTER TABLE article_version ADD COLUMN IF NOT EXISTS published_at timestamptz;
