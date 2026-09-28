CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX projects_owner ON projects (owner_id, created_at);
