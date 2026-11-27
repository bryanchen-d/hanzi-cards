// Browser speech recognition (Web Speech API) for Mandarin.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const recognitionSupported = Boolean(Recognition);

const MESSAGES = {
  unsupported:
    "This browser can't recognize speech, and Hanzi Cards is voice-only. Open this page in Chrome or Edge (desktop or Android) or Safari (Mac, iPhone or iPad).",
  'not-allowed':
    'Microphone access is blocked. Click the lock or site-settings icon in the address bar, set Microphone to Allow, then tap the mic again. (On iPhone/iPad: Settings → Safari → Microphone.)',
  'service-not-allowed':
    "Speech recognition is turned off. In Safari, enable Siri or Dictation (System Settings → Keyboard → Dictation), then tap the mic again.",
  'audio-capture': 'No microphone was found. Check that one is connected and selected in your system sound settings.',
  network: 'Speech recognition needs an internet connection (the browser sends audio to its speech service).',
  'no-speech': "Didn't hear anything — tap the mic and say the character.",
  'language-not-supported': "This browser can't recognize Mandarin (zh-CN). Try Chrome or Edge.",
  'start-failed': "Couldn't start the microphone. Please try again.",
};

export function speechErrorMessage(code) {
  return MESSAGES[code] ?? `Speech recognition error (${code}). Please try again.`;
}

/** Errors that mean speaking can't work until the learner changes a setting or browser. */
export function isFatalSpeechError(code) {
  return ['unsupported', 'not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(code);
}

function speechError(code) {
  const err = new Error(speechErrorMessage(code));
  err.code = code;
  return err;
}

const MAX_CANDIDATES = 15;
const MAX_RESTARTS = 30;

/**
 * Listen continuously until `stop()` is called or `timeoutMs` passes.
 *
 * `onStart()` fires once the microphone is live (the countdown starts then,
 * so a permission prompt doesn't eat into the time). `onResult(candidates)` fires
 * for every interim or final result with the full utterance so far, followed by
 * the newest recognition alternatives.
 *
 * `done` resolves with `{ reason: 'stopped' | 'timeout', candidates }`, or
 * rejects with an error carrying a `code` when listening can't work at all.
 * Browsers end recognition on their own after silence; it is restarted until
 * the deadline.
 */
export function startListening({ lang = 'zh-CN', timeoutMs = 10000, onStart, onResult } = {}) {
  if (!Recognition) return { done: Promise.reject(speechError('unsupported')), stop() {} };

  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  let rec = null;
  let finished = false;
  let started = false;
  let restarts = 0;
  let previousText = ''; // text heard in earlier recognition runs
  let candidates = [];
  let deadlineTimer = null;
  // Safety net in case the browser never reports that it started.
  const startTimer = setTimeout(() => finish('timeout'), timeoutMs + 20000);

  function finish(reason, error) {
    if (finished) return;
    finished = true;
    clearTimeout(deadlineTimer);
    clearTimeout(startTimer);
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
    if (error) rejectDone(error);
    else resolveDone({ reason, candidates });
  }

  function run() {
    rec = new Recognition();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 10;
    let runText = '';
    let fatal = null;

    rec.onstart = () => {
      if (started || finished) return;
      started = true;
      clearTimeout(startTimer);
      deadlineTimer = setTimeout(() => finish('timeout'), timeoutMs);
      onStart?.();
    };
    rec.onresult = (event) => {
      if (finished) return;
      runText = '';
      for (let i = 0; i < event.results.length; i++) runText += event.results[i][0]?.transcript ?? '';
      const fresh = [];
      for (let i = event.results.length - 1; i >= event.resultIndex; i--) {
        const result = event.results[i];
        for (let j = 0; j < result.length; j++) fresh.push(result[j].transcript.trim());
      }
      const whole = (previousText + runText).replace(/\s+/g, ' ').trim().slice(-100);
      candidates = [...new Set([whole, ...fresh])].filter(Boolean).slice(0, MAX_CANDIDATES);
      onResult?.(candidates);
    };
    rec.onerror = (event) => {
      if (isFatalSpeechError(event.error) || event.error === 'network') fatal = event.error;
    };
    rec.onend = () => {
      if (finished) return;
      if (fatal) return finish(null, speechError(fatal));
      previousText += runText;
      if (++restarts > MAX_RESTARTS) return finish('timeout');
      setTimeout(() => {
        if (!finished) start();
      }, 100);
    };
    rec.start();
  }

  function start() {
    try {
      run();
    } catch {
      finish(null, speechError('start-failed'));
    }
  }

  start();
  return { done, stop: () => finish('stopped') };
}
