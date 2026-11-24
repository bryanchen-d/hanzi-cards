// Sound effects synthesised with the Web Audio API (no audio files needed).

let ctx = null;

function audio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx ??= new Ctx();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Call from a user gesture (click) so later sounds are allowed to play. */
export function unlockAudio() {
  audio();
}

function tone(c, freq, start, duration, { type = 'sine', gain = 0.25, endFreq } = {}) {
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function play(notes, totalMs) {
  const c = audio();
  if (!c) return Promise.resolve();
  const t = c.currentTime + 0.02;
  for (const [freq, offset, duration, opts] of notes) tone(c, freq, t + offset, duration, opts);
  return new Promise((resolve) => setTimeout(resolve, totalMs));
}

/** Bright two-note "ding-ding". */
export function playPass() {
  return play(
    [
      [880, 0, 0.14, { type: 'triangle', gain: 0.3 }],
      [1318.5, 0.11, 0.32, { type: 'triangle', gain: 0.3 }],
    ],
    450,
  );
}

/** Low descending "buzz". */
export function playFail() {
  return play(
    [
      [220, 0, 0.18, { type: 'square', gain: 0.07, endFreq: 200 }],
      [165, 0.17, 0.32, { type: 'square', gain: 0.07, endFreq: 130 }],
    ],
    550,
  );
}

/** Short rising arpeggio for finishing a session. */
export function playComplete() {
  return play(
    [523.25, 659.25, 783.99, 1046.5].map((f, i) => [f, i * 0.1, 0.3, { type: 'triangle', gain: 0.22 }]),
    700,
  );
}
