// Browser-local "backend": accounts, progress and practice sessions are stored
// in Web Storage (localStorage) on this device. It exposes the same async API
// the UI used to call over HTTP, so errors carry an HTTP-like `status`.
import { checkPronunciation } from './checker.js';
import { CHARACTERS } from './characters.js';
import { MASTERED_BOX, RECENT_WINDOW, applyResult, pickNext } from './scheduler.js';

const PREFIX = 'hanzi-cards:v1:';
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const PBKDF2_ITERATIONS = 210000;
const MAX_ATTEMPTS = 5000;
const MAX_SESSIONS = 200;
const SESSION_SIZES = { min: 3, max: 50, default: 10 };

export const DECK = CHARACTERS.map((c, i) => ({ id: c.hanzi, ...c, ord: i + 1 }));
const charById = new Map(DECK.map((c) => [c.id, c]));

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Minimal in-memory Storage, used for tests and when localStorage is unavailable. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** Returns window.localStorage if it works, otherwise null. */
export function browserStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = `${PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Returns an error message, or null when the credentials are acceptable. */
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.';
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return 'Password must be 6–128 characters.';
  }
  return null;
}

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new ApiError(500, 'Open this page over HTTPS (or localhost) so the browser can secure your password.');
  return s;
}

export async function hashPassword(password, { salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PBKDF2_ITERATIONS } = {}) {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return ['pbkdf2-sha256', iterations, toB64(salt), toB64(new Uint8Array(bits))].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const candidate = await hashPassword(password, { salt: fromB64(parts[2]), iterations: Number(parts[1]) });
  let diff = candidate.length ^ stored.length;
  for (let i = 0; i < Math.min(candidate.length, stored.length); i++) diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

function cardView(character, progress) {
  return {
    id: character.id,
    hanzi: character.hanzi,
    pinyin: character.pinyin,
    readings: character.readings,
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

function candidatesFrom(payload) {
  return Array.isArray(payload?.transcripts) ? payload.transcripts.filter((t) => typeof t === 'string' && t.trim()) : [];
}

export function createBackend({ storage = createMemoryStorage(), now = () => Date.now(), rand = Math.random } = {}) {
  const keys = {
    users: `${PREFIX}users`,
    current: `${PREFIX}currentUser`,
    data: (userId) => `${PREFIX}data:${userId}`,
  };

  function read(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      throw new ApiError(507, 'Could not save: browser storage is full or disabled.');
    }
  }

  const users = () => read(keys.users, {});

  function currentUser() {
    const id = storage.getItem(keys.current);
    const user = id ? Object.values(users()).find((u) => u.id === id) : null;
    return user ? { id: user.id, username: user.username } : null;
  }

  function requireUser() {
    const user = currentUser();
    if (!user) throw new ApiError(401, 'Please log in.');
    return user;
  }

  // All of a user's data lives in one JSON document; every call reads it fresh,
  // so several open tabs stay consistent.
  function load(userId) {
    return read(keys.data(userId), null) ?? { progress: {}, sessions: [], attempts: [], nextSessionId: 1 };
  }

  const save = (userId, data) => write(keys.data(userId), data);

  function findPractice(data, id) {
    const practice = data.sessions.find((s) => s.id === Number(id));
    if (!practice) throw new ApiError(404, 'Practice session not found.');
    return practice;
  }

  // The session must be open and charId must be its current card.
  function currentCard(data, id, charId) {
    const practice = findPractice(data, id);
    if (practice.answered >= practice.size) throw new ApiError(409, 'This session is already finished.');
    if (!practice.current_char_id || charId !== practice.current_char_id) {
      throw new ApiError(409, 'That card is not the current card.');
    }
    return { practice, character: charById.get(practice.current_char_id) };
  }

  const progressRows = (data) => Object.entries(data.progress).map(([charId, p]) => ({ ...p, char_id: charId }));

  return {
    async me() {
      return { user: currentUser() };
    },

    async register(username, password) {
      const problem = validateCredentials(username, password);
      if (problem) throw new ApiError(400, problem);
      const key = username.toLowerCase();
      if (users()[key]) throw new ApiError(409, 'That username is already taken on this device.');
      const passwordHash = await hashPassword(password);
      const all = users();
      if (all[key]) throw new ApiError(409, 'That username is already taken on this device.');
      const user = { id: crypto.randomUUID(), username, passwordHash, createdAt: now() };
      all[key] = user;
      write(keys.users, all);
      storage.setItem(keys.current, user.id);
      return { user: { id: user.id, username } };
    },

    async login(username, password) {
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        throw new ApiError(400, 'Enter your username and password.');
      }
      const user = users()[username.toLowerCase()];
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw new ApiError(401, 'Incorrect username or password.');
      }
      storage.setItem(keys.current, user.id);
      return { user: { id: user.id, username: user.username } };
    },

    async logout() {
      storage.removeItem(keys.current);
      return { ok: true };
    },

    async stats() {
      const user = requireUser();
      const data = load(user.id);
      const t = now();
      const totals = { characters: DECK.length, seen: 0, mastered: 0, learning: 0, due: 0, attempts: 0, correct: 0 };
      const characters = DECK.map((c) => {
        const p = data.progress[c.id];
        if (p && p.attempts > 0) {
          totals.seen += 1;
          totals.attempts += p.attempts;
          totals.correct += p.correct;
          if (p.box >= MASTERED_BOX) totals.mastered += 1;
          else totals.learning += 1;
          if (p.next_due <= t) totals.due += 1;
        }
        return { ...cardView(c, p), incorrect: p?.incorrect ?? 0, lastSeen: p?.last_seen ?? null, nextDue: p?.next_due ?? null };
      });
      totals.accuracy = totals.attempts ? totals.correct / totals.attempts : null;
      const recentSessions = data.sessions
        .filter((s) => s.answered > 0)
        .slice(-5)
        .reverse()
        .map(({ id, size, answered, correct, started_at, ended_at }) => ({ id, size, answered, correct, started_at, ended_at }));
      return { totals, characters, recentSessions };
    },

    async startSession(requestedSize) {
      const user = requireUser();
      const data = load(user.id);
      const requested = Number(requestedSize ?? SESSION_SIZES.default);
      const size = Number.isFinite(requested)
        ? Math.min(SESSION_SIZES.max, Math.max(SESSION_SIZES.min, Math.round(requested)))
        : SESSION_SIZES.default;
      const practice = { id: data.nextSessionId++, size, answered: 0, correct: 0, current_char_id: null, started_at: now(), ended_at: null };
      data.sessions = [...data.sessions, practice].slice(-MAX_SESSIONS);
      save(user.id, data);
      return { session: practiceView(practice) };
    },

    async next(id) {
      const user = requireUser();
      const data = load(user.id);
      const practice = findPractice(data, id);
      if (practice.answered >= practice.size) {
        const summary = data.attempts
          .filter((a) => a.session_id === practice.id)
          .map((a) => ({ ...charById.get(a.char_id), char_id: a.char_id, correct: a.correct, match_type: a.match_type, heard: a.heard }));
        return { done: true, session: practiceView(practice), summary };
      }
      let character = practice.current_char_id ? charById.get(practice.current_char_id) : null;
      if (!character) {
        character = pickNext({
          characters: DECK,
          progress: progressRows(data),
          recentIds: data.attempts.slice(-RECENT_WINDOW).map((a) => a.char_id).reverse(),
          now: now(),
          rand,
        });
        practice.current_char_id = character.id;
        save(user.id, data);
      }
      return { done: false, session: practiceView(practice), card: cardView(character, data.progress[character.id]) };
    },

    /** Live check while the learner is still speaking: nothing is recorded. */
    async check(id, payload = {}) {
      const user = requireUser();
      const { character } = currentCard(load(user.id), id, payload.charId);
      const result = checkPronunciation(character, candidatesFrom(payload), { ignoreTones: Boolean(payload.ignoreTones) });
      return { correct: result.correct, matchType: result.matchType };
    },

    async answer(id, payload = {}) {
      const user = requireUser();
      const data = load(user.id);
      const { practice, character } = currentCard(data, id, payload.charId);
      const candidates = candidatesFrom(payload);
      if (!payload.skipped && !payload.timedOut && candidates.length === 0) {
        throw new ApiError(400, 'No answer was provided.');
      }

      let result;
      if (payload.skipped) {
        result = { correct: false, matchType: 'skipped', heard: '', heardPinyin: '', reason: 'skipped' };
      } else if (candidates.length === 0) {
        result = { correct: false, matchType: 'timeout', heard: '', heardPinyin: '', reason: 'timeout' };
      } else {
        result = checkPronunciation(character, candidates, { ignoreTones: Boolean(payload.ignoreTones) });
        if (payload.timedOut && !result.correct) result.timedOut = true;
      }

      const t = now();
      const progress = applyResult(data.progress[character.id] ?? null, result.correct, t);
      data.progress[character.id] = progress;
      data.attempts.push({
        char_id: character.id,
        session_id: practice.id,
        correct: result.correct,
        match_type: result.matchType ?? null,
        heard: result.heard ?? '',
        created_at: t,
      });
      if (data.attempts.length > MAX_ATTEMPTS) data.attempts = data.attempts.slice(-MAX_ATTEMPTS);
      practice.answered += 1;
      if (result.correct) practice.correct += 1;
      practice.current_char_id = null;
      if (practice.answered >= practice.size) practice.ended_at = t;
      save(user.id, data);

      return {
        result: {
          ...result,
          expected: { hanzi: character.hanzi, pinyin: character.pinyin, readings: character.readings, meaning: character.meaning },
        },
        progress: progressView(progress),
        session: practiceView(practice),
      };
    },
  };
}
