import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOX_INTERVALS, MAX_LEARNING, MINUTE, applyResult, pickNext } from '../public/js/lib/scheduler.js';

const NOW = 1_000_000_000;
const deck = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, hanzi: String(i + 1) }));

function row(charId, fields) {
  return { char_id: charId, box: 1, attempts: 1, correct: 1, incorrect: 0, streak: 1, last_seen: NOW - MINUTE, next_due: NOW + MINUTE, ...fields };
}

describe('applyResult', () => {
  it('promotes a card one box on a correct answer', () => {
    const first = applyResult(null, true, NOW);
    assert.equal(first.box, 1);
    assert.equal(first.next_due, NOW + BOX_INTERVALS[1]);
    const second = applyResult(first, true, NOW + MINUTE);
    assert.equal(second.box, 2);
    assert.equal(second.next_due, NOW + MINUTE + BOX_INTERVALS[2]);
    assert.deepEqual([second.attempts, second.correct, second.streak], [2, 2, 2]);
  });

  it('sends a missed card back to box 1, due again immediately', () => {
    const prev = row(1, { box: 5, attempts: 6, correct: 6, streak: 6 });
    const next = applyResult(prev, false, NOW);
    assert.equal(next.box, 1);
    assert.equal(next.next_due, NOW);
    assert.deepEqual([next.attempts, next.incorrect, next.streak], [7, 1, 0]);
    assert.equal(prev.box, 5, 'input is not mutated');
  });
});

describe('pickNext', () => {
  it('starts a new learner on the first character', () => {
    assert.equal(pickNext({ characters: deck, progress: [], now: NOW }).id, 1);
  });

  it('prefers due reviews, weakest first', () => {
    const progress = [
      row(1, { box: 3, next_due: NOW - 1 }),
      row(2, { box: 1, attempts: 4, correct: 1, incorrect: 3, next_due: NOW - 1 }),
      row(3, { box: 1, attempts: 4, correct: 3, incorrect: 1, next_due: NOW - 1 }),
    ];
    const seq = (...values) => () => values.shift();
    // First roll skips introducing a new card, second picks the top-priority due card.
    assert.equal(pickNext({ characters: deck, progress, now: NOW, rand: seq(0.99, 0) }).id, 2);
    assert.equal(pickNext({ characters: deck, progress, now: NOW, rand: seq(0.99, 0.5) }).id, 3);
  });

  it('mixes in new characters while reviews are due', () => {
    const progress = [row(1, { next_due: NOW - 1 })];
    assert.equal(pickNext({ characters: deck, progress, now: NOW, rand: () => 0 }).id, 2);
  });

  it('holds back new characters when too many are being learned', () => {
    const progress = Array.from({ length: MAX_LEARNING }, (_, i) => row(i + 1, { next_due: NOW + (i + 1) * MINUTE }));
    const pick = pickNext({ characters: deck, progress, now: NOW, rand: () => 0 });
    assert.equal(pick.id, 1, 'reviews the soonest-due card ahead of schedule');
  });

  it('avoids characters shown in the last few turns', () => {
    const progress = [row(1, { box: 1, next_due: NOW - 1 }), row(2, { box: 1, next_due: NOW - 1 })];
    const pick = pickNext({ characters: deck, progress, recentIds: [1], now: NOW, rand: () => 0.99 });
    assert.equal(pick.id, 2);
    assert.equal(pickNext({ characters: deck.slice(0, 1), progress: [], recentIds: [1], now: NOW }).id, 1);
  });
});
