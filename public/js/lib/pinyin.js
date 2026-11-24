// Helpers for comparing pinyin syllables written with tone marks ("nǐ") or tone numbers ("ni3").

const COMBINING_TONES = {
  '\u0304': 1, // macron: ā
  '\u0301': 2, // acute: á
  '\u030C': 3, // caron: ǎ
  '\u0300': 4, // grave: à
};
const COMBINING_DIAERESIS = '\u0308'; // ü

/**
 * Parse one pinyin syllable into its toneless base and tone.
 *
 * - Tone marks and trailing tone numbers are both understood ("nǐ", "ni3").
 * - "ü" may be written as "ü", "v" or "u:"; it is normalised to "v",
 *   except after j/q/x/y where standard pinyin writes a plain "u".
 * - Tone 0 means neutral. A syllable without any tone information gets
 *   `tone: 0` when `bareIsNeutral` is true (dictionary data), otherwise
 *   `tone: null` (user input where the tone was simply omitted).
 */
export function parseSyllable(input, { bareIsNeutral = false } = {}) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase().normalize('NFD').replace(/u:/g, 'v');
  let base = '';
  let tone = null;
  for (const ch of text) {
    if (ch in COMBINING_TONES) {
      tone = COMBINING_TONES[ch];
    } else if (ch === COMBINING_DIAERESIS) {
      if (base.endsWith('u')) base = `${base.slice(0, -1)}v`;
    } else if (ch >= 'a' && ch <= 'z') {
      base += ch;
    } else if (ch >= '0' && ch <= '5') {
      tone = ch === '5' ? 0 : Number(ch);
    } else {
      return null;
    }
  }
  if (!base) return null;
  base = base.replace(/^([jqxy])v/, '$1u');
  if (tone === null && bareIsNeutral) tone = 0;
  return { base, tone };
}

/**
 * Does a candidate syllable match the target syllable?
 * A candidate with unknown tone (null) only matches a neutral-tone target,
 * unless tones are ignored entirely.
 */
export function syllablesMatch(target, candidate, { ignoreTones = false } = {}) {
  if (!target || !candidate || target.base !== candidate.base) return false;
  if (ignoreTones) return true;
  if (candidate.tone === null) return target.tone === 0;
  return candidate.tone === target.tone;
}
