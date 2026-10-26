// Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, parseTTML, pairCues, cueIndexAt, pickTrack, splitWords, lemmaCandidates, formatTime, toCSV, toAnki, DEFAULT_KEYS, keyLabel, assignKey, normalizeKeys, phraseCandidates } = require('./lib.js');

const DFXP = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:tickRate="10000000" xml:lang="en">
<head><styling><style xml:id="style_0" tts:color="white"/></styling></head>
<body><div>
<p begin="70830000t" end="95000000t" region="region_00" xml:id="subtitle1">we're planning<br/>some <span tts:fontStyle="italic">layoffs</span> &amp; cuts.</p>
<p begin="54250000t" end="70830000t" region="region_00" xml:id="subtitle0"><span style="style_0">Um, as you know,</span></p>
<p begin="100000000t" end="120000000t" region="region_top">- Hey!</p>
<p begin="100000000t" end="120000000t" region="region_bottom">- What?</p>
<p begin="130000000t" end="140000000t"> </p>
<p begin="150000000t" end="160000000t"/>
<p begin="170000000t" end="180000000t">It&#39;s
    fine&#x2026;</p>
</div></body></tt>`;

test('parseTime handles offset and clock forms', () => {
  assert.equal(parseTime('54250000t', 10000000, 30), 5.425);
  assert.equal(parseTime('1.5s', 1, 30), 1.5);
  assert.equal(parseTime('1500ms', 1, 30), 1.5);
  assert.equal(parseTime('2m', 1, 30), 120);
  assert.equal(parseTime('01:02:03.500', 1, 30), 3723.5);
  assert.equal(parseTime('00:00:01:15', 1, 30), 1.5);
  assert.ok(Number.isNaN(parseTime(undefined, 1, 30)));
});

test('parseTTML reads Netflix dfxp', () => {
  assert.deepEqual(parseTTML(DFXP), [
    { start: 5.425, end: 7.083, text: 'Um, as you know,' },
    { start: 7.083, end: 9.5, text: "we're planning\nsome layoffs & cuts." },
    { start: 10, end: 12, text: '- Hey!\n- What?' },
    { start: 17, end: 18, text: "It's fine…" },
  ]);
});

test('parseTTML handles prefixed tags and clock times', () => {
  const xml = `<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div>
    <tt:p begin="00:00:01.000" end="00:00:02.500">Hi<tt:br/>there</tt:p></tt:div></tt:body></tt:tt>`;
  assert.deepEqual(parseTTML(xml), [{ start: 1, end: 2.5, text: 'Hi\nthere' }]);
});

test('pairCues matches by overlap, not by index', () => {
  const en = [
    { start: 5.4, end: 7.0, text: 'Um, as you know,' },
    { start: 7.0, end: 9.5, text: "we're planning layoffs." },
    { start: 20, end: 21, text: 'Bye.' },
  ];
  const ko = [
    { start: 5.4, end: 9.5, text: '알다시피 인원 감축이 예정되었고' },
    { start: 9.4, end: 12, text: '다음 줄' }, // 0.1s sliver with en[1] must not leak in
    { start: 20.2, end: 20.5, text: '잘 가' },
    { start: 20.5, end: 21, text: '요' },
  ];
  assert.deepEqual(pairCues(en, ko), [
    '알다시피 인원 감축이 예정되었고',
    '알다시피 인원 감축이 예정되었고',
    '잘 가\n요',
  ]);
  assert.deepEqual(pairCues(en, []), ['', '', '']);
});

test('cueIndexAt returns the last cue started', () => {
  const cues = [{ start: 1 }, { start: 3 }, { start: 3.5 }, { start: 10 }];
  assert.equal(cueIndexAt(cues, 0.5), -1);
  assert.equal(cueIndexAt(cues, 1), 0);
  assert.equal(cueIndexAt(cues, 3.2), 1);
  assert.equal(cueIndexAt(cues, 9), 2);
  assert.equal(cueIndexAt(cues, 99), 3);
  assert.equal(cueIndexAt([], 5), -1);
});

test('pickTrack prefers exact key, then language, then base language', () => {
  const tracks = [
    { lang: 'en', cc: true }, { lang: 'en', cc: false }, { lang: 'ko', cc: false }, { lang: 'pt-BR', cc: false },
  ];
  assert.equal(pickTrack(tracks, 'en'), tracks[1]);
  assert.equal(pickTrack(tracks, 'en|cc'), tracks[0]);
  assert.equal(pickTrack(tracks, 'ko|cc'), tracks[2]);
  assert.equal(pickTrack(tracks, 'pt'), tracks[3]);
  assert.equal(pickTrack(tracks, 'en-GB'), tracks[1]);
  assert.equal(pickTrack(tracks, 'ja'), null);
  assert.equal(pickTrack(tracks, ''), null);
});

test('parseTTML joins split lines top to bottom, whatever the file order', () => {
  // Netflix imsc1.1: one <p> per line, bottom line listed first, position on the region.
  const imsc = `<tt xmlns="http://www.w3.org/ns/ttml" ttp:tickRate="10000000"><head><layout>
    <region xml:id="region13" tts:displayAlign="center" tts:extent="70.000% 5.330%" tts:origin="12.500% 84.620%"/>
    <region xml:id="region14" tts:displayAlign="center" tts:extent="47.500% 5.330%" tts:origin="25.000% 79.290%"/>
    </layout></head><body><div>
    <p begin="10000000t" end="20000000t" region="region13">bottom line</p>
    <p begin="10000000t" end="20000000t" region="region14">top line</p>
    </div></body></tt>`;
  assert.equal(parseTTML(imsc)[0].text, 'top line\nbottom line');

  // Netflix dfxp-ls-sdh: bare regions, position on each <p>.
  const dfxp = `<tt ttp:tickRate="10000000"><body><div>
    <p begin="10000000t" end="20000000t" region="region_01" tts:extent="70.00% 5.33%" tts:origin="12.50% 15.33%">second</p>
    <p begin="10000000t" end="20000000t" region="region_00" tts:extent="47.50% 5.33%" tts:origin="25.00% 10.00%">first</p>
    </div></body></tt>`;
  assert.equal(parseTTML(dfxp)[0].text, 'first\nsecond');

  // Same box, told apart only by displayAlign (Netflix's Korean imsc1.1: region0 after = bottom, region1 before = top).
  const align = `<tt><head><layout>
    <region xml:id="region0" tts:displayAlign="after" tts:extent="80.000% 80.000%" tts:origin="10.000% 10.000%"/>
    <region xml:id="region1" tts:displayAlign="before" tts:extent="80.000% 80.000%" tts:origin="10.000% 10.000%"/>
    </layout></head><body><div>
    <p begin="1s" end="2s" region="region0">아래</p>
    <p begin="1s" end="2s" region="region1">위</p>
    </div></body></tt>`;
  assert.deepEqual(parseTTML(align), [{ start: 1, end: 2, text: '위\n아래' }]);
});

test('parseTTML drops Japanese furigana (tts:ruby="text")', () => {
  // Shape of Netflix's ja imsc1.1: container > base + text spans.
  const xml = `<tt ttp:tickRate="10000000"><head><styling>
    <style xml:id="container" tts:ruby="container"/><style xml:id="base" tts:ruby="base"/>
    <style xml:id="text" tts:ruby="text"/><style xml:id="style0" tts:color="white"/>
    </styling></head><body><div>
    <p begin="10000000t" end="20000000t" style="style0">ひろ<span style="container"><span style="base">子</span><span style="text">こ</span></span>そんな</p>
    <p begin="30000000t" end="40000000t"><span tts:ruby="text">よみ</span>漢字</p>
    </div></body></tt>`;
  assert.deepEqual(parseTTML(xml).map(c => c.text), ['ひろ子そんな', '漢字']);
});

test('splitWords marks words, keeps punctuation and line breaks as plain text', () => {
  assert.deepEqual(splitWords("I'm here.\n- Café?"), [
    { text: "I'm", word: true }, { text: ' ', word: false }, { text: 'here', word: true },
    { text: '.\n- ', word: false }, { text: 'Café', word: true }, { text: '?', word: false },
  ]);
  assert.deepEqual(splitWords('...'), [{ text: '...', word: false }]);
  assert.deepEqual(splitWords(''), []);
});

test('lemmaCandidates tries the word as written, then common dictionary forms', () => {
  assert.deepEqual(lemmaCandidates('Planning'), ['planning', 'plann', 'plan']);
  assert.deepEqual(lemmaCandidates('stopped'), ['stopped', 'stopp', 'stop']);
  assert.deepEqual(lemmaCandidates('loved'), ['loved', 'lov', 'love']);
  assert.deepEqual(lemmaCandidates('layoffs'), ['layoffs', 'layoff']);
  assert.deepEqual(lemmaCandidates('cities'), ['cities', 'city', 'citie']);
  assert.deepEqual(lemmaCandidates('watches'), ['watches', 'watch', 'watche']);
  assert.deepEqual(lemmaCandidates('Michael’s'), ['michael']);
  assert.deepEqual(lemmaCandidates('boss'), ['boss']);
  assert.deepEqual(lemmaCandidates('uses'), ['uses', 'use']); // no 2-letter stems: 'us' is an ISO code page
  assert.deepEqual(lemmaCandidates('ties'), ['ties', 'tie']);
});

const SAVED = [
  { type: 'word', text: 'city', meaning: '(noun) A large settlement, bigger than a town', sentence: 'I think the cities\nyou love', translation: '당신이 좋아하는 도시들', title: 'The Office', time: 26.5, savedAt: Date.UTC(2026, 9, 19) },
  { type: 'sentence', text: '- Who\'s on the list?\n- "Nobody", yet.', meaning: '- 명단에 누가 있죠?', sentence: '', translation: '', title: '', time: 3725, savedAt: Date.UTC(2026, 9, 19) },
];

test('formatTime', () => {
  assert.equal(formatTime(26.5), '0:26');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(undefined), '0:00');
  assert.equal(formatTime(26.5, true), '0:00:26');
});

test('toCSV quotes, keeps Korean readable in Excel and defuses formula-looking cells', () => {
  const csv = toCSV(SAVED);
  assert.ok(csv.startsWith('﻿type,text,meaning,sentence,translation,title,time,saved_at\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], 'word,city,"(noun) A large settlement, bigger than a town","I think the cities\nyou love",당신이 좋아하는 도시들,The Office,0:00:26,2026-10-19T00:00:00.000Z');
  assert.ok(lines[2].startsWith(`sentence,"'- Who's on the list?\n- ""Nobody"", yet.",'- 명단에 누가 있죠?,,,,1:02:05,`));
});

test('toAnki writes header lines and one escaped HTML row per item', () => {
  const rows = toAnki(SAVED).trimEnd().split('\n');
  assert.deepEqual(rows.slice(0, 3), ['#separator:tab', '#html:true', '#tags column:3']);
  assert.equal(rows[3], 'city\t(noun) A large settlement, bigger than a town<br><br><i>I think the cities<br>you love</i><br>당신이 좋아하는 도시들\tdualsub dualsub-word');
  assert.equal(rows[4], '- Who\'s on the list?<br>- &quot;Nobody&quot;, yet.\t- 명단에 누가 있죠?\tdualsub dualsub-sentence');
  assert.equal(rows.length, 5);
  assert.ok(toAnki([{ type: 'sentence', text: '#1 fan', meaning: '팬' }]).includes('\n&#35;1 fan\t팬\t'));
});

test('shortcut keys: labels, swapping on conflict, and loading saved keys', () => {
  assert.equal(keyLabel('KeyJ'), 'J');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('ArrowLeft'), '←');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel(undefined), '—');
  // a free key just moves; a taken key swaps with the action that had it
  assert.deepEqual(assignKey(DEFAULT_KEYS, 'prev', 'KeyJ'), { ...DEFAULT_KEYS, prev: 'KeyJ' });
  assert.deepEqual(assignKey(DEFAULT_KEYS, 'prev', 'KeyD'), { ...DEFAULT_KEYS, prev: 'KeyD', next: 'KeyA' });
  assert.deepEqual(assignKey(DEFAULT_KEYS, 'prev', 'KeyA'), DEFAULT_KEYS);
  assert.deepEqual(normalizeKeys({ prev: 'KeyJ', next: 42, ap: '<b>' }), { ...DEFAULT_KEYS, prev: 'KeyJ' });
  // keys saved before an action existed (copy) get its default
  assert.equal(normalizeKeys({ prev: 'KeyA', repeat: 'KeyS', next: 'KeyD', ap: 'KeyQ' }).copy, 'KeyC');
  // ...unless a saved action already took that key: then no key rather than two actions on one
  assert.equal(normalizeKeys({ prev: 'KeyC', repeat: 'KeyS', next: 'KeyD', ap: 'KeyQ' }).copy, '');
  // ...and that '' survives the next load even once the default is free again
  assert.equal(normalizeKeys({ ...DEFAULT_KEYS, copy: 'KeyX', hideOrig: '' }).hideOrig, '');
  assert.deepEqual(normalizeKeys(null), DEFAULT_KEYS);
  assert.equal(new Set(Object.values(DEFAULT_KEYS)).size, Object.keys(DEFAULT_KEYS).length); // one key per action
});

test('phraseCandidates tries the phrase, then the dictionary\'s general forms', () => {
  assert.deepEqual(phraseCandidates(['beat', 'me', 'to', 'the', 'punch']).slice(0, 3),
    ['beat me to the punch', 'beat someone to the punch', 'beat to the punch']);
  assert.ok(phraseCandidates(['kicked', 'the', 'bucket']).includes('kick the bucket'));
  assert.ok(phraseCandidates(['Lose', 'my', 'temper']).includes("lose one's temper"));
  assert.ok(phraseCandidates(['losing', 'my', 'temper']).includes("lose one's temper"));
  assert.ok(phraseCandidates(['giving', 'him', 'a', 'piece', 'of', 'my', 'mind']).includes("give someone a piece of one's mind"));
  assert.deepEqual(phraseCandidates(['I', 'mean']), ['I mean']); // the page is "I mean", not "i mean"
  assert.equal(phraseCandidates(['New', 'York']).at(-1), 'New York');
  assert.deepEqual(phraseCandidates(['You', 'know']), ['you know', 'someone know', 'You know']); // never a single word
  assert.ok(phraseCandidates(['a', 'b', 'c', 'd']).length <= 6);
});

test('UI text exists in Korean and English, picked by browser language', () => {
  const { STRINGS, uiLang, defaultLangs, dictLink } = require('./lib.js');
  assert.deepEqual(Object.keys(STRINGS.ko).sort(), Object.keys(STRINGS.en).sort()); // no key missing in either
  assert.equal(uiLang('ko-KR'), 'ko');
  assert.equal(uiLang('ja-JP'), 'en');
  assert.equal(uiLang(''), 'en');
  assert.deepEqual(defaultLangs('ko-KR'), { orig: 'en', trans: 'ko' }); // existing Korean users: unchanged
  assert.deepEqual(defaultLangs('ja'), { orig: 'en', trans: 'ja' });
  assert.deepEqual(defaultLangs('en-US'), { orig: 'es', trans: 'en' });
  assert.match(dictLink('city', 'ko-KR')[1], /naver/);
  assert.match(dictLink('city', 'ja-JP')[1], /weblio/);
  assert.equal(dictLink('beat someone to the punch', 'en-GB')[1], 'https://dictionary.cambridge.org/dictionary/english/beat-someone-to-the-punch');
  assert.match(dictLink('city', 'fr-FR')[1], /translate\.google\.com.*tl=fr/);
  // a chosen dictionary wins over the language's default
  assert.match(dictLink('city', 'ko-KR', 'daum')[1], /dic\.daum\.net.*q=city/);
  assert.equal(dictLink('look after', 'ko', 'cambridge')[1], 'https://dictionary.cambridge.org/dictionary/english-korean/look-after');
  assert.match(dictLink('city', 'ko', 'nope')[1], /naver/); // unknown choice: back to auto
});
