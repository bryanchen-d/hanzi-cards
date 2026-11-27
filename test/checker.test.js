import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_STRICTNESS, checkPronunciation, normalizeStrictness } from '../public/js/lib/checker.js';
import { CHARACTERS } from '../public/js/lib/characters.js';
import { accentKey, parseSyllable } from '../public/js/lib/pinyin.js';

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

describe('accentKey', () => {
  it('merges the common accent confusions and nothing else', () => {
    const pairs = [
      ['zhi', 'zi'], ['chi', 'ci'], ['shi', 'si'], ['ni', 'li'], ['re', 'le'], ['fei', 'hei'],
      ['bang', 'ban'], ['meng', 'men'], ['xing', 'xin'], ['xiang', 'xian'], ['guang', 'guan'],
    ];
    for (const [a, b] of pairs) assert.equal(accentKey(a), accentKey(b), `${a} ~ ${b}`);
    for (const [a, b] of [['ba', 'pa'], ['ni', 'wo'], ['er', 'e'], ['dong', 'deng'], ['ji', 'qi']]) {
      assert.notEqual(accentKey(a), accentKey(b), `${a} ≁ ${b}`);
    }
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

  it('rejects a different tone only in strict mode', () => {
    const strict = checkPronunciation(ma, ['马'], { strictness: 'strict' });
    assert.equal(strict.correct, false);
    assert.equal(strict.reason, 'tone');
    assert.equal(strict.heardPinyin, 'mǎ');
    for (const strictness of ['normal', 'relaxed']) {
      const r = checkPronunciation(ma, ['马'], { strictness });
      assert.equal(r.correct, true, strictness);
      assert.equal(r.lenient, 'tone');
      assert.deepEqual([r.heardSyllable, r.matchedReading], ['mǎ', 'mā']);
    }
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
    assert.equal(checkPronunciation(ni, ['nǐ'], { strictness: 'relaxed' }).correct, false);
  });

  it('defaults to relaxed matching and falls back to it for unknown levels', () => {
    assert.equal(DEFAULT_STRICTNESS, 'relaxed');
    assert.equal(normalizeStrictness('bogus'), 'relaxed');
    assert.equal(checkPronunciation({ hanzi: '是', pinyin: 'shì' }, ['四']).correct, true);
  });

  it('accepts each accent confusion only in relaxed mode', () => {
    const cases = [
      [{ hanzi: '知', pinyin: 'zhī' }, '资', 'zh → z'],
      [{ hanzi: '在', pinyin: 'zài' }, '寨', 'z → zh'],
      [{ hanzi: '吃', pinyin: 'chī' }, '疵', 'ch → c'],
      [{ hanzi: '是', pinyin: 'shì' }, '四', 'sh → s'],
      [{ hanzi: '你', pinyin: 'nǐ' }, '里', 'n → l'],
      [{ hanzi: '热', pinyin: 'rè' }, '乐', 'r → l'],
      [{ hanzi: '飞', pinyin: 'fēi' }, '黑', 'f → h'],
      [{ hanzi: '帮', pinyin: 'bāng' }, '班', 'ang → an'],
      [{ hanzi: '门', pinyin: 'mén' }, '盟', 'en → eng'],
      [{ hanzi: '心', pinyin: 'xīn' }, '星', 'in → ing'],
      [{ hanzi: '先', pinyin: 'xiān' }, '香', 'ian → iang'],
      [{ hanzi: '关', pinyin: 'guān' }, '光', 'uan → uang'],
    ];
    for (const [target, heard, label] of cases) {
      const relaxed = checkPronunciation(target, [heard], { strictness: 'relaxed' });
      assert.equal(relaxed.correct, true, `relaxed: ${label}`);
      assert.equal(relaxed.lenient, 'accent', label);
      assert.equal(relaxed.matchedReading, target.pinyin, label);
      for (const strictness of ['strict', 'normal']) {
        const r = checkPronunciation(target, [heard], { strictness });
        assert.equal(r.correct, false, `${strictness}: ${label}`);
        assert.equal(r.reason, 'accent', label);
      }
    }
  });

  it('still rejects sounds that are not accent confusions', () => {
    assert.equal(checkPronunciation({ hanzi: '爸', pinyin: 'bà' }, ['怕']).correct, false, 'b ≠ p');
    assert.equal(checkPronunciation({ hanzi: '是', pinyin: 'shì' }, ['二']).correct, false);
    assert.equal(checkPronunciation(ni, ['我']).reason, 'mismatch');
  });

  it('prefers the strictest match and always accepts the character itself', () => {
    const shi = { hanzi: '是', pinyin: 'shì' };
    const r = checkPronunciation(shi, ['四', '马', '事'], { strictness: 'relaxed' });
    assert.deepEqual([r.correct, r.lenient, r.heard], [true, null, '事']);
    assert.equal(checkPronunciation(shi, ['四是'], { strictness: 'strict' }).matchType, 'exact');
  });

  it('treats empty input as incorrect', () => {
    const r = checkPronunciation(ni, ['  ', '']);
    assert.equal(r.correct, false);
    assert.equal(r.reason, 'empty');
  });
});
