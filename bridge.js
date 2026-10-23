// Isolated-world side of ☆ saving: content.js runs in the page and can't use chrome.storage, so it posts here.
// chrome.storage (not netflix.com's localStorage) so saved items survive Netflix clearing its own storage.
// Each item is its own key, so saves from two tabs never overwrite each other.
const PREFIX = 'item:';
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const reply = msg => postMessage({ source: 'dualsub-bridge', ...msg }, location.origin);

function sendSavedIds() {
  chrome.storage.local.get(null).then(all => reply({
    type: 'saved-ids',
    ids: Object.keys(all).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)),
  }), () => {}); // fails only once the extension was reloaded under this tab
}

// Messages come from the Netflix page, so keep only known fields, as bounded strings.
addEventListener('message', e => {
  const m = e.data;
  if (e.source !== window || !m || m.source !== 'dualsub') return;
  // A write that can't happen (the extension was reloaded under this tab) is reported, so the page undoes its ★.
  const failed = err => { console.warn('[dualsub] storage unavailable', err); reply({ type: 'save-failed', id: m.id || (m.item && m.item.id) }); };
  try {
    if (m.type === 'get-saved') sendSavedIds();
    if (m.type === 'unsave' && typeof m.id === 'string') chrome.storage.local.remove(PREFIX + m.id).catch(failed);
    if (m.type === 'save' && m.item && typeof m.item.id === 'string') {
      const i = m.item;
      const item = {
        id: str(i.id, 300), type: i.type === 'word' ? 'word' : 'sentence', text: str(i.text, 500),
        meaning: str(i.meaning, 2000), sentence: str(i.sentence, 1000), translation: str(i.translation, 1000),
        movieId: str(i.movieId, 20), title: str(i.title, 200), time: Number(i.time) || 0, savedAt: Date.now(),
      };
      if (item.text) chrome.storage.local.set({ [PREFIX + item.id]: item }).catch(failed);
    }
  } catch (err) {
    if (m.type === 'save' || m.type === 'unsave') failed(err);
  }
});

// Deletions in the toolbar popup (or saves in another tab) update the stars here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(k => k.startsWith(PREFIX))) sendSavedIds();
});
