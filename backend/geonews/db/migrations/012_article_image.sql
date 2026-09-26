-- Preview picture the publisher attached to an article (feed enclosure, og:image, Telegram post photo).
-- Only the link is stored: the reader's browser loads the picture from the publisher.
ALTER TABLE article ADD COLUMN IF NOT EXISTS image_url text;
