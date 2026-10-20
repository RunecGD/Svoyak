CREATE TABLE question_images (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 content_type TEXT NOT NULL,
 bytes BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
 CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
);
CREATE INDEX question_images_owner ON question_images(owner);
