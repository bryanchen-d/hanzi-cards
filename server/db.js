import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHARACTERS } from './data/characters.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hanzi TEXT NOT NULL UNIQUE,
  pinyin TEXT NOT NULL,
  meaning TEXT NOT NULL,
  ord INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  box INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  incorrect INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_result INTEGER,
  last_seen INTEGER,
  next_due INTEGER,
  PRIMARY KEY (user_id, char_id)
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size INTEGER NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  current_char_id INTEGER REFERENCES characters(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user ON practice_sessions(user_id, id);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  char_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES practice_sessions(id) ON DELETE SET NULL,
  correct INTEGER NOT NULL,
  match_type TEXT,
  heard TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id, id);
`;

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function seedCharacters(db, list = CHARACTERS) {
  const upsert = db.prepare(`
    INSERT INTO characters (hanzi, pinyin, meaning, ord) VALUES (?, ?, ?, ?)
    ON CONFLICT(hanzi) DO UPDATE SET pinyin = excluded.pinyin, meaning = excluded.meaning, ord = excluded.ord`);
  transaction(db, () => list.forEach(([hanzi, pinyin, meaning], i) => upsert.run(hanzi, pinyin, meaning, i + 1)));
}

/** Open (or create) the database, apply the schema and seed the character deck. */
export function openDatabase(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seedCharacters(db);
  return db;
}
