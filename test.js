// Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
test('guide routes regional browser languages and falls back to English', () => {
  const { guidePage } = require('./lib.js');
  for (const lang of ['ja-JP', 'zh-CN', 'es-MX', 'fr-CA', 'de-DE', 'pt-BR', 'pt-PT'])
    assert.equal(guidePage(lang), `help.intl.html?lang=${lang.split('-')[0]}`);
  assert.equal(guidePage('ko-KR'), 'help.html');
  for (const lang of ['en-US', 'it-IT', '', undefined]) assert.equal(guidePage(lang), 'help.en.html');
});
const { parseTime, parseTTML, pairCues, cueIndexAt, pickTrack, splitWords, joinWords, wiktionarySenses, wordCandidates, lemmaCandidates, formatTime, toCSV, toAnki, DEFAULT_KEYS, keyLabel, assignKey, normalizeKeys, phraseCandidates } = require('./lib.js');

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

test('splitWords finds words in every script', () => {
  const words = (s, lang) => splitWords(s, lang).filter(p => p.word).map(p => p.text);
  assert.deepEqual(words('你好,我想吃饭', 'zh'), ['你好', '我想', '吃饭']);
  assert.ok(words('私は学校で', 'ja').includes('学校'));
  assert.deepEqual(words('สวัสดีครับ', 'th'), ['สวัสดี', 'ครับ']);
  assert.deepEqual(words('मैं किताब', 'hi'), ['मैं', 'किताब']); // vowel signs stay inside the word
  assert.deepEqual(words('학교에서 밥을', 'ko'), ['학교에서', '밥을']);
  assert.deepEqual(words('Room 101', 'en'), ['Room']); // a number is no word to look up
  assert.equal(splitWords('私は\n学校', 'ja').map(p => p.text).join(''), '私は\n学校');
});

test('wiktionarySenses reads the language out of the reply', () => {
  const es = [{ language: 'Spanish' }], sh = [{ language: 'Serbo-Croatian' }], tl = [{ language: 'Tagalog' }];
  const nb = { language: 'Norwegian Bokmål' }, json = { es, sh, tl, other: [{ language: 'Old Saxon' }, nb] };
  assert.equal(wiktionarySenses(json, 'es'), es);
  assert.equal(wiktionarySenses(json, 'hr'), sh);
  assert.equal(wiktionarySenses(json, 'fil'), tl);
  assert.deepEqual(wiktionarySenses(json, 'nb'), [nb]);
  assert.deepEqual(wiktionarySenses(json, 'de'), []); // the title exists, only in other languages
});

test('joinWords and wordCandidates follow the language', () => {
  assert.equal(joinWords(['食べ', 'る'], 'ja'), '食べる');
  assert.equal(joinWords(['tener', 'en', 'cuenta'], 'es'), 'tener en cuenta');
  assert.deepEqual(wordCandidates('Häuser', 'de'), ['Häuser', 'häuser']); // German inside a sentence: as written (nouns)
  assert.deepEqual(wordCandidates('Häuser', 'de', { sentenceStart: true }), ['häuser', 'Häuser']); // opening one: no hint
  assert.deepEqual(wordCandidates('Isparta', 'tr', { sentenceStart: true }), ['ısparta', 'Isparta']); // other languages as before
  assert.deepEqual(wordCandidates('I', 'en', { sentenceStart: true }), wordCandidates('I', 'en'));
  const { startsSentence } = require('./lib.js');
  for (const before of ['', '  ', 'Da. ', 'Wie? ', 'Nein! ', 'Also… ', 'Er sagt: ', '(Ja.) ', 'Gut." ', '- ', 'Ja.\n- ', 'Ja! - ', 'Da. „', '- (', '»Nein!« ',
    '♪ ', '♪♪ ', '[Musik] ', '(lacht) ', '♪ [Musik] ', 'Ja.\n♪ ', '»', '›', 'Da. »', 'Ja,\n- ', 'Ja,\n– ', 'Ja.\n', 'Ja,\n♪ ', 'Ja,\n[Musik] ',
    '-[Ulrich] ', 'Ja.\n-[Martha] ', 'Ja,\n-[Martha] ', '- (lacht) ', '-♪ ', // a dash, then a speaker's or sound note
    'Er sagt: ‚Ja.‘ ']) // ‘ closes a German inner quote (‚…‘)
    assert.equal(startsSentence(before), true, JSON.stringify(before));
  for (const before of ['Der ', 'sagen ', 'Ja - ', 'z.B', 'Ja, ', 'Ja.', 'Haus- ',
    'Er singt ♪ ', 'Ja [Musik] ', 'Ja, »', 'Ja – ', 'Ja,\nund - ',
    'Ich sehe den\n', 'Gut\n', 'Ja,\n', 'Ja,\n„', // a cue's second line going on with the sentence
    'Er sagt „']) // known limit: a quote without a colon before it
    assert.equal(startsSentence(before), false, JSON.stringify(before));
  assert.deepEqual(wordCandidates("l’homme", 'fr'), ["l'homme", 'homme']);
  assert.deepEqual(wordCandidates('학교에서', 'ko'), ['학교에서', '학교']);
  assert.deepEqual(wordCandidates('이', 'ko'), ['이']); // a one-syllable word isn't all particle
  assert.deepEqual(wordCandidates('Isparta', 'tr'), ['ısparta', 'Isparta']); // Turkish dotless i
  assert.ok(wordCandidates('cities').includes('city')); // English keeps its suffix rules
  assert.equal(wordCandidates("I'm")[0], "I'm");
  assert.deepEqual(phraseCandidates(['Tener', 'en', 'cuenta'], 'es'), ['tener en cuenta', 'Tener en cuenta']);
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
  { type: 'word', text: 'city', meaning: '(noun) A large settlement, bigger than a town', sentence: 'I think the cities\nyou love', translation: '당신이 좋아하는 도시들', title: 'The Office', time: 26.5, savedAt: Date.UTC(2026, 9, 19), lang: 'en' },
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
  assert.ok(csv.startsWith('﻿type,text,meaning,sentence,translation,title,time,saved_at,lang\r\n')); // lang added last
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], 'word,city,"(noun) A large settlement, bigger than a town","I think the cities\nyou love",당신이 좋아하는 도시들,The Office,0:00:26,2026-10-19T00:00:00.000Z,en');
  assert.ok(lines[2].startsWith(`sentence,"'- Who's on the list?\n- ""Nobody"", yet.",'- 명단에 누가 있죠?,,,,1:02:05,`));
  assert.ok(lines[2].endsWith('Z,'), lines[2]); // an older item without a language: an empty last cell
});

test('toAnki writes header lines and one escaped HTML row per item', () => {
  const rows = toAnki(SAVED).trimEnd().split('\n');
  assert.deepEqual(rows.slice(0, 3), ['#separator:tab', '#html:true', '#tags column:3']);
  assert.equal(rows[3], 'city\t(noun) A large settlement, bigger than a town<br><br><i>I think the cities<br>you love</i><br>당신이 좋아하는 도시들\tdualsub dualsub-word dualsub-en');
  assert.equal(rows[4], '- Who\'s on the list?<br>- &quot;Nobody&quot;, yet.\t- 명단에 누가 있죠?\tdualsub dualsub-sentence'); // no lang: no tag
  assert.match(toAnki([{ type: 'word', text: 'Weg', meaning: 'way', lang: 'de' }]), /\tdualsub dualsub-word dualsub-de\n$/);
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
  assert.match(dictLink('city', 'en', 'ko-KR')[1], /naver/);
  assert.match(dictLink('city', 'en', 'ja-JP')[1], /weblio/);
  assert.equal(dictLink('beat someone to the punch', 'en', 'en-GB')[1], 'https://dictionary.cambridge.org/dictionary/english/beat-someone-to-the-punch');
  assert.match(dictLink('city', 'en', 'fr-FR')[1], /translate\.google\.com.*tl=fr/);
  // a chosen dictionary wins over the language's default
  assert.match(dictLink('city', 'en', 'ko-KR', 'daum')[1], /dic\.daum\.net.*q=city/);
  assert.equal(dictLink('look after', 'en', 'ko', 'cambridge')[1], 'https://dictionary.cambridge.org/dictionary/english-korean/look-after');
  assert.match(dictLink('city', 'en', 'ko', 'nope')[1], /naver/); // unknown choice: back to auto
  // translators go from the original's language to the translation's
  assert.match(dictLink('city', 'en-US', 'ja', 'google')[1], /sl=en&tl=ja/);
  // English dictionaries can't look up other languages, chosen or not
  assert.match(dictLink('casa', 'es', 'ko')[1], /translate\.google\.com.*sl=es&tl=ko/);
  assert.match(dictLink('casa', 'es-ES', 'en', 'cambridge')[1], /sl=es&tl=en/);
  assert.match(dictLink('casa', 'es', 'ko', 'papago')[1], /papago.*sk=es&tk=ko/);
  assert.match(dictLink('city', 'en', 'zh-Hans', 'papago')[1], /sk=en&tk=zh/);
});

// Runs the real lib.js + content.js in a VM with a minimal fake page, so load()'s hint paths are exercised for real
// (a local track variable named `t` once shadowed DualSub's t() there and every hint threw "t is not a function").
// manifestTracks: null for a watch page whose manifest never comes. player: a fake Netflix player (see fakePlayer).
// storage: with it, bridge.js runs too (its own world, chrome.storage.local over this object, key -> item), and the
// two pass messages through window as on the real page.
// faults: {get, set, remove} -> a promise chrome.storage.local returns instead (a rejection: the API failing).
// getKeys: chrome.storage.local.getKeys as a newer Chrome has it ('ok'), one that throws or rejects; null: none.
// storageCalls counts get(null) and getKeys() calls.
function contentPage({ manifestTracks, fetchText, prefs = { orig: 'en', trans: 'ko' }, player = null, storage = null, faults = {}, onSave = () => {}, getKeys = null }) {
  const vm = require('node:vm');
  const fs = require('node:fs');
  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.hidden = false;
      this.className = ''; this.textContent = ''; this.value = '';
      const cls = new Set();
      this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
        toggle: (c, on = !cls.has(c)) => (on ? cls.add(c) : cls.delete(c), on) };
      this.style = { setProperty() {} };
      created.push(this);
    }
    append(...kids) {
      for (const k of kids) if (k instanceof El) { k.parentNode = this; this.children.push(k); } else this.textContent += k;
    }
    replaceChildren(...kids) { this.children = []; this.textContent = ''; this.append(...kids); }
    setAttribute(k, v) { (this.attrs ||= {})[k] = String(v); } getAttribute(k) { return this.attrs?.[k] ?? null; }
    focus() {} blur() {} setPointerCapture() {}
    addEventListener(type, fn) { ((this.on ||= {})[type] ||= []).push(fn); }
    dispatch(type, e) { for (const fn of (this.on || {})[type] || []) fn(e); }
    has(sel) { const c = sel.slice(1); return sel[0] === '.' && (this.className.split(' ').includes(c) || this.classList.contains(c)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) { return this.children.flatMap(k => [...(k.has(sel) ? [k] : []), ...k.querySelectorAll(sel)]); }
    closest(sel) { for (let e = this; e; e = e.parentNode) if (e.has && e.has(sel)) return e; return null; }
    get isConnected() { return true; } get nextSibling() { return null; } get offsetWidth() { return 0; }
    matches() { return false; } remove() {}
    contains(e) { for (; e; e = e.parentNode) if (e === this) return true; return false; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
    getClientRects() { return this.drawn ? [this.getBoundingClientRect()] : []; } // drawn: laid out on screen
  }
  const created = [], logs = [], warnings = [], fetched = [], pending = new Map();
  let clock = 0, timerId = 0, tickFn = null;
  const page$ = {}, listeners = {}; // page$: selector -> element document.querySelector finds
  const box = { player }; // swapped by setPlayer(): the player can show up later
  const videoPlayer = {
    getAllPlayerSessionIds: () => (box.player ? ['watch-1'] : []), getVideoPlayerBySessionId: () => box.player };
  const ctx = {
    console: { info: (...a) => logs.push(a.join(' ')), warn: (...a) => warnings.push(a), log() {}, error() {} },
    navigator: { language: 'en-US' },
    localStorage: { getItem: () => JSON.stringify(prefs), setItem: (k, v) => onSave(v) }, // onSave: the prefs written
    location: { pathname: '/watch/80000001', origin: 'https://www.netflix.com' },
    // A fast clock so hydrate()'s waitFor gives up at once (no Netflix player here).
    performance: { now: () => (clock += 1000) },
    // The frame loop never runs; short waits (hydrate's polling) run at once; waits of 1 s or more (the retry
    // timers) stay pending until the test fires them, so no test really waits seconds.
    setTimeout: (fn, ms) => {
      if (fn.name === 'tick') { tickFn = fn; return 0; } // the frame loop runs only when a test calls tick()
      if (ms < 1000) return setTimeout(fn, 0);
      pending.set(++timerId, { fn, ms });
      return timerId;
    },
    clearTimeout: id => (typeof id === 'number' ? pending.delete(id) : clearTimeout(id)),
    // fetchText(url): the file's text, null for HTTP 404, a number for that HTTP status, or throw for a network error.
    // A request still open when its signal aborts (content.js's timeout) rejects like a browser's fetch, also while
    // its body is still coming. fetchText may also give { body: Promise }: headers at once, the body when it settles.
    fetch: async (url, { signal } = {}) => {
      fetched.push(url);
      const abortable = work => new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'),
          { name: 'AbortError' })));
        Promise.resolve().then(work).then(resolve, reject);
      });
      const text = await abortable(() => fetchText(url));
      return text == null ? { ok: false, status: 404 } : typeof text === 'number' ? { ok: false, status: text }
        : { ok: true, status: 200, text: () => abortable(() => (typeof text === 'object' ? text.body : text)),
          json: async () => JSON.parse(text) };
    },
    postMessage: msg => deliver(msg), addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), innerHeight: 800,
    innerWidth: 1200, Intl, Promise, AbortController, AbortSignal,
    DOMParser: class { parseFromString(html) { const b = new El('body'); b.textContent = String(html).replace(/<[^>]*>/g, ''); return { body: b, querySelector: sel => {
      // Wiktionary's "plural of city": the base form is the title of the link in .form-of-definition-link
      const m = sel === '.form-of-definition-link a' && /form-of-definition-link[^>]*>(?:<[^>]*>)*?<a [^>]*title="([^"]+)"/.exec(String(html));
      return m ? { title: m[1] } : null;
    } }; } },
    netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer }) } } } },
    document: {
      createElement: tag => new El(tag), createElementNS: (ns, tag) => new El(tag),
      addEventListener() {}, querySelector: sel => page$[sel] || null, fullscreenElement: null, elementFromPoint: () => page$.pointAt,
      documentElement: new El('html'), body: new El('body'),
    },
  };
  ctx.window = ctx;
  ctx.Element = El;
  // window.postMessage: every listener of the page's window gets it a moment later, in either world (source: that
  // world's own window, which is what both scripts check).
  const worlds = [{ win: null, on: listeners }]; // win: set once the context exists (its own `window`)
  const deliver = msg => setTimeout(() => {
    for (const w of worlds) for (const fn of w.on.message || []) fn({ data: structuredClone(msg), source: w.win });
  }, 0);
  const posted = [], replies = []; // what content.js sent the bridge, and the bridge's answers
  worlds.push({ win: null, on: { message: [e => {
    if (e.data.source === 'dualsub') posted.push(e.data);
    if (e.data.source === 'dualsub-bridge') replies.push(e.data);
  }] } });
  const storageCalls = { get: 0, getKeys: 0 };
  let otherTab = null; // chrome.storage written by another tab (or the toolbar list): its onChanged reaches this one
  if (storage) {
    const changed = [], bridgeOn = {};
    const local = {
      get: async () => { storageCalls.get++; return faults.get ? faults.get() : structuredClone(storage); },
      set: async obj => {
        if (faults.set) return faults.set(obj);
        Object.assign(storage, structuredClone(obj)); changed.forEach(fn => fn(obj, 'local'));
      },
      remove: async key => {
        if (faults.remove) return faults.remove(key);
        if (key in storage) { delete storage[key]; changed.forEach(fn => fn({ [key]: {} }, 'local')); }
      },
    };
    if (getKeys) local.getKeys = () => {
      storageCalls.getKeys++;
      if (getKeys === 'throw') throw new TypeError('getKeys is not supported');
      return getKeys === 'reject' ? Promise.reject(new Error('no getKeys')) : Promise.resolve(Object.keys(storage));
    };
    otherTab = { set: obj => { Object.assign(storage, structuredClone(obj)); changed.forEach(fn => fn(obj, 'local')); },
      remove: key => { delete storage[key]; changed.forEach(fn => fn({ [key]: {} }, 'local')); } };
    const bridge = { chrome: { storage: { local, onChanged: { addListener: fn => changed.push(fn) } } }, location: ctx.location,
      console: ctx.console, postMessage: msg => deliver(msg), addEventListener: (type, fn) => (bridgeOn[type] ||= []).push(fn) };
    bridge.window = bridge;
    vm.createContext(bridge);
    vm.runInContext(fs.readFileSync(`${__dirname}/bridge.js`, 'utf8'), bridge, { filename: 'bridge.js' });
    worlds.push({ win: vm.runInContext('window', bridge), on: bridgeOn });
  }
  vm.createContext(ctx);
  worlds[0].win = vm.runInContext('window', ctx);
  for (const f of ['lib.js', 'content.js']) vm.runInContext(fs.readFileSync(`${__dirname}/${f}`, 'utf8'), ctx, { filename: f });
  const ui = vm.runInContext('DualSub.t', ctx);
  const hintEl = created.find(e => e.className === 'ds-hint');
  const strip = created.find(e => e.className === 'ds-strip');
  const list = created.find(e => e.id === 'dualsub-list');
  const transSel = created.find(e => e.tagName === 'SELECT' && e.title === ui('transSub'));
  // A player manifest for a title, as Netflix sends it (content.js wraps JSON.parse); loads it if it is the open one.
  const manifestFor = (movieId, textTracks) =>
    vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({ result: { movieId, textTracks } }))})`, ctx);
  if (manifestTracks) manifestFor(80000001, manifestTracks);
  // Another title: the URL changes, then its manifest arrives.
  const watch = (movieId, textTracks) => { ctx.location.pathname = `/watch/${movieId}`; manifestFor(movieId, textTracks); };
  const timers = () => [...pending.values()].map(x => x.ms); // the pending retry delays
  const fire = () => { const due = [...pending.values()]; pending.clear(); due.forEach(x => x.fn()); };
  const until = async (ok, what) => {
    for (let i = 0; i < 500; i++) { if (ok()) return; await new Promise(r => setTimeout(r, 1)); }
    assert.fail(`timed out waiting for ${what}; hint=${JSON.stringify(hintEl.textContent)} warnings=${warnings}`);
  };
  // Each list item is [original line, its translation].
  const lines = () => list.children.map(item => item.children.map(c => c.textContent));
  const pickTrans = value => { transSel.value = value; transSel.onchange({ target: transSel }); };
  const origSel = created.find(e => e.tagName === 'SELECT' && e.title === ui('origSub'));
  const pickOrig = value => { origSel.value = value; origSel.onchange({ target: origSel }); };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1)); };
  const popup = created.find(e => e.id === 'dualsub-popup'), origEl = created.find(e => e.className === 'ds-orig');
  const transEl = created.find(e => e.className === 'ds-trans');
  const goPath = path => { ctx.location.pathname = path; }; // the URL changes, no manifest (yet)
  // The page's <video> and Netflix's own elements, by the selector content.js looks them up with.
  const show = (sel, e) => { if (e) page$[sel] = e; else delete page$[sel]; };
  const tick = (n = 6) => { for (let i = 0; i < n; i++) tickFn(); }; // 6 frames: one round of the 100 ms checks
  const key = code => { // a keydown as the page sees it; true if content.js took it
    let taken = false;
    const e = { code, target: null, preventDefault() { taken = true; }, stopImmediatePropagation() {} };
    for (const fn of listeners.keydown || []) fn(e);
    return taken;
  };
  const root = created.find(e => e.id === 'dualsub-root'), panel = created.find(e => e.id === 'dualsub-panel');
  // The hint once the download settled: "Loading …" shows while the original's lines are on their way.
  const loadingHint = ui('hintLoading', '\u0000').split('\u0000')[0];
  const outcome = () => !!hintEl.textContent && !hintEl.textContent.startsWith(loadingHint);
  return { ui, hint: () => hintEl.textContent, outcome, strip, transSel, lines, pickTrans, watch, timers, fire, settle, logs, warnings,
    fetched, until, manifest: manifestFor, popup, origEl, transEl, goPath, setPlayer: p => { box.player = p; }, pickOrig,
    show, tick, key, root, panel, online: () => (listeners.online || []).forEach(fn => fn({ type: 'online' })), list, El, posted, replies, otherTab, storageCalls, hintEl, toastEl: created.find(e => e.id === 'dualsub-toast'), send: msg => deliver({ source: 'dualsub', ...msg }),
    star: created.find(e => e.tagName === 'BUTTON' && e.title === ui('saveLine')),
    wordStar: () => created.filter(e => e.className === 'ds-pop-star').pop() || null,
    // Click a word of the shown line, or press on word `from` and release on word `to` (a phrase).
    pickWords: (from, to = from) => {
      const spans = origEl.querySelectorAll('.ds-word');
      origEl.dispatch('pointerdown', { target: spans[from], button: 0, pointerId: 1 });
      page$.pointAt = spans[to];
      origEl.dispatch('pointermove', { pointerId: 1, buttons: 1 });
      origEl.dispatch('pointerup', { pointerId: 1 });
    } };
}
const track = (language, url, extra = {}) => ({ new_track_id: `T-${language}`, language, languageDescription:
  { en: 'English', ko: 'Korean', ja: 'Japanese' }[language], rawTrackType: 'subtitles', hydrated: !!url,
  downloadables: url ? { 'imsc1.1': { urls: [{ url }] } } : {}, ...extra });
const ttml = text => `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s">${text}</p></div></body></tt>`;

test('content load(): both tracks load, cues render and no hint shows', async () => {
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko')],
    fetchText: url => ttml(url.endsWith('en') ? 'Hello' : '안녕') });
  await page.until(() => page.logs.some(l => l.includes('loaded en')), 'the load');
  assert.ok(page.logs.some(l => l.includes('loaded en (1) + ko (1)')), page.logs.join('\n'));
  assert.equal(page.strip.children.length, 1);
  assert.equal(page.hint(), '');
  assert.deepEqual(page.warnings, []);
});

test('content load(): no original-language track shows hintNoTrack', async () => {
  const page = contentPage({ manifestTracks: [track('ko', 'https://x/ko')], fetchText: () => ttml('안녕') });
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintNoTrack'));
  assert.deepEqual(page.warnings, []);
});

test('content load(): a track without a URL shows hintLoading, then hintTurnOn', async () => {
  const page = contentPage({ manifestTracks: [track('en', null, { hydrated: false }), track('ko', 'https://x/ko')],
    fetchText: () => ttml('안녕') });
  await page.until(() => page.hint(), 'a hint');
  assert.equal(page.hint(), page.ui('hintLoading', 'English'));
  // No Netflix player to switch subtitles with: hydration gives up and load() asks the user to turn it on.
  await page.until(() => page.hint() === page.ui('hintTurnOn', 'English'), 'hintTurnOn');
  assert.equal(page.warnings.filter(w => String(w[0]).includes('subtitle fetch failed')).length, 0);
});

test('content load(): a failed subtitle fetch shows hintFailed', async () => {
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko')],
    fetchText: url => (url.endsWith('en') ? null : ttml('안녕')) });
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintFailed'));
  assert.equal(page.warnings.length, 1);
  assert.match(String(page.warnings[0][0]), /subtitle fetch failed/);
  assert.match(String(page.warnings[0][1]), /HTTP 404/);
});

test('content load(): both tracks loaded pair each original line with its translation', async () => {
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko')],
    fetchText: url => ttml(url.endsWith('en') ? 'Hello' : '안녕') });
  await page.until(() => page.lines().length, 'the cues');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(page.hint(), '');
});

test('content load(): only the translation failing still shows the original, with hintTransFailed', async () => {
  for (const fail of [() => null, () => { throw new TypeError('Failed to fetch'); }]) { // HTTP 404 / network error
    const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko')],
      fetchText: url => (url.endsWith('en') ? ttml('Hello') : fail()) });
    await page.until(() => page.outcome(), 'a hint');
    assert.deepEqual(page.lines(), [['Hello', '']]);
    assert.equal(page.strip.children.length, 1);
    assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
    assert.notEqual(page.hint(), page.ui('hintFailed'));
    assert.equal(page.warnings.length, 1);
    assert.match(String(page.warnings[0][0]), /translation fetch failed/);
  }
});

test('content load(): the original failing keeps hintFailed and shows no lines', async () => {
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko')],
    fetchText: url => (url.endsWith('ko') ? ttml('안녕') : null) });
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintFailed'));
  assert.deepEqual(page.lines(), []);
});

test('content load(): translation off or not offered is not a download failure (not offered: a note says so)', async () => {
  for (const trans of ['', 'ja']) { // ⚙ "none", and a language this title has no subtitles in
    const page = contentPage({ prefs: { orig: 'en', trans },
      manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko')], fetchText: () => ttml('Hello') });
    await page.until(() => page.lines().length, 'the cues');
    assert.deepEqual(page.lines(), [['Hello', '']]);
    assert.deepEqual(page.fetched, ['https://x/en']);
    assert.equal(page.hint(), trans ? page.ui('hintNoTrans', 'Japanese') : '');
    assert.deepEqual(page.warnings, []);
  }
});

test('content load(): a translation language this title lacks gets a note, and stays chosen for the next title', async () => {
  const saved = [];
  const page = contentPage({ prefs: { orig: 'en', trans: 'ko' }, manifestTracks: [track('en', 'https://x/en'), track('ja', 'https://x/ja')],
    fetchText: url => ttml(url.endsWith('ko') ? '안녕' : 'Hello'), onSave: v => saved.push(JSON.parse(v)) });
  await page.until(() => page.lines().length, 'the cues');
  assert.equal(page.hint(), page.ui('hintNoTrans', 'Korean'));
  assert.equal(page.transSel.value, ''); // the select shows "none"…
  page.manifest(80000001, [track('en', 'https://x/en'), track('ja', 'https://x/ja')]); // a refresh: the same note
  await page.settle();
  assert.equal(page.hint(), page.ui('hintNoTrans', 'Korean'));
  page.watch(80000002, [track('en', 'https://x/1/en'), track('ko', 'https://x/1/ko')]); // …but Korean is still the choice
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the Korean lines');
  assert.equal(page.hint(), '');
  assert.ok(saved.every(p => p.trans === 'ko'), JSON.stringify(saved)); // no prefs write ever replaced the choice
  // Failures and the first download keep their hints over the note.
  const failing = contentPage({ prefs: { orig: 'en', trans: 'ko' }, manifestTracks: [track('en', 'https://x/en')], fetchText: () => null });
  await failing.until(() => failing.outcome(), 'a hint');
  assert.equal(failing.hint(), failing.ui('hintFailed'));
  const slow = contentPage({ prefs: { orig: 'en', trans: 'ko' }, manifestTracks: [track('en', 'https://x/en')], fetchText: () => new Promise(() => {}) });
  await slow.settle();
  assert.equal(slow.hint(), slow.ui('hintLoading', 'English'));
  // An original without its URL yet: the hydrate hint, not the note.
  const dehydrated = contentPage({ prefs: { orig: 'en', trans: 'ko' }, manifestTracks: [track('en', null, { hydrated: false })], fetchText: () => null });
  await dehydrated.until(() => dehydrated.hint() === dehydrated.ui('hintTurnOn', 'English'), 'hintTurnOn');
});

test('content load(): switching to a translation that fails drops the old translation', async () => {
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko'),
    track('ja', 'https://x/ja')], fetchText: url => ({ en: ttml('Hello'), ko: ttml('안녕') })[url.slice(-2)] });
  await page.until(() => page.lines().length, 'the cues');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  page.pickTrans('ja');
  await page.until(() => page.outcome(), 'a hint');
  assert.deepEqual(page.lines(), [['Hello', '']]); // no Korean left beside the lines
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Japanese'));
  page.pickTrans('ko'); // a working translation again clears the hint
  await page.until(() => !page.hint(), 'the hint to clear');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
});

test('content load(): a stale translation failure does not override a newer load', async () => {
  let failJa;
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', 'https://x/ko'),
    track('ja', 'https://x/ja')], fetchText: url => url.endsWith('ja') ? new Promise(r => { failJa = () => r(null); })
    : ({ en: ttml('Hello'), ko: ttml('안녕') })[url.slice(-2)] });
  await page.until(() => page.lines().length, 'the cues');
  page.pickTrans('ja'); // slow, and will fail
  page.pickTrans('ko'); // the newer choice
  await page.until(() => failJa, 'the Japanese fetch');
  failJa();
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1));
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(page.hint(), '');
  assert.deepEqual(page.warnings, []);
});

// fetchText that answers from a list per URL, one entry per request (the last one repeats).
const scripted = answers => { const n = {}; return url => {
  const list = answers[url.slice(-2)], a = list[Math.min(n[url] = (n[url] ?? -1) + 1, list.length - 1)];
  if (a instanceof Error) throw a;
  return a;
}; };
const count = (page, lang) => page.fetched.filter(u => u.endsWith(lang)).length;
const both = () => [track('en', 'https://x/en'), track('ko', 'https://x/ko')];

test('content retry: a translation that failed for a passing reason comes back by itself', async () => {
  const page = contentPage({ manifestTracks: both(),
    fetchText: scripted({ en: [ttml('Hello')], ko: [503, ttml('안녕')] }) });
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
  assert.deepEqual(page.lines(), [['Hello', '']]);
  assert.deepEqual(page.timers(), [2000]); // one retry, later
  page.fire();
  await page.until(() => !page.hint(), 'the hint to clear');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(count(page, 'en'), 1); // the original's lines were kept (cached), not downloaded again
  assert.equal(count(page, 'ko'), 2);
  assert.deepEqual(page.timers(), []);
});

test('content retry: an original that failed on the network comes back by itself', async () => {
  const page = contentPage({ manifestTracks: both(),
    fetchText: scripted({ en: [new TypeError('Failed to fetch'), ttml('Hello')], ko: [ttml('안녕')] }) });
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintFailed'));
  assert.deepEqual(page.lines(), []);
  assert.deepEqual(page.timers(), [2000]);
  page.fire();
  await page.until(() => page.lines().length, 'the cues');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(page.hint(), '');
  assert.equal(count(page, 'en'), 2);
  assert.equal(count(page, 'ko'), 1); // the translation that had loaded came from the cache
});

test('content retry: a download that keeps failing is tried 3 more times, further apart, then left alone', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [503] }) });
  await page.until(() => page.outcome(), 'a hint');
  for (const ms of [2000, 5000, 15000]) {
    assert.deepEqual(page.timers(), [ms]);
    page.fire();
    await page.settle();
  }
  assert.deepEqual(page.timers(), []);
  assert.equal(count(page, 'ko'), 4); // the first try + 3 retries
  assert.deepEqual(page.lines(), [['Hello', '']]); // the original stays up the whole time
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
});

test('content retry: 403/404 and the original\'s 404 are not retried', async () => {
  for (const answers of [{ en: [ttml('Hello')], ko: [403] }, { en: [ttml('Hello')], ko: [404] },
    { en: [404], ko: [ttml('안녕')] }]) {
    const page = contentPage({ manifestTracks: both(), fetchText: scripted(answers) });
    await page.until(() => page.outcome(), 'a hint');
    assert.deepEqual(page.timers(), []);
  }
});

test('content retry: a 404 translation is not asked for again on manifest refreshes, until the language or title changes', async () => {
  const page = contentPage({ manifestTracks: [...both(), track('ja', 'https://x/ja')],
    fetchText: scripted({ en: [ttml('Hello')], ko: [404, ttml('안녕')], ja: [ttml('こんにちは')] }) });
  await page.until(() => page.outcome(), 'a hint');
  for (let i = 0; i < 3; i++) { page.manifest(80000001, [...both(), track('ja', 'https://x/ja')]); await page.settle(); }
  assert.equal(count(page, 'ko'), 1); // the first load only
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean')); // the failure hint stays
  assert.deepEqual(page.lines(), [['Hello', '']]);
  page.pickTrans('ja');
  await page.until(() => !page.hint(), 'Japanese');
  page.pickTrans('ko'); // the user picks it again: tried again
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the Korean lines');
  assert.equal(count(page, 'ko'), 2);

  // Another title, the same (bad) URL: tried again there; and back on the first title, again.
  const page2 = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [404] }) });
  await page2.until(() => page2.outcome(), 'a hint');
  page2.manifest(80000001, both());
  await page2.settle();
  assert.equal(count(page2, 'ko'), 1);
  page2.watch(80000002, both());
  await page2.settle();
  assert.equal(count(page2, 'ko'), 2);
  page2.watch(80000001, both());
  await page2.settle();
  assert.equal(count(page2, 'ko'), 3);
  assert.equal(page2.hint(), page2.ui('hintTransFailed', 'Korean'));
});

test('content retry: once the retries ran out, a manifest refresh does not ask again', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [503] }) });
  await page.until(() => page.outcome(), 'a hint');
  for (let i = 0; i < 3; i++) { page.fire(); await page.settle(); }
  assert.equal(count(page, 'ko'), 4);
  for (let i = 0; i < 3; i++) { page.manifest(80000001, both()); await page.settle(); }
  assert.equal(count(page, 'ko'), 4);
  assert.deepEqual(page.timers(), []);
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
});

test('content retry: a network failure that used up its retries is tried again on the next load, and comes back', async () => {
  const net = () => new TypeError('Failed to fetch');
  const page = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [net(), net(), net(), net(), ttml('안녕')] }) });
  await page.until(() => page.outcome(), 'a hint');
  for (let i = 0; i < 3; i++) { page.fire(); await page.settle(); }
  assert.equal(count(page, 'ko'), 4);
  assert.deepEqual(page.timers(), []);
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
  page.manifest(80000001, both()); // not given up on: the connection may be back
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the Korean lines');
  assert.equal(count(page, 'ko'), 5);
  assert.equal(page.hint(), '');
});

test('content retry: back online, a URL given up on is tried once more; with nothing failed, online asks for nothing', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [404, ttml('안녕')] }) });
  await page.until(() => page.outcome(), 'a hint');
  page.manifest(80000001, both());
  await page.settle();
  assert.equal(count(page, 'ko'), 1); // given up on (K2)
  page.online();
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the Korean lines');
  assert.equal(count(page, 'ko'), 2);
  assert.equal(page.hint(), '');
  const loads = page.logs.filter(l => l.includes('loaded')).length;
  page.online(); // all loaded: nothing to do, not even a load from the cache
  await page.settle();
  assert.equal(page.logs.filter(l => l.includes('loaded')).length, loads);
  assert.equal(count(page, 'ko'), 2);
  assert.equal(count(page, 'en'), 1);
  // Retries spent on the network (not given up on, but no load since): online loads again too.
  const net = () => new TypeError('Failed to fetch');
  const page2 = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [net(), net(), net(), net(), ttml('안녕')] }) });
  await page2.until(() => page2.outcome(), 'a hint');
  for (let i = 0; i < 3; i++) { page2.fire(); await page2.settle(); }
  page2.online();
  await page2.until(() => page2.lines()[0]?.[1] === '안녕', 'the Korean lines');
  assert.equal(count(page2, 'ko'), 5);
});

test('content retry: picking another translation cancels the pending retry', async () => {
  const page = contentPage({ manifestTracks: [...both(), track('ja', 'https://x/ja')],
    fetchText: scripted({ en: [ttml('Hello')], ko: [503], ja: [ttml('こんにちは')] }) });
  await page.until(() => page.outcome(), 'a hint');
  assert.deepEqual(page.timers(), [2000]);
  page.pickTrans('ja');
  await page.until(() => !page.hint(), 'the hint to clear');
  assert.deepEqual(page.timers(), []);
  assert.deepEqual(page.lines(), [['Hello', 'こんにちは']]);
  await page.settle();
  assert.equal(count(page, 'ko'), 1); // the Korean retry never ran
});

test('content retry: another title cancels the pending retry, and leaving the player never retries', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: url => (url.includes('/1/') ? ttml(url.endsWith('en')
    ? 'Second' : '둘째') : url.endsWith('ko') ? 503 : ttml('Hello')) });
  await page.until(() => page.outcome(), 'a hint');
  assert.deepEqual(page.timers(), [2000]);
  page.watch(80000002, [track('en', 'https://x/1/en'), track('ko', 'https://x/1/ko')]);
  await page.until(() => page.lines()[0]?.[0] === 'Second', 'the second title');
  assert.deepEqual(page.timers(), []);
  assert.deepEqual(page.lines(), [['Second', '둘째']]);
  assert.equal(page.fetched.filter(u => u === 'https://x/ko').length, 1);

  // A retry still pending when the user leaves the player (no load() runs then) does nothing when it fires.
  const page2 = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [503] }) });
  await page2.until(() => page2.hint(), 'a hint');
  page2.watch('browse', []); // /watch/browse is not a title page: movieId() is now undefined
  page2.fire();
  await page2.settle();
  assert.equal(count(page2, 'ko'), 1);
});

test('content retry: a load from hydrate in between neither re-downloads the failed URL nor spends a retry', async () => {
  const page = contentPage({ manifestTracks: [track('en', null, { hydrated: false }), track('ko', 'https://x/ko')],
    fetchText: scripted({ ko: [503] }) });
  await page.until(() => page.timers().includes(2000), 'a retry');
  // hydrate() gives up (no player here) and calls load() again while the Korean waits for its retry.
  await page.until(() => page.hint() === page.ui('hintTurnOn', 'English'), 'hintTurnOn');
  await page.settle();
  assert.deepEqual(page.timers(), [2000]); // the same retry, still 2 s, not a second one
  assert.equal(count(page, 'ko'), 1);
  page.fire();
  await page.settle();
  assert.deepEqual(page.timers(), [5000]); // the retry ran: then the 2nd of 3
  assert.equal(count(page, 'ko'), 2);
});

// A Netflix player with these subtitle tracks, `current` on (null: Netflix's subtitles off). onSet(track) runs when
// setTimedTextTrack switches, as Netflix would (e.g. send a manifest with the URL); calls lists every switch.
function fakePlayer(trackIds, current, onSet) {
  const list = trackIds.map(trackId => ({ trackId }));
  const p = { calls: [], current: list.find(x => x.trackId === current) || null,
    getMovieId: () => 80000001, getTimedTextTrackList: () => list, getTimedTextTrack: () => p.current,
    setTimedTextTrack: async tr => { p.calls.push(tr.trackId); p.current = tr; if (onSet) await onSet(tr, p, list); } };
  return p;
}
const dehydratedEn = () => [track('en', null, { hydrated: false }), track('ko', 'https://x/ko')];
const helloKo = scripted({ en: [ttml('Hello')], ko: [ttml('안녕')] });

test('hydrate: switches to the URL-less language, then puts the user\'s subtitles back', async () => {
  let page;
  const player = fakePlayer(['T-en', 'T-ko'], 'T-ko', tr => tr.trackId === 'T-en' && page.manifest(80000001, both()));
  page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo, player });
  await page.until(() => page.lines()[0]?.[0] === 'Hello' && player.calls.length === 2, 'the hydrated lines');
  assert.deepEqual(player.calls, ['T-en', 'T-ko']);
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(page.hint(), '');
});

test('hydrate: a subtitle the user picks in Netflix\'s menu meanwhile is not overwritten', async () => {
  const player = fakePlayer(['T-en', 'T-ko', 'T-ja'], 'T-ko', (tr, p, list) => { p.current = list[2]; }); // user: ja
  const page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo, player });
  await page.until(() => page.hint() === page.ui('hintTurnOn', 'English'), 'hintTurnOn');
  await page.settle();
  assert.deepEqual(player.calls, ['T-en']); // no switch back to Korean over the user's Japanese
});

test('hydrate: with Netflix\'s subtitles off nothing is switched back (no known way to turn them off)', async () => {
  let page;
  const player = fakePlayer(['T-en', 'T-ko'], null, tr => tr.trackId === 'T-en' && page.manifest(80000001, both()));
  page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo, player });
  await page.until(() => page.lines()[0]?.[0] === 'Hello', 'the hydrated lines');
  await page.settle();
  assert.deepEqual(player.calls, ['T-en']);
});

test('hydrate: no player yet is not final; a later load tries again once it is there', async () => {
  const page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo });
  await page.until(() => page.hint() === page.ui('hintTurnOn', 'English'), 'hintTurnOn'); // not "Loading…" forever
  assert.equal(page.logs.filter(l => l.includes('cannot load T-en')).length, 1); // and no loop of its own
  const player = fakePlayer(['T-en', 'T-ko'], 'T-ko', tr => tr.trackId === 'T-en' && page.manifest(80000001, both()));
  page.setPlayer(player);
  page.pickTrans('ko'); // any later load(): same choice, a new manifest, a retry
  await page.until(() => page.lines()[0]?.[0] === 'Hello', 'the hydrated lines');
  assert.deepEqual(player.calls, ['T-en', 'T-ko']);
  assert.equal(page.hint(), '');
});

test('hydrate: attempts that never get to switch stop after 3', async () => {
  const page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo });
  for (let i = 0; i < 5; i++) {
    await page.until(() => page.hint() === page.ui('hintTurnOn', 'English'), 'hintTurnOn');
    await page.settle();
    page.pickTrans('ko');
  }
  await page.settle();
  assert.equal(page.logs.filter(l => l.includes('cannot load T-en')).length, 3);
});

test('hydrate: leaving the title mid-way neither switches back there nor counts as done', async () => {
  let release;
  const player = fakePlayer(['T-en', 'T-ko'], 'T-ko', () => new Promise(r => { release = r; }));
  const page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo, player });
  await page.until(() => release, 'the switch');
  page.goPath('/watch/80000002');
  release();
  await page.settle();
  assert.deepEqual(player.calls, ['T-en']); // the departed title's Korean is not switched back on
  release = null;
  page.goPath('/watch/80000001');
  page.manifest(80000001, dehydratedEn()); // back on the title: a fresh attempt
  await page.until(() => release, 'a second switch');
  assert.deepEqual(player.calls, ['T-en', 'T-en']);
});

test('tracks: of two with the same language, the one with a URL is used', async () => {
  const page = contentPage({ manifestTracks: [track('en', null, { hydrated: false, new_track_id: 'T-en-a' }),
    track('en', 'https://x/en'), track('ko', 'https://x/ko')], fetchText: helloKo });
  await page.until(() => page.lines().length, 'the cues');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(page.hint(), '');
  await page.settle();
  assert.equal(page.logs.filter(l => l.includes('cannot load')).length, 0); // no needless hydrate
});

test('fetch timeout: a hanging download is given up, its cache entry dropped, and retried', async () => {
  const hang = new Promise(() => {});
  for (const [answers, failed] of [[{ en: [ttml('Hello')], ko: [hang, ttml('안녕')] }, 'hintTransFailed'],
    [{ en: [hang, ttml('Hello')], ko: [ttml('안녕')] }, 'hintFailed']]) {
    const page = contentPage({ manifestTracks: both(), fetchText: scripted(answers) });
    await page.until(() => page.timers().filter(ms => ms === 20000).length === 1 && count(page, 'ko') && count(page, 'en'),
      'only the hanging download left');
    await page.settle();
    assert.deepEqual(page.timers(), [20000]);
    if (failed === 'hintFailed') assert.equal(page.hint(), page.ui('hintLoading', 'English')); // nothing on screen yet: the wait is said, not blank
    else { // O2: the original's lines show while the translation hangs, and that wait is said
      assert.equal(page.hint(), page.ui('hintLoading', 'Korean'));
      assert.deepEqual(page.lines(), [['Hello', '']]);
    }
    page.fire(); // 20 s pass
    await page.until(() => page.outcome(), 'a hint');
    assert.equal(page.hint(), failed === 'hintFailed' ? page.ui('hintFailed') : page.ui('hintTransFailed', 'Korean'));
    assert.deepEqual(page.timers(), [2000]);
    page.fire();
    await page.until(() => !page.hint() && page.lines().length, 'the recovery');
    assert.deepEqual(page.lines(), [['Hello', '안녕']]);
    assert.deepEqual(page.timers(), []); // no timeout left running after a finished download
  }
});

test('same lines from a new URL keep the shown line and popup; changed lines reset them', async () => {
  const page = contentPage({ manifestTracks: both(),
    fetchText: url => ttml(url.endsWith('ko') ? '안녕' : url.endsWith('en2') ? 'Changed' : 'Hello') });
  await page.until(() => page.lines().length, 'the cues');
  page.popup.hidden = false; page.origEl.textContent = 'Hello'; // as if the line shows and a word popup is open
  page.manifest(80000001, [track('en', 'https://x/en?sig=2'), track('ko', 'https://x/ko')]); // refreshed URL
  await page.until(() => page.fetched.includes('https://x/en?sig=2'), 'the new URL');
  await page.settle();
  assert.equal(page.popup.hidden, false);
  assert.equal(page.origEl.textContent, 'Hello');
  page.manifest(80000001, [track('en', 'https://x/en2'), track('ko', 'https://x/ko')]); // really other lines
  await page.until(() => page.lines()[0]?.[0] === 'Changed', 'the changed lines');
  assert.equal(page.popup.hidden, true);
  assert.equal(page.origEl.textContent, '');
});

test('no manifest on a watch page: a hint after a while, none if it arrives', async () => {
  const page = contentPage({ manifestTracks: null, fetchText: helloKo });
  assert.deepEqual(page.timers(), [10000]);
  assert.equal(page.hint(), '');
  page.fire();
  assert.equal(page.hint(), page.ui('hintNoManifest'));
  page.manifest(80000001, both()); // it turns up later after all
  await page.until(() => page.lines().length, 'the cues');
  assert.equal(page.hint(), '');

  const page2 = contentPage({ manifestTracks: null, fetchText: helloKo });
  page2.manifest(80000001, both());
  assert.deepEqual(page2.timers().filter(ms => ms === 10000), []);
  await page2.until(() => page2.lines().length, 'the cues');
  assert.equal(page2.hint(), '');
});

test('cue cache: keeps the 8 most recently used files', async () => {
  const langs = ['ko', 'ja', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'da'];
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), ...langs.map(l => track(l, `https://x/${l}`))],
    fetchText: url => ttml(url.slice(-2)) });
  await page.until(() => page.lines()[0]?.[1] === 'ko', 'Korean');
  for (const l of [...langs.slice(1), 'ko', 'da']) {
    page.pickTrans(l);
    await page.until(() => page.lines()[0]?.[1] === l, l);
  }
  assert.equal(count(page, 'en'), 1); // in use all along
  assert.equal(count(page, 'ko'), 2); // pushed out, so downloaded again
  assert.equal(count(page, 'da'), 1); // still kept
});

test('no manifest, then it comes but the lines are slow: a loading hint, not the reload one', async () => {
  const page = contentPage({ manifestTracks: null,
    fetchText: scripted({ en: [new Promise(() => {}), ttml('Hello')], ko: [ttml('안녕')] }) });
  page.fire();
  assert.equal(page.hint(), page.ui('hintNoManifest'));
  page.manifest(80000001, both()); // the English hangs
  assert.equal(page.hint(), page.ui('hintLoading', 'English'));
  await page.until(() => page.timers().includes(20000) && count(page, 'ko'), 'the hanging download');
  await page.settle();
  page.fire(); // its timeout
  await page.until(() => page.hint() === page.ui('hintFailed'), 'hintFailed');
  page.fire(); // the retry
  await page.until(() => page.lines().length, 'the cues');
  assert.equal(page.hint(), '');
});

test('content retry: manifests in a row while a retry waits do not re-download or use up the retries', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: scripted({ en: [ttml('Hello')], ko: [503, ttml('안녕')] }) });
  await page.until(() => page.timers().includes(2000), 'a retry');
  for (let i = 0; i < 3; i++) { page.manifest(80000001, both()); await page.settle(); }
  assert.equal(count(page, 'ko'), 1);
  assert.deepEqual(page.timers(), [2000]);
  assert.deepEqual(page.lines(), [['Hello', '']]); // the original stays up meanwhile
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
  page.fire(); // the retry, when it was due
  await page.until(() => !page.hint(), 'the recovery');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.equal(count(page, 'ko'), 2);
});

test('content retry: a new URL for the same language while a retry waits downloads at once', async () => {
  const page = contentPage({ manifestTracks: both(),
    fetchText: url => (url === 'https://x/ko' ? 503 : ttml(url.includes('ko') ? '안녕' : 'Hello')) });
  await page.until(() => page.timers().includes(2000), 'a retry');
  page.manifest(80000001, [track('en', 'https://x/en'), track('ko', 'https://x/ko?sig=2')]);
  await page.until(() => !page.hint(), 'the new URL to load');
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
  assert.deepEqual(page.timers(), []); // nothing left to retry
});

test('content retry: a success gives later failures their full retries again', async () => {
  const n = {};
  const page = contentPage({ manifestTracks: both(), fetchText: url => {
    n[url] = (n[url] || 0) + 1;
    return url.endsWith('en') ? ttml('Hello') : url === 'https://x/ko' && n[url] === 3 ? ttml('안녕') : 503;
  } });
  await page.until(() => page.timers().includes(2000), 'retry 1');
  page.fire();
  await page.until(() => page.timers().includes(5000), 'retry 2');
  page.fire();
  await page.until(() => !page.hint(), 'the recovery');
  page.manifest(80000001, [track('en', 'https://x/en'), track('ko', 'https://x/ko?sig=2')]); // a new URL that fails
  await page.until(() => page.outcome(), 'a hint');
  assert.deepEqual(page.timers(), [2000]); // counted from 1 again, not the 3rd (15 s)
});

test('cue cache: an evicted download failing late does not drop the newer entry for its URL', async () => {
  let failOld;
  const langs = ['ja', 'fr', 'de', 'es', 'it', 'pt', 'nl'];
  const page = contentPage({ manifestTracks: [...both(), ...langs.map(l => track(l, `https://x/${l}`))],
    fetchText: url => (url.endsWith('ko') && !failOld ? new Promise(r => { failOld = () => r(404); }) : ttml(url.slice(-2))) });
  for (const l of langs) { page.pickTrans(l); await page.until(() => page.lines()[0]?.[1] === l, l); } // pushes ko out
  page.pickTrans('ko'); // downloads again (the first is still open)
  await page.until(() => page.lines()[0]?.[1] === 'ko', 'Korean');
  failOld(); // the first Korean request fails only now
  await page.settle();
  page.pickTrans('nl');
  await page.until(() => page.lines()[0]?.[1] === 'nl', 'nl');
  page.pickTrans('ko');
  await page.until(() => page.lines()[0]?.[1] === 'ko', 'Korean again');
  assert.equal(count(page, 'ko'), 2); // the second one is still cached
});

test('same lines and times in another original language still reset the shown line and popup', async () => {
  const page = contentPage({ manifestTracks: [...both(), track('es', 'https://x/es')], fetchText: url =>
    ttml(url.endsWith('ko') ? '안녕' : 'Hello') }); // the Spanish file has the very same line
  await page.until(() => page.lines().length, 'the cues');
  page.popup.hidden = false; page.origEl.textContent = 'Hello';
  page.pickOrig('es');
  await page.until(() => count(page, 'es'), 'the Spanish');
  await page.settle();
  assert.equal(page.popup.hidden, true);
  assert.equal(page.origEl.textContent, '');
});

test('fetch: a body that fails or stalls after the headers is retried and recovers', async () => {
  for (const stall of [false, true]) {
    let first = true;
    const page = contentPage({ manifestTracks: both(), fetchText: url => {
      if (url.endsWith('ko')) return ttml('안녕');
      if (!first) return ttml('Hello');
      first = false;
      return { body: stall ? new Promise(() => {}) : Promise.reject(new TypeError('network error')) };
    } });
    if (stall) {
      await page.until(() => page.timers().includes(20000) && count(page, 'ko'), 'the stalled body');
      await page.settle();
      page.fire(); // its timeout
    }
    await page.until(() => page.hint() === page.ui('hintFailed'), 'hintFailed');
    assert.deepEqual(page.timers(), [2000]);
    page.fire();
    await page.until(() => page.lines().length, 'the recovery');
    assert.deepEqual(page.lines(), [['Hello', '안녕']]);
    assert.equal(page.hint(), '');
  }
});

test('content retry: a new choice that fails for good leaves no old retry behind', async () => {
  const page = contentPage({ manifestTracks: [...both(), track('ja', 'https://x/ja')],
    fetchText: scripted({ en: [ttml('Hello')], ko: [503], ja: [404] }) });
  await page.until(() => page.timers().includes(2000), 'a retry');
  page.pickTrans('ja'); // 404: not retried
  await page.until(() => page.hint() === page.ui('hintTransFailed', 'Japanese'), 'the Japanese failure');
  assert.deepEqual(page.timers(), []);
  page.fire();
  await page.settle();
  assert.equal(count(page, 'ja'), 1);
  assert.equal(count(page, 'ko'), 1);
});

// N1: both downloads failing, in either order, both wait for the one retry.
const later = () => { let settle; const p = new Promise(r => { settle = r; }); return Object.assign(p, { settle }); };
test('content retry: original and translation both failing both wait for the one retry, in either order', async () => {
  for (const order of ['together', 'original first', 'translation first']) {
    const slow = later(), first = { en: order === 'translation first', ko: order === 'original first' };
    const n = { en: 0, ko: 0 };
    const page = contentPage({ manifestTracks: both(), fetchText: url => {
      const l = url.slice(-2), i = n[l]++;
      if (i === 0) return first[l] ? slow : 503; // the first try fails (late, for the slow one)
      return i === 1 ? 503 : ttml(l === 'en' ? 'Hello' : '안녕'); // the 1st retry fails too, the 2nd works
    } });
    await page.until(() => n.en && n.ko, `${order}: both requests`);
    if (order === 'original first') await page.until(() => page.timers().includes(2000), 'the original\'s retry');
    else await page.settle(); // translation first: its 503 is in, the original still open
    slow.settle(503);
    await page.until(() => page.timers().includes(2000), `${order}: a retry`);
    await page.settle();
    assert.deepEqual(page.timers(), [2000], order);
    for (let i = 0; i < 3; i++) { page.manifest(80000001, both()); await page.settle(); }
    assert.deepEqual([count(page, 'en'), count(page, 'ko')], [1, 1], `${order}: nothing asked again while waiting`);
    assert.deepEqual(page.timers(), [2000], order); // still the one retry, budget untouched
    assert.equal(page.hint(), page.ui('hintFailed'));
    page.fire();
    await page.until(() => page.timers().includes(5000), `${order}: the 2nd retry`);
    assert.deepEqual([count(page, 'en'), count(page, 'ko')], [2, 2], order);
    page.manifest(80000001, both());
    await page.settle();
    assert.deepEqual([count(page, 'en'), count(page, 'ko')], [2, 2], `${order}: again nothing while waiting`);
    page.fire();
    await page.until(() => !page.hint(), `${order}: the recovery`);
    assert.deepEqual(page.lines(), [['Hello', '안녕']]);
    assert.deepEqual(page.timers(), []);
  }
});

test('content retry: a translation failing late for an older choice does not hold back the newer one', async () => {
  const slowKo = later();
  const page = contentPage({ manifestTracks: [...both(), track('ja', 'https://x/ja')],
    fetchText: scripted({ en: [503, ttml('Hello')], ko: [slowKo, ttml('안녕')], ja: [ttml('こんにちは')] }) });
  await page.until(() => page.timers().includes(2000) && count(page, 'ko'), 'the original\'s retry');
  page.pickTrans('ja'); // another choice: the waiting retry goes, the English downloads again
  await page.until(() => page.lines()[0]?.[1] === 'こんにちは', 'the Japanese');
  slowKo.settle(503); // the first Korean request fails only now
  await page.settle();
  assert.deepEqual(page.timers(), []);
  page.pickTrans('ko'); // not held back by that old failure: downloaded again, and it works
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the Korean');
  assert.equal(count(page, 'ko'), 2);
  assert.equal(page.hint(), '');
});

// Netflix's pause ad: a paused title shows an ad over it after a few seconds (data-uia="depp-pause-ad", seen live).
test('pause ad: an ordinary pause keeps the panel; a pause ad hides our UI; playing again brings it back', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: helloKo, prefs: { orig: 'en', trans: 'ko', list: true } });
  await page.until(() => page.lines().length, 'the cues');
  // The shown line: renderOrig() puts each word in its own span.
  const line = () => page.origEl.textContent + page.origEl.children.map(c => c.textContent).join('');
  const video = { currentTime: 1.5, paused: false, playbackRate: 1, pause() { this.paused = true; }, play() {} };
  page.show('video', video);
  page.tick();
  assert.equal(page.panel.hidden, false);
  assert.equal(line(), 'Hello'); // the line at 1.5 s
  assert.equal(page.list.hidden, false);

  video.paused = true; // a learner's pause: reading, a word popup, recording
  page.popup.hidden = false;
  page.tick(60);
  assert.equal(page.root.hidden, false);
  assert.equal(page.panel.hidden, false);
  assert.equal(page.popup.hidden, false);
  assert.equal(page.key('KeyS'), true); // our shortcuts still work

  const ad = new page.El('div');
  page.show('[data-uia="depp-pause-ad"]', ad); // in the page but not drawn yet
  page.tick();
  assert.equal(page.root.hidden, false);
  ad.drawn = true; // the pause ad shows
  page.tick();
  assert.equal(page.root.hidden, true); // panel, list and popup all out of the ad's way
  assert.equal(page.key('KeyS'), false); // keys go to Netflix meanwhile
  assert.equal(page.popup.hidden, false); // only hidden with the rest, not closed: it comes back as it was
  assert.equal(line(), 'Hello');

  video.paused = false; // playing again (Netflix may keep the ad's element around a moment)
  page.tick();
  assert.equal(page.root.hidden, false);
  page.show('[data-uia="depp-pause-ad"]', null);
  page.tick();
  assert.equal(page.root.hidden, false);
  assert.equal(page.panel.hidden, false);
  assert.equal(page.list.hidden, false);
  assert.equal(page.popup.hidden, false);
  assert.equal(line(), 'Hello');
  assert.equal(page.key('KeyS'), true);
});

test('pause ad: a real ad break still hides the panel and closes the popup as before', async () => {
  const page = contentPage({ manifestTracks: both(), fetchText: helloKo });
  await page.until(() => page.lines().length, 'the cues');
  page.show('video', { currentTime: 1.5, paused: false, playbackRate: 1 });
  page.tick();
  page.popup.hidden = false;
  page.show('[data-uia="ads-info-container"]', new page.El('div'));
  page.tick();
  assert.equal(page.panel.hidden, true);
  assert.equal(page.popup.hidden, true);
  page.show('[data-uia="ads-info-container"]', null);
  page.tick();
  assert.equal(page.panel.hidden, false);
});

// ---- Saved-item ids (☆) ----
const { SAVE_ID_MAX, sentenceId, wordId, textHash } = require('./lib.js');
test('save ids: language, text and case keep different items apart; the same item always gets the same id', () => {
  assert.notEqual(wordId('en', 'chat'), wordId('fr', 'chat')); // English chat, French chat (cat)
  assert.notEqual(wordId('de', 'Weg'), wordId('de', 'weg')); // way / away
  assert.notEqual(wordId('de', 'Arm'), wordId('de', 'arm')); // arm / poor
  assert.equal(wordId('fr', 'café'), wordId('fr-CA', 'café')); // one spelling, composed or not
  assert.equal(wordId('en', 'look after'), 'w2:en:look after'); // short ones stay readable
  assert.notEqual(sentenceId('80000001', 'en', 1, 'Hello'), sentenceId('80000001', 'fr', 1, 'Hello'));
  assert.notEqual(sentenceId('80000001', 'en', 1, 'Hello'), sentenceId('80000001', 'en', 1, '[door creaks] Hello'));
  assert.notEqual(sentenceId('80000001', 'en', 1, 'Hello'), sentenceId('80000001', 'en', 2, 'Hello'));
  assert.equal(sentenceId('80000001', 'en', 1.0004, 'Hello'), sentenceId('80000001', 'en-US', 1, 'Hello'));
  // Never an older version's form, so an old item is never taken for a new one.
  assert.match(sentenceId('80000001', 'en', 1, 'Hello'), /^s2:80000001:en:1000:[0-9a-z]+$/);
  assert.match(wordId('en', 'chat'), /^w2:/);
  // A long phrase: under the bridge's limit, the same each time, and apart from one that only differs at its end.
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  assert.ok(wordId('en', long).length <= SAVE_ID_MAX);
  assert.equal(wordId('en', long), wordId('en', long));
  assert.notEqual(wordId('en', long), wordId('en', long + ' more'));
  assert.ok(wordId('ja', '𠮷'.repeat(200)).length <= SAVE_ID_MAX); // characters outside the BMP count twice
  assert.notEqual(textHash('a'), textHash('b'));
});

// A title whose original line at 1 s exists in English and French; Wiktionary knows none of the words (404).
const saveTracks = () => [track('en', 'https://x/en'), track('fr', 'https://x/fr'), track('ko', 'https://x/ko')];
const saveText = lines => url => (url.includes('wiktionary') ? null : ttml(lines[url.slice(-2)] || ''));
async function savePage(lines, storage, prefs = { orig: 'en', trans: 'ko' }, faults = {}) {
  const page = contentPage({ manifestTracks: saveTracks(), fetchText: saveText(lines), storage, prefs, faults });
  await page.until(() => page.lines().length, 'the cues');
  page.show('video', { currentTime: 1.5, paused: true, playbackRate: 1 });
  page.tick();
  await page.settle(); // the saved ids from the bridge
  return page;
}
const showOrig = async (page, lang, text) => {
  page.pickOrig(lang);
  await page.until(() => page.lines()[0]?.[0] === text, `the ${lang} line`);
  page.tick();
};
const openWord = async (page, from, to) => {
  const before = page.wordStar();
  page.pickWords(from, to);
  await page.until(() => page.wordStar() !== before, 'the word popup');
  return page.wordStar();
};
const starred = b => b.classList.contains('saved');

test('save: the same spelling in two languages is saved and unsaved apart; an old item is left alone', async () => {
  const storage = { 'item:w:chat': { id: 'w:chat', type: 'word', text: 'chat', meaning: 'old', savedAt: 1 } };
  const page = await savePage({ en: 'chat now', fr: 'chat noir', ko: '안녕' }, storage);
  let star = await openWord(page, 0);
  assert.equal(starred(star), false); // the old "w:chat" has no language: not taken for this one
  star.onclick();
  await page.settle();
  assert.deepEqual(Object.keys(storage).sort(), ['item:w2:en:chat', 'item:w:chat']);
  assert.equal(storage['item:w2:en:chat'].lang, 'en');
  assert.equal(starred(star), true);

  await showOrig(page, 'fr', 'chat noir');
  star = await openWord(page, 0);
  assert.equal(starred(star), false); // French chat is not the English one saved above
  star.onclick();
  await page.settle();
  assert.ok(storage['item:w2:fr:chat'] && storage['item:w2:en:chat']);
  star.onclick(); // unsave the French one only
  await page.settle();
  assert.deepEqual(Object.keys(storage).sort(), ['item:w2:en:chat', 'item:w:chat']);
  assert.equal(starred(star), false);

  await showOrig(page, 'en', 'chat now');
  star = await openWord(page, 0);
  assert.equal(starred(star), true); // still saved
  assert.equal(storage['item:w:chat'].meaning, 'old');
});

test('saved ids: read with getKeys where Chrome has it, else (missing, throwing, rejecting) with get(null), the same answer', async () => {
  const id = sentenceId('80000001', 'en', 1, 'Hello');
  for (const getKeys of ['ok', null, 'throw', 'reject']) {
    const storage = { [`item:${id}`]: { id, type: 'sentence', text: 'Hello', lang: 'en', savedAt: 1 }, other: 1 };
    const page = contentPage({ manifestTracks: saveTracks(), fetchText: saveText({ en: 'Hello', ko: '안녕' }), storage, getKeys });
    await page.until(() => page.lines().length, 'the cues');
    page.show('video', { currentTime: 1.5, paused: true, playbackRate: 1 });
    page.tick();
    await page.settle();
    const answers = page.replies.filter(m => m.type === 'saved-ids');
    assert.ok(answers.length, getKeys);
    for (const m of answers) assert.deepEqual(m.ids, [id], getKeys); // item: keys only, prefix cut, as before
    assert.equal(starred(page.star), true, getKeys);
    if (getKeys === 'ok') assert.deepEqual(page.storageCalls, { get: 0, getKeys: answers.length }); // no values read
    else assert.ok(page.storageCalls.get >= answers.length, getKeys);
    // A change from another tab is answered the same way.
    page.otherTab.remove(`item:${id}`);
    await page.settle();
    assert.equal(starred(page.star), false, getKeys);
  }
});

test('accessibility: ☆ and the word popup\'s ☆ say saved with aria-pressed, the toast is a polite status', async () => {
  const page = await savePage({ en: 'Hello there', ko: '안녕' }, {});
  const pressed = b => b.getAttribute('aria-pressed');
  assert.equal(pressed(page.star), 'false');
  page.star.onclick();
  await page.settle();
  assert.equal(pressed(page.star), 'true');
  page.star.onclick();
  await page.settle();
  assert.equal(pressed(page.star), 'false');
  const star = await openWord(page, 0);
  assert.equal(pressed(star), 'false');
  star.onclick();
  await page.settle();
  assert.equal(pressed(star), 'true');
  star.onclick();
  await page.settle();
  assert.equal(pressed(star), 'false');
  assert.equal(page.toastEl.getAttribute('role'), 'status');
  assert.equal(page.toastEl.getAttribute('aria-live'), 'polite');
});

test('accessibility: the 0.75× button is aria-pressed while the slow replay runs, and not once it ends', async () => {
  const player = { getMovieId: () => 80000001, seek() {}, play() {}, getTimedTextTrackList: () => [], getTimedTextTrack: () => null };
  const page = contentPage({ manifestTracks: both(), fetchText: helloKo, player });
  await page.until(() => page.lines().length, 'the cues');
  const v = { currentTime: 1.5, paused: false, playbackRate: 1 };
  page.show('video', v);
  page.tick();
  const slowBtn = page.root.querySelector('.ds-slow');
  assert.equal(slowBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(page.key('KeyR'), true);
  assert.equal(slowBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(v.playbackRate, 0.75);
  v.currentTime = 2.5; // past the line's end: the replay is over
  page.tick();
  assert.equal(slowBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(v.playbackRate, 1);
});

test('save: lines at the same time in two original languages are saved apart', async () => {
  const storage = { 'item:s:80000001:1000': { id: 's:80000001:1000', type: 'sentence', text: 'Hello', savedAt: 1 } };
  const page = await savePage({ en: 'Hello', fr: 'Bonjour', ko: '안녕' }, storage);
  assert.equal(starred(page.star), false); // the old id is not this line's
  page.star.onclick();
  await page.settle();
  const en = sentenceId('80000001', 'en', 1, 'Hello');
  assert.equal(storage[`item:${en}`].text, 'Hello');
  assert.equal(storage[`item:${en}`].meaning, '안녕');

  await showOrig(page, 'fr', 'Bonjour');
  assert.equal(starred(page.star), false);
  page.star.onclick();
  await page.settle();
  const fr = sentenceId('80000001', 'fr', 1, 'Bonjour');
  assert.equal(storage[`item:${fr}`].text, 'Bonjour');
  assert.equal(storage[`item:${en}`].text, 'Hello'); // not replaced
  page.star.onclick();
  await page.settle();
  assert.deepEqual(Object.keys(storage).sort(), [`item:${en}`, 'item:s:80000001:1000'].sort());
  await showOrig(page, 'en', 'Hello');
  assert.equal(starred(page.star), true);
});

test('save: the same text at the same time in another original language is another line', async () => {
  const storage = {};
  const page = await savePage({ en: 'OK', fr: 'OK', ko: '알았어' }, storage);
  page.star.onclick();
  await page.settle();
  page.pickOrig('fr'); // the same line text as before, so wait for the French download itself
  await page.until(() => count(page, 'fr') === 1, 'the French download');
  await page.settle();
  page.tick();
  assert.equal(starred(page.star), false);
  page.star.onclick();
  await page.settle();
  assert.deepEqual(Object.values(storage).map(i => i.lang).sort(), ['en', 'fr']);
});

test('save: a long phrase saves, shows as saved and unsaves under one id', async () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`); // 409 characters: over the old 300 cut
  const storage = {};
  const page = await savePage({ en: words.join(' '), ko: '안녕' }, storage);
  const star = await openWord(page, 0, words.length - 1);
  star.onclick();
  await page.settle();
  const keys = Object.keys(storage);
  assert.equal(keys.length, 1);
  const saved = storage[keys[0]];
  assert.equal(keys[0], `item:${saved.id}`); // stored whole: the key is the id the page knows
  assert.equal(saved.id, wordId('en', words.join(' ')));
  assert.equal(saved.text, words.join(' '));
  assert.equal(starred(star), true); // the bridge's saved ids still include it
  star.onclick();
  await page.settle();
  assert.deepEqual(storage, {});
  assert.equal(starred(star), false);
});

test('bridge: an id over the limit is refused whole, never stored cut short', async () => {
  const storage = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage);
  const long = 'w2:en:' + 'x'.repeat(400);
  // As if the page sent it (e.g. an older content.js): the bridge answers save-failed and stores nothing.
  page.send({ type: 'save', item: { id: long, type: 'word', text: 'x' } });
  page.send({ type: 'unsave', id: long });
  await page.settle();
  assert.deepEqual(storage, {});
  const replies = page.replies;
  assert.deepEqual(replies.filter(m => m.type === 'save-failed').map(m => m.id), [long, long]);
});

// The toolbar's saved list (saved.js) over chrome.storage as older and newer versions left it.
async function savedPage(storage) {
  const vm = require('node:vm'), fs = require('node:fs');
  const byId = {}, downloads = [], changed = [];
  const node = tag => ({ tagName: tag.toUpperCase(), children: [], textContent: '', style: {}, classList: { toggle() {} },
    setAttribute() {}, addEventListener() {}, focus() {}, contains: () => false, click() { if (this.download) downloads.push(this); },
    append(...kids) { for (const k of kids) if (typeof k === 'object') this.children.push(k); else this.textContent += k; },
    replaceChildren(...kids) { this.children = []; this.append(...kids); } });
  const ctx = {
    navigator: { language: 'en-US' }, console, setTimeout() {}, Blob,
    URL: { createObjectURL: blob => { downloads.blob = blob; return 'blob:x'; }, revokeObjectURL() {} },
    document: { getElementById: id => (byId[id] ||= node('div')), createElement: node, addEventListener() {} },
    chrome: { storage: { local: { get: async () => structuredClone(storage), remove: async key => { delete storage[key]; changed.forEach(f => f()); } },
      onChanged: { addListener: fn => changed.push(fn) } } },
  };
  vm.createContext(ctx);
  for (const f of ['lib.js', 'saved.js']) vm.runInContext(fs.readFileSync(`${__dirname}/${f}`, 'utf8'), ctx, { filename: f });
  await new Promise(r => setTimeout(r, 5));
  const text = n => n.textContent + n.children.map(text).join('');
  return { items: () => byId.list.children.map(text), del: i => byId.list.children[i].children.find(c => c.className === 'del').onclick({ detail: 1 }),
    csv: async () => { await byId.csv.onclick(); return downloads.blob.text(); },
    anki: async () => { await byId.anki.onclick(); return downloads.blob.text(); } };
}

test('saved list: older items still show, export and delete next to new ones', async () => {
  const storage = {
    'item:w:chat': { id: 'w:chat', type: 'word', text: 'chat', meaning: '(noun) talk', sentence: 'chat now', savedAt: 3 },
    'item:s:80000001:1000': { id: 's:80000001:1000', type: 'sentence', text: 'Hello', meaning: '안녕', title: 'The Office', time: 1, savedAt: 2 },
    // Cut at 300 by an older bridge: the stored id and the key agree, but not with the page's full id.
    [`item:w:${'y'.repeat(298)}`]: { id: `w:${'y'.repeat(298)}`, type: 'word', text: 'yyyy', savedAt: 1 },
    [`item:${wordId('fr', 'chat')}`]: { id: wordId('fr', 'chat'), type: 'word', text: 'chat', meaning: '(noun) cat', lang: 'fr', savedAt: 4 },
    'item:no-id': { type: 'word', text: 'odd', savedAt: 0 }, // no id of its own: × goes by the key
    'other-setting': true,
  };
  const page = await savedPage(storage);
  assert.equal(page.items().length, 5);
  assert.match(page.items()[0], /cat/);
  assert.match(page.items()[1], /talk/);
  const csv = await page.csv();
  assert.match(csv, /word,chat,\(noun\) cat/);
  assert.match(csv, /word,chat,\(noun\) talk/);
  assert.match(csv, /sentence,Hello,안녕/);
  assert.equal(csv.trim().split('\r\n').length, 6);
  assert.equal((await page.anki()).split('\n').filter(l => l.includes('dualsub-')).length, 5);
  page.del(1); // the older English "chat": only it goes
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(Object.keys(storage).sort(), [`item:${wordId('fr', 'chat')}`, `item:w:${'y'.repeat(298)}`,
    'item:s:80000001:1000', 'item:no-id', 'other-setting'].sort());
  page.del(2); // the cut one
  page.del(3); // the one without an id
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(Object.keys(storage).sort(), [`item:${wordId('fr', 'chat')}`, 'item:s:80000001:1000', 'other-setting'].sort());
});

test('save ids: a line\'s layout (breaks, spaces) is not part of its id; its letters and language are', () => {
  const id = text => sentenceId('80000001', 'en', 1, text);
  assert.equal(id('Hello\nthere'), id('Hello there'));
  assert.equal(id(' Hello  \r\n there '), id('Hello there'));
  assert.equal(id('Café\nnow'), id('Café now'));
  assert.notEqual(id('Hello there'), id('Hello there!'));
  assert.notEqual(id('Hello there'), id('hello there'));
  assert.notEqual(id('Hello there'), id('Hellothere'));
  assert.notEqual(id('Hello there'), sentenceId('80000001', 'fr', 1, 'Hello there'));
});

test('save: the same line broken differently in another track is the same saved line, kept as first shown', async () => {
  const storage = {};
  const tracks = [track('en', 'https://x/en'), track('en', 'https://x/cc', { new_track_id: 'T-en-cc', rawTrackType: 'closedcaptions' }),
    track('ko', 'https://x/ko')];
  const lines = { en: 'Hello<br/>there', cc: '  Hello   there ', ko: '안녕' };
  const page = contentPage({ manifestTracks: tracks, fetchText: saveText(lines), storage });
  await page.until(() => page.lines().length, 'the cues');
  page.show('video', { currentTime: 1.5, paused: true, playbackRate: 1 });
  page.tick();
  await page.settle();
  page.star.onclick();
  await page.settle();
  assert.deepEqual(Object.values(storage).map(i => i.text), ['Hello\nthere']); // saved as shown, line break and all
  page.pickOrig('en|cc');
  await page.until(() => count(page, 'cc') === 1, 'the CC download');
  await page.settle();
  page.tick();
  assert.equal(starred(page.star), true); // the same line: saved, and ☆ unsaves that one
  page.star.onclick();
  await page.settle();
  assert.deepEqual(storage, {});
});

test('bridge: fields are cut to their length without splitting an emoji; an empty text is refused', async () => {
  const storage = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage);
  const over = n => 'a'.repeat(n - 1) + '😀'; // the emoji's second half would be unit n + 1
  const fits = n => 'a'.repeat(n - 2) + '😀'; // exactly n units: kept whole
  page.send({ type: 'save', item: { id: 'w2:en:cut', type: 'word', text: over(500), meaning: over(2000), sentence: over(1000),
    translation: over(1000), title: over(200), movieId: over(20), lang: over(20) } });
  page.send({ type: 'save', item: { id: 'w2:en:fit', type: 'word', text: fits(500), title: fits(200) } });
  page.send({ type: 'save', item: { id: 'w2:en:empty', type: 'word', text: '' } });
  page.send({ type: 'save', item: { id: 'w2:en:none', type: 'word' } });
  await page.settle();
  const cut = storage['item:w2:en:cut'];
  for (const [field, max] of Object.entries({ text: 500, meaning: 2000, sentence: 1000, translation: 1000, title: 200, movieId: 20, lang: 20 })) {
    assert.equal(cut[field], 'a'.repeat(max - 1), field); // the whole emoji dropped, not half of it
    assert.ok(!/[\uD800-\uDFFF]/.test(cut[field]), field);
  }
  assert.equal(storage['item:w2:en:fit'].text, fits(500));
  assert.equal(storage['item:w2:en:fit'].title, fits(200));
  assert.deepEqual(Object.keys(storage).sort(), ['item:w2:en:cut', 'item:w2:en:fit']);
  assert.deepEqual(page.replies.filter(m => m.type === 'save-failed').map(m => m.id), ['w2:en:empty', 'w2:en:none']);
});

// ---- Follow-ups from the Check review (/tmp/netflix-dualsub-next-review.md D1-5) ----
test('hydrate while off (H): Netflix\'s subtitles are left alone; turning on fetches the language', async () => {
  let page;
  const player = fakePlayer(['T-en', 'T-ko'], 'T-ko', tr => tr.trackId === 'T-en' && page.manifest(80000001, both()));
  page = contentPage({ manifestTracks: dehydratedEn(), fetchText: helloKo, player, prefs: { orig: 'en', trans: 'ko', off: true } });
  page.show('video', { currentTime: 1.5, paused: false, playbackRate: 1 });
  await page.settle();
  page.manifest(80000001, dehydratedEn()); // a manifest refresh while off: still nothing switched
  await page.settle();
  assert.deepEqual(player.calls, []);
  assert.equal(page.key('KeyH'), true); // on
  await page.until(() => page.lines()[0]?.[0] === 'Hello' && player.calls.length === 2, 'the hydrated lines');
  assert.deepEqual(player.calls, ['T-en', 'T-ko']);
});

test('hydrate while off (H): one waiting in line is skipped, not counted, and runs on turning on', async () => {
  let page, gate;
  const noUrls = () => [track('en', null, { hydrated: false }), track('ko', null, { hydrated: false })];
  const player = fakePlayer(['T-en', 'T-ko', 'T-fr'], 'T-fr', async tr => {
    if (tr.trackId === 'T-en' && !gate) { gate = later(); await gate; page.manifest(80000001, [track('en', 'https://x/en'), track('ko', null, { hydrated: false })]); }
    if (tr.trackId === 'T-ko') page.manifest(80000001, both());
  });
  page = contentPage({ manifestTracks: noUrls(), fetchText: helloKo, player });
  page.show('video', { currentTime: 1.5, paused: false, playbackRate: 1 });
  await page.until(() => gate, 'the English switch'); // Korean waits in line behind it
  page.tick(); // the panel shows (its loading hint), so H is ours
  assert.equal(page.key('KeyH'), true); // off, mid-switch
  gate.settle();
  await page.settle();
  // The switch under way still puts the user's subtitles back; the Korean one in line never switches.
  assert.deepEqual(player.calls, ['T-en', 'T-fr']);
  assert.equal(player.current.trackId, 'T-fr');
  assert.equal(page.key('KeyH'), true); // on: Korean is tried now, not taken as done or failed
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the Korean lines');
  assert.deepEqual(player.calls, ['T-en', 'T-fr', 'T-ko', 'T-fr']);
  assert.deepEqual(page.lines(), [['Hello', '안녕']]);
});

// German pages as Wiktionary has them (checked live by the Test pane): capitalized pages exist for many lowercase
// words (Ich "ego", Heute "today" as a noun), and Haus has no lowercase German page.
const dePage = (pos, def) => ({ partOfSpeech: pos, language: 'German', definitions: [{ definition: def }] });
// A form-of definition as Wiktionary writes it: "singular imperative of hausen", linking the base form.
const formOf = (lemma, what) => `<span class="form-of-definition use-with-mention">${what} of <span class="form-of-definition-link"><i lang="de"><a href="/wiki/${lemma}#German" title="${lemma}">${lemma}</a></i></span></span>`;
const DE_DICT = {
  Weg: [dePage('Noun', 'way, path')], weg: [dePage('Adverb', 'away')], Morgen: [dePage('Noun', 'morning')],
  morgen: [dePage('Adverb', 'tomorrow')], Arm: [dePage('Noun', 'arm')], arm: [dePage('Adjective', 'poor')],
  Ich: [dePage('Noun', 'ego')], ich: [dePage('Pronoun', 'I')], Heute: [dePage('Noun', 'today, the present')],
  heute: [dePage('Adverb', 'today')], Sie: [dePage('Pronoun', 'you (formal)')], sie: [dePage('Pronoun', 'she; they')],
  Haus: [dePage('Noun', 'house')], haus: [dePage('Verb', formOf('hausen', 'singular imperative'))],
  hausen: [dePage('Verb', 'to dwell, to reside')], Es: [dePage('Noun', 'E-flat')], es: [dePage('Pronoun', 'it')], Mai: [dePage('Noun', 'May')], mai: null, // mai: no German section
};
// Looks up word `w` (its n-th time on the line) in a German line: [headword, meaning] as the popup shows them.
async function germanLookups(text, picks) {
  const storage = {};
  const page = contentPage({ manifestTracks: [track('de', 'https://x/de'), track('ko', 'https://x/ko')], storage, prefs: { orig: 'de', trans: 'ko' },
    fetchText: url => {
      if (!url.includes('wiktionary')) return ttml(url.endsWith('de') ? text : '안녕');
      const w = decodeURIComponent(url.split('/').pop());
      return w in DE_DICT ? JSON.stringify(DE_DICT[w] ? { de: DE_DICT[w] } : { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'x' }] }] }) : null;
    } });
  await page.until(() => page.lines().length, 'the cues');
  page.show('video', { currentTime: 1.5, paused: true, playbackRate: 1 });
  page.tick();
  await page.settle();
  const words = page.origEl.querySelectorAll('.ds-word').map(w => w.textContent);
  const deep = e => e.textContent + e.children.map(deep).join('');
  const out = [];
  for (const [w, n = 0] of picks) {
    const i = words.findIndex((x, j) => x === w && words.slice(0, j).filter(y => y === w).length === n);
    const star = await openWord(page, i);
    const [head, body] = page.popup.children;
    out.push([head.children[0].textContent, deep(body)]);
    if (w === 'Weg' || w === 'weg') { star.onclick(); await page.settle(); }
  }
  return { out, storage };
}

test('word lookup in German: opening a sentence, lowercase first (Ich is "I", not "ego"); inside one, as written', async () => {
  const { out } = await germanLookups('Ich bin da. Ich auch!<br/>- Ich nicht. „Ich?" Heute ist der Weg weg, guten Morgen, bis morgen, mein Arm ist arm, sagen Sie',
    [['Ich', 0], ['Ich', 1], ['Ich', 2], ['Ich', 3], ['Heute'], ['Weg'], ['weg'], ['Morgen'], ['morgen'], ['Arm'], ['arm'], ['Sie']]);
  assert.deepEqual(out, [
    ['ich', 'PronounI'], // first on the line
    ['ich', 'PronounI'], // after ". "
    ['ich', 'PronounI'], // after a dialogue dash
    ['ich', 'PronounI'], // after ". " and an opening quote: „Ich
    ['heute', 'Adverbtoday'], // after '?" ': Heute has a German noun page too, the lowercase one comes first
    ['Weg', 'Nounway, path'], ['weg', 'Adverbaway'],
    ['Morgen', 'Nounmorning'], ['morgen', 'Adverbtomorrow'],
    ['Arm', 'Nounarm'], ['arm', 'Adjectivepoor'],
    ['Sie', 'Pronounyou (formal)'], // inside a sentence: the capital is the formal "you"
  ]);
});

test('word lookup in German: opening a line, lowercase forms lead on to their verb; with no lowercase German page, the capital', async () => {
  // Intended (manager's call): a capital opening a line says nothing, and in dialogue a line opens with an imperative
  // ("Ruf mich an", "Schlaf gut", "Lauf!") more often than with a noun without its article. So Haus there goes
  // haus ("singular imperative of hausen") -> hausen, as it did before D1. define()'s order is left as it is.
  let { out } = await germanLookups('Haus ist groß', [['Haus']]);
  assert.deepEqual(out, [['hausen', 'Verbto dwell, to reside']]);
  ({ out } = await germanLookups('Mai ist schön', [['Mai']])); // no German "mai": the capital is the real fallback
  assert.deepEqual(out, [['Mai', 'NounMay']]);
  const { out: mid, storage } = await germanLookups('der Weg weg, ein Haus', [['Weg'], ['weg'], ['Haus']]);
  assert.deepEqual(mid, [['Weg', 'Nounway, path'], ['weg', 'Adverbaway'], ['Haus', 'Nounhouse']]); // inside: as written
  assert.ok(storage[`item:${wordId('de', 'Weg')}`] && storage[`item:${wordId('de', 'weg')}`]); // saved as two items
});

test('word lookup in German: a two-line cue\'s second line goes on with the sentence, unless a dash opens it', async () => {
  // Real two-line cues (TTML <br/>): a plain line break is not a sentence's start.
  for (const [line, word, want] of [['Ich sehe den<br/>Weg nicht', 'Weg', ['Weg', 'Nounway, path']],
    ['Er hat einen<br/>Arm verloren', 'Arm', ['Arm', 'Nounarm']], ['Bis<br/>Morgen früh', 'Morgen', ['Morgen', 'Nounmorning']],
    ['- Wo?<br/>- Weg da!', 'Weg', ['weg', 'Adverbaway']], ['Ja.<br/>Weg da!', 'Weg', ['weg', 'Adverbaway']],
    // As on Netflix (N6): a speaker's note after the dash, the line still opens with Es ("it"), not the note E-flat.
    ['-Der hat im Keller geschlafen oder so.<br/>-[Mutter] Es sind 13 Tage.', 'Es', ['es', 'Pronounit']]]) {
    const { out } = await germanLookups(line, [[word]]);
    assert.deepEqual(out, [want], line);
  }
});

test('word lookup in German: after a song note, a sound note, a German quote or a speaker\'s dash, Ich is "I"', async () => {
  for (const line of ['♪ Ich bin da', '[Musik] Ich bin da', '(lacht) Ich bin da', '»Ich komme«', 'Ja,<br/>- Ich nicht']) {
    const { out } = await germanLookups(line, [['Ich']]);
    assert.deepEqual(out, [['ich', 'PronounI']], line);
  }
  const { out } = await germanLookups('Ja – Ich', [['Ich']]); // a dash inside the line: still inside the sentence
  assert.deepEqual(out, [['Ich', 'Nounego']]);
});

// ☆ against a storage that fails: the star ends up showing what is really stored, whatever the order of events.
const dead = () => Promise.reject(new Error('Extension context invalidated.'));
const asks = page => page.posted.filter(m => m.type === 'get-saved').length;
test('save failing: quick save then unsave on a dead storage shows no ★, asks once per failure, and the hint stays', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage, undefined, faults);
  faults.get = faults.set = faults.remove = dead; // the extension was reloaded under this tab
  const before = asks(page), hint = page.hint();
  page.star.onclick(); // save
  page.star.onclick(); // unsave, before the save's failure comes back
  await page.settle();
  assert.equal(page.replies.filter(m => m.type === 'save-failed').length, 2);
  assert.equal(starred(page.star), false); // nothing stored: no ★ (flipping back each failure would leave it on)
  assert.deepEqual(storage, {});
  assert.equal(asks(page) - before, 2); // one ask per failure, unanswered, and no more after that
  await page.settle();
  assert.equal(asks(page) - before, 2);
  assert.equal(page.hint(), hint); // the hint line is not taken over
  assert.equal(page.toastEl.hidden, false);
  assert.equal(page.toastEl.textContent, page.ui('saveFailed'));
});

test('save failing: a late failure after an unsave, an unsave failing, another tab and a new press all end right', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage, undefined, faults);
  const id = sentenceId('80000001', 'en', 1, 'Hello');
  // 1. The save fails late, after the user already unsaved (nothing to remove: no onChanged either).
  let gate = later();
  faults.set = () => gate.then(dead);
  page.star.onclick();
  page.star.onclick();
  await page.settle();
  gate.settle();
  await page.settle();
  assert.equal(starred(page.star), false);
  assert.deepEqual(storage, {});
  // 2. Storage works again: a new press saves.
  delete faults.set;
  page.star.onclick();
  await page.settle();
  assert.ok(storage[`item:${id}`]);
  assert.equal(starred(page.star), true);
  // 3. An unsave that fails: still stored, so ★ comes back.
  faults.remove = dead;
  page.star.onclick();
  await page.settle();
  assert.ok(storage[`item:${id}`]);
  assert.equal(starred(page.star), true);
  delete faults.remove;
  // 4. Unsaved for real, then a save failing late while another tab saves the same line: it is stored, so ★.
  page.star.onclick();
  await page.settle();
  assert.equal(starred(page.star), false);
  gate = later();
  faults.set = () => gate.then(dead);
  page.star.onclick();
  await page.settle();
  page.otherTab.set({ [`item:${id}`]: { id, type: 'sentence', text: 'Hello', savedAt: 9 } });
  await page.settle();
  gate.settle();
  await page.settle();
  assert.equal(starred(page.star), true);
  // 5. And another tab removing it brings ★ off.
  page.otherTab.remove(`item:${id}`);
  await page.settle();
  assert.equal(starred(page.star), false);
});

// O1: a press on its way (the bridge hasn't written yet) against saved-ids snapshots sent for other reasons.
// A held write: faults.set/remove wait for the gate, then land as a real write would (onChanged and all).
const holdWrites = (page, faults) => {
  const gate = later();
  faults.set = obj => gate.then(() => { page.otherTab.set(obj); });
  faults.remove = key => gate.then(() => { page.otherTab.remove(key); });
  return () => { delete faults.set; delete faults.remove; gate.settle(); };
};
test('save pending: a snapshot without the save on its way keeps ★, one still holding an unsave on its way keeps ☆', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage, undefined, faults);
  const id = sentenceId('80000001', 'en', 1, 'Hello'), aria = () => page.star.getAttribute('aria-pressed');
  // 1. Saving: another reason's snapshot (a re-ask, load()) comes before the write.
  let release = holdWrites(page, faults);
  page.star.onclick();
  page.send({ type: 'get-saved' });
  await page.settle();
  assert.ok(page.replies.some(m => m.type === 'saved-ids' && !m.ids.includes(id))); // that snapshot came
  assert.equal(starred(page.star), true); // before O1: off until the write landed
  assert.equal(aria(), 'true');
  release();
  await page.settle();
  assert.ok(storage[`item:${id}`]);
  assert.equal(starred(page.star), true);
  // 2. Unsaving: a snapshot still holding it.
  release = holdWrites(page, faults);
  page.star.onclick();
  page.send({ type: 'get-saved' });
  await page.settle();
  assert.equal(starred(page.star), false);
  assert.equal(aria(), 'false');
  release();
  await page.settle();
  assert.deepEqual(storage, {});
  assert.equal(starred(page.star), false);
  // 3. Confirmed and no longer pending: another tab's changes show as they come.
  page.otherTab.set({ [`item:${id}`]: { id, type: 'sentence', text: 'Hello', savedAt: 9 } });
  await page.settle();
  assert.equal(starred(page.star), true);
  assert.equal(aria(), 'true');
  page.otherTab.remove(`item:${id}`);
  await page.settle();
  assert.equal(starred(page.star), false);
  assert.equal(aria(), 'false');
});

test('save pending: save, unsave, the first save failing: ☆, nothing stored, and nothing left pending after', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage, undefined, faults);
  const id = sentenceId('80000001', 'en', 1, 'Hello');
  const gate = later();
  faults.set = () => gate.then(dead);
  page.star.onclick();
  page.star.onclick();
  await page.settle();
  gate.settle();
  await page.settle();
  assert.equal(starred(page.star), false);
  assert.deepEqual(storage, {});
  delete faults.set;
  page.otherTab.set({ [`item:${id}`]: { id, type: 'sentence', text: 'Hello', savedAt: 9 } }); // no unsave wish left over
  await page.settle();
  assert.equal(starred(page.star), true);
});

test('save pending: save, unsave, save, then the first save failing: the latest wish wins and is stored', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage, undefined, faults);
  const id = sentenceId('80000001', 'en', 1, 'Hello');
  const gate = later(), last = later();
  // The first save fails, late; the last one is still on its way when that failure comes.
  faults.set = () => { faults.set = obj => last.then(() => { page.otherTab.set(obj); }); return gate.then(dead); };
  page.star.onclick(); page.star.onclick(); page.star.onclick();
  await page.settle();
  assert.equal(starred(page.star), true);
  gate.settle();
  await page.settle();
  assert.equal(page.replies.filter(m => m.type === 'save-failed').length, 1);
  assert.equal(starred(page.star), true); // the last press is still on its way: its wish stays
  delete faults.set;
  last.settle();
  await page.settle();
  assert.ok(storage[`item:${id}`]);
  assert.equal(starred(page.star), true);
  assert.equal(page.star.getAttribute('aria-pressed'), 'true');
});

test('save pending: a dead bridge brings ★ back to what storage held, and other items\' changes show meanwhile', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello there', ko: '안녕' }, storage, undefined, faults);
  const id = sentenceId('80000001', 'en', 1, 'Hello there');
  // 8. A word's save on its way; another tab saves the line: its ★ shows at once, the word's stays.
  const release = holdWrites(page, faults);
  const word = await openWord(page, 0);
  word.onclick();
  page.otherTab.set({ [`item:${id}`]: { id, type: 'sentence', text: 'Hello there', savedAt: 9 } });
  await page.settle();
  assert.equal(starred(page.star), true);
  assert.equal(starred(word), true);
  release();
  await page.settle();
  assert.equal(starred(word), true);
  // 7. Dead: an unsave fails (still stored: ★ back), a save fails (not stored: ☆ back), and the re-asks go unanswered.
  faults.get = faults.set = faults.remove = dead;
  word.onclick();
  await page.settle();
  assert.equal(starred(word), true);
  const other = await openWord(page, 1); // "there": never saved
  other.onclick();
  await page.settle();
  assert.equal(starred(other), false);
  assert.equal(other.getAttribute('aria-pressed'), 'false');
  assert.equal(starred(page.star), true); // the line, saved by the other tab, as last known
  assert.equal(Object.keys(storage).length, 2); // the line and "Hello"; nothing else was written
});

test('first download: a loading hint shows the panel meanwhile; lines already showing stay, without one', async () => {
  const slow = { en: later(), ko: later(), ja: later(), fr: later() };
  const text = { en: ttml('Hello'), ko: ttml('안녕'), ja: ttml('こんにちは'), fr: ttml('Bonjour') };
  const page = contentPage({ manifestTracks: [...both(), track('ja', 'https://x/ja'), track('fr', 'https://x/fr')],
    fetchText: url => slow[url.slice(-2)].then(() => text[url.slice(-2)]) });
  page.show('video', { currentTime: 1.5, paused: false, playbackRate: 1 });
  await page.settle();
  page.tick();
  assert.equal(page.hint(), page.ui('hintLoading', 'English'));
  assert.equal(page.panel.hidden, false); // not a blank screen while the first lines download
  slow.en.settle(); slow.ko.settle();
  await page.until(() => page.lines().length, 'the lines');
  assert.equal(page.hint(), '');
  // O2: lines on screen stay while the new translation downloads; the old language's translation goes (it isn't the
  // one chosen) and the wait for the new one is said.
  page.pickTrans('ja');
  await page.settle();
  assert.equal(page.hint(), page.ui('hintLoading', 'Japanese'));
  assert.deepEqual(page.lines(), [['Hello', '']]);
  page.pickOrig('fr'); // another original: the old lines stay until the new ones are in
  await page.settle();
  assert.equal(page.hint(), page.ui('hintLoading', 'Japanese'));
  assert.deepEqual(page.lines(), [['Hello', '']]);
  slow.ja.settle(); slow.fr.settle();
  await page.until(() => page.lines()[0]?.[0] === 'Bonjour', 'the French lines');
  assert.deepEqual(page.lines(), [['Bonjour', 'こんにちは']]);
  assert.equal(page.hint(), '');
});

test('first download: another title meanwhile gets its own loading hint, and the old download changes nothing', async () => {
  const slow = { 1: later(), 2: later() };
  const page = contentPage({ manifestTracks: both(),
    fetchText: url => (url.includes('/b/') ? slow[2] : slow[1]).then(() => ttml(url.includes('/b/') ? 'Second' : 'First')) });
  await page.settle();
  assert.equal(page.hint(), page.ui('hintLoading', 'English'));
  page.watch(80000002, [track('en', 'https://x/b/en'), track('ko', 'https://x/b/ko')]);
  await page.settle();
  assert.equal(page.hint(), page.ui('hintLoading', 'English'));
  slow[2].settle();
  await page.until(() => page.lines().length, 'the second title');
  slow[1].settle(); // the first title's late lines
  await page.settle();
  assert.deepEqual(page.lines(), [['Second', 'Second']]);
  assert.equal(page.hint(), '');
});

test('save failing: the note is a passing toast; a subtitle hint already showing stays', async () => {
  const storage = {}, faults = {};
  const page = contentPage({ manifestTracks: saveTracks(), storage, faults,
    fetchText: url => (url.endsWith('ko') ? null : ttml('Hello')) });
  await page.until(() => page.outcome(), 'the translation hint');
  page.show('video', { currentTime: 1.5, paused: true, playbackRate: 1 });
  page.tick();
  await page.settle();
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
  faults.set = dead;
  page.star.onclick();
  await page.settle();
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
  assert.equal(page.toastEl.textContent, page.ui('saveFailed'));
  assert.ok(page.timers().includes(4000)); // it goes away by itself
});

test('save failing with no answer to the re-ask: ★ never shows what storage did not confirm', async () => {
  const storage = {}, faults = {};
  const page = await savePage({ en: 'Hello', ko: '안녕' }, storage, undefined, faults);
  faults.set = faults.get = dead; // saving and reading fail; removing (nothing there) goes through quietly
  page.star.onclick(); // save: fails
  page.star.onclick(); // unsave: nothing to remove, no change, no answer
  await page.settle();
  assert.deepEqual(storage, {});
  assert.equal(starred(page.star), false); // flipping the failed save back would turn ★ on here, for good
});

test('first download: a manifest refresh while the original waits for its retry keeps the failure hint', async () => {
  const slowKo = later();
  const page = contentPage({ manifestTracks: both(),
    fetchText: url => (url.endsWith('/en') ? 503 : url.includes('/k2/') ? slowKo.then(() => ttml('안녕')) : ttml('안녕')) });
  await page.until(() => page.hint() === page.ui('hintFailed') && page.timers().includes(2000), 'the retry');
  page.manifest(80000001, [track('en', 'https://x/en'), track('ko', 'https://x/k2/ko')]); // a new translation URL
  await page.settle();
  assert.equal(page.hint(), page.ui('hintFailed')); // not "Loading…" for lines that are waiting for their retry
  slowKo.settle();
  await page.settle();
  assert.equal(page.hint(), page.ui('hintFailed'));
});

// O2: the original lines show first, the translation joins them when it comes.
// gatedFetch: per language, a list of answers, one per request (the last repeats); an answer that is a later() is
// held until settled, then gives `text[lang]`; a number is that HTTP status (also after a gate: [gate, 503]).
function gatedFetch(text, plan = {}) {
  const n = {};
  const fetchText = url => {
    if (url.includes('wiktionary')) return null;
    const l = url.slice(-2), list = plan[l] || [text[l]], a = list[Math.min(n[l] = (n[l] ?? -1) + 1, list.length - 1)];
    return a && typeof a.then === 'function' ? a.then(v => (v === undefined ? text[l] : v)) : a;
  };
  return fetchText;
}
const loadedLogs = page => page.logs.filter(l => l.includes(' loaded ')).length;
const hintsSeen = page => { // every hint written from now on
  const seen = [];
  let v = page.hintEl.textContent;
  Object.defineProperty(page.hintEl, 'textContent', { get: () => v, set: x => { v = x; seen.push(x); } });
  return seen;
};
const TEXT = { en: ttml('Hello there'), ko: ttml('안녕'), ja: ttml('こんにちは'), fr: ttml('Bonjour') };
const four = () => [...both(), track('ja', 'https://x/ja'), track('fr', 'https://x/fr')];
const watching = async page => {
  page.show('video', { currentTime: 1.5, paused: true, playbackRate: 1 });
  page.tick();
  await page.settle();
};

test('O2 1: a slow translation: the original shows first with the wait said, then the translation joins it', async () => {
  const ko = later();
  const page = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [ko] }) });
  await page.until(() => page.lines().length, 'the original lines');
  assert.deepEqual(page.lines(), [['Hello there', '']]);
  assert.equal(page.hint(), page.ui('hintLoading', 'Korean'));
  assert.equal(loadedLogs(page), 0); // not "loaded" until everything is in
  ko.settle();
  await page.until(() => page.lines()[0][1] === '안녕', 'the translation');
  assert.equal(page.hint(), '');
  assert.equal(loadedLogs(page), 1);
});

test('O2 2: both in the cache: one change, the translation there from the first, no loading hint', async () => {
  const page = contentPage({ manifestTracks: four(), fetchText: gatedFetch(TEXT) });
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the lines');
  page.pickTrans('ja');
  await page.until(() => page.lines()[0][1] === 'こんにちは', 'Japanese');
  const seen = hintsSeen(page), shown = [];
  const lines = page.list;
  page.pickTrans('ko'); // cached
  await page.settle();
  shown.push(...lines.children.map(i => i.children[1].textContent));
  assert.deepEqual(shown, ['안녕']);
  assert.ok(!seen.includes(page.ui('hintLoading', 'Korean')), JSON.stringify(seen));
  assert.equal(page.hint(), '');
  assert.equal(count(page, 'ko'), 1);
});

test('O2 3: the translation failing after the original showed: its failure hint, the lines stay, a retry later', async () => {
  const ko = later();
  const retried = later();
  const page = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [ko.then(() => 503), retried] }) });
  await page.until(() => page.lines().length, 'the original lines');
  ko.settle();
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
  assert.deepEqual(page.lines(), [['Hello there', '']]);
  assert.deepEqual(page.timers(), [2000]);
  page.fire(); // the retry, slow too: the failed translation was never put in, so its wait is said again
  await page.settle();
  assert.equal(page.hint(), page.ui('hintLoading', 'Korean'));
  retried.settle();
  await page.until(() => page.lines()[0][1] === '안녕', 'the translation');
  assert.equal(page.hint(), '');
  // The same when the first failure came at once (with the original, in one step).
  const again = later();
  const p2 = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [503, again] }) });
  await p2.until(() => p2.outcome(), 'a hint');
  assert.equal(p2.hint(), p2.ui('hintTransFailed', 'Korean'));
  p2.fire();
  await p2.settle();
  assert.equal(p2.hint(), p2.ui('hintLoading', 'Korean'));
  again.settle();
  await p2.until(() => p2.lines()[0][1] === '안녕', 'the translation');
});

test('O2 4: the original failing, then the translation: one retry for both, and a load meanwhile asks for neither', async () => {
  const ko = later();
  const page = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { en: [503], ko: [ko.then(() => 503)] }) });
  await page.until(() => page.outcome(), 'a hint');
  assert.equal(page.hint(), page.ui('hintFailed'));
  ko.settle();
  await page.settle();
  assert.deepEqual(page.timers(), [2000]);
  page.manifest(80000001, both());
  await page.settle();
  assert.equal(count(page, 'en'), 1);
  assert.equal(count(page, 'ko'), 1);
  assert.equal(page.hint(), page.ui('hintFailed'));
  assert.deepEqual(page.timers(), [2000]);
});

test('O2 5: another title between the two steps: the old translation never lands on it', async () => {
  const ko = later();
  const page = contentPage({ manifestTracks: both(), fetchText: url => (url.includes('/b/')
    ? ttml(url.endsWith('en') ? 'Second' : '둘째') : gatedFetch(TEXT, { ko: [ko] })(url)) });
  await page.until(() => page.lines().length, 'the original lines');
  page.watch(80000002, [track('en', 'https://x/b/en'), track('ko', 'https://x/b/ko')]);
  await page.until(() => page.lines()[0]?.[0] === 'Second', 'the second title');
  ko.settle();
  await page.settle();
  assert.deepEqual(page.lines(), [['Second', '둘째']]);
  assert.equal(page.hint(), '');
});

test('O2 6: another translation between the two steps: only the newer one is put in', async () => {
  const ko = later();
  const page = contentPage({ manifestTracks: four(), fetchText: gatedFetch(TEXT, { ko: [ko] }) });
  await page.until(() => page.lines().length, 'the original lines');
  page.pickTrans('ja');
  await page.until(() => page.lines()[0][1] === 'こんにちは', 'Japanese');
  ko.settle();
  await page.settle();
  assert.deepEqual(page.lines(), [['Hello there', 'こんにちは']]);
  assert.equal(page.hint(), '');
  assert.equal(loadedLogs(page), 1); // the Korean load's second step never ran
});

test('O2 7: a manifest refresh between the two steps: no second request, and the newer load puts it in', async () => {
  const ko = later();
  const page = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [ko] }) });
  await page.until(() => page.lines().length, 'the original lines');
  page.manifest(80000001, both());
  await page.settle();
  assert.equal(page.hint(), page.ui('hintLoading', 'Korean'));
  ko.settle();
  await page.until(() => page.lines()[0][1] === '안녕', 'the translation');
  assert.equal(count(page, 'ko'), 1);
  assert.equal(loadedLogs(page), 1);
  assert.equal(page.hint(), '');
});

test('O2 7b: a refresh with a new URL for the same translation, lines showing: the translation stays up, no wait said', async () => {
  const ko2 = later();
  const page = contentPage({ manifestTracks: both(), fetchText: url => (url.endsWith('ko2') ? ko2.then(() => TEXT.ko) : gatedFetch(TEXT)(url)) });
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the lines');
  const seen = hintsSeen(page);
  page.manifest(80000001, [track('en', 'https://x/en'), { ...track('ko', 'https://x/ko2') }]);
  await page.settle();
  assert.deepEqual(page.lines(), [['Hello there', '안녕']]); // no blank in between
  assert.deepEqual(seen.filter(Boolean), []);
  ko2.settle();
  await page.until(() => loadedLogs(page) === 2, 'the refresh to finish');
  assert.deepEqual(page.lines(), [['Hello there', '안녕']]);
  assert.equal(page.hint(), '');
});

test('O2 8: a popup, the shown line and auto-pause stay when the translation comes', async () => {
  const ko = later();
  const page = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [ko] }), prefs: { orig: 'en', trans: 'ko', ap: true } });
  await page.until(() => page.lines().length, 'the original lines');
  await watching(page);
  assert.equal(page.origEl.querySelectorAll('.ds-word').length, 2);
  page.pickWords(0);
  await page.until(() => !page.popup.hidden, 'the word popup');
  const words = page.origEl.querySelectorAll('.ds-word');
  ko.settle();
  await page.until(() => page.lines()[0][1] === '안녕', 'the translation');
  assert.equal(page.popup.hidden, false); // not closed
  assert.deepEqual(page.origEl.querySelectorAll('.ds-word'), words); // the shown line not re-rendered
  assert.equal(page.transEl.textContent, '안녕'); // the translation line under it filled in
  assert.ok(page.list.children[0].classList.contains('on')); // the list still marks the shown line
  // Auto-pause armed while the line plays still pauses at its end after the translation came in between.
  const ko2 = later();
  const p2 = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [ko2] }), prefs: { orig: 'en', trans: 'ko', ap: true } });
  await p2.until(() => p2.lines().length, 'the original lines');
  const v = { currentTime: 1.5, paused: false, playbackRate: 1, pause() { this.paused = true; } };
  p2.show('video', v);
  p2.tick(); // playing the line: armed
  ko2.settle();
  await p2.until(() => p2.lines()[0][1] === '안녕', 'the translation');
  v.currentTime = 2.05; // past its end
  p2.tick(1);
  assert.equal(v.paused, true);
});

test('O2 9: a translation change with lines showing: lines and popup stay, the old translation goes, the new comes', async () => {
  const ja = later();
  const page = contentPage({ manifestTracks: four(), fetchText: gatedFetch(TEXT, { ja: [ja] }) });
  await page.until(() => page.lines()[0]?.[1] === '안녕', 'the lines');
  await watching(page);
  page.pickWords(0);
  await page.until(() => !page.popup.hidden, 'the word popup');
  page.pickTrans('ja');
  await page.settle();
  assert.deepEqual(page.lines(), [['Hello there', '']]);
  assert.equal(page.transEl.textContent, '');
  assert.equal(page.hint(), page.ui('hintLoading', 'Japanese'));
  assert.equal(page.popup.hidden, false);
  ja.settle();
  await page.until(() => page.lines()[0][1] === 'こんにちは', 'Japanese');
  assert.equal(page.transEl.textContent, 'こんにちは');
  assert.equal(page.popup.hidden, false);
  assert.equal(page.hint(), '');
});

test('O2 10: a line saved before its translation came keeps its ★ (same id); its meaning is saved empty', async () => {
  const ko = later(), storage = {};
  const page = contentPage({ manifestTracks: both(), fetchText: gatedFetch(TEXT, { ko: [ko] }), storage });
  await page.until(() => page.lines().length, 'the original lines');
  await watching(page);
  page.star.onclick();
  await page.settle();
  const id = sentenceId('80000001', 'en', 1, 'Hello there');
  assert.equal(storage[`item:${id}`].meaning, ''); // as with no translation track (documented)
  ko.settle();
  await page.until(() => page.lines()[0][1] === '안녕', 'the translation');
  page.tick();
  assert.equal(starred(page.star), true);
});

test('O2 11: a translation without its URL yet: the original shows at once with the hydrate hint, the URL adds it later', async () => {
  const page = contentPage({ manifestTracks: [track('en', 'https://x/en'), track('ko', null, { hydrated: false })], fetchText: gatedFetch(TEXT) });
  await page.until(() => page.lines().length, 'the original lines');
  await page.until(() => page.hint() === page.ui('hintTurnOn', 'Korean'), 'hintTurnOn'); // hydrate gave up (no player)
  assert.deepEqual(page.lines(), [['Hello there', '']]);
  page.manifest(80000001, both());
  await page.until(() => page.lines()[0][1] === '안녕', 'the translation');
  assert.equal(page.hint(), '');
});

// O2 12 (a translation timing out): see "fetch timeout: a hanging download…" above, where the original now shows.

test('O2 13: the original loading fine does not reset the translation\'s retries: still 3, then left alone', async () => {
  const slow503 = () => new Promise(r => setTimeout(() => r(503), 5)); // after the macrotask race: a second step
  const page = contentPage({ manifestTracks: both(), fetchText: url => (url.endsWith('ko') ? slow503() : TEXT.en) });
  await page.until(() => page.outcome(), 'a hint');
  for (const ms of [2000, 5000, 15000]) {
    assert.deepEqual(page.timers(), [ms]);
    page.fire();
    await page.until(() => page.outcome(), 'a hint');
    await page.settle();
  }
  assert.deepEqual(page.timers(), []);
  assert.equal(count(page, 'ko'), 4);
  assert.equal(page.hint(), page.ui('hintTransFailed', 'Korean'));
});

test('O2 14: no translation (none chosen, or not offered): one step, one "loaded"', async () => {
  for (const trans of ['', 'ja']) {
    const page = contentPage({ manifestTracks: both(), prefs: { orig: 'en', trans }, fetchText: gatedFetch(TEXT) });
    const seen = hintsSeen(page);
    await page.until(() => page.lines().length, 'the lines');
    await page.settle();
    assert.equal(loadedLogs(page), 1);
    assert.deepEqual(seen.filter(h => h && h !== page.ui('hintLoading', 'English') && h !== page.hint()), [], JSON.stringify(seen)); // no wait for a translation
    assert.equal(page.hint(), trans ? page.ui('hintNoTrans', 'Japanese') : '');
  }
});
