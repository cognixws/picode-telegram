CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE updates (
  epoch INTEGER NOT NULL,
  id INTEGER NOT NULL,
  state TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  receipt TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (epoch, id)
);
CREATE TABLE deliveries (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  state TEXT NOT NULL,
  telegram_id INTEGER,
  changed_at INTEGER NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0
  ,revision TEXT NOT NULL DEFAULT ''
);
CREATE TABLE buttons (
  handle TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  choice INTEGER NOT NULL,
  choice_hash TEXT NOT NULL DEFAULT '',
  telegram_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX deliveries_state ON deliveries(state, retry_at);
CREATE INDEX buttons_item ON buttons(item_id);
