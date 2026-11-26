// Runs in the page itself ("world": "MAIN") at document_start, so JSON.parse is wrapped before Netflix's player loads
// and netflix.appContext (the player API) is reachable.
(() => {
  const { parseTTML, pairCues, cueIndexAt, trackKey, pickTrack, splitWords, joinWords, wiktionarySenses, wordCandidates, startsSentence, toTranscript,
    DEFAULT_KEYS, keyLabel, assignKey, normalizeKeys, phraseCandidates, t, langName, defaultLangs, dictLink, DICTS, sentenceId, wordId } = DualSub;
  // TTML profiles, best first. imsc1.1 is the only text one for Korean/Japanese/Chinese; nflx-cmisc is images.
  const FORMATS = ['imsc1.1', 'dfxp-ls-sdh', 'simplesdh'];
  const log = (...a) => console.info('[dualsub]', ...a);
  const nativeFetch = window.fetch.bind(window); // before other extensions patch it

  // ---- 1. Capture subtitle tracks from the player manifest ----
  // movieId -> Map(trackId -> {id, lang, name, cc, url}). Merged across manifests: Netflix sends some languages
  // without a URL ("dehydrated") and a later manifest fills them in once that language is picked in its menu.
  const movies = new Map();
  const parse = JSON.parse;
  JSON.parse = function () {
    const v = parse.apply(this, arguments);
    try {
      const r = v && v.result;
      // Netflix renamed timedtexttracks -> textTracks (and ttDownloadables -> downloadables) in 2026-06.
      if (r && Array.isArray(r.textTracks || r.timedtexttracks)) onManifest(r);
    } catch (e) { console.warn('[dualsub] manifest', e); } // never break Netflix's own parsing
    return v;
  };

  function urlOf(dl) {
    for (const f of FORMATS) {
      const d = dl[f];
      const url = d && !d.isImage && (d.urls ? d.urls[0] && d.urls[0].url : Object.values(d.downloadUrls || {})[0]);
      if (url) return url;
    }
  }

  function onManifest(r) {
    const id = String(r.movieId ?? r.viewableId);
    if (!/^\d+$/.test(id)) return;
    const known = movies.get(id) || new Map();
    const seen = [];
    for (const t of r.textTracks || r.timedtexttracks) {
      const trackId = t.new_track_id ?? t.id;
      if (t.isNoneTrack || t.isForcedNarrative || t.rank < 0 || !t.language || trackId == null) continue;
      const dl = t.downloadables || t.ttDownloadables || {};
      const url = urlOf(dl) || (known.get(trackId) || {}).url; // never drop a URL we already had
      seen.push(`${t.language}${url ? '' : '(no url)'}:${Object.keys(dl).join('/')}`);
      // No text URL: either dehydrated (keep, a later manifest may fill it in) or image-only subtitles (drop).
      if (!url && t.hydrated !== false && Object.keys(dl).length) { known.delete(trackId); continue; }
      known.set(trackId, { id: trackId, lang: t.language, name: t.languageDescription || t.language,
        cc: String(t.rawTrackType).toLowerCase() === 'closedcaptions', url });
    }
    movies.set(id, known);
    log('manifest', id, seen);
    if (id === movieId()) load();
  }

  // ---- 2. Preferences (two languages, auto-pause) ----
  let prefs = { ...defaultLangs(navigator.language), ap: false };
  try { prefs = { ...prefs, ...parse(localStorage.getItem('dualsub') || '{}') }; } catch {}
  if (!(prefs.pos && Number.isFinite(prefs.pos.x) && Number.isFinite(prefs.pos.y))) prefs.pos = null; // dragged spot
  prefs.keys = normalizeKeys(prefs.keys); // shortcut per action, changed in the ⚙ settings
  if (!(prefs.scale >= 0.6 && prefs.scale <= 2)) prefs.scale = 1; // panel size, changed with its corner grip
  prefs.compact = prefs.compact === true; // 간단히 보기: just the lines until the pointer is on the panel
  prefs.hideOrig = prefs.hideOrig === true; // 가리기 (shadowing): blur that line until the pointer is on it
  prefs.hideTrans = prefs.hideTrans === true;
  if (!DICTS[prefs.dict]) prefs.dict = 'auto'; // the word popup's dictionary link, chosen in ⚙
  prefs.off = prefs.off === true; // 자막 끄기 (H): no panel, Netflix's own subtitles back
  if (![1, 2, 3, 5].includes(prefs.repeat)) prefs.repeat = 1; // 문장 반복: plays per line (1 = off)
  const save = () => { try { localStorage.setItem('dualsub', JSON.stringify(prefs)); } catch {} };

  // ---- 3. Load and pair cues for the current title ----
  const movieId = () => (/^\/watch\/(\d+)/.exec(location.pathname) || [])[1];
  // url -> Promise of cues. Failures leave it at once (so the next load downloads again); otherwise the
  // CUE_CACHE_MAX most recently used files stay, enough for switching back and forth between a title's languages.
  const cueCache = new Map(), CUE_CACHE_MAX = 8;
  // A download that hangs (no answer, or a body that never ends) is given up after FETCH_TIMEOUT_MS, as a failure.
  const FETCH_TIMEOUT_MS = 20000;
  // `retry` marks failures worth trying again in a moment: the network (offline, connection reset, the timeout) and
  // HTTP 408, 429 and 5xx. Any other HTTP error (403/404: a bad or expired URL) or an unreadable file would fail the
  // same way again.
  const netError = e => Object.assign(new Error(`network: ${e && e.message}`), { retry: true, cause: e });
  const fetchCues = url => {
    let p = cueCache.get(url);
    if (p) { cueCache.delete(url); cueCache.set(url, p); return p; } // now the most recently used
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    p = nativeFetch(url, { signal: abort.signal })
      .then(res => {
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`),
          { retry: res.status === 408 || res.status === 429 || res.status >= 500, status: res.status });
        return res.text().catch(e => { throw netError(e); });
      }, e => { throw netError(e); })
      .finally(() => clearTimeout(timer))
      .then(parseTTML)
      .catch(e => { if (cueCache.get(url) === p) cueCache.delete(url); throw e; }); // not a newer try's entry
    cueCache.set(url, p);
    for (const old of cueCache.keys()) if (cueCache.size > CUE_CACHE_MAX) cueCache.delete(old); else break;
    return p;
  };
  // The same lines at the same times: a new URL for the same file (a manifest refresh), so nothing on screen moved.
  const sameCues = (a, b) => a === b || (a.length === b.length
    && a.every((c, i) => c.start === b[i].start && c.end === b[i].end && c.text === b[i].text));

  // pairedKey: "movieId trackKey" of the translation `trans` holds, once it is in ('' while it isn't).
  let pairedKey = '', shownId, cues = [], trans = [], shown = -2, prevT = 0, prevVideoT = 0, hint = '', loadGen = 0, titleTicks = 0;
  let armed = -1;       // cue whose end triggers auto-pause
  let stuck = null;     // {i, at, sawPause}: we auto-paused after cue i at time `at`
  let jumpedUntil = 0;  // right after our own seek, trust `armed` over currentTime (the seek may not have landed)
  let slow = null;      // {v, rate, i}: replaying cue i slowly on video v; `rate` is the speed to put back
  let loop = { i: -1, n: 0 }; // 문장 반복: cue i has been replayed n times so far

  // A download that failed for a passing reason (see fetchCues) loads again by itself a few times, further apart each
  // time, for the same title and languages only. A load() for another title or languages cancels the pending retry.
  // One for the same choice while it waits (a manifest refresh, hydrate() finishing) gets the failed URLs' errors
  // without asking again and leaves the retry, its timing and the count as they are; a new URL still downloads.
  const RETRY_DELAYS = [2000, 5000, 15000];
  // dead: url -> error of a URL not to ask for again while the key stays (an HTTP error that isn't retried, 403/404,
  // or one whose retries ran out): a manifest refresh with the same URL gets its error, so its failure hint stays.
  const retry = { key: '', n: 0, timer: 0, failed: new Map(), dead: new Map() }; // key: "movieId orig trans"; failed: url -> error
  const cancelRetry = () => { clearTimeout(retry.timer); retry.timer = 0; retry.failed.clear(); };
  // Back online: what was given up on may load now. Load again if this title has failed (a URL given up on, or
  // retries spent and not yet reset by a load that worked); a request already under way is reused (fetchCues).
  addEventListener('online', () => {
    const failing = retry.dead.size > 0 || retry.n > 0;
    retry.dead.clear();
    if (failing && movies.has(movieId())) load();
  });
  // A watch page whose player manifest never came by (the extension was installed or updated with the page already
  // open, so JSON.parse was wrapped too late): say so after a while instead of showing nothing.
  const NO_MANIFEST_MS = 10000;
  let manifestWait = 0;

  // rehydrate: false from hydrate() itself, so a stalled attempt waits for the next load() instead of looping.
  async function load({ rehydrate = true } = {}) {
    const id = movieId(), known = movies.get(id), gen = ++loadGen;
    clearTimeout(manifestWait);
    manifestWait = 0;
    if (!known) {
      cancelRetry();
      if (id) manifestWait = setTimeout(() => { if (movieId() === id && !movies.has(id)) setHint(t('hintNoManifest')); },
        NO_MANIFEST_MS);
      return;
    }
    send({ type: 'get-saved' });
    // One entry per key: a second "English" (e.g. a STRIPPED_SDH variant) could never be picked anyway. Of those, the
    // first one with a URL, so a URL-less duplicate never hides one that can load (or sends it to hydrate()).
    const byKey = new Map();
    for (const tr of known.values()) { const had = byKey.get(trackKey(tr)); if (!had || (!had.url && tr.url)) byKey.set(trackKey(tr), tr); }
    const tracks = [...byKey.values()];
    // origTrack/transTrack, not o/t: `t` is the UI text function from DualSub, used for the hints below.
    const origTrack = pickTrack(tracks, prefs.orig), transTrack = pickTrack(tracks, prefs.trans);
    // The manifest did turn up after all: the "reload the page" hint no longer applies while the lines download.
    if (hint === t('hintNoManifest')) setHint(origTrack && origTrack.url ? t('hintLoading', origTrack.name) : '');
    fillSelect(origSel, tracks, origTrack, false);
    fillSelect(transSel, tracks, transTrack, true);
    const missing = [origTrack, transTrack].filter(x => x && !x.url);
    // Turned off (H): Netflix's own subtitles are showing, so don't switch them around; toggleOff() loads on turning on.
    if (!prefs.off) missing.forEach(x => hydrate(id, x, rehydrate));
    const key = `${id} ${origTrack ? trackKey(origTrack) : ''} ${transTrack ? trackKey(transTrack) : ''}`;
    if (retry.key !== key) { cancelRetry(); retry.dead.clear(); retry.key = key; retry.n = 0; } // another title or language: start afresh
    // A URL waiting for its retry, or given up on: its error again, no request (see RETRY_DELAYS).
    const get = url => (retry.dead.has(url) ? Promise.reject(retry.dead.get(url))
      : retry.failed.has(url) ? Promise.reject(retry.failed.get(url)) : fetchCues(url));
    // Only from a load that is still the newest (checked by the callers), so at most one retry is ever pending.
    const retryLater = (err, url) => {
      if (!(err && err.retry)) { if (err && err.status && url) retry.dead.set(url, err); return; } // 403/404
      if (retry.timer) { retry.failed.set(url, err); return; } // the pending retry covers this one too
      // Retries used up on HTTP errors (5xx/429/408) only: a network failure (offline, the timeout) is tried again
      // on the next load, and on getting back online (below).
      if (retry.n >= RETRY_DELAYS.length) { if (url && err.status) retry.dead.set(url, err); return; }
      const ms = RETRY_DELAYS[retry.n++];
      retry.failed.set(url, err);
      log(`retry ${retry.n}/${RETRY_DELAYS.length} in ${ms} ms`);
      retry.timer = setTimeout(() => { retry.timer = 0; retry.failed.clear(); if (movieId() === id) load(); }, ms);
    };
    // The translation downloads on its own: if only it fails, the original lines still show (without translations)
    // and a hint says so. An original that fails still fails the whole load (catch below).
    // Nothing on screen yet and the original's lines on their way: say so, rather than no panel at all. Lines already
    // showing stay as they are until the new ones are in. (An original waiting for its retry fails again at once, below,
    // so its failure hint comes straight back.)
    if (!cues.length && origTrack && origTrack.url) setHint(t('hintLoading', origTrack.name));
    let transError = null;
    const transUrl = transTrack && transTrack.url, transKey = transTrack ? `${id} ${trackKey(transTrack)}` : '';
    const transP = transUrl ? get(transUrl).catch(e => {
      transError = e;
      // Failing after the original already did (so a retry is waiting): wait with it, if this is still the newest.
      if (retry.timer && gen === loadGen && movieId() === id) retryLater(e, transUrl);
      return [];
    }) : Promise.resolve([]);
    const stale = () => gen !== loadGen || movieId() !== id; // a newer load() or another title took over
    // waiting: the original lines show and the translation is still on its way.
    const hintFor = waiting => {
      const names = missing.map(x => x.name).join(', ');
      return !origTrack ? t('hintNoTrack')
        : missing.length ? (missing.every(x => hydrated(id, x)) ? t('hintTurnOn', names) : t('hintLoading', names))
        : waiting ? t('hintLoading', transTrack.name)
        : transError ? t('hintTransFailed', transTrack.name)
        // The chosen translation isn't in this title: its select shows "none", but prefs.trans stays for the next one.
        : prefs.trans && !transTrack ? t('hintNoTrans', langName(prefs.trans))
        : '';
    };
    try {
      const oc = await (origTrack && origTrack.url ? get(origTrack.url) : []);
      if (stale()) return;
      // A slow translation doesn't hold the original lines back: they show first and it joins them when it comes.
      // One already in (the cache) or quick to come is put in with them, in one go. A macrotask, not a microtask:
      // a finished download's .catch() above settles a few microtasks later, so only this reliably lets it win.
      const WAIT = {};
      let tc = await Promise.race([transP, new Promise(r => setTimeout(() => r(WAIT), 0))]);
      if (stale()) return;
      const waiting = tc === WAIT;
      const lang = origTrack ? origTrack.lang.toLowerCase().split('-')[0] : 'en';
      // Same original lines at the same times (a translation change, or a manifest refresh, even with a new URL): keep
      // the shown line, an open popup, a take and auto-pause. Any other change makes the old line indexes meaningless.
      const same = lang === origLang && sameCues(oc, cues);
      if (!same) { armed = -1; stuck = null; jumpedUntil = 0; dropTake(); }
      // Waiting, the same lines and the same translation already next to them (a manifest refresh): leave those up.
      const keep = waiting && same && pairedKey === transKey;
      cues = oc;
      if (!waiting) trans = pairCues(oc, tc);
      else if (!keep) trans = oc.map(() => '');
      if (!keep) pairedKey = waiting || transError ? '' : transKey;
      origLang = lang;
      transLang = transTrack ? transTrack.lang : ''; // the word popup's dictionary explains in this language
      renderCues();
      if (same) {
        transEl.textContent = shown >= 0 ? trans[shown] : '';
        for (const e of [segs[shown], items[shown]]) if (e) e.classList.add('on');
        centerList(true);
      } else {
        closePopup();
        shown = -2; // re-render on the next frame
        origEl.textContent = transEl.textContent = '';
      }
      if (waiting) {
        if (!keep) setHint(hintFor(true));
        tc = await transP;
        // Only the translation changes now: the shown line, a popup, a take and auto-pause stay as they are.
        if (stale() || cues !== oc) return;
        trans = pairCues(oc, tc);
        pairedKey = transError ? '' : transKey;
        items.forEach((item, i) => { const c = item.querySelector('.ds-item-trans'); if (c) c.textContent = trans[i]; });
        if (shown >= 0) transEl.textContent = trans[shown];
      }
      setHint(hintFor(false));
      if (transError) { console.warn('[dualsub] translation fetch failed', transError); retryLater(transError, transUrl); }
      else { retry.n = 0; cancelRetry(); } // everything that could load did: a later failure gets its retries again
      log(`loaded ${origTrack && trackKey(origTrack)} (${oc.length}) + ${transTrack ? trackKey(transTrack) : 'none'} (${tc.length})`);
    } catch (e) {
      if (gen !== loadGen || movieId() !== id) return;
      console.warn('[dualsub] subtitle fetch failed', e);
      setHint(t('hintFailed'));
      retryLater(e, origTrack && origTrack.url);
      if (transError) retryLater(transError, transTrack.url); // the translation failed first: it waits for the same retry
    }
  }

  // ---- 4. Player control (setting video.currentTime directly makes Netflix show error M7375) ----
  // The watch session for this title; preview and prefetched next-episode sessions can exist at the same time.
  // Looked up at most once a second, since the frame loop asks for it every frame.
  let cachedPlayer = null, cachedAt = -1e9;
  function player() {
    if (performance.now() - cachedAt < 1000) return cachedPlayer;
    cachedAt = performance.now();
    try {
      const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const players = vp.getAllPlayerSessionIds().filter(s => s.startsWith('watch'))
        .map(s => vp.getVideoPlayerBySessionId(s)).filter(Boolean);
      cachedPlayer = players.find(p => String(p.getMovieId()) === movieId()) || (players.length === 1 ? players[0] : null);
    } catch { cachedPlayer = null; }
    return cachedPlayer;
  }
  const video = () => document.querySelector('.watch-video video') || document.querySelector('video');

  // Position in the title, in seconds. Mid-roll ads play in the same <video>, and from the first ad on
  // video.currentTime (and the player's getCurrentTime) also count the ads' length, so subtitles ran ahead by that
  // much (seen live: +32 s after one break). getSegmentTime() stays the position in the title, which is what the
  // subtitle files and seek() use, and stands still while an ad plays. It only moves every ~260 ms, so follow the
  // smooth video clock from its last move, at most a step ahead (so it also stands still during an ad, even one
  // fast-forwarded with a speed extension).
  let segAnchor = NaN, videoAnchor = 0;
  function clock(v) {
    const vt = v.currentTime;
    let seg;
    try { seg = player().getSegmentTime() / 1000; } catch {}
    if (!Number.isFinite(seg)) return vt;
    if (seg !== segAnchor) { segAnchor = seg; videoAnchor = vt; }
    // Not backwards either: after a seek back (across an ad break, say) video time minus a stale anchor is wrong.
    return segAnchor + Math.min(Math.max(vt - videoAnchor, 0), 0.5 * Math.max(1, v.playbackRate));
  }

  async function waitFor(fn, ms) {
    for (const end = performance.now() + ms; performance.now() < end;) {
      try { const v = fn(); if (v) return v; } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // A language Netflix listed without a URL: switch Netflix's own subtitles to it for a moment, which makes Netflix
  // send a newer manifest with the URL (onManifest merges it), then switch back. One at a time.
  // "movieId trackId" -> {state, tries}: 'pending'; 'done' (switched, so whatever Netflix sends is in); or 'stalled'
  // (never got to switch: no player yet, or the language not in its menu), which a later load() tries again, up to
  // HYDRATE_TRIES in all. Leaving the title mid-way forgets the attempt, so coming back starts afresh.
  const HYDRATE_TRIES = 3;
  const hydration = new Map();
  const hydrated = (id, track) => ['done', 'stalled'].includes((hydration.get(`${id} ${track.id}`) || {}).state);
  let hydrating = Promise.resolve();
  function hydrate(id, track, again) {
    const key = `${id} ${track.id}`, h = hydration.get(key);
    if (h && !(again && h.state === 'stalled' && h.tries < HYDRATE_TRIES)) return;
    const tries = (h ? h.tries : 0) + 1;
    hydration.set(key, { state: 'pending', tries });
    let state = 'stalled';
    hydrating = hydrating.then(async () => {
      const p = await waitFor(() => { const p = player(); return p && p.getTimedTextTrackList().length && p; }, 15000);
      // Turned off while this waited in line: not tried, so not counted either (turning on loads, which tries again).
      if (prefs.off) { state = 'off'; return log('off: not switching to', track.id); }
      const target = p && movieId() === id && p.getTimedTextTrackList().find(t => t.trackId === track.id);
      if (!target) return log('cannot load', track.id);
      const prev = p.getTimedTextTrack();
      try {
        await p.setTimedTextTrack(target);
        state = 'done';
        await waitFor(() => movies.get(id).get(track.id).url, 8000);
      } finally {
        // Put back what was on, unless the user picked something else in Netflix's menu meanwhile (or left the title).
        const now = p.getTimedTextTrack();
        if (prev && movieId() === id && now && now.trackId === target.trackId) await p.setTimedTextTrack(prev);
      }
    }).catch(e => console.warn('[dualsub] hydrate', e))
      .then(() => {
        if (movieId() !== id) return hydration.delete(key); // left the title: its next visit tries again
        if (state === 'off') return hydration.delete(key);
        hydration.set(key, { state, tries });
        load({ rehydrate: false }); // pick up the URL, or show the manual hint if it never came
      });
  }

  // The cue the user is "on": the one we just auto-paused after (currentTime is already past its end),
  // the one we just jumped to, else the one playing.
  function currentCue(t) {
    if (stuck) return stuck.i;
    if (performance.now() < jumpedUntil) return armed;
    return cueIndexAt(cues, t);
  }

  function go(delta) {
    const v = video();
    if (v && cues.length) jump(currentCue(clock(v)) + delta);
  }

  function jump(k) {
    const p = player();
    if (!p || !cues.length) return;
    k = Math.min(Math.max(k, 0), cues.length - 1);
    if (slow && k !== slow.i) endSlow(); // A/D, the bar or the list: the new line plays at the earlier speed
    if (compare && k !== compare.k) stopCompare();
    armed = k; // auto-pause at the end of the cue we jump to, even when it is the same one again
    stuck = null;
    jumpedUntil = performance.now() + 1000;
    p.seek(Math.ceil(cues[k].start * 1000)); // ceil: landing a fraction of a ms early shows the previous line
    p.play();
  }

  // 느리게 다시 듣기 (R / 0.75×): replay the current line slowly; tick() puts the earlier speed back when the line
  // ends. That speed may come from Netflix's speed menu or a speed extension. Writing playbackRate is safe on Netflix
  // (unlike currentTime).
  const SLOW_RATE = 0.75;
  const CLEAR_AFTER = 2; // seconds of silence after a line before it leaves the screen
  // Video Speed Controller (a common speed extension) runs in this page too and treats any speed change it didn't
  // make as the site's: it adopts one made within 0.3 s of a click, and reverts the rest to the user's speed (seen on
  // Netflix, VSC 2026). With VSC, change the speed through VSC itself so it knows the change is ours.
  function setRate(v, rate) {
    const vsc = window.VSC_controller && window.VSC_controller.actionHandler;
    if (vsc && v.vsc && typeof vsc.adjustSpeed === 'function') vsc.adjustSpeed(v, rate);
    else v.playbackRate = rate;
  }
  function slowRepeat() {
    const v = video();
    if (!v || !cues.length || !player()) return;
    const rate = slow && slow.v === v ? slow.rate : v.playbackRate; // pressed again mid-replay: keep the original speed
    slow = null; // so jump() doesn't end it
    go(0);
    slow = { v, rate, i: armed }; // armed: the line go(0) jumped to
    setRate(v, SLOW_RATE);
    keyButtons.slow.classList.add('on');
    keyButtons.slow.setAttribute('aria-pressed', 'true');
  }
  function endSlow() {
    if (slow.v.playbackRate === SLOW_RATE) setRate(slow.v, slow.rate); // unless something else changed it since
    slow = null;
    keyButtons.slow.classList.remove('on');
    keyButtons.slow.setAttribute('aria-pressed', 'false');
  }

  // 문장 반복 (T / 반복): play every line prefs.repeat times before moving on; tick() replays it at its end.
  const REPEATS = [1, 2, 3, 5];
  function cycleRepeat() {
    prefs.repeat = REPEATS[(REPEATS.indexOf(prefs.repeat) + 1) % REPEATS.length];
    save();
    renderLoop();
    toast(prefs.repeat > 1 ? t('repeatOn', prefs.repeat) : t('repeatOff'));
  }
  function renderLoop() { // "반복 2/3": the play now showing, out of how many
    const b = keyButtons.loop;
    b.textContent = prefs.repeat > 1 ? t('repeatProgress', Math.min((loop.i === shown ? loop.n : 0) + 1, prefs.repeat), prefs.repeat) : t('repeatBtn');
    b.classList.toggle('on', prefs.repeat > 1);
  }

  // 녹음·비교 (B / mic; N / 비교): record yourself saying the line, then hear the original and your take back to back.
  // The take lives in memory only (one blob URL, replaced by the next take), never saved or sent anywhere, and the
  // mic is released as soon as a take ends.
  const MAX_TAKE_MS = 30000;
  let rec = null;     // recording, or still asking for the mic: {k, recorder?, timer?, discard?}
  let take = null;    // {k, url}: the last take and its line
  let compare = null; // {k, phase: 'orig' | 'mine', audio?, sawPause?}
  async function toggleRecord() {
    if (rec) { rec.recorder ? rec.recorder.stop() : cancelRecord(); return; } // ends the take, or cancels the mic prompt
    const v = video();
    const k = v && cues.length ? currentCue(clock(v)) : -1;
    if (k < 0) return;
    stopCompare();
    // Always pause (a play() from a jump may still be on its way; the speakers would leak into the take) and hold the
    // line the way a word lookup does, so 문장 반복 can't replay it meanwhile.
    const p = player();
    p ? p.pause() : v.pause();
    stuck = stuck || { i: k, at: clock(v), sawPause: false };
    const r = rec = { k };
    renderRec();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // asks once per site the first time
    } catch (e) {
      if (rec === r) rec = null;
      renderRec();
      if (!r.discard) toast(e && e.name === 'NotFoundError' ? t('micNotFound')
        : e && e.name === 'NotReadableError' ? t('micBusy')
        : t('micDenied'));
      return;
    }
    if (r.discard) { stream.getTracks().forEach(tr => tr.stop()); return; } // a new title or an ad while asking
    const chunks = [];
    try {
      r.recorder = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach(tr => tr.stop());
      if (rec === r) rec = null;
      renderRec();
      toast(t('recUnsupported'));
      return;
    }
    r.recorder.ondataavailable = e => chunks.push(e.data);
    r.recorder.onstop = () => {
      clearTimeout(r.timer);
      stream.getTracks().forEach(tr => tr.stop()); // mic off
      if (rec === r) rec = null;
      if (!r.discard && chunks.length) {
        if (take) URL.revokeObjectURL(take.url);
        take = { k: r.k, url: URL.createObjectURL(new Blob(chunks, { type: r.recorder.mimeType })) };
        startCompare();
      }
      renderRec();
    };
    r.timer = setTimeout(() => r.recorder.state === 'recording' && r.recorder.stop(), MAX_TAKE_MS);
    r.recorder.start();
    toast(t('recording'));
  }
  function cancelRecord() { // a new title or an ad: drop the take in progress
    if (!rec) return;
    rec.discard = true;
    if (rec.recorder && rec.recorder.state === 'recording') rec.recorder.stop();
    else rec = null; // still asking: toggleRecord sees `discard` and lets the mic go
    renderRec();
  }
  function dropTake() { // a new title, or a different cue list: the take's line index means another line now
    cancelRecord();
    stopCompare();
    if (take) { URL.revokeObjectURL(take.url); take = null; }
    renderRec();
  }
  function startCompare() {
    if (!take || !cues[take.k]) return;
    stopCompare();
    compare = { k: take.k, phase: 'orig' };
    jump(take.k); // tick() pauses at the line's end and plays the take
    renderRec();
  }
  function compareAgain() {
    if (rec) return; // the original and the old take would go into the new recording
    if (take && take.k === shown) startCompare();
    else toast(t('noTake'));
  }
  function playTake() {
    const c = compare;
    c.phase = 'mine';
    c.audio = new Audio(take.url);
    c.audio.onended = c.audio.onerror = () => { if (compare === c) { compare = null; renderRec(); } };
    c.audio.play().catch(c.audio.onerror);
  }
  function stopCompare() {
    if (!compare) return;
    if (compare.audio) compare.audio.pause();
    compare = null;
    renderRec();
  }
  function renderRec() {
    keyButtons.record.classList.toggle('on', !!rec);
    keyButtons.compare.hidden = !!rec || !(take && take.k === shown);
    keyButtons.compare.classList.toggle('on', !!compare);
  }

  function toggleOff() {
    prefs.off = !prefs.off;
    save();
    if (prefs.off) {
      if (slow) endSlow(); // tick() skips playback cleanup while the panel is hidden
      closePopup(); cancelRecord(); stopCompare();
    }
    toast(prefs.off ? t('subsOff', keyLabel(prefs.keys.off)) : t('subsOn'));
    if (!prefs.off) load(); // a language that came without a URL meanwhile was left alone (see load): fetch it now
  }

  function toggleAP() {
    prefs.ap = !prefs.ap;
    apBox.checked = prefs.ap;
    save();
  }

  function toggleList() {
    prefs.list = !prefs.list;
    save();
  }

  // ---- 5. Panel ----
  const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const btn = (label, title, onclick) => el('button', { className: 'ds-btn', title, onclick, type: 'button' }, label);
  // Line icons in the spirit of SF Symbols, drawn by content.css (stroke = currentColor; `.saved` fills the star).
  const ICONS = {
    prev: 'M15 18l-6-6 6-6',
    next: 'M9 18l6-6-6-6',
    repeat: 'M4 4v5h5M4.6 15A8 8 0 1 0 6.3 6.3L4 9',
    star: 'M12 3l2.8 5.6 6.2.9-4.5 4.4 1.1 6.2L12 17.2l-5.6 2.9 1.1-6.2L3 9.5l6.2-.9z',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
    settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
    copy: 'M9.5 8.5h9a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 19v-9a1.5 1.5 0 0 1 1.5-1.5zM16 8.5V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8',
  };
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  // ---- Saving (☆): bridge.js keeps items in chrome.storage; the toolbar popup lists and exports them ----
  let storedIds = new Set(), savedIds = new Set(), wordStar = null, wordItem = null; // wordStar/wordItem: the open word popup's star
  // storedIds: what the bridge last said is in storage. savedIds is that plus the ☆ presses it hasn't confirmed yet:
  // pending, id -> {want: saved or not, n: requests sent and not yet answered by a failure}. A press stays pending
  // until a saved-ids snapshot shows what it wanted, so a snapshot sent for another reason (another item's re-ask,
  // another tab, load()) while it is on its way doesn't turn its ★ off and on again.
  const pending = new Map();
  const view = () => {
    savedIds = new Set(storedIds);
    for (const [id, p] of pending) if (p.want) savedIds.add(id); else savedIds.delete(id);
  };
  const titles = new Map(); // movieId -> title, read from Netflix's controls whenever they are showing
  const send = msg => postMessage({ source: 'dualsub', ...msg }, location.origin);
  addEventListener('message', e => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== 'dualsub-bridge') return;
    if (m.type === 'saved-ids' && Array.isArray(m.ids)) {
      storedIds = new Set(m.ids);
      for (const [id, p] of pending) if (storedIds.has(id) === p.want) pending.delete(id); // done as pressed
      view();
    } else if (m.type === 'save-failed' && typeof m.id === 'string') {
      // Not flipped back: after quick presses (save, unsave, then the save's failure) flipping would show ★ for nothing
      // stored. A later press still on its way keeps its wish; with none, that item goes back to what storage last
      // held, and storage is asked again (one ask per failure). If the extension was reloaded under this tab, the
      // bridge can't answer: the last known state stays, never a guess.
      const p = pending.get(m.id);
      if (!(p && --p.n > 0)) pending.delete(m.id);
      view();
      send({ type: 'get-saved' });
      toast(t('saveFailed'), 4000); // a passing note (long enough to read): the subtitle hint line keeps its own message
    } else return;
    updateStars();
  });
  function toggleSave(item) {
    const want = !savedIds.has(item.id);
    send(want ? { type: 'save', item } : { type: 'unsave', id: item.id });
    const p = pending.get(item.id) || { n: 0 };
    p.want = want;
    p.n++;
    pending.set(item.id, p);
    view();
    updateStars(); // right away; the bridge's saved-ids message confirms
  }
  const lineInfo = i => ({ movieId: movieId(), title: readTitle() || titles.get(movieId()) || '', time: cues[i].start });
  // Ids: see sentenceId/wordId in lib.js (with the original subtitles' language; older items keep their old ids).
  const sentenceItem = i => ({ ...lineInfo(i), id: sentenceId(movieId(), origLang, cues[i].start, cues[i].text),
    type: 'sentence', text: cues[i].text, meaning: trans[i] || '', lang: origLang });
  const starBtn = btn(icon('star'), t('saveLine'), () => { if (cues[shown]) toggleSave(sentenceItem(shown)); });
  // ★ also as aria-pressed, so a screen reader says whether it is saved.
  const pressed = (b, on) => { b.classList.toggle('saved', on); b.setAttribute('aria-pressed', String(on)); };
  function updateStars() {
    pressed(starBtn, !!cues[shown] && savedIds.has(sentenceItem(shown).id));
    if (wordStar) pressed(wordStar, savedIds.has(wordItem.id));
  }
  // "The Office" + "S1:E2 Diversity Day" from the title block in Netflix's player controls.
  function readTitle() {
    const t = document.querySelector('[data-uia="video-title"]');
    return t ? [...t.children].map(c => c.textContent.trim()).filter(Boolean).join(' · ') || t.textContent.trim() : '';
  }
  const origEl = el('div', { className: 'ds-orig' });
  const transEl = el('div', { className: 'ds-trans' });
  const hintEl = el('div', { className: 'ds-hint' });
  const setHint = text => { hint = text; hintEl.textContent = text; };
  // Hand focus back after using a control, so Space/arrows go to Netflix and A/S/D/Q keep working.
  const unfocus = e => { e.target.blur(); const pl = document.querySelector('[data-uia="player"]'); if (pl) pl.focus(); };
  const apBox = el('input', { type: 'checkbox', checked: prefs.ap, onchange: e => { prefs.ap = apBox.checked; save(); unfocus(e); } });
  const compactBox = el('input', { type: 'checkbox', checked: prefs.compact, onchange: e => {
    prefs.compact = compactBox.checked; panel.classList.toggle('ds-compact', prefs.compact); save(); unfocus(e); } });
  // 원문·번역 가리기: switches in ⚙ and W/E; content.css blurs the lines in the panel and the list.
  const applyHide = () => {
    root.classList.toggle('ds-hide-orig', prefs.hideOrig);
    root.classList.toggle('ds-hide-trans', prefs.hideTrans);
    segs.forEach((s, i) => { s.title = prefs.hideOrig ? '' : cues[i].text; }); // timing-bar tooltips (renderCues)
  };
  const hideBox = key => el('input', { type: 'checkbox', checked: prefs[key], onchange: e => {
    prefs[key] = e.target.checked; applyHide(); save(); unfocus(e); } });
  const hideBoxes = { hideOrig: hideBox('hideOrig'), hideTrans: hideBox('hideTrans') };
  function toggleHide(key) {
    prefs[key] = !prefs[key];
    hideBoxes[key].checked = prefs[key];
    applyHide();
    save();
    toast(`${ACTIONS[key][0]} ${prefs[key] ? t('on') : t('off')}`); // no button on screen shows the change
  }
  const dictSel = el('select', { title: t('dictLabel').trim(), onchange: e => { prefs.dict = dictSel.value; save(); unfocus(e); } },
    el('option', { value: 'auto' }, t('dictAuto')), ...Object.entries(DICTS).map(([k, [name]]) => el('option', { value: k }, name)));
  dictSel.value = prefs.dict;
  const origSel = el('select', { title: t('origSub'), onchange: e => { prefs.orig = origSel.value; save(); load(); unfocus(e); } });
  const transSel = el('select', { title: t('transSub'), onchange: e => { prefs.trans = transSel.value; save(); load(); unfocus(e); } });
  // Timing bar: every line is a segment on a strip, PX_PER_SEC wide per second, that slides under a fixed center
  // marker, so the lines just before and after now are visible. Clicking a segment jumps to that line.
  const PX_PER_SEC = 25;
  const strip = el('div', { className: 'ds-strip' });
  const bar = el('div', { className: 'ds-bar' }, strip);
  const list = el('div', { id: 'dualsub-list', hidden: true }); // every line with its translation; click to jump
  let segs = [], items = [], stripX = null, listScrolledAt = 0;
  let rangeFrom = -1; // where a Shift+click range starts: the list line last clicked (-1: none since renderCues)
  const pick = e => { const hit = e.target.closest('[data-i]'); if (hit) jump(+hit.dataset.i); };
  // On press, not click: the strip moves while the button is down, and a click that ends on another segment is lost.
  strip.addEventListener('mousedown', e => { if (e.button === 0) pick(e); });
  // A click jumps to the line and makes it where a Shift+click range starts; a Shift+click copies the range instead
  // (copyRange), without jumping. (Shift+press selects no page text: root's mousedown handler prevents that.)
  list.addEventListener('click', e => {
    const hit = e.target.closest('.ds-item');
    if (!hit) return;
    if (e.shiftKey) return copyRange(+hit.dataset.i);
    rangeFrom = +hit.dataset.i;
    markLines(-1, -1);
    jump(rangeFrom);
  });
  list.addEventListener('wheel', () => { listScrolledAt = performance.now(); }, { passive: true });

  // ---- Shortcuts: one key per action, changed in the ⚙ settings row (click a key, press the new one) ----
  const ACTIONS = { prev: [t('actPrev'), () => go(-1)], repeat: [t('actRepeat'), () => go(0)],
    next: [t('actNext'), () => go(1)], ap: [t('actAp'), toggleAP], copy: [t('actCopy'), () => copyLine()],
    hideOrig: [t('actHideOrig'), () => toggleHide('hideOrig')], hideTrans: [t('actHideTrans'), () => toggleHide('hideTrans')],
    slow: [t('actSlow'), slowRepeat], loop: [t('actLoop'), cycleRepeat],
    record: [t('actRecord'), toggleRecord], compare: [t('actCompare'), compareAgain], off: [t('actOff'), toggleOff] };
  const keyButtons = { prev: btn(icon('prev'), '', () => go(-1)), repeat: btn(icon('repeat'), '', () => go(0)),
    next: btn(icon('next'), '', () => go(1)), ap: el('label', { className: 'ds-ap' }, apBox, t('apLabel')),
    copy: btn(icon('copy'), '', () => copyLine()),
    slow: Object.assign(btn(`${SLOW_RATE}×`, '', slowRepeat), { className: 'ds-btn ds-text ds-slow' }),
    loop: Object.assign(btn(t('repeatBtn'), '', cycleRepeat), { className: 'ds-btn ds-text ds-loop' }),
    record: Object.assign(btn(icon('mic'), '', toggleRecord), { className: 'ds-btn ds-rec' }),
    compare: Object.assign(btn(t('compareBtn'), '', compareAgain), { className: 'ds-btn ds-text ds-cmp', hidden: true }),
    hideOrig: el('label', { className: 'ds-ap' }, hideBoxes.hideOrig, t('actHideOrig')),
    hideTrans: el('label', { className: 'ds-ap' }, hideBoxes.hideTrans, t('actHideTrans')) };
  for (const b of [starBtn, keyButtons.slow]) b.setAttribute('aria-pressed', 'false'); // toggles (see pressed, slowRepeat)
  // ⚙ row: subtitle languages (static, filled by load()) and the shortcut keys (re-rendered below).
  const shortcutsEl = el('div');
  const settingsEl = el('div', { className: 'ds-settings', hidden: true },
    el('div', { className: 'ds-set-langs' },
      el('label', {}, t('origLabel'), origSel),
      el('label', {}, t('transLabel'), transSel),
      el('label', {}, t('dictLabel'), dictSel),
      keyButtons.hideOrig, keyButtons.hideTrans,
      el('label', { className: 'ds-ap', title: t('compactTitle') }, compactBox, t('compactLabel'))),
    shortcutsEl);
  let capturing = null; // the action waiting for its new key
  function renderShortcuts() {
    for (const a in keyButtons) keyButtons[a].title = `${ACTIONS[a][0]} (${keyLabel(prefs.keys[a])})`;
    if (settingsEl.hidden) return;
    const keyBtn = a => el('button', { type: 'button', className: 'ds-key' + (capturing === a ? ' capturing' : ''),
      onclick: () => { capturing = capturing === a ? null : a; renderShortcuts(); } },
      capturing === a ? t('pressKey') : keyLabel(prefs.keys[a]));
    shortcutsEl.replaceChildren(
      el('div', { className: 'ds-set-grid' },
        ...Object.keys(ACTIONS).map(a => el('div', { className: 'ds-set-row' }, el('span', {}, ACTIONS[a][0]), keyBtn(a)))),
      el('div', { className: 'ds-set-foot' },
        el('span', { className: 'ds-set-note' }, t('keysNote')),
        el('button', { type: 'button', className: 'ds-key', onclick: () => {
          prefs.keys = { ...DEFAULT_KEYS };
          capturing = null;
          save();
          renderShortcuts();
        } }, t('resetKeys'))));
  }
  const toggleSettings = () => { settingsEl.hidden = !settingsEl.hidden; capturing = null; renderShortcuts(); };

  const panel = el('div', { id: 'dualsub-panel', hidden: true, className: prefs.compact ? 'ds-compact' : '' },
    el('div', { className: 'ds-nav' }, keyButtons.prev, keyButtons.repeat, keyButtons.next),
    el('div', { className: 'ds-lines' }, origEl, transEl, hintEl),
    // Three icons each side, mirroring the navigation, so the lines sit in the panel's center.
    el('div', { className: 'ds-side' },
      starBtn,
      btn(icon('list'), t('list'), toggleList),
      btn(icon('settings'), t('settings'), toggleSettings)),
    el('div', { className: 'ds-barrow' }, keyButtons.copy, keyButtons.slow, keyButtons.record, keyButtons.compare, bar,
      keyButtons.loop, keyButtons.ap),
    settingsEl);
  renderShortcuts();
  renderLoop();
  renderRec();

  // ---- Resizing: drag the grip in the top-right corner (up/right = bigger), double-click it for the default size.
  // The panel stays anchored at its bottom edge and grows upward; --ds-scale scales the text and the width cap.
  const grip = el('div', { className: 'ds-resize', title: t('resize') });
  panel.append(grip);
  const applyScale = () => panel.style.setProperty('--ds-scale', String(prefs.scale));
  applyScale();
  let resizing = null;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation(); // not a panel drag
    resizing = { id: e.pointerId, x0: e.clientX, y0: e.clientY, scale: prefs.scale };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', e => {
    if (!resizing || e.pointerId !== resizing.id) return;
    if (!(e.buttons & 1)) { resizing = null; save(); return; } // released where we didn't see it
    const grow = (e.clientX - resizing.x0) - (e.clientY - resizing.y0); // right and up
    prefs.scale = Math.round(Math.min(Math.max(resizing.scale + grow / 400, 0.6), 2) * 100) / 100;
    applyScale();
    positionPanel();
  });
  const endResize = e => { if (resizing && e.pointerId === resizing.id) { resizing = null; save(); } };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);
  grip.addEventListener('dblclick', e => {
    e.stopPropagation(); // not the panel's position reset
    prefs.scale = 1;
    applyScale();
    save();
    positionPanel();
  });
  const popup = el('div', { id: 'dualsub-popup', hidden: true }); // word/phrase meaning, see openLookup()
  const toastEl = el('div', { id: 'dualsub-toast', hidden: true }); // short confirmation over the panel's bottom row
  toastEl.setAttribute('role', 'status'); // read out by screen readers (W/E/T/Q change nothing else on screen)
  toastEl.setAttribute('aria-live', 'polite');
  const root = el('div', { id: 'dualsub-root' }, panel, list, popup, toastEl);
  applyHide();
  // Keep clicks on our UI from reaching Netflix (which would toggle play/pause).
  for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'])
    root.addEventListener(type, e => e.stopPropagation());
  // Our UI never takes focus (else Space would press the last button clicked, or scroll the list, instead of
  // reaching Netflix). Selects still need it to open. Scrollbar drags keep working despite preventDefault.
  root.addEventListener('mousedown', e => { if (e.target.tagName !== 'SELECT') e.preventDefault(); });

  // ---- Moving the panel: drag any empty part of it; double-click an empty part to put it back ----
  // prefs.pos = panel center x and bottom edge, as fractions of the window, so it survives resizes and fullscreen.
  const CONTROL = 'button, select, input, label, .ds-word, .ds-bar, .ds-resize'; // the bar moves under the pointer
  let controlsLift = 0, drag = null, dragged = false, adPlaying = false;
  let pauseAd = false; // Netflix's ad over a paused title (see tick)

  // Apply the dragged spot (kept inside the window) or the CSS default, and stay above Netflix's controls.
  // clientWidth/Height: the area fixed elements live in (innerWidth would include a page scrollbar).
  const viewW = () => document.documentElement.clientWidth, viewH = () => document.documentElement.clientHeight;
  function positionPanel() {
    let left = '', bottom = '';
    const h = panel.offsetHeight;
    if (prefs.pos) {
      const w = panel.offsetWidth;
      const right = list.hidden ? viewW() : list.getBoundingClientRect().left; // stay left of the open list
      left = `${Math.round(Math.min(Math.max(prefs.pos.x * viewW(), w / 2 + 8), right - w / 2 - 8))}px`;
      bottom = `${Math.round(Math.min(Math.max(prefs.pos.y * viewH(), 8), viewH() - h - 8))}px`;
    }
    if (controlsLift > 0) bottom = `max(${bottom || '12%'}, ${controlsLift}px)`;
    // Never past the window top (a big scale with long lines in a small window): the first line and the grip stay
    // reachable, even if that means covering Netflix's controls.
    bottom = `min(${bottom || '12%'}, ${Math.max(viewH() - h - 8, 0)}px)`;
    if (panel.style.left !== left) panel.style.left = left;
    if (panel.style.bottom !== bottom) panel.style.bottom = bottom;
  }

  panel.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest(CONTROL)) return;
    const r = panel.getBoundingClientRect();
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: r.left + r.width / 2, bottom: viewH() - r.bottom, moved: false };
    panel.setPointerCapture(e.pointerId); // keep getting moves after a fast drag leaves the panel
  });
  panel.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!(e.buttons & 1)) return endDrag(e); // the button was released where we didn't see it
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return; // a plain click is not a drag
      drag.moved = true;
      panel.classList.add('dragging');
    }
    prefs.pos = { x: (drag.cx + dx) / viewW(), y: (drag.bottom - dy) / viewH() };
    positionPanel();
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) { panel.classList.remove('dragging'); save(); }
    dragged = drag.moved;
    drag = null;
  };
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);
  panel.addEventListener('dblclick', e => {
    if (dragged || e.target.closest(CONTROL)) return; // a double-click whose 2nd press was a drag keeps the new spot
    prefs.pos = null;
    save();
    positionPanel();
  });

  // ---- Word and phrase meanings: click a word in the original line, or drag across several ----
  // Wiktionary's REST API (CC BY-SA): official, free, no key, sends CORS headers and works from the Netflix page.
  // (dictionaryapi.dev was the first choice, but it hangs on any request carrying an Origin header, i.e. every
  // request a browser makes.)
  const WIKTIONARY = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  const entries = new Map(); // word -> Promise of {word, meanings} or null
  let origLang = 'en', transLang = '', popupSpans = null; // popupSpans: the looked-up words' spans
  // Wiktionary HTML to text, minus inline <style> (TemplateStyles CSS) and nested sub-sense lists (the API also lists
  // those as their own definitions).
  function htmlText(html) {
    const body = new DOMParser().parseFromString(html || '', 'text/html').body;
    body.querySelectorAll('style, ol').forEach(n => n.remove());
    return body.textContent.replace(/\s+/g, ' ').trim();
  }

  function entry(word) {
    const lang = origLang, key = `${lang} ${word}`;
    if (!entries.has(key)) {
      entries.set(key, nativeFetch(WIKTIONARY + encodeURIComponent(word.replace(/ /g, '_')), { signal: AbortSignal.timeout(8000) })
        .then(res => {
          if (res.status === 404) return null;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(json => json && trimEntry(word, wiktionarySenses(json, lang)))
        .catch(e => { entries.delete(key); throw e; }));
    }
    return entries.get(key);
  }

  // Up to 3 senses with 2 definitions each, written in English whatever the word's language. The API's "en" list starts
  // with Translingual senses (letters, symbols, ISO language codes: "the" opens with one), so keep the others when
  // there are any. `formOnly` marks pages that just point at another form ("plural of city"), so define() can go on to
  // the real word. `lemma` is that form, also on pages with other senses (Spanish "echo": a noun, and a form of echar).
  function trimEntry(word, senses) {
    const own = senses.filter(s => s.language !== 'Translingual');
    const meanings = (own.length ? own : senses).map(s => ({
      pos: s.partOfSpeech || '',
      defs: (s.definitions || []).map(d => ({
        text: htmlText(d.definition),
        example: htmlText((d.examples || [])[0]),
        formOf: /form-of-definition/.test(d.definition || ''),
      })).filter(d => d.text).slice(0, 2),
    })).filter(m => m.defs.length).slice(0, 3);
    if (!meanings.length) return null;
    const formOnly = meanings.every(m => m.defs.every(d => d.formOf));
    const lemma = senses.flatMap(s => s.definitions || []).map(d => new DOMParser()
      .parseFromString(d.definition || '', 'text/html').querySelector('.form-of-definition-link a')?.title).find(Boolean);
    return { word, meanings, formOnly, lemma };
  }

  // The first title Wiktionary really defines. A page that only says "plural of city" leads to the word it names, and
  // is kept as a fallback while the remaining titles are tried.
  // One failed title doesn't end the search; the error shows only when nothing at all was found.
  async function define(tries) {
    let fallback = null, error = null;
    for (const w of tries) {
      const e = await entry(w).catch(err => { error = err; return null; });
      if (e && !e.formOnly) return { entry: e };
      const base = e && e.lemma ? await entry(e.lemma).catch(() => null) : null;
      if (base && !base.formOnly) return { entry: base };
      fallback = fallback || e;
    }
    return fallback || !error ? { entry: fallback } : { error };
  }

  function renderOrig(text) {
    const parts = splitWords(text, origLang);
    origEl.replaceChildren(...parts.map(p => p.word ? el('span', { className: 'ds-word' }, p.text) : p.text));
  }

  // Press on a word and release on another to select the words in between (a plain click selects one).
  let wordDrag = null; // {id, spans, from, to}
  const markRange = (spans, a, b) =>
    spans.forEach((sp, k) => sp.classList.toggle('sel', k >= Math.min(a, b) && k <= Math.max(a, b)));
  origEl.addEventListener('pointerdown', e => {
    const w = e.target.closest('.ds-word');
    if (!w || e.button !== 0) return;
    const spans = [...origEl.querySelectorAll('.ds-word')], i = spans.indexOf(w);
    wordDrag = { id: e.pointerId, spans, from: i, to: i };
    origEl.setPointerCapture(e.pointerId); // keep following the pointer across words
    markRange(spans, i, i);
  });
  origEl.addEventListener('pointermove', e => {
    if (!wordDrag || e.pointerId !== wordDrag.id) return;
    if (!(e.buttons & 1)) return endWordDrag(e, false); // capture lost (fullscreen remount): the release never came
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const i = wordDrag.spans.indexOf(hit && hit.closest ? hit.closest('.ds-word') : null);
    if (i < 0 || i === wordDrag.to) return;
    wordDrag.to = i;
    markRange(wordDrag.spans, wordDrag.from, i);
  });
  const endWordDrag = (e, open) => {
    if (!wordDrag || e.pointerId !== wordDrag.id) return;
    const { spans, from, to } = wordDrag;
    wordDrag = null;
    spans.forEach(sp => sp.classList.remove('sel'));
    const picked = spans.slice(Math.min(from, to), Math.max(from, to) + 1);
    if (open && picked[0].isConnected && !panel.hidden) openLookup(picked); // not if the line changed or an ad began
  };
  origEl.addEventListener('pointerup', e => endWordDrag(e, true));
  origEl.addEventListener('pointercancel', e => endWordDrag(e, false));

  // 뜻 번역: Chrome's built-in Translator puts the English definitions (and the original word, from its own language)
  // into the translation subtitles' language on this computer (only its one-time language model download uses the
  // network). Other browsers, or an unsupported language pair: no translation.
  const translators = new Map(); // "from to" -> Promise<Translator | null>
  let modelNote = null; // the open popup's "downloading the model" line
  function translatorFor(from, to) {
    if (!to || to === from || typeof Translator === 'undefined') return Promise.resolve(null);
    const key = `${from} ${to}`;
    if (!translators.has(key)) {
      const opts = { sourceLanguage: from, targetLanguage: to };
      translators.set(key, Translator.availability(opts)
        .then(a => a === 'unavailable' ? null : Translator.create({ ...opts, monitor: m => m.addEventListener('downloadprogress', e => {
          if (modelNote) modelNote.textContent = e.loaded < 1 ? t('modelLoading', Math.round(e.loaded * 100)) : '';
        }) }))
        .catch(e => { translators.delete(key); log('translator', e); return null; })); // e.g. no click to allow the download: next time
    }
    return translators.get(key);
  }

  async function openLookup(spans) {
    closePopup();
    const line = shown, phrase = spans.length > 1;
    popupSpans = spans;
    spans.forEach(sp => sp.classList.add('on'));
    const v = video(), p = player();
    if (v && p && !v.paused) {
      p.pause(); // reading takes longer than the line lasts
      // Netflix pauses asynchronously: hold this line (as auto-pause does) so the next one can't replace it meanwhile.
      stuck = stuck || { i: shown, at: clock(v), sawPause: false };
    }
    const words = spans.map(sp => sp.textContent), text = joinWords(words, origLang);
    // Asked for now, inside the click: downloading the model the first time needs the user's gesture.
    const code = (transLang || '').toLowerCase().split('-')[0], to = code === 'zh' ? transLang : code;
    const defsP = translatorFor('en', to), lineP = translatorFor(origLang, to);
    const head = el('div', { className: 'ds-pop-head' }, el('b', {}, text));
    const body = el('div', { className: 'ds-pop-body' }, t('lookingUp'));
    const link = (href, label, className) => el('a', { className, href, target: '_blank', rel: 'noopener noreferrer' }, label);
    const source = link(`https://en.wiktionary.org/wiki/${encodeURIComponent(text.toLowerCase())}`, 'Wiktionary', 'ds-pop-src');
    // [site, URL]: chosen in ⚙ or picked for the translation's language (the browser's without a translation)
    const dict = dictLink(text, origLang, transLang || navigator.language, prefs.dict);
    modelNote = el('div', { className: 'ds-pop-note' });
    popup.replaceChildren(head, body, modelNote, el('div', { className: 'ds-pop-foot' },
      link(dict[1], t('dictLink', dict[0]), 'ds-pop-link'), source));
    popup.hidden = false;
    placePopup();
    // Japanese verbs come out of the segmenter in pieces (食 / べ), so the piece right after this one is tried with it.
    const next = spans[0].nextSibling;
    const joined = !phrase && origLang === 'ja' && next && next.classList && next.classList.contains('ds-word') ? [text + next.textContent] : [];
    // The line's text before the word (as renderOrig split it): whether the word opens a sentence (German capitals).
    const k = [...origEl.querySelectorAll('.ds-word')].indexOf(spans[0]), parts = splitWords(cues[line].text, origLang);
    const at = parts.map((x, j) => j).filter(j => parts[j].word)[k] ?? -1;
    const sentenceStart = at >= 0 && startsSentence(parts.slice(0, at).map(x => x.text).join(''));
    let found = await define(phrase ? phraseCandidates(words, origLang)
      : [...joined, ...wordCandidates(text, origLang, { sentenceStart })]);
    if (phrase && !found.entry && origLang !== 'en' && text.includes(' ')) { // "echo de menos" -> "echar de menos"
      const base = (await define(wordCandidates(words[0], origLang))).entry;
      const again = base && await define(phraseCandidates([base.lemma || base.word, ...words.slice(1)], origLang));
      if (again && again.entry) found = again;
    }
    const { entry, error } = found;
    if (popupSpans !== spans) return; // closed, or another lookup started meanwhile
    if (entry) {
      head.replaceChildren(el('b', {}, entry.word));
      source.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.word)}`;
      body.replaceChildren(...entry.meanings.map(m => el('div', { className: 'ds-pop-meaning' },
        el('i', {}, m.pos),
        el('ol', {}, ...m.defs.map(d => el('li', {}, el('div', { className: 'ds-pop-def' }, d.text), d.example ? el('div', { className: 'ds-pop-ex' }, d.example) : ''))))));
    } else {
      body.textContent = error ? t('dictError') : phrase ? t('noPhrase') : t('noWord');
      if (error) log('lookup failed', error);
    }
    const headword = entry ? entry.word : text;
    wordItem = { ...lineInfo(line), id: wordId(origLang, headword), type: 'word', text: headword, lang: origLang,
      meaning: entry ? entry.meanings.map(m => `(${m.pos}) ${m.defs[0].text}`).join(' / ') : '',
      sentence: cues[line].text, translation: trans[line] || '' };
    wordStar = el('button', { className: 'ds-pop-star', type: 'button', title: phrase ? t('savePhrase') : t('saveWord'),
      onclick: () => toggleSave(wordItem) }, icon('star'));
    head.append(wordStar);
    updateStars();
    placePopup();
    const [defsTr, lineTr] = await Promise.all([defsP, lineP]);
    if (popupSpans !== spans || error) return;
    try {
      if (entry) { // the headword and each definition; the English stays underneath
        const defs = defsTr ? [...body.querySelectorAll('.ds-pop-def')] : [];
        const [word, ...out] = await Promise.all([lineTr && lineTr.translate(entry.word), ...defs.map(d => defsTr.translate(d.textContent))]);
        if (popupSpans !== spans) return;
        if (word) head.querySelector('b').append(el('span', { className: 'ds-pop-tr' }, word));
        defs.forEach((d, k) => { const en = d.textContent; d.textContent = out[k]; d.append(el('div', { className: 'ds-pop-en' }, en)); });
      } else if (lineTr) { // not in the dictionary: at least a machine translation
        const out = await lineTr.translate(text);
        if (popupSpans !== spans) return;
        body.append(el('div', { className: 'ds-pop-mt' }, out, el('span', { className: 'ds-pop-note' }, ` · ${t('machine')}`)));
      }
      placePopup();
    } catch (e) { log('translate', e); }
  }

  // Centered on the looked-up words, above the whole original line (so a word on its 2nd row doesn't hide the 1st),
  // or below the panel when it was dragged so high that there's more room there; always inside the window.
  function placePopup() {
    if (!popupSpans || popup.hidden) return;
    const rects = popupSpans.map(sp => sp.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
    const top = Math.min(...rects.map(r => r.top), origEl.getBoundingClientRect().top);
    const below = panel.getBoundingClientRect().bottom;
    const roomAbove = top - 16, roomBelow = innerHeight - below - 16, up = roomAbove >= 240 || roomAbove >= roomBelow;
    popup.style.maxHeight = `${Math.max(Math.min(innerHeight / 2, up ? roomAbove : roomBelow), 80)}px`;
    const w = popup.offsetWidth;
    popup.style.left = `${Math.min(Math.max((left + right) / 2 - w / 2, 8), innerWidth - w - 8)}px`;
    popup.style.bottom = up ? `${innerHeight - top + 8}px` : '';
    popup.style.top = up ? '' : `${below + 8}px`;
  }

  function closePopup() {
    wordStar = wordItem = null;
    if (popupSpans) popupSpans.forEach(sp => sp.classList.remove('on'));
    popupSpans = null;
    popup.hidden = true;
  }
  // ---- Copy the original line on screen (the one held after an auto-pause or a lookup, if any) ----
  async function copyLine() {
    const text = cues[shown] && cues[shown].text.replace(/\s*\n\s*/g, ' '); // one line, not the subtitle's line breaks
    if (!text) return;
    toast(await writeClipboard(text) ? t('copied') : t('copyFailed'));
  }
  // ---- Copy a range of lines from the list (Shift+click), with their times and translations, e.g. to ask a chatbot ----
  // From rangeFrom (else the line on screen, else the clicked line alone) to line k, either way round. Both lines are
  // copied whether hidden (W/E) or not: copying is asked for. At most RANGE_MAX lines, the earliest ones, so the
  // list doesn't become a way to take a whole episode's script.
  const RANGE_MAX = 100;
  async function copyRange(k) {
    if (!cues[k]) return;
    if (!cues[rangeFrom]) rangeFrom = cues[shown] ? shown : k;
    const lo = Math.min(rangeFrom, k), n = Math.min(Math.abs(rangeFrom - k) + 1, RANGE_MAX);
    markLines(lo, lo + n - 1);
    const lines = cues.slice(lo, lo + n).map((c, j) => ({ start: c.start, text: c.text, trans: trans[lo + j] }));
    const text = toTranscript(readTitle() || titles.get(movieId()) || '', lines);
    const capped = Math.abs(rangeFrom - k) + 1 > RANGE_MAX;
    if (!await writeClipboard(text)) return toast(t('copyFailed'));
    toast(capped ? t('copiedLinesMax', n) : n === 1 ? t('copiedOneLine') : t('copiedLines', n), capped ? 3000 : 1400);
  }
  // ds-sel on list lines lo..hi (none for -1, -1).
  function markLines(lo, hi) { items.forEach((item, i) => item.classList.toggle('ds-sel', i >= lo && i <= hi)); }
  // The clipboard API, else (the page's permissions policy, or a lost user gesture) the old way. True if it copied.
  async function writeClipboard(text) {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch { // the page's permissions policy (or a lost user gesture) blocked it: the old way
      const area = el('textarea', { value: text, style: 'position:fixed;opacity:0;pointer-events:none' });
      root.append(area);
      area.select();
      ok = document.execCommand('copy');
      area.remove();
      const pl = document.querySelector('[data-uia="player"]');
      if (pl) pl.focus(); // Space/arrows back to Netflix
    }
    return ok;
  }
  let toastTimer = 0;
  function toast(text, ms = 1400) {
    // A hidden panel (turned off) has no box: use the bottom middle of the window.
    const r = panel.hidden ? { left: 0, width: innerWidth, bottom: innerHeight * 0.9 } : panel.getBoundingClientRect();
    toastEl.textContent = text;
    toastEl.style.left = `${Math.round(r.left + r.width / 2)}px`;
    toastEl.style.bottom = `${Math.round(innerHeight - r.bottom + 6)}px`; // over the timing bar, clear of the word popup above
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // A press anywhere outside our UI closes it (inside, a word click opens the next one, and a line change closes it).
  document.addEventListener('mousedown', e => { if (!popup.hidden && !root.contains(e.target)) closePopup(); }, true);

  // Rebuild the timing bar and the list whenever the cue list or its translations change.
  function renderCues() {
    segs = cues.map((c, i) => {
      const seg = el('div', { className: 'ds-seg', title: prefs.hideOrig ? '' : c.text }); // a tooltip would give away a hidden line
      seg.dataset.i = i;
      seg.style.left = `${c.start * PX_PER_SEC}px`;
      seg.style.width = `${Math.max((c.end - c.start) * PX_PER_SEC, 2)}px`;
      return seg;
    });
    items = cues.map((c, i) => {
      const item = el('div', { className: 'ds-item' },
        el('div', { className: 'ds-item-orig' }, c.text), el('div', { className: 'ds-item-trans' }, trans[i] || ''));
      item.dataset.i = i;
      return item;
    });
    strip.replaceChildren(...segs);
    list.replaceChildren(...items);
    stripX = null;
    rangeFrom = -1; // other lines now: a range starts afresh (the new items have no ds-sel)
  }

  // Keep the current line in the middle of the list, unless the user is pointing at it (the line they are about to
  // click would slide away) or scrolled it in the last few seconds.
  function centerList(force) {
    const item = items[shown];
    if (list.hidden || !item) return;
    if (!force && (list.matches(':hover') || performance.now() - listScrolledAt < 4000)) return;
    list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
  }

  function fillSelect(sel, tracks, chosen, allowOff) {
    sel.replaceChildren(
      ...(allowOff ? [el('option', { value: '' }, t('transNone'))] : []),
      ...tracks.map(t => el('option', { value: trackKey(t), selected: t === chosen }, t.name + (t.cc ? ' [CC]' : ''))));
    if (!chosen) sel.value = '';
  }

  // In fullscreen only the fullscreen element's subtree is drawn, so our UI has to live inside it.
  function mount() {
    const fs = document.fullscreenElement;
    const host = fs && fs !== document.documentElement && fs.tagName !== 'VIDEO' ? fs : document.body;
    if (host && root.parentNode !== host) { host.append(root); centerList(true); } // moving resets the list's scroll
  }
  document.addEventListener('fullscreenchange', mount);

  // ---- 6. Keyboard: the shortcut keys in prefs.keys (A/S/D/Q by default), matched by e.code ----
  addEventListener('keydown', e => {
    // Waiting for a new shortcut: take the next plain key (Esc/Tab cancel; browser shortcuts with Cmd/Ctrl/Alt and
    // a lone modifier press pass through).
    // Only while the panel (and its prompt) shows; lock and 한/영 input-source keys are skipped like modifiers.
    if (capturing && !panel.hidden && !e.ctrlKey && !e.metaKey && !e.altKey
      && !/^(Shift|Control|Alt|Meta|OS|CapsLock|Fn|Lang|Convert|NonConvert|KanaMode)/.test(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code && e.code !== 'Escape' && e.code !== 'Tab') {
        prefs.keys = assignKey(prefs.keys, capturing, e.code);
        save();
      }
      capturing = null;
      renderShortcuts();
      return;
    }
    if (e.code === 'Escape') { if (!popup.hidden) closePopup(); markLines(-1, -1); } // and Netflix still gets Esc
    const offKey = prefs.off && e.code && e.code === prefs.keys.off && video(); // the one key alive while off
    if (((panel.hidden || root.hidden) && !offKey) || e.ctrlKey || e.metaKey || e.altKey) return; // root: pause ad
    const tgt = e.target;
    if (tgt instanceof Element && !root.contains(tgt) && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
    const action = e.code && Object.keys(ACTIONS).find(a => prefs.keys[a] === e.code); // '' = action with no key
    // Without lines there is nothing to navigate or copy: leave the key to Netflix. Mode switches work anyway.
    if (!action || (!['ap', 'hideOrig', 'hideTrans', 'loop', 'off'].includes(action) && !cues.length)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) ACTIONS[action][1]();
  }, true);

  // ---- 7. Frame loop: follow navigation, show the current line, auto-pause ----
  // setTimeout, not requestAnimationFrame: rAF stops in background tabs, but Chrome keeps timers running in a tab
  // that plays audio, so auto-pause still works while the learner looks something up in another tab.
  function tick() {
    setTimeout(tick, 16);
    const id = movieId();
    if (id !== shownId) {
      shownId = id; cues = []; trans = []; shown = -2; armed = -1; stuck = null;
      if (slow) endSlow();
      dropTake();
      cachedAt = -1e9; segAnchor = NaN; // a new title has its own player and clock
      closePopup();
      origEl.textContent = transEl.textContent = '';
      renderCues();
      setHint('');
      if (id) load();
    }
    const v = id && video();
    // About every 100 ms: an ad playing (Netflix shows its ad info), the controls bar (~135px at the bottom while the
    // mouse moves, so the panel sits above it), and about every second the title for saved items.
    if (v && ++titleTicks % 6 === 0) {
      adPlaying = !!document.querySelector('[data-uia="ads-info-container"]');
      if (adPlaying) closePopup();
      // Netflix's pause ad (shown over the paused title after a few seconds; seen live 2026-11-12) is not an ad
      // playing: the title just waits. So only stand aside: hide all of our UI while it shows, keeping the line, an
      // open popup, a take, a slow replay and auto-pause as they are, and come back as it goes. Only while paused and
      // drawn, so an ordinary pause (to read, record or look up a word) keeps the panel.
      const ad = document.querySelector('[data-uia="depp-pause-ad"]');
      pauseAd = !!(v.paused && ad && ad.getClientRects().length);
      const controls = document.querySelector('[data-uia="controls-standard"]');
      controlsLift = controls ? Math.round(innerHeight - controls.getBoundingClientRect().top + 8) : 0;
      if (titleTicks % 60 === 0) { const title = readTitle(); if (title) titles.set(id, title); }
    }
    if (slow && (slow.v !== v || adPlaying)) endSlow(); // a new player, or an ad, ends the slow replay
    if (adPlaying) { cancelRecord(); stopCompare(); }
    root.hidden = !!(v && pauseAd);
    // During an ad there is nothing to show; hidden, the panel also leaves A/S/D to Netflix.
    panel.hidden = !(v && !adPlaying && !prefs.off && (cues.length || hint));
    document.documentElement.classList.toggle('dualsub-on', !!(v && cues.length && !prefs.off));
    const listOn = !!(prefs.list && v && !adPlaying && !prefs.off && cues.length);
    if (list.hidden === listOn) { list.hidden = !listOn; root.classList.toggle('list-open', listOn); centerList(true); }
    if (panel.hidden) return;
    mount();
    if (titleTicks % 6 === 0) positionPanel();
    placePopup(); // no-op unless open; follows fullscreen changes, resizes and the list toggle
    if (!cues.length) { if (slow) endSlow(); return; } // the cues went away (another language loading)

    const t = clock(v);
    // A seek we didn't make (Netflix's ← or seek bar) starts the 문장 반복 count afresh, even back into the same line.
    if (loop.i >= 0 && performance.now() > jumpedUntil && Math.abs(v.currentTime - prevVideoT) >= 1) { loop = { i: -1, n: 0 }; renderLoop(); }
    // The armed cue just played to its end (a big jump means a seek, not playback). (The title clock lags a seek by up
    // to a step, so also require the raw video time not to have jumped.) Replay it while 문장 반복 has plays left,
    // else auto-pause.
    if (armed >= 0 && !v.paused && prevT < cues[armed].end && t >= cues[armed].end && t - prevT < 1
      && Math.abs(v.currentTime - prevVideoT) < 1) {
      if (loop.i !== armed) loop = { i: armed, n: 0 };
      if (compare && compare.phase === 'orig' && armed === compare.k) { // 녹음 비교: the original is done, now the take
        const p = player();
        p ? p.pause() : v.pause();
        stuck = { i: armed, at: t, sawPause: false };
        playTake();
      } else if (loop.n + 1 < prefs.repeat && !stuck) { // stuck here = a word lookup's pause still on its way: let it win
        loop.n++;
        jump(armed); // same line: a slow replay (R) stays slow
        renderLoop();
      } else if (prefs.ap) {
        const p = player();
        p ? p.pause() : v.pause();
        stuck = { i: armed, at: t, sawPause: false };
      }
    }
    prevT = t;
    prevVideoT = v.currentTime;
    // The slow replay ends with its line: playback past the end, or a jump or seek elsewhere (not while our own seek
    // is still landing, when the clock can still show the old spot).
    const sc = slow && cues[slow.i]; // gone if the cues were reloaded (another language) mid-replay
    if (slow && performance.now() > jumpedUntil && (!sc || t >= sc.end || t < sc.start - 0.5)) endSlow();
    // Leave the stuck state once the user resumes or seeks (Netflix pauses asynchronously, so wait to see the pause first).
    if (stuck) {
      if (Math.abs(t - stuck.at) > 1 || (!v.paused && stuck.sawPause)) stuck = null;
      else if (v.paused) stuck.sawPause = true;
    }
    // A seek elsewhere (Netflix's ←/→ or seek bar) while the original plays ends the comparison.
    const cc = compare && compare.phase === 'orig' && cues[compare.k];
    if (cc && performance.now() > jumpedUntil && (t < cc.start - 0.5 || t > cc.end + 0.5)) stopCompare();
    // Playing the video again while the take plays ends the comparison (Netflix pauses asynchronously: see it first).
    if (compare && compare.phase === 'mine') {
      if (v.paused) compare.sawPause = true;
      else if (compare.sawPause) stopCompare();
    }

    const i = cueIndexAt(cues, t);
    if (performance.now() > jumpedUntil && i >= 0 && t < cues[i].end) armed = i;
    if (loop.i >= 0 && armed !== loop.i) { loop = { i: -1, n: 0 }; renderLoop(); } // moved to another line: count afresh
    const x = Math.round(-t * PX_PER_SEC);
    if (x !== stripX) { stripX = x; strip.style.transform = `translateX(${x}px)`; }

    // While our own seek lands the clock still reads the old spot: show the line we jumped to (as currentCue() picks
    // it), so a 문장 반복 replay doesn't flash the next line.
    // More than CLEAR_AFTER s of silence after a line clears it (cueIndexAt keeps the last line until the next one).
    const show = stuck ? stuck.i : performance.now() < jumpedUntil ? armed
      : i >= 0 && t > cues[i].end + CLEAR_AFTER ? -1 : i;
    if (show !== shown) {
      for (const e of [segs[shown], items[shown]]) if (e) e.classList.remove('on');
      shown = show;
      closePopup();
      renderOrig(show >= 0 ? cues[show].text : '');
      transEl.textContent = show >= 0 ? trans[show] : '';
      for (const e of [segs[show], items[show]]) if (e) e.classList.add('on');
      centerList(false);
      updateStars();
      renderLoop();
      renderRec();
    }
  }
  tick();
})();
