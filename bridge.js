// Isolated-world side of ☆ saving: content.js runs in the page and can't use chrome.storage, so it posts here.
// chrome.storage (not netflix.com's localStorage) so saved items survive Netflix clearing its own storage.
// Each item is its own key, so saves from two tabs never overwrite each other.
const PREFIX = 'item:';
// At most `max` UTF-16 units, never ending in half of a surrogate pair (an emoji cut in two shows as �).
const str = (v, max) => {
  if (typeof v !== 'string') return '';
  const s = v.slice(0, max);
  return s.length === max && v.length > max && /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s;
};
// An id is used whole or not at all (lib.js keeps new ones under this): cut short, the stored key would no longer be
// the id the page knows, so its ☆ would never match and unsaving it would remove nothing. One too long is refused,
// and the page undoes its ☆ (save-failed), rather than saved under a key nothing can find again.
const ID_MAX = 300;
const okId = id => typeof id === 'string' && id.length > 0 && id.length <= ID_MAX;
const reply = msg => postMessage({ source: 'dualsub-bridge', ...msg }, location.origin);

// The stored keys: getKeys() reads only those, where Chrome has it; else (or if it fails) get(null), every value too.
const allKeys = () => chrome.storage.local.get(null).then(Object.keys);
function storedKeys() {
  try { if (typeof chrome.storage.local.getKeys === 'function') return chrome.storage.local.getKeys().catch(allKeys); } catch {}
  return allKeys();
}

function sendSavedIds() {
  storedKeys().then(keys => reply({
    type: 'saved-ids',
    ids: keys.filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)),
  }), () => {}); // fails only once the extension was reloaded under this tab
}

// Messages come from the Netflix page, so keep only known fields, as bounded strings.
addEventListener('message', e => {
  const m = e.data;
  if (e.source !== window || !m || m.source !== 'dualsub') return;
  // A write that can't happen (the extension was reloaded under this tab) is reported, so the page undoes its ★.
  const failed = err => { console.warn('[dualsub] save failed', err); reply({ type: 'save-failed', id: m.id || (m.item && m.item.id) }); };
  try {
    if (m.type === 'get-saved') sendSavedIds();
    if (m.type === 'unsave' && typeof m.id === 'string') {
      if (okId(m.id)) chrome.storage.local.remove(PREFIX + m.id).catch(failed); else failed('id too long');
    }
    if (m.type === 'save' && m.item && typeof m.item.id === 'string') {
      const i = m.item;
      if (!okId(i.id)) return failed('id too long');
      const item = {
        id: i.id, type: i.type === 'word' ? 'word' : 'sentence', text: str(i.text, 500), lang: str(i.lang, 20),
        meaning: str(i.meaning, 2000), sentence: str(i.sentence, 1000), translation: str(i.translation, 1000),
        movieId: str(i.movieId, 20), title: str(i.title, 200), time: Number(i.time) || 0, savedAt: Date.now(),
      };
      // Nothing to save: say so, or the page would keep showing ★ for an item that isn't there.
      if (!item.text) return failed('empty text');
      chrome.storage.local.set({ [PREFIX + item.id]: item }).catch(failed);
    }
  } catch (err) {
    if (m.type === 'save' || m.type === 'unsave') failed(err);
  }
});

// Deletions in the toolbar popup (or saves in another tab) update the stars here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(k => k.startsWith(PREFIX))) sendSavedIds();
});
