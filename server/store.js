import { transaction } from './db.js';

/** Thin data-access layer over the SQLite database. */
export function createStore(db) {
  const q = {
    insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
    userByName: db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?'),
    userById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),

    insertAuthSession: db.prepare(
      'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ),
    authSession: db.prepare(`
      SELECT u.id, u.username, s.expires_at FROM auth_sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`),
    deleteAuthSession: db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?'),
    purgeAuthSessions: db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?'),

    characters: db.prepare('SELECT id, hanzi, pinyin, meaning, ord FROM characters ORDER BY ord'),
    character: db.prepare('SELECT id, hanzi, pinyin, meaning, ord FROM characters WHERE id = ?'),

    progressForUser: db.prepare('SELECT * FROM progress WHERE user_id = ?'),
    progressOne: db.prepare('SELECT * FROM progress WHERE user_id = ? AND char_id = ?'),
    upsertProgress: db.prepare(`
      INSERT INTO progress (user_id, char_id, box, attempts, correct, incorrect, streak, last_result, last_seen, next_due)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, char_id) DO UPDATE SET
        box = excluded.box, attempts = excluded.attempts, correct = excluded.correct,
        incorrect = excluded.incorrect, streak = excluded.streak, last_result = excluded.last_result,
        last_seen = excluded.last_seen, next_due = excluded.next_due`),

    insertPractice: db.prepare('INSERT INTO practice_sessions (user_id, size, started_at) VALUES (?, ?, ?)'),
    practice: db.prepare('SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?'),
    setCurrentChar: db.prepare('UPDATE practice_sessions SET current_char_id = ? WHERE id = ?'),
    recordPracticeAnswer: db.prepare(`
      UPDATE practice_sessions SET
        answered = answered + 1,
        correct = correct + ?,
        current_char_id = NULL,
        ended_at = CASE WHEN answered + 1 >= size THEN ? ELSE ended_at END
      WHERE id = ?`),
    recentPractices: db.prepare(`
      SELECT id, size, answered, correct, started_at, ended_at FROM practice_sessions
      WHERE user_id = ? AND answered > 0 ORDER BY id DESC LIMIT ?`),

    insertAttempt: db.prepare(`
      INSERT INTO attempts (user_id, char_id, session_id, correct, match_type, heard, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    recentCharIds: db.prepare('SELECT char_id FROM attempts WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
    sessionAttempts: db.prepare(`
      SELECT a.char_id, c.hanzi, c.pinyin, c.meaning, a.correct, a.match_type, a.heard
      FROM attempts a JOIN characters c ON c.id = a.char_id
      WHERE a.session_id = ? ORDER BY a.id`),
  };

  return {
    createUser(username, passwordHash, now) {
      const { lastInsertRowid } = q.insertUser.run(username, passwordHash, now);
      return q.userById.get(lastInsertRowid);
    },
    findUserByName: (username) => q.userByName.get(username),

    createAuthSession(tokenHash, userId, now, expiresAt) {
      q.purgeAuthSessions.run(now);
      q.insertAuthSession.run(tokenHash, userId, now, expiresAt);
    },
    userForToken(tokenHash, now) {
      const row = q.authSession.get(tokenHash);
      if (!row) return null;
      if (row.expires_at <= now) {
        q.deleteAuthSession.run(tokenHash);
        return null;
      }
      return { id: row.id, username: row.username };
    },
    deleteAuthSession: (tokenHash) => q.deleteAuthSession.run(tokenHash),

    characters: () => q.characters.all(),
    character: (id) => q.character.get(id),
    progressForUser: (userId) => q.progressForUser.all(userId),
    progressOne: (userId, charId) => q.progressOne.get(userId, charId),
    recentCharIds: (userId, limit) => q.recentCharIds.all(userId, limit).map((r) => r.char_id),

    createPractice(userId, size, now) {
      const { lastInsertRowid } = q.insertPractice.run(userId, size, now);
      return q.practice.get(lastInsertRowid, userId);
    },
    practice: (id, userId) => q.practice.get(id, userId),
    setCurrentChar: (practiceId, charId) => q.setCurrentChar.run(charId, practiceId),
    recentPractices: (userId, limit = 5) => q.recentPractices.all(userId, limit),
    sessionAttempts: (practiceId) => q.sessionAttempts.all(practiceId),

    /** Persist one answer atomically: progress, attempt log and session counters. */
    recordAnswer({ userId, charId, practiceId, progress: p, result, now }) {
      transaction(db, () => {
        q.upsertProgress.run(
          userId, charId, p.box, p.attempts, p.correct, p.incorrect, p.streak, p.last_result, p.last_seen, p.next_due,
        );
        q.insertAttempt.run(
          userId, charId, practiceId, result.correct ? 1 : 0, result.matchType ?? null, result.heard ?? '', now,
        );
        q.recordPracticeAnswer.run(result.correct ? 1 : 0, now, practiceId);
      });
      return q.practice.get(practiceId, userId);
    },
  };
}
