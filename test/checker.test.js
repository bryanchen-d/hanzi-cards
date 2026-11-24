import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPronunciation } from '../public/js/lib/checker.js';
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

  it('checks typed pinyin', () => {
    assert.equal(checkPronunciation(ni, ['ni3']).correct, true);
    assert.equal(checkPronunciation(ni, ['nǐ']).matchType, 'pinyin');
    assert.equal(checkPronunciation(ni, ['ni2']).correct, false);
    assert.equal(checkPronunciation(ni, ['ni']).reason, 'tone');
    assert.equal(checkPronunciation(ni, ['ni'], { ignoreTones: true }).correct, true);
    assert.equal(checkPronunciation({ hanzi: '女', pinyin: 'nǚ' }, ['nv3']).correct, true);
    assert.equal(checkPronunciation({ hanzi: '的', pinyin: 'de' }, ['de']).correct, true);
  });

  it('treats empty input as incorrect', () => {
    const r = checkPronunciation(ni, ['  ', '']);
    assert.equal(r.correct, false);
    assert.equal(r.reason, 'empty');
  });
});
