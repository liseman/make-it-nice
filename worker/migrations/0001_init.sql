-- make it nice — D1 schema
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mode TEXT NOT NULL DEFAULT 'fresh',
  parent_id TEXT,
  seed INTEGER,
  n INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  w TEXT NOT NULL,
  s TEXT NOT NULL,
  history TEXT,
  nice_name TEXT,
  model_version INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  rated_at TEXT,
  duration_ms INTEGER,
  device TEXT,
  lang TEXT,
  ref TEXT,
  share_views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model_version);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  type TEXT NOT NULL,
  session_id TEXT,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS model (
  version INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  json TEXT NOT NULL,
  n_sessions INTEGER NOT NULL DEFAULT 0,
  n_rated INTEGER NOT NULL DEFAULT 0
);
