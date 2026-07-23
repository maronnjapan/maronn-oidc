CREATE TABLE IF NOT EXISTS oidc_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS oidc_store_expires_at_idx
  ON oidc_store (expires_at);
