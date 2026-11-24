import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

let server;
let baseUrl;

before(async () => {
  const app = createApp({ db: openDatabase(':memory:'), rand: () => 0.99 });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

/** Minimal cookie-aware client. */
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      cookie = pair.endsWith('=') ? '' : pair;
    }
    return { status: res.status, body: await res.json() };
  };
}

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    assert.match(hash, /^scrypt\$/);
    assert.equal(await verifyPassword('correct horse', hash), true);
    assert.equal(await verifyPassword('wrong horse', hash), false);
    assert.equal(await verifyPassword('anything', 'garbage'), false);
  });
});

describe('auth API', () => {
  it('registers, logs out and logs back in', async () => {
    const call = client();
    const reg = await call('POST', '/api/auth/register', { username: 'mei', password: 'secret123' });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.user.username, 'mei');
    assert.equal((await call('GET', '/api/auth/me')).body.user.username, 'mei');

    await call('POST', '/api/auth/logout');
    assert.equal((await call('GET', '/api/auth/me')).body.user, null);
    assert.equal((await call('GET', '/api/stats')).status, 401);

    assert.equal((await call('POST', '/api/auth/login', { username: 'mei', password: 'nope-nope' })).status, 401);
    const login = await call('POST', '/api/auth/login', { username: 'MEI', password: 'secret123' });
    assert.equal(login.status, 200);
    assert.equal((await call('GET', '/api/stats')).status, 200);
  });

  it('rejects duplicate and invalid registrations', async () => {
    const call = client();
    assert.equal((await call('POST', '/api/auth/register', { username: 'dup', password: 'secret123' })).status, 201);
    assert.equal((await call('POST', '/api/auth/register', { username: 'DUP', password: 'secret123' })).status, 409);
    assert.equal((await call('POST', '/api/auth/register', { username: 'x', password: 'secret123' })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { username: 'okname', password: '123' })).status, 400);
    assert.equal((await call('POST', '/api/auth/login', { username: 'ghost', password: 'secret123' })).status, 401);
  });

  it('keeps progress separate per user', async () => {
    const a = client();
    const b = client();
    await a('POST', '/api/auth/register', { username: 'alice', password: 'secret123' });
    await b('POST', '/api/auth/register', { username: 'bob', password: 'secret123' });
    const { body } = await a('POST', '/api/sessions', { size: 3 });
    assert.equal((await b('GET', `/api/sessions/${body.session.id}/next`)).status, 404);
  });
});

describe('practice session API', () => {
  it('serves cards, checks answers, records progress and finishes', async () => {
    const call = client();
    await call('POST', '/api/auth/register', { username: 'learner', password: 'secret123' });
    const { body: start } = await call('POST', '/api/sessions', { size: 3 });
    const id = start.session.id;
    assert.equal(start.session.size, 3);

    // 1st card: answer correctly by saying the character.
    const first = (await call('GET', `/api/sessions/${id}/next`)).body;
    assert.equal(first.done, false);
    assert.equal(first.card.isNew, true);
    const again = (await call('GET', `/api/sessions/${id}/next`)).body;
    assert.equal(again.card.id, first.card.id, 'unanswered card is served again');

    const right = await call('POST', `/api/sessions/${id}/answer`, {
      charId: first.card.id,
      transcripts: [first.card.hanzi],
    });
    assert.equal(right.status, 200);
    assert.equal(right.body.result.correct, true);
    assert.equal(right.body.progress.box, 1);
    assert.equal(right.body.session.answered, 1);

    // Answering a card that isn't current is rejected.
    assert.equal((await call('POST', `/api/sessions/${id}/answer`, { charId: first.card.id, transcripts: ['x'] })).status, 409);

    // 2nd card: wrong answer.
    const second = (await call('GET', `/api/sessions/${id}/next`)).body;
    assert.notEqual(second.card.id, first.card.id);
    const wrong = await call('POST', `/api/sessions/${id}/answer`, { charId: second.card.id, transcripts: ['猫'] });
    assert.equal(wrong.body.result.correct, false);
    assert.equal(wrong.body.result.expected.hanzi, second.card.hanzi);

    // 3rd card: skipped.
    const third = (await call('GET', `/api/sessions/${id}/next`)).body;
    const skip = await call('POST', `/api/sessions/${id}/answer`, { charId: third.card.id, skipped: true });
    assert.equal(skip.body.result.matchType, 'skipped');
    assert.equal(skip.body.session.done, true);

    const done = (await call('GET', `/api/sessions/${id}/next`)).body;
    assert.equal(done.done, true);
    assert.deepEqual(done.summary.map((a) => a.correct), [1, 0, 0]);

    const stats = (await call('GET', '/api/stats')).body;
    assert.equal(stats.totals.seen, 3);
    assert.equal(stats.totals.attempts, 3);
    assert.equal(stats.totals.correct, 1);
    assert.equal(stats.recentSessions[0].correct, 1);
    const seenChar = stats.characters.find((c) => c.id === second.card.id);
    assert.equal(seenChar.incorrect, 1);
  });
});
