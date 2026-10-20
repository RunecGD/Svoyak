CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 invite TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0,
 data TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_owner_created ON rooms(owner, created_at DESC);
