import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  hashToken,
  newSessionToken,
  parseCookies,
  validateCredentials,
  verifyPassword,
} from './auth.js';
import { checkPronunciation } from './checker.js';
import { MASTERED_BOX, RECENT_WINDOW, applyResult, pickNext } from './scheduler.js';
import { createStore } from './store.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_SIZES = { min: 3, max: 50, default: 10 };

function cardView(character, progress) {
  return {
    id: character.id,
    hanzi: character.hanzi,
    pinyin: character.pinyin,
    meaning: character.meaning,
    isNew: !progress || progress.attempts === 0,
    box: progress?.box ?? 0,
    attempts: progress?.attempts ?? 0,
    correct: progress?.correct ?? 0,
  };
}

function practiceView(s) {
  return { id: s.id, size: s.size, answered: s.answered, correct: s.correct, done: s.answered >= s.size };
}

function progressView(p) {
  return {
    box: p.box,
    attempts: p.attempts,
    correct: p.correct,
    incorrect: p.incorrect,
    streak: p.streak,
    nextDue: p.next_due,
    mastered: p.box >= MASTERED_BOX,
  };
}

export function createApp({ db, now = () => Date.now(), rand = Math.random, secureCookies = false }) {
  const store = createStore(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Run a real hash comparison for unknown users so login timing doesn't reveal usernames.
  const dummyHash = hashPassword('not-a-real-password');

  function startAuthSession(res, userId) {
    const token = newSessionToken();
    const t = now();
    store.createAuthSession(hashToken(token), userId, t, t + SESSION_TTL_MS);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token ? store.userForToken(hashToken(token), now()) : null;
  }

  function requireAuth(req, res, next) {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in.' });
    req.user = user;
    next();
  }

  function loadPractice(req, res) {
    const id = Number(req.params.id);
    const practice = Number.isInteger(id) ? store.practice(id, req.user.id) : null;
    if (!practice) res.status(404).json({ error: 'Practice session not found.' });
    return practice;
  }

  // ---- Auth -------------------------------------------------------------

  app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body ?? {};
    const problem = validateCredentials(username, password);
    if (problem) return res.status(400).json({ error: problem });
    if (store.findUserByName(username)) return res.status(409).json({ error: 'That username is already taken.' });
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = store.createUser(username, passwordHash, now());
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: 'That username is already taken.' });
      throw err;
    }
    startAuthSession(res, user.id);
    res.status(201).json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Enter your username and password.' });
    }
    const user = store.findUserByName(username);
    const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash);
    if (!user || !ok) return res.status(401).json({ error: 'Incorrect username or password.' });
    startAuthSession(res, user.id);
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) store.deleteAuthSession(hashToken(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: currentUser(req) });
  });

  // ---- Progress -----------------------------------------------------------

  app.get('/api/stats', requireAuth, (req, res) => {
    const t = now();
    const characters = store.characters();
    const progress = new Map(store.progressForUser(req.user.id).map((p) => [p.char_id, p]));
    const totals = { characters: characters.length, seen: 0, mastered: 0, learning: 0, due: 0, attempts: 0, correct: 0 };
    const list = characters.map((c) => {
      const p = progress.get(c.id);
      if (p && p.attempts > 0) {
        totals.seen += 1;
        totals.attempts += p.attempts;
        totals.correct += p.correct;
        if (p.box >= MASTERED_BOX) totals.mastered += 1;
        else totals.learning += 1;
        if (p.next_due <= t) totals.due += 1;
      }
      return {
        ...cardView(c, p),
        incorrect: p?.incorrect ?? 0,
        lastSeen: p?.last_seen ?? null,
        nextDue: p?.next_due ?? null,
      };
    });
    totals.accuracy = totals.attempts ? totals.correct / totals.attempts : null;
    res.json({ totals, characters: list, recentSessions: store.recentPractices(req.user.id) });
  });

  // ---- Practice sessions ----------------------------------------------------

  app.post('/api/sessions', requireAuth, (req, res) => {
    const requested = Number(req.body?.size ?? SESSION_SIZES.default);
    const size = Number.isFinite(requested)
      ? Math.min(SESSION_SIZES.max, Math.max(SESSION_SIZES.min, Math.round(requested)))
      : SESSION_SIZES.default;
    const practice = store.createPractice(req.user.id, size, now());
    res.status(201).json({ session: practiceView(practice) });
  });

  app.get('/api/sessions/:id/next', requireAuth, (req, res) => {
    const practice = loadPractice(req, res);
    if (!practice) return;
    if (practice.answered >= practice.size) {
      return res.json({ done: true, session: practiceView(practice), summary: store.sessionAttempts(practice.id) });
    }
    let character = practice.current_char_id ? store.character(practice.current_char_id) : null;
    if (!character) {
      character = pickNext({
        characters: store.characters(),
        progress: store.progressForUser(req.user.id),
        recentIds: store.recentCharIds(req.user.id, RECENT_WINDOW),
        now: now(),
        rand,
      });
      if (!character) return res.status(500).json({ error: 'No characters available.' });
      store.setCurrentChar(practice.id, character.id);
    }
    res.json({
      done: false,
      session: practiceView(practice),
      card: cardView(character, store.progressOne(req.user.id, character.id)),
    });
  });

  app.post('/api/sessions/:id/answer', requireAuth, (req, res) => {
    const practice = loadPractice(req, res);
    if (!practice) return;
    const { charId, transcripts, ignoreTones, skipped } = req.body ?? {};
    if (practice.answered >= practice.size) return res.status(409).json({ error: 'This session is already finished.' });
    if (!practice.current_char_id || Number(charId) !== practice.current_char_id) {
      return res.status(409).json({ error: 'That card is not the current card.' });
    }
    const candidates = Array.isArray(transcripts) ? transcripts.filter((t) => typeof t === 'string') : [];
    if (!skipped && !candidates.some((t) => t.trim())) {
      return res.status(400).json({ error: 'No answer was provided.' });
    }

    const character = store.character(practice.current_char_id);
    const result = skipped
      ? { correct: false, matchType: 'skipped', heard: '', heardPinyin: '', reason: 'skipped' }
      : checkPronunciation(character, candidates, { ignoreTones: Boolean(ignoreTones) });
    const t = now();
    const progress = applyResult(store.progressOne(req.user.id, character.id), result.correct, t);
    const updated = store.recordAnswer({
      userId: req.user.id,
      charId: character.id,
      practiceId: practice.id,
      progress,
      result,
      now: t,
    });
    res.json({
      result: { ...result, expected: { hanzi: character.hanzi, pinyin: character.pinyin, meaning: character.meaning } },
      progress: progressView(progress),
      session: practiceView(updated),
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(express.static(PUBLIC_DIR));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
