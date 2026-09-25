-- Exact-title candidate lookup for forwards/reposts of short posts (see runner._dedup).
CREATE INDEX IF NOT EXISTS article_title_md5_idx ON article (md5(lower(title)), published_at);
