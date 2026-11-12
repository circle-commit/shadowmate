// Toolbar popup logic. Items are written by bridge.js as chrome.storage.local keys "item:<id>".
const PREFIX = 'item:';
const { t } = DualSub;
const guideURL = DualSub.guidePage(navigator.language);
// Static text in the browser's language (saved.html holds the Korean, shown until this runs).
document.title = t('savedTitle');
document.getElementById('title').textContent = t('savedHeader');
Object.assign(document.getElementById('help'), { title: t('guideTitle'), href: guideURL });
document.getElementById('help').setAttribute('aria-label', t('guide'));
document.getElementById('export-label').textContent = t('exportLabel');
const exportsEl = document.getElementById('exports');
document.addEventListener('click', e => { if (!exportsEl.contains(e.target)) exportsEl.open = false; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && exportsEl.open) {
    exportsEl.open = false;
    document.getElementById('export-label').focus();
    e.preventDefault();
  }
});
document.getElementById('csv').title = t('csvTitle');
document.getElementById('anki').title = t('ankiTitle');
const listEl = document.getElementById('list');
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// Every "item:" key, whatever its id's form (older versions' "s:"/"w:" ids included, see sentenceId in lib.js).
// key: the storage key it was read from, so × removes exactly that one whatever the item inside says its id is.
async function savedItems() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter(k => k.startsWith(PREFIX)).map(k => ({ ...all[k], key: k })).sort((a, b) => b.savedAt - a.savedAt);
}

async function render() {
  const items = await savedItems();
  document.getElementById('count').textContent = t('count', items.length);
  document.getElementById('csv').disabled = document.getElementById('anki').disabled = !items.length;
  exportsEl.hidden = !items.length;
  listEl.classList.toggle('is-empty', !items.length);
  if (!items.length) {
    exportsEl.open = false;
    const star = el('span', { className: 'empty-icon' }, '☆');
    star.setAttribute('aria-hidden', 'true');
    listEl.replaceChildren(el('li', { className: 'empty' }, star,
      el('h1', {}, t('emptyHeading')), el('p', {}, t('emptyDescription')),
      el('a', { href: guideURL, target: '_blank' }, t('saveGuide'))));
    return;
  }
  listEl.replaceChildren(...items.map(i => el('li', {},
    el('div', { className: 'text' }, el('span', { className: 'tag' }, i.type === 'word' ? t('tagWord') : t('tagLine')), i.text),
    i.meaning ? el('div', { className: 'meaning' }, i.meaning) : '',
    i.type === 'word' && i.sentence ? el('div', { className: 'context' }, i.sentence) : '',
    el('div', { className: 'src' }, [i.title, DualSub.formatTime(i.time)].filter(Boolean).join(' · ')),
    // detail < 2: the second click of a double-click would hit the next item, which moved into this slot.
    el('button', { className: 'del', title: t('del'), onclick: e => { if (e.detail < 2) chrome.storage.local.remove(i.key); } }, '×'))));
}

function download(name, text) {
  exportsEl.open = false;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
document.getElementById('csv').onclick = async () => download(`dualsub-${stamp()}.csv`, DualSub.toCSV(await savedItems()));
document.getElementById('anki').onclick = async () => download(`dualsub-anki-${stamp()}.txt`, DualSub.toAnki(await savedItems()));
chrome.storage.onChanged.addListener(render);
render();
