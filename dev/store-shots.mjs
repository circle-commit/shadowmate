// Chrome Web Store images: five 1280x800 screenshots and the 440x280 promo tile, drawn by the real panel on the fake
// Netflix page (dev/harness.html) with a calm background instead of the test pattern. No Netflix footage is used.
// Run from the project folder (macOS, Google Chrome installed): node dev/store-shots.mjs [en]  → store/*.png (en: store/en/)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8767, CDP = 9333, ORIGIN = `http://localhost:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EN = process.argv[2] === 'en', OUT = EN ? 'store/en' : 'store';
mkdirSync(OUT, { recursive: true });
// Headlines per language: [title, subtitle] for shots 1-5, then the promo tile's tagline.
const TEXT = EN ? [
  ['Two subtitles at once', 'The language you learn and your own · any language Netflix has'],
  ['Drag to look up idioms', 'Click a word, drag a phrase · definitions and a dictionary in your language'],
  ['Listen first, check later', 'Hide either line · compact view · auto-pause after every line'],
  ['Say it, then compare', 'Repeat each line · replay at 0.75× · record yourself and compare'],
  ['Your words, into Anki', 'Save words and lines with ☆ · export to CSV or Anki'],
  'Shadowing any language<br>on Netflix',
] : [
  ['두 언어 자막을 한 화면에', '배우는 언어와 한국어를 함께 · 넷플릭스에 있는 자막이면 어떤 언어든'],
  ['드래그하면 숙어까지 찾아요', '단어는 누르고, 표현은 끌어서 · 영영 뜻과 네이버 사전'],
  ['먼저 귀로 듣고, 확인은 나중에', '원문·번역 가리기 · 간단히 보기 · 문장마다 자동 정지'],
  ['따라 말하고, 원어민과 비교', '문장 반복 · 0.75배 느리게 · 내 발음 녹음 비교'],
  ['저장한 단어는 Anki로', '☆로 모은 단어·문장을 CSV나 Anki로 내보내요'],
  '넷플릭스로 하는<br>외국어 쉐도잉',
];
const LANGS = { orig: 'en', trans: 'ko' }; // the fake page's tracks, whatever the browser language

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'shadowmate-shots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  ...(EN ? ['--lang=en-US', '--accept-lang=en-US'] : ['--lang=ko-KR', '--accept-lang=ko-KR']), '--window-size=1280,800', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  'about:blank'], { stdio: 'ignore' });
const cleanup = () => { chrome.kill(); server.kill(); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }; // retries: Chrome may still be writing its profile

let ws, nextId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const go = async url => { await send('Page.navigate', { url }); await sleep(1200); };
const capture = async name => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`${OUT}/${name}.png`);
};
// A page of our own HTML on the local origin (a data: URL may not load localhost files such as the icon).
const page = async html => { await go(`${ORIGIN}/store/`); await evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close(); 1`); await sleep(1500); };
const mouse = (type, x, y, buttons = 0) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });

const BG = 'radial-gradient(1200px 700px at 78% 18%, #2c3e66 0%, transparent 60%), radial-gradient(900px 600px at 12% 90%, #4a2c4f 0%, transparent 55%), linear-gradient(160deg, #10131c, #1b1f2c 60%, #0d0f15)';
// The fake page dressed for a screenshot: calm background, no test pattern, a headline at the top left.
const stage = (title, sub) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const s = document.createElement('style');
  s.textContent = \`body { background: ${BG} !important; } video { opacity: 0; } .player-timedtext { display: none; }
    .shot-head { position: fixed; left: 72px; top: 64px; z-index: 2147483647; color: #fff; letter-spacing: -0.02em;
      font: 700 46px/1.2 -apple-system, "Apple SD Gothic Neo", sans-serif; }
    .shot-head small { display: block; margin-top: 14px; color: rgba(235, 235, 245, 0.7); letter-spacing: 0;
      font: 500 21px/1.5 -apple-system, "Apple SD Gothic Neo", sans-serif; }\`;
  document.head.append(s);
  const h = document.createElement('div');
  h.className = 'shot-head';
  h.innerHTML = ${JSON.stringify(title)} + '<small>' + ${JSON.stringify(sub)} + '</small>';
  document.body.append(h);
  const v = document.querySelector('video');
  for (let i = 0; i < 80 && !(v.readyState >= 3 && document.getElementById('dualsub-panel') && !document.getElementById('dualsub-panel').hidden); i++) await sleep(100);
  return true;
})()`;
const harness = async prefs => {
  await go(`${ORIGIN}/dev/harness.html`);
  await evaluate(`localStorage.setItem('dualsub', ${JSON.stringify(JSON.stringify(prefs))}); 1`);
  await go(`${ORIGIN}/dev/harness.html`); // not reload(): the page renamed itself /watch/123, which the server doesn't have
};
const seek = t => evaluate(`(async () => { const v = document.querySelector('video'); v.currentTime = ${t}; v.pause(); await new Promise(r => setTimeout(r, 600)); return 1; })()`);

try {
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true })); }
    } catch { await sleep(200); }
  }
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  await send('Page.enable');
  await send('Emulation.setLocaleOverride', { locale: EN ? 'en-US' : 'ko-KR' });
  await size(1280, 800);

  // 1. Two languages at once
  await harness({ ...LANGS });
  await evaluate(stage(...TEXT[0]));
  await seek(33);
  await capture('shot-1');

  // 2. A dragged phrase looked up as one idiom
  await harness({ ...LANGS });
  await evaluate(stage(...TEXT[1]));
  await seek(33);
  const [a, b] = await evaluate(`[...document.querySelectorAll('#dualsub-panel .ds-orig .ds-word')].filter(w => /^(beat|punch)$/.test(w.textContent))
    .map(w => { const r = w.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })`);
  await mouse('mouseMoved', ...a); await mouse('mousePressed', ...a, 1);
  await mouse('mouseMoved', (a[0] + b[0]) / 2, a[1], 1); await mouse('mouseMoved', ...b, 1); await mouse('mouseReleased', ...b);
  await mouse('mouseMoved', 1270, 10);
  await sleep(3500); // the dictionary answer
  await capture('shot-2');

  // 3. Listen first: compact view with the original line hidden
  await harness({ ...LANGS, compact: true, hideOrig: true });
  await evaluate(stage(...TEXT[2]));
  await seek(13);
  await sleep(600);
  await capture('shot-3');

  // 4. Shadowing: repeat, slow, record and compare (a test tone stands in for the mic)
  await harness({ ...LANGS, repeat: 3 });
  await evaluate(stage(...TEXT[3]));
  await seek(33);
  await evaluate(`(async () => {
    navigator.mediaDevices.getUserMedia = async () => { const ac = new AudioContext(); const d = ac.createMediaStreamDestination(); ac.createOscillator().connect(d); return d.stream; };
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    return 1;
  })()`);
  await capture('shot-4');

  // 5. The word list and Anki export (the toolbar popup)
  await page(`<!doctype html><meta charset="utf-8">
    <body style="margin:0;height:100vh;background:${BG};font-family:-apple-system,'Apple SD Gothic Neo',sans-serif">
    <div style="position:fixed;left:72px;top:64px;color:#fff;letter-spacing:-0.02em;font:700 46px/1.2 -apple-system,'Apple SD Gothic Neo',sans-serif">
      ${TEXT[4][0]}<small style="display:block;margin-top:14px;color:rgba(235,235,245,.7);letter-spacing:0;font:500 21px/1.5 -apple-system,'Apple SD Gothic Neo',sans-serif">${TEXT[4][1]}</small></div>
    <iframe src="${ORIGIN}/dev/saved-harness.html" style="position:fixed;right:110px;top:150px;width:400px;height:430px;border:0;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.5)"></iframe>`);
  await capture('shot-5');

  // Small promo tile
  await size(440, 280);
  await page(`<!doctype html><meta charset="utf-8">
    <body style="margin:0;height:100vh;display:flex;align-items:center;gap:22px;padding:0 36px;box-sizing:border-box;background:${BG};font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;color:#fff">
    <img src="${ORIGIN}/icons/icon128.png" width="112" height="112" style="flex:none;margin:-14px">
    <div><div style="font:700 40px/1.1 -apple-system,sans-serif;letter-spacing:-0.02em">Shadowmate</div>
    <div style="margin-top:10px;font:500 17px/1.45 -apple-system,'Apple SD Gothic Neo',sans-serif;color:rgba(235,235,245,.75)">${TEXT[5]}</div></div>`);
  await capture('promo-440x280');
} finally {
  cleanup();
}
