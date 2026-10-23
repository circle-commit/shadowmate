// Toolbar popup logic. Items are written by bridge.js as chrome.storage.local keys "item:<id>".
const PREFIX = 'item:';
const listEl = document.getElementById('list');
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

async function savedItems() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter(k => k.startsWith(PREFIX)).map(k => all[k]).sort((a, b) => b.savedAt - a.savedAt);
}

async function render() {
  const items = await savedItems();
  document.getElementById('count').textContent = ` ${items.length}개`;
  document.getElementById('csv').disabled = document.getElementById('anki').disabled = !items.length;
  if (!items.length) {
    listEl.replaceChildren(el('li', { className: 'empty' }, '아직 없어요. 넷플릭스에서 문장 옆 ☆나 단어 뜻 창의 ☆를 누르세요.',
      el('br'), el('a', { href: 'help.html', target: '_blank' }, '사용법 보기')));
    return;
  }
  listEl.replaceChildren(...items.map(i => el('li', {},
    el('div', { className: 'text' }, el('span', { className: 'tag' }, i.type === 'word' ? '단어' : '문장'), i.text),
    i.meaning ? el('div', { className: 'meaning' }, i.meaning) : '',
    i.type === 'word' && i.sentence ? el('div', { className: 'context' }, i.sentence) : '',
    el('div', { className: 'src' }, [i.title, DualSub.formatTime(i.time)].filter(Boolean).join(' · ')),
    // detail < 2: the second click of a double-click would hit the next item, which moved into this slot.
    el('button', { className: 'del', title: '삭제', onclick: e => { if (e.detail < 2) chrome.storage.local.remove(PREFIX + i.id); } }, '×'))));
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
document.getElementById('csv').onclick = async () => download(`dualsub-${stamp()}.csv`, DualSub.toCSV(await savedItems()));
document.getElementById('anki').onclick = async () => download(`dualsub-anki-${stamp()}.txt`, DualSub.toAnki(await savedItems()));
chrome.storage.onChanged.addListener(render);
render();
