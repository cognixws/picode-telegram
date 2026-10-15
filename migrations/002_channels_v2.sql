-- Independent from retryable V1 notices: these keys never become sendable again.
CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('dispatching','sent','refused','uncertain')),
  telegram_id INTEGER,
  changed_at INTEGER NOT NULL
);
CREATE TABLE targets (
  handle TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('agent','assistant')),
  id TEXT NOT NULL,
  generation TEXT NOT NULL,
  revision INTEGER NOT NULL,
  picker INTEGER NOT NULL,
  telegram_id INTEGER,
  created_at INTEGER NOT NULL
);
