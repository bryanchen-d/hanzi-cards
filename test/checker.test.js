import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPronunciation } from '../public/js/lib/checker.js';
import { CHARACTERS } from '../public/js/lib/characters.js';
import { parseSyllable } from '../public/js/lib/pinyin.js';

const ni = { hanzi: '你', pinyin: 'nǐ' };
const ma = { hanzi: '妈', pinyin: 'mā' };

describe('parseSyllable', () => {
  it('reads tone marks, tone numbers and ü spellings', () => {
    assert.deepEqual(parseSyllable('nǐ'), { base: 'ni', tone: 3 });
    assert.deepEqual(parseSyllable('NI3'), { base: 'ni', tone: 3 });
    assert.deepEqual(parseSyllable('nǚ'), { base: 'nv', tone: 3 });
    assert.deepEqual(parseSyllable('nu:3'), { base: 'nv', tone: 3 });
    assert.deepEqual(parseSyllable('qù'), { base: 'qu', tone: 4 });
    assert.deepEqual(parseSyllable('de5'), { base: 'de', tone: 0 });
  });

  it('distinguishes an omitted tone from a neutral tone', () => {
    assert.deepEqual(parseSyllable('ni'), { base: 'ni', tone: null });
    assert.deepEqual(parseSyllable('de', { bareIsNeutral: true }), { base: 'de', tone: 0 });
    assert.equal(parseSyllable('ni hao'), null);
  });
});

describe('checkPronunciation', () => {
  it('accepts a transcript containing the target character', () => {
    const r = checkPronunciation(ni, ['你。']);
    assert.equal(r.correct, true);
    assert.equal(r.matchType, 'exact');
  });

  it('accepts a homophone with the same tone', () => {
    const r = checkPronunciation({ hanzi: '他', pinyin: 'tā' }, ['她']);
    assert.equal(r.correct, true);
    assert.equal(r.matchType, 'homophone');
  });

  it('rejects a different tone unless tones are ignored', () => {
    const strict = checkPronunciation(ma, ['马']);
    assert.equal(strict.correct, false);
    assert.equal(strict.reason, 'tone');
    assert.equal(strict.heardPinyin, 'mǎ');
    assert.equal(checkPronunciation(ma, ['马'], { ignoreTones: true }).correct, true);
  });

  it('rejects a different syllable', () => {
    const r = checkPronunciation(ni, ['我']);
    assert.equal(r.correct, false);
    assert.equal(r.reason, 'mismatch');
    assert.equal(r.heard, '我');
  });

  it('accepts if any recognition alternative matches', () => {
    const r = checkPronunciation(ni, ['我', '你']);
    assert.equal(r.correct, true);
    assert.equal(r.heard, '你');
  });

  it('maps Arabic numerals returned by the recogniser', () => {
    assert.equal(checkPronunciation({ hanzi: '八', pinyin: 'bā' }, ['8']).correct, true);
    assert.equal(checkPronunciation({ hanzi: '十', pinyin: 'shí' }, ['10']).correct, true);
  });

  it('accepts any standard reading of a polyphonic character', () => {
    const xing = { hanzi: '行', pinyin: 'xíng', readings: ['xíng', 'háng', 'héng'] };
    assert.equal(checkPronunciation(xing, ['航']).correct, true, 'háng via homophone 航');
    assert.equal(checkPronunciation(xing, ['型']).correct, true, 'xíng via homophone 型');
    assert.equal(checkPronunciation({ hanzi: '行', pinyin: 'xíng' }, ['航']).correct, false, 'only listed readings count');

    const de = CHARACTERS.find((c) => c.hanzi === '的');
    assert.deepEqual(de.readings, ['de', 'dī', 'dí', 'dì']);
    assert.equal(checkPronunciation(de, ['敌']).correct, true, 'dí reading from the deck');
  });

  it('ignores romanised transcripts (answers are spoken, not typed)', () => {
    assert.equal(checkPronunciation(ni, ['ni3']).correct, false);
    assert.equal(checkPronunciation(ni, ['Ni']).correct, false);
    assert.equal(checkPronunciation(ni, ['nǐ'], { ignoreTones: true }).correct, false);
  });

  it('treats empty input as incorrect', () => {
    const r = checkPronunciation(ni, ['  ', '']);
    assert.equal(r.correct, false);
    assert.equal(r.reason, 'empty');
  });
});
