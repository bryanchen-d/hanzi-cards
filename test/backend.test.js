import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DECK, createBackend, createMemoryStorage, hashPassword, verifyPassword } from '../public/js/lib/backend.js';
import { parseSyllable } from '../public/js/lib/pinyin.js';

const backend = (storage = createMemoryStorage()) => createBackend({ storage, rand: () => 0.99 });

async function rejects(promise, status) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message);
    return true;
  });
}

describe('deck', () => {
  it('has 3000 unique characters, the curated starter deck first, each with readings and a meaning', () => {
    assert.equal(DECK.length, 3000);
    assert.equal(new Set(DECK.map((c) => c.id)).size, 3000);
    const starter = readFileSync(new URL('../scripts/data/starter.tsv', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('\t')[0]);
    assert.deepEqual(DECK.slice(0, starter.length).map((c) => c.hanzi), starter);
    for (const c of DECK) {
      assert.ok(c.meaning, `${c.hanzi} has a meaning`);
      assert.equal(c.readings[0], c.pinyin);
      for (const r of c.readings) assert.ok(parseSyllable(r, { bareIsNeutral: true }), `${c.hanzi}: ${r} parses`);
    }
  });

  it('keeps progress saved by earlier versions (keyed by character)', async () => {
    const storage = createMemoryStorage();
    const api = backend(storage);
    const { user } = await api.register('returning', 'secret123');
    const old = { box: 3, attempts: 4, correct: 3, incorrect: 1, streak: 2, last_result: 1, last_seen: 1, next_due: Date.now() + 1e9 };
    storage.setItem(`hanzi-cards:v1:data:${user.id}`, JSON.stringify({ progress: { 杯: old }, sessions: [], attempts: [], nextSessionId: 1 }));
    const cup = (await api.stats()).characters.find((c) => c.hanzi === '杯');
    assert.deepEqual([cup.attempts, cup.box], [4, 3]);
  });
});

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    assert.match(hash, /^pbkdf2-sha256\$210000\$/);
    assert.equal(await verifyPassword('correct horse', hash), true);
    assert.equal(await verifyPassword('wrong horse', hash), false);
    assert.equal(await verifyPassword('anything', 'garbage'), false);
  });
});

describe('accounts', () => {
  it('registers, logs out and logs back in; the password is never stored in plain text', async () => {
    const storage = createMemoryStorage();
    const api = backend(storage);
    assert.equal((await api.register('mei', 'secret123')).user.username, 'mei');
    assert.equal((await api.me()).user.username, 'mei');
    assert.doesNotMatch(storage.getItem('hanzi-cards:v1:users'), /secret123/);

    await api.logout();
    assert.equal((await api.me()).user, null);
    await rejects(api.stats(), 401);
    await rejects(api.login('mei', 'nope-nope'), 401);
    await rejects(api.login('ghost', 'secret123'), 401);
    assert.equal((await api.login('MEI', 'secret123')).user.username, 'mei');
  });

  it('rejects duplicate and invalid registrations', async () => {
    const api = backend();
    await api.register('dup', 'secret123');
    await rejects(api.register('DUP', 'secret123'), 409);
    await rejects(api.register('x', 'secret123'), 400);
    await rejects(api.register('okname', '123'), 400);
  });

  it('keeps progress separate per user and survives a reload', async () => {
    const storage = createMemoryStorage();
    const api = backend(storage);
    await api.register('alice', 'secret123');
    const { session } = await api.startSession(3);
    const { card } = await api.next(session.id);
    await api.answer(session.id, { charId: card.id, transcripts: [card.hanzi] });

    await api.logout();
    await api.register('bob', 'secret123');
    await rejects(api.next(session.id), 404);
    assert.equal((await api.stats()).totals.attempts, 0);

    // A fresh backend over the same storage = reopening the page.
    await api.login('alice', 'secret123');
    const reopened = backend(storage);
    assert.equal((await reopened.me()).user.username, 'alice');
    assert.equal((await reopened.stats()).totals.correct, 1);
  });
});

describe('practice sessions', () => {
  it('serves cards, checks answers, records progress and finishes', async () => {
    const api = backend();
    await api.register('learner', 'secret123');
    const { session } = await api.startSession(3);
    assert.equal(session.size, 3);

    const first = await api.next(session.id);
    assert.equal(first.card.isNew, true);
    assert.equal((await api.next(session.id)).card.id, first.card.id, 'unanswered card is served again');

    const right = await api.answer(session.id, { charId: first.card.id, transcripts: [first.card.hanzi] });
    assert.equal(right.result.correct, true);
    assert.equal(right.progress.box, 1);
    assert.equal(right.session.answered, 1);
    await rejects(api.answer(session.id, { charId: first.card.id, transcripts: ['x'] }), 409);

    const second = await api.next(session.id);
    assert.notEqual(second.card.id, first.card.id);
    const wrong = await api.answer(session.id, { charId: second.card.id, transcripts: ['猫'] });
    assert.equal(wrong.result.correct, false);
    assert.equal(wrong.result.expected.hanzi, second.card.hanzi);

    const third = await api.next(session.id);
    const skip = await api.answer(session.id, { charId: third.card.id, skipped: true });
    assert.equal(skip.result.matchType, 'skipped');
    assert.equal(skip.session.done, true);

    const done = await api.next(session.id);
    assert.equal(done.done, true);
    assert.deepEqual(done.summary.map((a) => a.correct), [true, false, false]);
    assert.equal(done.summary[0].hanzi, first.card.hanzi);

    const stats = await api.stats();
    assert.deepEqual([stats.totals.seen, stats.totals.attempts, stats.totals.correct], [3, 3, 1]);
    assert.equal(stats.recentSessions[0].correct, 1);
    assert.equal(stats.characters.find((c) => c.id === second.card.id).incorrect, 1);
  });

  it('live-checks without recording, and records a timeout as wrong', async () => {
    const api = backend();
    await api.register('listener', 'secret123');
    const { session } = await api.startSession(3);
    const { card } = await api.next(session.id);

    assert.deepEqual(await api.check(session.id, { charId: card.id, transcripts: ['猫'] }), { correct: false, matchType: null });
    assert.equal((await api.check(session.id, { charId: card.id, transcripts: [`嗯${card.hanzi}`] })).correct, true);
    assert.equal((await api.stats()).totals.attempts, 0, 'checks are not recorded');
    assert.equal((await api.next(session.id)).card.id, card.id, 'card stays current');

    const silent = await api.answer(session.id, { charId: card.id, timedOut: true, transcripts: [] });
    assert.equal(silent.result.correct, false);
    assert.equal(silent.result.matchType, 'timeout');

    const second = (await api.next(session.id)).card;
    const rambling = await api.answer(session.id, { charId: second.id, timedOut: true, transcripts: ['猫狗'] });
    assert.equal(rambling.result.timedOut, true);
    assert.equal(rambling.result.heard, '猫狗');
    assert.equal((await api.stats()).totals.attempts, 2);
  });
});
