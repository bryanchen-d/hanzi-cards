import { pinyin } from 'pinyin-pro';
import { parseSyllable, syllablesMatch } from './pinyin.js';

const HAN = /\p{Script=Han}/u;
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const MAX_CANDIDATES = 10;
const MAX_CANDIDATE_LENGTH = 100;

// Speech recognisers often return Arabic numerals for spoken numbers ("8" for 八).
function digitsToHanzi(text) {
  return text.replace(/(?<!\d)10(?!\d)/g, '十').replace(/\d/g, (d) => DIGITS[Number(d)]);
}

function clean(text) {
  return digitsToHanzi(String(text).normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, ''));
}

function readingsOf(ch) {
  return pinyin(ch, { multiple: true, type: 'array' })
    .map((r) => parseSyllable(r, { bareIsNeutral: true }))
    .filter(Boolean);
}

// Only Chinese characters in the transcript count; recognisers sometimes return Latin text for unclear speech.
function evaluate(target, raw, ignoreTones) {
  const text = clean(raw);
  if (!text) return { correct: false, nearTone: false };
  if (text.includes(target.hanzi)) return { correct: true, matchType: 'exact' };

  let nearTone = false;
  for (const ch of [...text].filter((c) => HAN.test(c))) {
    for (const reading of readingsOf(ch)) {
      for (const syllable of target.syllables) {
        if (syllablesMatch(syllable, reading, { ignoreTones })) return { correct: true, matchType: 'homophone' };
        if (reading.base === syllable.base) nearTone = true;
      }
    }
  }
  return { correct: false, nearTone };
}

export function toPinyin(text) {
  return HAN.test(text) ? pinyin(text) : text;
}

/**
 * Decide whether what the learner said (one or more speech-recognition
 * alternatives) is an acceptable pronunciation of `character`.
 *
 * Accepted: a transcript contains the character itself, or a homophone of any
 * of its standard readings (`character.readings`, falling back to
 * `character.pinyin`). Tones must match unless `ignoreTones`.
 */
export function checkPronunciation(character, candidates, { ignoreTones = false } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [candidates])
    .filter((c) => typeof c === 'string')
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.slice(0, MAX_CANDIDATE_LENGTH).trim())
    .filter(Boolean);

  const readings = character.readings?.length ? character.readings : [character.pinyin];
  const target = {
    hanzi: character.hanzi,
    syllables: readings.map((r) => parseSyllable(r, { bareIsNeutral: true })).filter(Boolean),
  };
  const heard = list[0] ?? '';
  const base = { heard, heardPinyin: heard ? toPinyin(heard) : '' };

  if (list.length === 0) {
    return { ...base, correct: false, matchType: null, reason: 'empty' };
  }

  let nearTone = false;
  for (const candidate of list) {
    const outcome = evaluate(target, candidate, ignoreTones);
    if (outcome.correct) {
      return {
        correct: true,
        matchType: outcome.matchType,
        heard: candidate,
        heardPinyin: toPinyin(candidate),
        reason: null,
      };
    }
    nearTone ||= outcome.nearTone;
  }
  return { ...base, correct: false, matchType: null, reason: nearTone ? 'tone' : 'mismatch' };
}
