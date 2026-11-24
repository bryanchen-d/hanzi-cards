// Text-to-speech playback of the correct pronunciation.

export const ttsSupported = 'speechSynthesis' in window;
let voices = [];

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
}

if (ttsSupported) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

function chineseVoice() {
  return (
    voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ||
    voices.find((v) => /^cmn/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    null
  );
}

/** False only once voices have loaded and none of them speak Chinese. */
export function hasChineseVoice() {
  return !ttsSupported || voices.length === 0 || Boolean(chineseVoice());
}

/** Speak Chinese text; resolves when finished (or after a safety timeout). */
export function speakChinese(text, { rate = 0.8 } = {}) {
  if (!ttsSupported) return Promise.resolve(false);
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = rate;
    const voice = chineseVoice();
    if (voice) utterance.voice = voice;
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(done, 4000);
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}
