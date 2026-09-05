PRAGMA foreign_keys = ON;
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  parent_id TEXT REFERENCES comments(id),
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  source_id TEXT UNIQUE,
  request_id TEXT UNIQUE,
  request_hash TEXT,
  moderated_at TEXT
);
CREATE INDEX comments_article_page ON comments(article_id, status, created_at, id);
CREATE INDEX comments_admin_page ON comments(created_at, id);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE oauth_states (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
