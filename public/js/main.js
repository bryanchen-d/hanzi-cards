import { api } from './api.js';
import { isFatalSpeechError, listenOnce, recognitionSupported, speechErrorMessage } from './speech.js';
import { hasChineseVoice, speakChinese, ttsSupported } from './tts.js';
import { playComplete, playFail, playPass, unlockAudio } from './sounds.js';

const app = document.getElementById('app');
const MASTERED_BOX = 5;
const MAX_BOX = 7;
const SIZES = [5, 10, 20];

const state = {
  view: 'loading',
  user: null,
  stats: null,
  sessionSize: SIZES.includes(Number(localStorage.getItem('hz.size'))) ? Number(localStorage.getItem('hz.size')) : 10,
  ignoreTones: localStorage.getItem('hz.ignoreTones') === '1',
  practice: null,
  summary: null,
};

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};

const PRAISE = ['Nice!', 'Correct!', 'Great job!', 'Excellent!', '太好了!', 'Well said!'];

function levelLabel(box) {
  if (!box) return 'New';
  if (box >= MASTERED_BOX) return 'Mastered';
  if (box >= 3) return 'Reviewing';
  return 'Learning';
}

function levelClass(c) {
  if (!c.attempts) return 'lvl-new';
  if (c.box >= MASTERED_BOX) return 'lvl-mastered';
  if (c.box >= 3) return 'lvl-review';
  return 'lvl-learning';
}

function levelDots(box) {
  return `<span class="dots" aria-label="Level ${box} of ${MAX_BOX}">${Array.from(
    { length: MAX_BOX },
    (_, i) => `<i class="${i < box ? 'on' : ''}"></i>`,
  ).join('')}</span>`;
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString();
}

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function renderAuth(mode = 'login', { error = '', username = '' } = {}) {
  setView('auth');
  const isLogin = mode === 'login';
  app.innerHTML = `
    <main class="auth">
      <div class="auth-card">
        <div class="auth-logo" lang="zh-CN">汉字</div>
        <h1>Hanzi Cards</h1>
        <p class="muted">Learn Chinese characters by saying them out loud.</p>
        <div class="tabs" role="tablist">
          <button class="tab ${isLogin ? 'on' : ''}" role="tab" aria-selected="${isLogin}" data-action="auth-tab" data-mode="login">Log in</button>
          <button class="tab ${isLogin ? '' : 'on'}" role="tab" aria-selected="${!isLogin}" data-action="auth-tab" data-mode="register">Sign up</button>
        </div>
        <form class="auth-form" data-form="auth" data-mode="${mode}" novalidate>
          <label>Username
            <input name="username" value="${esc(username)}" autocomplete="username" autocapitalize="off" spellcheck="false" required>
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required>
          </label>
          ${isLogin ? '' : '<p class="hint">3–32 letters, numbers, dots, dashes or underscores. Password: at least 6 characters.</p>'}
          <div class="error" role="alert">${esc(error)}</div>
          <button class="btn btn-primary btn-block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
        </form>
      </div>
    </main>`;
  app.querySelector(username ? 'input[name=password]' : 'input[name=username]')?.focus();
}

async function submitAuth(form) {
  const mode = form.dataset.mode;
  const username = form.username.value.trim();
  const password = form.password.value;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const { user } = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
    state.user = user;
    await showHome();
  } catch (err) {
    renderAuth(mode, { error: err.message, username });
  }
}

// ---------------------------------------------------------------------------
// Home / dashboard
// ---------------------------------------------------------------------------

function topbar() {
  return `
    <header class="topbar">
      <div class="brand"><span class="brand-mark" lang="zh-CN">汉</span> Hanzi Cards</div>
      <div class="who">
        <span class="avatar" aria-hidden="true">${esc(state.user.username.slice(0, 1).toUpperCase())}</span>
        <span class="who-name">${esc(state.user.username)}</span>
        <button class="btn btn-ghost btn-small" data-action="logout">Log out</button>
      </div>
    </header>`;
}

function heroText(t) {
  if (!t) return 'Loading your progress…';
  if (t.seen === 0) return 'Start your first session — we’ll introduce characters one at a time.';
  if (t.due > 0) return `${t.due} character${t.due === 1 ? ' is' : 's are'} ready for review.`;
  return 'You’re all caught up! Practice to learn new characters.';
}

async function showHome() {
  setView('home');
  state.practice = null;
  renderHome();
  try {
    state.stats = await api.stats();
  } catch (err) {
    if (err.status === 401) return renderAuth('login');
    state.stats = null;
  }
  if (state.view === 'home') renderHome();
}

function renderHome() {
  const s = state.stats;
  const t = s?.totals;
  const accuracy = t?.accuracy == null ? '—' : `${Math.round(t.accuracy * 100)}%`;
  const voiceWarning = ttsSupported && !hasChineseVoice();
  app.innerHTML = `
    ${topbar()}
    <main class="home">
      <section class="hero">
        <div class="hero-text">
          <h1><span lang="zh-CN">你好</span>, ${esc(state.user.username)}!</h1>
          <p>${heroText(t)}</p>
        </div>
        <div class="hero-actions">
          <div class="chips" role="group" aria-label="Session length">
            ${SIZES.map((n) => `<button class="chip ${state.sessionSize === n ? 'on' : ''}" data-action="size" data-size="${n}">${n} cards</button>`).join('')}
          </div>
          <button class="btn btn-primary btn-big" data-action="start">Start practice</button>
          <label class="toggle">
            <input type="checkbox" data-action="tones" ${state.ignoreTones ? 'checked' : ''}>
            <span>Ignore tones (more forgiving)</span>
          </label>
        </div>
      </section>

      ${recognitionSupported ? '' : `<div class="notice warn">${esc(speechErrorMessage('unsupported'))}</div>`}
      ${voiceWarning ? '<div class="notice warn">No Chinese text-to-speech voice was found, so correct pronunciations may not play. Install a Chinese (zh-CN) voice in your system settings.</div>' : ''}

      <section class="tiles">
        <div class="tile"><b>${t ? t.seen : '—'}<small>/${t ? t.characters : '—'}</small></b><span>Characters seen</span></div>
        <div class="tile"><b>${t ? t.mastered : '—'}</b><span>Mastered</span></div>
        <div class="tile"><b>${accuracy}</b><span>Accuracy</span></div>
        <div class="tile"><b>${t ? t.due : '—'}</b><span>Due for review</span></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Your characters</h2>
          <div class="legend">
            <span><i class="lvl-new"></i>New</span><span><i class="lvl-learning"></i>Learning</span>
            <span><i class="lvl-review"></i>Reviewing</span><span><i class="lvl-mastered"></i>Mastered</span>
          </div>
        </div>
        <div class="char-grid">
          ${(s?.characters ?? [])
            .map((c) => {
              const tip = c.attempts
                ? `${c.pinyin} — ${c.meaning} · ${c.correct}/${c.attempts} correct · ${levelLabel(c.box)}`
                : `${c.pinyin} — ${c.meaning} · not practiced yet`;
              return `<div class="char ${levelClass(c)}" title="${esc(tip)}" lang="zh-CN">${esc(c.hanzi)}</div>`;
            })
            .join('')}
        </div>
      </section>

      <section class="panel">
        <h2>Recent sessions</h2>
        ${
          s?.recentSessions?.length
            ? `<ul class="sessions">${s.recentSessions
                .map(
                  (r) => `<li><span>${timeAgo(r.started_at)}</span><span>${r.correct}/${r.answered} correct</span>
                    <span class="bar"><i style="width:${Math.round((r.correct / Math.max(1, r.answered)) * 100)}%"></i></span>
                    <span class="muted">${r.ended_at ? 'complete' : 'unfinished'}</span></li>`,
                )
                .join('')}</ul>`
            : '<p class="muted">No sessions yet.</p>'
        }
      </section>
    </main>`;
}

// ---------------------------------------------------------------------------
// Practice session
// ---------------------------------------------------------------------------

async function startPractice() {
  unlockAudio();
  try {
    const { session } = await api.startSession(state.sessionSize);
    state.practice = {
      id: session.id,
      size: session.size,
      answered: 0,
      correct: 0,
      card: null,
      phase: 'loading',
      result: null,
      message: '',
      hint: false,
      typing: !recognitionSupported,
      listener: null,
    };
    setView('practice');
    await loadNextCard();
  } catch (err) {
    if (err.status === 401) return renderAuth('login');
    alert(err.message);
  }
}

async function loadNextCard() {
  const p = state.practice;
  p.phase = 'loading';
  p.card = null;
  p.result = null;
  p.message = '';
  p.hint = false;
  renderPractice();
  const data = await api.next(p.id);
  if (state.practice !== p) return;
  if (data.done) {
    state.summary = data;
    renderSummary();
    playComplete();
    return;
  }
  Object.assign(p, { card: data.card, answered: data.session.answered, correct: data.session.correct, phase: 'ready' });
  renderPractice();
}

async function toggleListening() {
  const p = state.practice;
  if (p.phase === 'listening') {
    p.listener?.stop();
    return;
  }
  if (p.phase !== 'ready') return;
  unlockAudio();
  window.speechSynthesis?.cancel();
  p.phase = 'listening';
  p.message = '';
  renderPractice();
  p.listener = listenOnce();
  try {
    const transcripts = await p.listener.promise;
    if (state.practice !== p) return;
    await submitAnswer({ transcripts });
  } catch (err) {
    if (state.practice !== p) return;
    p.phase = 'ready';
    if (err.code !== 'aborted') p.message = err.message;
    if (isFatalSpeechError(err.code)) p.typing = true;
    renderPractice();
  } finally {
    p.listener = null;
  }
}

async function submitAnswer(payload) {
  const p = state.practice;
  const card = p.card;
  p.phase = 'checking';
  renderPractice();
  let data;
  try {
    data = await api.answer(p.id, { charId: card.id, ignoreTones: state.ignoreTones, ...payload });
  } catch (err) {
    p.phase = 'ready';
    p.message = err.message;
    renderPractice();
    return;
  }
  if (state.practice !== p) return;
  Object.assign(p, {
    phase: 'feedback',
    result: data.result,
    progress: data.progress,
    answered: data.session.answered,
    correct: data.session.correct,
    praise: PRAISE[Math.floor(Math.random() * PRAISE.length)],
  });
  renderPractice();
  if (data.result.correct) {
    await playPass();
  } else {
    await playFail();
    if (state.practice === p) await speakChinese(card.hanzi);
  }
}

function micBlock(p) {
  if (p.phase === 'feedback') return '';
  const busy = p.phase === 'loading' || p.phase === 'checking';
  const label = { listening: 'Listening… tap to stop', checking: 'Checking…', loading: '' }[p.phase] ?? 'Tap to speak';
  const canSpeak = recognitionSupported;
  return `
    <div class="answer-area">
      ${
        canSpeak
          ? `<button class="mic ${p.phase === 'listening' ? 'listening' : ''}" data-action="speak" ${busy ? 'disabled' : ''}
               aria-label="${p.phase === 'listening' ? 'Stop listening' : 'Speak the character'}">${ICONS.mic}</button>
             <div class="mic-label" aria-live="polite">${label}</div>`
          : ''
      }
      ${p.message ? `<div class="notice ${canSpeak && !p.typing ? '' : 'warn'}" role="alert">${esc(p.message)}</div>` : ''}
      ${
        p.typing
          ? `<form class="typed" data-form="typed">
               <input name="typed" placeholder="Pinyin, e.g. ni3 or nǐ" aria-label="Type the pinyin" autocomplete="off" autocapitalize="off" spellcheck="false" ${busy ? 'disabled' : ''}>
               <button class="btn btn-secondary" type="submit" ${busy ? 'disabled' : ''}>Check</button>
             </form>`
          : canSpeak
            ? '<button class="link-btn" data-action="show-typing">Can’t speak right now? Type the pinyin</button>'
            : ''
      }
    </div>`;
}

function feedbackSheet(p) {
  const r = p.result;
  const c = p.card;
  const heard = r.heard
    ? `<div class="heard">You said: <b lang="zh-CN">${esc(r.heard)}</b>${
        r.heardPinyin && r.heardPinyin !== r.heard ? ` <span class="muted">(${esc(r.heardPinyin)})</span>` : ''
      }</div>`
    : '';
  const title = r.correct ? p.praise : r.matchType === 'skipped' ? 'Skipped — here’s the answer' : 'Not quite';
  return `
    <div class="sheet ${r.correct ? 'ok' : 'bad'}" role="status">
      <div class="sheet-inner">
        <div class="sheet-icon">${r.correct ? ICONS.check : ICONS.cross}</div>
        <div class="sheet-text">
          <div class="sheet-title">${esc(title)}</div>
          ${heard}
          ${
            r.correct
              ? ''
              : `<div>Correct answer: <b lang="zh-CN">${esc(c.hanzi)}</b> <b>${esc(c.pinyin)}</b> — ${esc(c.meaning)}</div>`
          }
          ${r.reason === 'tone' ? '<div class="tip">So close — the sound was right but the tone was different.</div>' : ''}
        </div>
        <div class="sheet-actions">
          ${r.correct ? '' : `<button class="btn btn-ghost btn-icon" data-action="listen" aria-label="Hear it again">${ICONS.speaker}</button>`}
          <button class="btn ${r.correct ? 'btn-primary' : 'btn-danger'}" data-action="continue">Continue</button>
        </div>
      </div>
    </div>`;
}

function renderPractice() {
  const p = state.practice;
  const c = p.card;
  const r = p.phase === 'feedback' ? p.result : null;
  const pct = Math.round((p.answered / p.size) * 100);
  // Pinyin stays hidden until the learner has answered; new cards show the meaning and a listen button instead.
  const showMeaning = c && (c.isNew || r || p.hint);
  const canListen = c && (c.isNew || r);

  let body = '<div class="spinner" aria-label="Loading"></div>';
  if (c) {
    body = `
      <div class="prompt">
        ${c.isNew ? '<span class="badge new">New character</span>' : `<span class="badge">${levelLabel(c.box)} ${levelDots(c.box)}</span>`}
        <h2>${c.isNew ? 'Listen, then say it out loud' : 'Say this character'}</h2>
      </div>
      <div class="card ${r ? (r.correct ? 'correct' : 'wrong') : ''}">
        <div class="hanzi" lang="zh-CN">${esc(c.hanzi)}</div>
        ${r ? `<div class="pinyin">${esc(c.pinyin)}</div>` : ''}
        ${
          showMeaning
            ? `<div class="meaning">${esc(c.meaning)}</div>`
            : '<button class="link-btn" data-action="hint">Show meaning</button>'
        }
        ${canListen ? `<button class="listen-btn" data-action="listen" aria-label="Play pronunciation">${ICONS.speaker}</button>` : ''}
        ${r ? `<div class="mark ${r.correct ? 'ok' : 'bad'}" data-testid="mark">${r.correct ? ICONS.check : ICONS.cross}</div>` : ''}
      </div>
      ${micBlock(p)}`;
  }

  app.innerHTML = `
    <div class="practice">
      <div class="practice-top">
        <button class="icon-btn" data-action="exit" aria-label="End session">${ICONS.close}</button>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p.size}" aria-valuenow="${p.answered}">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <span class="progress-label">${p.answered}/${p.size}</span>
      </div>
      <main class="practice-main">${body}</main>
      ${
        r
          ? feedbackSheet(p)
          : `<footer class="practice-footer"><button class="btn btn-ghost" data-action="skip" ${p.phase === 'ready' ? '' : 'disabled'}>Skip</button></footer>`
      }
    </div>`;

  if (r) app.querySelector('[data-action=continue]')?.focus();
  else if (p.typing && p.phase === 'ready') app.querySelector('input[name=typed]')?.focus();
}

function exitPractice() {
  state.practice?.listener?.abort();
  window.speechSynthesis?.cancel();
  showHome();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function renderSummary() {
  setView('summary');
  const { session, summary } = state.summary;
  const accuracy = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
  const cheer = accuracy === 100 ? 'Perfect session!' : accuracy >= 70 ? 'Great work!' : 'Keep practicing!';
  app.innerHTML = `
    <main class="summary">
      <div class="summary-card">
        <div class="summary-score" style="--pct:${accuracy}"><span>${accuracy}%</span></div>
        <h1>${cheer}</h1>
        <p class="muted">${session.correct} of ${session.answered} characters correct</p>
        <ul class="results">
          ${summary
            .map(
              (a) => `<li class="${a.correct ? 'ok' : 'bad'}">
                <span class="r-hanzi" lang="zh-CN">${esc(a.hanzi)}</span>
                <span class="r-pinyin">${esc(a.pinyin)}</span>
                <span class="r-meaning muted">${esc(a.meaning)}</span>
                <span class="r-mark">${a.correct ? ICONS.check : ICONS.cross}</span>
              </li>`,
            )
            .join('')}
        </ul>
        <div class="summary-actions">
          <button class="btn btn-primary" data-action="start">Practice again</button>
          <button class="btn btn-ghost" data-action="home">Back to home</button>
        </div>
      </div>
    </main>`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const actions = {
  'auth-tab': (el) => renderAuth(el.dataset.mode, { username: app.querySelector('input[name=username]')?.value ?? '' }),
  logout: async () => {
    await api.logout().catch(() => {});
    state.user = null;
    state.stats = null;
    renderAuth('login');
  },
  size: (el) => {
    state.sessionSize = Number(el.dataset.size);
    localStorage.setItem('hz.size', String(state.sessionSize));
    renderHome();
  },
  tones: (el) => {
    state.ignoreTones = el.checked;
    localStorage.setItem('hz.ignoreTones', el.checked ? '1' : '0');
  },
  start: () => startPractice(),
  home: () => showHome(),
  exit: () => exitPractice(),
  speak: () => toggleListening(),
  hint: () => {
    state.practice.hint = true;
    renderPractice();
  },
  'show-typing': () => {
    state.practice.typing = true;
    renderPractice();
  },
  listen: () => speakChinese(state.practice.card.hanzi),
  skip: () => {
    if (state.practice?.phase !== 'ready') return;
    unlockAudio();
    submitAnswer({ skipped: true });
  },
  continue: () => {
    window.speechSynthesis?.cancel();
    loadNextCard().catch((err) => alert(err.message));
  },
};

app.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  actions[el.dataset.action]?.(el, event);
});

app.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.form === 'auth') submitAuth(form);
  if (form.dataset.form === 'typed') {
    const value = form.typed.value.trim();
    if (!value || state.practice?.phase !== 'ready') return;
    unlockAudio();
    submitAnswer({ transcripts: [value] });
  }
});

document.addEventListener('keydown', (event) => {
  if (state.view !== 'practice' || event.target.matches('input, textarea')) return;
  const p = state.practice;
  if (event.code === 'Space' && event.target.closest('button')) return; // native button activation
  if (event.code === 'Space' && (p.phase === 'ready' || p.phase === 'listening') && recognitionSupported) {
    event.preventDefault();
    toggleListening();
  } else if (event.key === 'Enter' && p.phase === 'feedback') {
    event.preventDefault();
    actions.continue();
  }
});

async function boot() {
  try {
    const { user } = await api.me();
    state.user = user;
  } catch {
    state.user = null;
  }
  if (state.user) await showHome();
  else renderAuth('login');
}

boot();
