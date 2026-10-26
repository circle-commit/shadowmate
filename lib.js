// Pure subtitle logic. Loaded into the Netflix page before content.js, and by test.js in Node.
const DualSub = (() => {
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] !== '#' ? ENTITIES[e] ?? m
        : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)));
  }

  // TTML time expressions: offset ("543210000t", "1.5s", "1500ms") or clock ("00:01:02.345", "00:01:02:12" frames).
  function parseTime(v, tickRate, frameRate) {
    let m;
    if ((m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(v))) {
      const n = parseFloat(m[1]);
      return { h: n * 3600, m: n * 60, s: n, ms: n / 1000, f: n / frameRate, t: n / tickRate }[m[2]];
    }
    if ((m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(v)))
      return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) + (m[4] ? parseFloat(m[4]) / frameRate : 0);
    return NaN;
  }

  // Netflix TTML (dfxp-ls-sdh / imsc1.1 / simplesdh) -> [{start, end, text}] in seconds, sorted.
  // shortcut: regex, not a full XML parser; enough for Netflix's machine-written files, swap for DOMParser if a file breaks it.
  function parseTTML(xml) {
    const attr = (s, name) => (new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(s) || [])[1];
    const root = /<(?:\w+:)?tt\b[^>]*>/.exec(xml)?.[0] || '';
    const tickRate = +attr(root, 'ttp:tickRate') || 10000000; // Netflix always declares 10000000
    const frameRate = +attr(root, 'ttp:frameRate') || 30;
    // Vertical position (top edge + displayAlign share of the height) from tts:origin / tts:extent, in the file's units.
    const second = v => parseFloat((v || '').trim().split(/\s+/)[1]) || 0;
    const ALIGN = { before: 0, center: 0.5, after: 1 };
    const yOf = (tag, align) => second(attr(tag, 'tts:origin')) + (ALIGN[align] || 0) * second(attr(tag, 'tts:extent'));
    // Japanese imsc1.1 puts furigana in spans styled tts:ruby="text"; drop them or the reading repeats the kanji.
    const rubyText = new Set();
    for (const [tag] of xml.matchAll(/<(?:\w+:)?style\b[^>]*>/g))
      if (attr(tag, 'tts:ruby') === 'text') rubyText.add(attr(tag, 'xml:id'));
    const isRubyText = a => attr(a, 'tts:ruby') === 'text' || (attr(a, 'style') || '').split(/\s+/).some(id => rubyText.has(id));
    const regions = {};
    for (const [tag] of xml.matchAll(/<(?:\w+:)?region\b[^>]*>/g)) {
      const id = attr(tag, 'xml:id');
      if (id) regions[id] = { tag, align: attr(tag, 'tts:displayAlign') };
    }
    const cues = [];
    for (const [, attrs = '', body] of xml.matchAll(/<(?:\w+:)?p(\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/(?:\w+:)?p>/g)) {
      const start = parseTime(attr(attrs, 'begin'), tickRate, frameRate);
      const end = parseTime(attr(attrs, 'end'), tickRate, frameRate);
      const text = decode(body
        .replace(/<(?:\w+:)?span\b([^>]*)>[^<]*<\/(?:\w+:)?span>/g, (m, a) => isRubyText(a) ? '' : m)
        .replace(/<(?:\w+:)?br\b[^>]*>/g, '\u0000')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t\r\n]+/g, ' '))
        .split('\u0000').map(l => l.trim()).filter(Boolean).join('\n');
      const region = regions[attr(attrs, 'region')] || {};
      const y = attr(attrs, 'tts:origin') ? yOf(attrs, attr(attrs, 'tts:displayAlign') || region.align)
        : region.tag ? yOf(region.tag, region.align) : 0;
      if (end > start && text) cues.push({ start, end, text, y });
    }
    cues.sort((a, b) => a.start - b.start || a.end - b.end || a.y - b.y);
    // Lines shown together arrive as separate <p> with identical timing, one per region and not in screen order
    // (Netflix's imsc1.1 lists a two-line subtitle bottom line first): join them top to bottom.
    return cues.reduce((out, { start, end, text }) => {
      const prev = out[out.length - 1];
      if (prev && prev.start === start && prev.end === end) prev.text += '\n' + text;
      else out.push({ start, end, text });
      return out;
    }, []);
  }

  // For each original cue, the translation lines that cover at least half of the shorter of the two.
  // Netflix's languages are cut differently ("Um, as you know," vs one longer Korean line), so match by time overlap.
  function pairCues(orig, trans) {
    return orig.map(o => trans.filter(t => {
      const overlap = Math.min(o.end, t.end) - Math.max(o.start, t.start);
      return overlap > 0 && overlap >= 0.5 * Math.min(o.end - o.start, t.end - t.start);
    }).map(t => t.text).join('\n'));
  }

  // Index of the last cue that started at or before t, or -1.
  function cueIndexAt(cues, t) {
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // Track key = "en" or "en|cc". Exact match first, then same language either type, then same base language (en-GB for en).
  const trackKey = t => t.lang + (t.cc ? '|cc' : '');
  function pickTrack(tracks, key) {
    if (!key) return null;
    const [lang, cc] = key.split('|'), base = l => l.toLowerCase().split('-')[0];
    const same = tracks.filter(t => base(t.lang) === base(lang));
    return same.find(t => trackKey(t) === key) || same.find(t => t.lang === lang)
      || same.find(t => t.cc === !!cc) || same[0] || null;
  }

  // "I'm here." -> I'm / " " / here / "." with word: true on the words, so each word can be its own click target.
  const splitWords = text => text.split(/(\p{L}+(?:['’]\p{L}+)*)/u)
    .map((t, i) => ({ text: t, word: i % 2 === 1 })).filter(p => p.text);

  // Dictionary forms to try for a clicked word, as written first: "planning" -> planning, plann, plan.
  // shortcut: suffix stripping, not a real lemmatizer; irregular forms (went, children) only hit if listed as words.
  function lemmaCandidates(word) {
    const w = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
    const out = [w];
    const add = s => { if (s.length > 2 && !out.includes(s)) out.push(s); }; // 2-letter stems hit ISO codes (fr, us)
    if (w.endsWith('ies') || w.endsWith('ied')) add(w.slice(0, -3) + 'y');
    if (/(s|x|z|ch|sh)es$/.test(w)) add(w.slice(0, -2));
    if (/[^s']s$/.test(w)) add(w.slice(0, -1));
    for (const suffix of ['ed', 'ing']) {
      if (!w.endsWith(suffix)) continue;
      const stem = w.slice(0, -suffix.length);
      add(stem);
      add(/([^aeiou])\1$/.test(stem) ? stem.slice(0, -1) : stem + 'e'); // stopped -> stop, loved -> love
    }
    return out.slice(0, 4);
  }

  // Saved items ({type: 'word'|'sentence', text, meaning, sentence, translation, title, time, savedAt}) for export.
  // For a sentence, meaning is its translation; for a word, sentence/translation are the line it was saved from.
  // m:ss for display; `full` always writes h:mm:ss, since spreadsheets read a bare "0:26" as 26 minutes.
  function formatTime(sec, full) {
    const s = Math.floor(sec || 0), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = String(s % 60).padStart(2, '0');
    return h || full ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  }

  // Spreadsheet export: RFC 4180 quoting, a BOM so Excel reads Korean as UTF-8, and a leading ' on cells starting
  // with = + - @ so spreadsheets don't run them as formulas (subtitle lines often start with "- ").
  function toCSV(items) {
    const cell = v => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [['type', 'text', 'meaning', 'sentence', 'translation', 'title', 'time', 'saved_at'],
      ...items.map(i => [i.type, i.text, i.meaning, i.sentence, i.translation, i.title, formatTime(i.time, true),
        new Date(i.savedAt).toISOString()])];
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // Anki "Import File": tab-separated Front / Back / Tags with Anki's header lines. Fields are HTML, so text is
  // escaped (quotes too, or Anki's parser would take a leading " as a quoted field).
  function toAnki(items) {
    const html = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const back = i => i.type === 'word'
      ? html(i.meaning) + (i.sentence ? `<br><br><i>${html(i.sentence)}</i>` : '') + (i.translation ? `<br>${html(i.translation)}` : '')
      : html(i.meaning);
    return ['#separator:tab', '#html:true', '#tags column:3',
      // A row starting with # would be read as a comment and dropped; &#35; still shows as #.
      ...items.map(i => [html(i.text).replace(/^#/, '&#35;'), back(i), `dualsub dualsub-${i.type}`].join('\t'))].join('\n') + '\n';
  }

  // Dictionary titles to try for a dragged phrase. Wiktionary lists idioms in a general form ("beat someone to the
  // punch", "lose one's temper"), so pronouns become someone / one's, and the first word also goes to its base form
  // ("kicked the bucket" -> "kick the bucket"). Phrases only (2+ words), a few tries (Wiktionary rate-limits).
  // Titles are case-sensitive: lowercase except the pronoun I ("I mean"), and names ("New York") last, as written.
  const OBJECT = new Set(['me', 'you', 'him', 'her', 'us', 'them']);
  const POSSESSIVE = new Set(['my', 'your', 'his', 'her', 'our', 'their']);
  function phraseCandidates(words) {
    const asWritten = words.map(w => w.replace(/’/g, "'"));
    const ws = asWritten.map(w => (/^I('|$)/.test(w) ? w : w.toLowerCase()));
    const general = ws.map(w => (OBJECT.has(w) ? 'someone' : POSSESSIVE.has(w) ? "one's" : w));
    const bases = lemmaCandidates(ws[0]).slice(1, 3);
    const forms = [ws, general, ...bases.map(b => [b, ...general.slice(1)]), ws.filter(w => !OBJECT.has(w)),
      ...bases.map(b => [b, ...ws.slice(1)]), asWritten];
    return [...new Set(forms.filter(f => f.length > 1).map(f => f.join(' ')))].slice(0, 6);
  }

  // Shortcut keys are KeyboardEvent.code values ("KeyA"): the physical key, so they work in 한글 input mode too.
  const DEFAULT_KEYS = { prev: 'KeyA', repeat: 'KeyS', next: 'KeyD', ap: 'KeyQ', copy: 'KeyC', hideOrig: 'KeyW', hideTrans: 'KeyE', slow: 'KeyR', loop: 'KeyT', record: 'KeyB', compare: 'KeyN', off: 'KeyH' };
  const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.',
    Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-',
    Equal: '=', Backquote: '`' };
  const keyLabel = code => (code ? KEY_NAMES[code] || code.replace(/^(Key|Digit)/, '') : '—');

  // Give `action` the key `code`. An action that already had it takes this action's old key (a swap), so one key
  // never does two things.
  function assignKey(keys, action, code) {
    const out = { ...keys };
    const other = Object.keys(out).find(a => a !== action && out[a] === code);
    if (other) out[other] = keys[action];
    out[action] = code;
    return out;
  }

  // Saved keys over the defaults; anything malformed or missing (an action added later) falls back to its default,
  // or to no key ('') when a saved action already uses that default. A saved '' stays: that action has no key on
  // purpose (an earlier upgrade or swap), and it must not take its default back after a reload.
  function normalizeKeys(saved) {
    const ok = a => saved && typeof saved[a] === 'string' && /^[A-Za-z0-9]{0,24}$/.test(saved[a]);
    const taken = new Set(Object.keys(DEFAULT_KEYS).filter(ok).map(a => saved[a]).filter(Boolean));
    const out = {};
    for (const [a, def] of Object.entries(DEFAULT_KEYS)) out[a] = ok(a) ? saved[a] : taken.has(def) ? '' : def;
    return out;
  }

  // UI text: Korean for Korean browsers, English for everyone else. {0}, {1} are filled in by t().
  const STRINGS = {
    ko: {
      hintNoTrack: '이 작품에는 고른 언어의 자막이 없어요. ⚙에서 다른 언어를 골라 보세요',
      hintTurnOn: '넷플릭스 자막 메뉴에서 {0} 자막을 한 번 켜 주세요',
      hintLoading: '{0} 자막 불러오는 중…',
      hintFailed: '자막을 불러오지 못했어요 (콘솔의 [dualsub] 로그 확인)',
      repeatOn: '문장 반복 {0}번', repeatOff: '문장 반복 끔', repeatBtn: '반복', repeatProgress: '반복 {0}/{1}',
      micNotFound: '마이크를 찾을 수 없어요', micBusy: '다른 앱이 마이크를 쓰고 있어요',
      micDenied: '마이크를 쓸 수 없어요. 주소창 왼쪽 아이콘에서 마이크를 허용해 주세요',
      recUnsupported: '이 브라우저에서는 녹음할 수 없어요', recording: '녹음 중이에요 · 한 번 더 누르면 끝나요',
      noTake: '이 문장은 아직 녹음하지 않았어요',
      subsOff: '자막 꺼짐 · {0}를 누르면 다시 켜져요', subsOn: '자막 켜짐',
      saveFailed: '저장하지 못했어요. 확장이 다시 로드됐다면 탭을 새로고침하세요', saveLine: '이 문장 저장',
      origSub: '원어 자막', transSub: '번역 자막', origLabel: '원어 ', transLabel: '번역 ', transNone: '번역 끄기',
      actPrev: '이전 문장', actRepeat: '현재 문장 반복', actNext: '다음 문장', actAp: '자동 일시정지', actCopy: '문장 복사',
      actHideOrig: '원문 가리기', actHideTrans: '번역 가리기', actSlow: '느리게 다시 듣기', actLoop: '문장 반복 횟수',
      actRecord: '녹음·비교', actCompare: '녹음 다시 비교', actOff: '자막 끄기·켜기',
      apLabel: '자동 정지', compareBtn: '비교', on: '켬', off: '끔',
      compactLabel: '간단히 보기', compactTitle: '평소엔 자막만 보이고, 패널에 마우스를 올리면 버튼이 나와요',
      pressKey: '새 키 누르기…', resetKeys: '기본값',
      keysNote: 'Space·←→·F·M처럼 넷플릭스가 쓰는 키에 지정하면 넷플릭스 동작 대신 이 기능이 실행돼요. Esc: 취소',
      list: '자막 목록', settings: '설정: 자막 언어·단축키', resize: '드래그해서 크기 조절 · 더블클릭: 기본 크기',
      lookingUp: '찾는 중…', dictError: '사전을 불러오지 못했어요', noPhrase: '사전에 없는 표현이에요', noWord: '사전에 없는 단어예요',
      savePhrase: '표현 저장', saveWord: '단어 저장', copied: '문장을 복사했어요', copyFailed: '복사하지 못했어요',
      dictLink: '{0}에서 보기 ↗', dictLabel: '사전 ', dictAuto: '자동 (언어에 맞게)',
      savedTitle: 'Shadowmate 저장함', savedHeader: '저장한 단어·문장', count: ' {0}개', guide: '사용법', guideTitle: '기능과 단축키 설명',
      guidePage: 'help.html', csvTitle: '엑셀·구글 시트용', ankiTitle: 'Anki: 파일 → 가져오기',
      empty: '아직 없어요. 넷플릭스에서 문장 옆 ☆나 단어 뜻 창의 ☆를 누르세요.', openGuide: '사용법 보기',
      tagWord: '단어', tagLine: '문장', del: '삭제',
    },
    en: {
      hintNoTrack: 'This title has no subtitles in the chosen language. Pick another one in ⚙',
      hintTurnOn: 'Turn on {0} subtitles once in Netflix’s subtitle menu',
      hintLoading: 'Loading {0} subtitles…',
      hintFailed: 'Couldn’t load the subtitles (see [dualsub] in the console)',
      repeatOn: 'Repeat each line {0}×', repeatOff: 'Line repeat off', repeatBtn: 'Repeat', repeatProgress: 'Repeat {0}/{1}',
      micNotFound: 'No microphone found', micBusy: 'Another app is using the microphone',
      micDenied: 'Can’t use the microphone. Allow it from the icon at the left of the address bar',
      recUnsupported: 'This browser can’t record', recording: 'Recording · press again to stop',
      noTake: 'You haven’t recorded this line yet',
      subsOff: 'Subtitles off · press {0} to bring them back', subsOn: 'Subtitles on',
      saveFailed: 'Couldn’t save. If the extension was reloaded, refresh the tab', saveLine: 'Save this line',
      origSub: 'Original subtitles', transSub: 'Translation subtitles', origLabel: 'Original ', transLabel: 'Translation ', transNone: 'No translation',
      actPrev: 'Previous line', actRepeat: 'Replay line', actNext: 'Next line', actAp: 'Auto-pause', actCopy: 'Copy line',
      actHideOrig: 'Hide original', actHideTrans: 'Hide translation', actSlow: 'Replay slowly', actLoop: 'Repeat count',
      actRecord: 'Record & compare', actCompare: 'Compare again', actOff: 'Subtitles off/on',
      apLabel: 'Auto-pause', compareBtn: 'Compare', on: 'on', off: 'off',
      compactLabel: 'Compact view', compactTitle: 'Just the subtitles; the buttons appear when the pointer is on the panel',
      pressKey: 'Press a key…', resetKeys: 'Reset',
      keysNote: 'Keys Netflix uses (Space, ←→, F, M) run this feature instead of Netflix’s. Esc: cancel',
      list: 'Subtitle list', settings: 'Settings: languages & shortcuts', resize: 'Drag to resize · double-click: default size',
      lookingUp: 'Looking up…', dictError: 'Couldn’t reach the dictionary', noPhrase: 'Not in the dictionary', noWord: 'Not in the dictionary',
      savePhrase: 'Save phrase', saveWord: 'Save word', copied: 'Line copied', copyFailed: 'Couldn’t copy',
      dictLink: 'Open in {0} ↗', dictLabel: 'Dictionary ', dictAuto: 'Auto (by language)',
      savedTitle: 'Shadowmate saved', savedHeader: 'Saved words & lines', count: ' {0}', guide: 'Guide', guideTitle: 'Features and shortcuts',
      guidePage: 'help.en.html', csvTitle: 'For Excel and Google Sheets', ankiTitle: 'Anki: File → Import',
      empty: 'Nothing yet. On Netflix, press ☆ next to a line or in a word’s popup.', openGuide: 'Open the guide',
      tagWord: 'Word', tagLine: 'Line', del: 'Delete',
    },
  };
  const uiLang = lang => (/^ko\b/i.test(lang || '') ? 'ko' : 'en');
  const UI_LANG = uiLang(typeof navigator === 'object' ? navigator.language : '');
  const t = (key, ...args) => (STRINGS[UI_LANG][key] ?? STRINGS.en[key] ?? key).replace(/\{(\d)\}/g, (_, i) => args[i]);

  // Subtitle languages a new user starts with: their own language as the translation, English to learn (Spanish
  // when their own language is English).
  function defaultLangs(lang) {
    const base = (lang || 'ko').toLowerCase().split('-')[0];
    return { orig: base === 'en' ? 'es' : 'en', trans: base };
  }

  // Dictionaries for the word popup's link: [name, URL for an English word]. `auto` picks one for the user's language.
  const DICTS = {
    naver: ['네이버 사전', q => `https://en.dict.naver.com/#/search?query=${q}`],
    daum: ['다음 사전', q => `https://dic.daum.net/search.do?q=${q}&dic=eng`],
    papago: ['Papago', (q, l) => `https://papago.naver.com/?sk=en&tk=${l}&st=${q}`],
    google: ['Google Translate', (q, l) => `https://translate.google.com/?sl=en&tl=${l}&text=${q}&op=translate`],
    cambridge: ['Cambridge Dictionary', (q, l, w) =>
      `https://dictionary.cambridge.org/dictionary/${l === 'ko' ? 'english-korean' : 'english'}/${encodeURIComponent(w.replace(/ /g, '-'))}`],
    weblio: ['Weblio', q => `https://ejje.weblio.jp/content/${q}`],
  };
  function dictLink(word, lang, choice) {
    const base = (lang || '').toLowerCase().split('-')[0] || 'en';
    const key = DICTS[choice] ? choice : { ko: 'naver', ja: 'weblio', en: 'cambridge' }[base] || 'google';
    return [DICTS[key][0], DICTS[key][1](encodeURIComponent(word), base, word)];
  }

  return { parseTime, parseTTML, pairCues, cueIndexAt, trackKey, pickTrack, splitWords, lemmaCandidates,
    formatTime, toCSV, toAnki, DEFAULT_KEYS, keyLabel, assignKey, normalizeKeys, phraseCandidates,
    STRINGS, uiLang, t, defaultLangs, dictLink, DICTS };
})();

if (typeof module === 'object') module.exports = DualSub;
