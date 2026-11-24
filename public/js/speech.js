// Browser speech recognition (Web Speech API) for Mandarin.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const recognitionSupported = Boolean(Recognition);

const MESSAGES = {
  unsupported: "This browser doesn't support speech recognition. Try Chrome, Edge or Safari — or type the pinyin below.",
  'not-allowed': 'Microphone access is blocked. Allow the microphone for this site (address bar → site settings), then try again.',
  'service-not-allowed': "Speech recognition isn't available here. In Safari, enable Siri/Dictation in System Settings, or type the pinyin below.",
  'audio-capture': 'No microphone was found. Check that one is connected and selected.',
  network: 'Speech recognition needs an internet connection (the browser sends audio to its speech service).',
  'no-speech': "Didn't hear anything — tap the mic and say the character.",
  'language-not-supported': "This browser can't recognize Mandarin (zh-CN). Try Chrome or Edge.",
  'start-failed': "Couldn't start the microphone. Please try again.",
};

export function speechErrorMessage(code) {
  return MESSAGES[code] ?? `Speech recognition error (${code}). Please try again.`;
}

/** Errors that mean speaking won't work at all, so offer typing instead. */
export function isFatalSpeechError(code) {
  return ['unsupported', 'not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(code);
}

function speechError(code) {
  const err = new Error(speechErrorMessage(code));
  err.code = code;
  return err;
}

/**
 * Listen for one utterance. Resolves with the recognition alternatives
 * (best first), or rejects with an error carrying a `code`.
 */
export function listenOnce({ lang = 'zh-CN', timeoutMs = 7000 } = {}) {
  if (!Recognition) return { promise: Promise.reject(speechError('unsupported')), stop() {}, abort() {} };

  const rec = new Recognition();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 5;

  let transcripts = [];
  let errorCode = null;
  let timer;

  const promise = new Promise((resolve, reject) => {
    rec.onresult = (event) => {
      const result = event.results[0];
      transcripts = Array.from({ length: result.length }, (_, i) => result[i].transcript.trim()).filter(Boolean);
    };
    rec.onerror = (event) => {
      errorCode = event.error;
    };
    rec.onend = () => {
      clearTimeout(timer);
      if (transcripts.length) resolve(transcripts);
      else reject(speechError(errorCode || 'no-speech'));
    };
    try {
      rec.start();
      timer = setTimeout(() => rec.stop(), timeoutMs);
    } catch {
      reject(speechError('start-failed'));
    }
  });

  return { promise, stop: () => rec.stop(), abort: () => rec.abort() };
}
