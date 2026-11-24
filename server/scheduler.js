// Leitner-style spaced repetition for character cards.

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

// Review interval after landing in each box (index = box). Box 0 = never seen.
export const BOX_INTERVALS = [0, MINUTE, 10 * MINUTE, DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];
export const MAX_BOX = BOX_INTERVALS.length - 1;
export const MASTERED_BOX = 5;
// A missed card goes back to box 1 and is due again right away; the recency
// window keeps it from being shown twice in a row.
export const RELEARN_DELAY = 0;
// Hold back new characters while this many cards are freshly learned or lapsed.
export const MAX_LEARNING = 4;
// When reviews are due, chance of mixing in a new character instead.
export const NEW_CARD_CHANCE = 0.3;
export const RECENT_WINDOW = 3;

export function emptyProgress() {
  return { box: 0, attempts: 0, correct: 0, incorrect: 0, streak: 0, last_result: null, last_seen: null, next_due: null };
}

/** Return the updated progress record after one answer. Does not mutate `prev`. */
export function applyResult(prev, correct, now) {
  const p = { ...emptyProgress(), ...(prev ?? {}) };
  p.attempts += 1;
  if (correct) {
    p.correct += 1;
    p.streak += 1;
    p.box = Math.min(MAX_BOX, p.box + 1);
    p.next_due = now + BOX_INTERVALS[p.box];
  } else {
    p.incorrect += 1;
    p.streak = 0;
    p.box = 1;
    p.next_due = now + RELEARN_DELAY;
  }
  p.last_result = correct ? 1 : 0;
  p.last_seen = now;
  return p;
}

export function errorRate(p) {
  return (p.incorrect + 1) / (p.attempts + 2);
}

// Weakest first: lower box, then higher (smoothed) error rate, then most overdue.
function byPriority(a, b) {
  return a.box - b.box || errorRate(b) - errorRate(a) || a.next_due - b.next_due;
}

/**
 * Choose the next character to show.
 *
 * @param {object} opts
 * @param {Array<{id:number}>} opts.characters  all characters, in teaching order
 * @param {Array<object>} opts.progress          the user's progress rows ({char_id, box, attempts, ...})
 * @param {number[]} [opts.recentIds]            characters shown most recently (avoid repeats)
 * @param {number} opts.now
 * @param {() => number} [opts.rand]
 */
export function pickNext({ characters, progress, recentIds = [], now, rand = Math.random }) {
  if (!characters.length) return null;
  const charById = new Map(characters.map((c) => [c.id, c]));
  const recent = new Set(recentIds);
  const seen = progress.filter((p) => p.attempts > 0 && charById.has(p.char_id));
  const seenIds = new Set(seen.map((p) => p.char_id));
  const fresh = characters.filter((c) => !seenIds.has(c.id) && !recent.has(c.id));
  const learning = seen.filter((p) => p.box <= 1).length;
  const canIntroduce = fresh.length > 0 && learning < MAX_LEARNING;

  const due = seen.filter((p) => p.next_due <= now && !recent.has(p.char_id)).sort(byPriority);
  if (due.length) {
    if (canIntroduce && rand() < NEW_CARD_CHANCE) return fresh[0];
    const top = due.slice(0, 3);
    return charById.get(top[Math.floor(rand() * top.length)].char_id);
  }
  if (canIntroduce) return fresh[0];

  // Nothing due: review ahead, soonest-due first.
  const ahead = seen
    .filter((p) => !recent.has(p.char_id))
    .sort((a, b) => a.next_due - b.next_due || byPriority(a, b));
  if (ahead.length) return charById.get(ahead[0].char_id);
  if (fresh.length) return fresh[0];

  // Tiny deck where everything was shown recently: least recently seen wins.
  const oldest = [...seen].sort((a, b) => (a.last_seen ?? 0) - (b.last_seen ?? 0))[0];
  return oldest ? charById.get(oldest.char_id) : characters[0];
}
