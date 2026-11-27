import { pinyin } from 'pinyin-pro';
import { accentKey, parseSyllable } from './pinyin.js';

const HAN = /\p{Script=Han}/u;
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const MAX_CANDIDATES = 30;
const MAX_CANDIDATE_LENGTH = 100;

/**
 * How forgiving matching is:
 * - strict:  same sound and same tone
 * - normal:  same sound, any tone
 * - relaxed: any tone, and common accent mergers count too (see accentKey)
 */
export const STRICTNESS_LEVELS = ['strict', 'normal', 'relaxed'];
export const DEFAULT_STRICTNESS = 'relaxed';

// Match ranks, best first. A rank is allowed when it is <= the level's limit.
const RANK = { exact: 0, homophone: 1, tone: 2, accent: 3 };
const LIMIT = { strict: RANK.homophone, normal: RANK.tone, relaxed: RANK.accent };

export function normalizeStrictness(value) {
  return STRICTNESS_LEVELS.includes(value) ? value : DEFAULT_STRICTNESS;
}

// Speech recognisers often return Arabic numerals for spoken numbers ("8" for 八).
function digitsToHanzi(text) {
  return text.replace(/(?<!\d)10(?!\d)/g, '十').replace(/\d/g, (d) => DIGITS[Number(d)]);
}

function clean(text) {
  return digitsToHanzi(String(text).normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, ''));
}

function readingsOf(ch) {
  return pinyin(ch, { multiple: true, type: 'array' })
    .map((text) => ({ text, syllable: parseSyllable(text, { bareIsNeutral: true }) }))
    .filter((r) => r.syllable);
}

/** Best (lowest-rank) match in one transcript. Only Chinese characters count, since answers are spoken. */
function bestMatch(target, raw) {
  const text = clean(raw);
  if (!text) return null;
  if (text.includes(target.hanzi)) return { rank: RANK.exact };

  let best = null;
  for (const ch of [...text].filter((c) => HAN.test(c))) {
    for (const reading of readingsOf(ch)) {
      for (const t of target.readings) {
        let rank = null;
        if (reading.syllable.base === t.syllable.base) {
          rank = reading.syllable.tone === t.syllable.tone ? RANK.homophone : RANK.tone;
        } else if (accentKey(reading.syllable.base) === accentKey(t.syllable.base)) {
          rank = RANK.accent;
        }
        if (rank !== null && (!best || rank < best.rank)) {
          best = { rank, heardSyllable: reading.text, matchedReading: t.text };
        }
      }
    }
  }
  return best;
}

export function toPinyin(text) {
  return HAN.test(text) ? pinyin(text) : text;
}

/**
 * Decide whether what the learner said (speech-recognition alternatives and
 * interim results) is an acceptable pronunciation of `character`.
 *
 * A transcript containing the character itself always passes. Otherwise it
 * passes if it contains a homophone of any of the character's standard
 * readings (`character.readings`, falling back to `character.pinyin`), within
 * the chosen `strictness`. The strictest available match wins, and
 * `lenient` ('tone' | 'accent' | null) says whether the pass relied on leniency.
 */
export function checkPronunciation(character, candidates, { strictness = DEFAULT_STRICTNESS } = {}) {
  const level = normalizeStrictness(strictness);
  const list = (Array.isArray(candidates) ? candidates : [candidates])
    .filter((c) => typeof c === 'string')
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.slice(0, MAX_CANDIDATE_LENGTH).trim())
    .filter(Boolean);

  const readings = character.readings?.length ? character.readings : [character.pinyin];
  const target = {
    hanzi: character.hanzi,
    readings: readings.map((text) => ({ text, syllable: parseSyllable(text, { bareIsNeutral: true }) })).filter((r) => r.syllable),
  };
  const heard = list[0] ?? '';
  const base = { heard, heardPinyin: heard ? toPinyin(heard) : '', lenient: null };

  if (list.length === 0) {
    return { ...base, correct: false, matchType: null, reason: 'empty' };
  }

  let best = null;
  for (const candidate of list) {
    const match = bestMatch(target, candidate);
    if (match && (!best || match.rank < best.rank)) best = { ...match, candidate };
  }

  if (best && best.rank <= LIMIT[level]) {
    return {
      correct: true,
      matchType: best.rank === RANK.exact ? 'exact' : 'homophone',
      lenient: best.rank === RANK.tone ? 'tone' : best.rank === RANK.accent ? 'accent' : null,
      heard: best.candidate,
      heardPinyin: toPinyin(best.candidate),
      heardSyllable: best.heardSyllable ?? null,
      matchedReading: best.matchedReading ?? null,
      reason: null,
    };
  }
  const reason = best?.rank === RANK.tone ? 'tone' : best?.rank === RANK.accent ? 'accent' : 'mismatch';
  return { ...base, correct: false, matchType: null, reason, heardSyllable: best?.heardSyllable ?? null };
}
