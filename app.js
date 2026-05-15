/* Webamp PWA — app.js */

// ── Config ──
const ALGOLIA_APP_ID = 'HQ9I5Z6IM5';
const ALGOLIA_API_KEY = '6466695ec3f624a5fccf46ec49680e51';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/Skins/query`;
const SKINS_CDN = 'https://r2.webampskins.org';
const RADIO_API = 'https://all.api.radio-browser.info/json/stations';

// Native Webamp dimensions (main + EQ + playlist stacked at default)
// Main: 275×116, EQ: 275×116, Playlist: 275×116 (default unshaded height)
const WEBAMP_W = 275;
const WEBAMP_H = 350; // sum of three stacked windows

// ── State ──
let webamp = null;
let webampReady = false;
let currentSkin = null; // { md5, fileName }
let skinGallery = []; // Array of { md5, fileName }
let skinIndex = -1;
let activeTracks = []; // For local files we hold object URLs to revoke later

const LS_LAST_SKIN = 'webamp_last_skin';
const LS_PLAYLIST  = 'webamp_playlist';
const PLAYLIST_MAX = 50;

function savedLastSkin() {
  try {
    const v = localStorage.getItem(LS_LAST_SKIN);
    return v ? JSON.parse(v) : null;
  } catch (_) { return null; }
}
function persistLastSkin(skin) {
  try { localStorage.setItem(LS_LAST_SKIN, JSON.stringify(skin)); } catch (_) {}
}

// Playlist persistence — only network URLs (blob: object URLs become invalid
// on reload, so we never persist local files).
function getStoredPlaylist() {
  try {
    const v = localStorage.getItem(LS_PLAYLIST);
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function saveStoredPlaylist(list) {
  try {
    const trimmed = (list || []).slice(0, PLAYLIST_MAX);
    localStorage.setItem(LS_PLAYLIST, JSON.stringify(trimmed));
  } catch (_) {}
}
function addToStoredPlaylist(track) {
  if (!track || !track.url) return;
  if (track.url.startsWith('blob:')) return; // local files don't survive reload
  const list = getStoredPlaylist().filter((t) => t.url !== track.url);
  list.unshift({ url: track.url, defaultName: track.defaultName || track.url });
  saveStoredPlaylist(list);
}
function clearStoredPlaylist() {
  try { localStorage.removeItem(LS_PLAYLIST); } catch (_) {}
}

// ── URL hash sharing: #skin=<md5>&name=<file>&radio=<url>&station=<name> ──
function parseHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return {};
  const p = new URLSearchParams(h);
  const out = {};
  const md5 = p.get('skin');
  if (md5 && /^[a-f0-9]{32}$/i.test(md5)) {
    out.skin = { md5, fileName: p.get('name') || md5 };
  }
  const radio = p.get('radio');
  if (radio && /^https?:\/\//i.test(radio)) {
    out.radio = { url: radio, defaultName: p.get('station') || 'Radio' };
  }
  return out;
}
function rebuildHash() {
  const p = new URLSearchParams();
  if (currentSkin && currentSkin.md5) {
    p.set('skin', currentSkin.md5);
    if (currentSkin.fileName) p.set('name', currentSkin.fileName);
  }
  if (lastStreamTrack && lastStreamTrack.url && !lastStreamTrack.url.startsWith('blob:')) {
    p.set('radio', lastStreamTrack.url);
    if (lastStreamTrack.defaultName) p.set('station', lastStreamTrack.defaultName);
  }
  const s = p.toString();
  const newHash = s ? '#' + s : '';
  if (location.hash !== newHash) {
    history.replaceState(null, '', location.pathname + location.search + newHash);
  }
}
// Compatibility shim — old call sites still use setHashSkin.
function setHashSkin(_skin) { rebuildHash(); }

// ── DOM refs ──
const $ = (id) => document.getElementById(id);
const launcher = $('launcher');
const playerView = $('playerView');
const statusMsg = $('statusMsg');
const swipeHint = $('swipeHint');

// ── Tabs ──
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Status helpers ──
function showMsg(text, kind = 'info', autoHideMs = 3000) {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${kind}`;
  if (autoHideMs) {
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(hideMsg, autoHideMs);
  }
}
function hideMsg() {
  statusMsg.className = 'status-msg hidden';
}

// ── Radio Browser ──
async function searchRadio({ q = '', tag = '', country = '', limit = 60 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('hidebroken', 'true');
  params.set('order', 'clickcount');
  params.set('reverse', 'true');
  if (q) params.set('name', q);
  if (tag) params.set('tag', tag);
  if (country) params.set('countrycode', country);
  const url = `${RADIO_API}/search?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Radio API ' + res.status);
  return res.json();
}

function renderStations(stations) {
  const grid = $('radioResults');
  grid.innerHTML = '';
  if (!stations || !stations.length) {
    grid.innerHTML = '<div class="hint">Nema rezultata.</div>';
    return;
  }
  for (const s of stations) {
    if (!s.url_resolved && !s.url) continue;
    const card = document.createElement('div');
    card.className = 'station-card';
    const tags = (s.tags || '').split(',').filter(Boolean).slice(0, 3);
    card.innerHTML = `
      <div class="name">${escHtml(s.name)}</div>
      <div class="meta">
        ${s.countrycode ? `<span>${flagEmoji(s.countrycode)} ${escHtml(s.country || s.countrycode)}</span>` : ''}
        ${s.bitrate ? `<span class="tag">${s.bitrate}k</span>` : ''}
        ${s.codec ? `<span class="tag">${escHtml(s.codec)}</span>` : ''}
        ${tags.map((t) => `<span class="tag">${escHtml(t.trim())}</span>`).join('')}
      </div>
    `;
    const streamUrl = s.url_resolved || s.url;
    card.addEventListener('click', () => playRadio(streamUrl, s.name));
    grid.appendChild(card);
  }
}

async function doRadioSearch(q, country, tag) {
  const grid = $('radioResults');
  grid.innerHTML = '<div class="hint"><span class="spinner"></span>Pretraga…</div>';
  try {
    const stations = await searchRadio({ q, country, tag });
    renderStations(stations);
  } catch (e) {
    grid.innerHTML = `<div class="hint">Greška: ${escHtml(e.message)}</div>`;
  }
}

$('radioSearchBtn').addEventListener('click', () => {
  const q = $('radioSearch').value.trim();
  const country = $('radioCountry').value;
  doRadioSearch(q, country, '');
});

// ── Saved stations UI ──
function renderSavedStations() {
  const list = getStoredPlaylist();
  const wrap = $('savedStations');
  const ul   = $('savedStationsList');
  if (!list.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  ul.innerHTML = '';
  list.forEach((t) => {
    const chip = document.createElement('div');
    chip.className = 'saved-chip';
    chip.innerHTML = `<span class="lbl">${escHtml(t.defaultName || t.url)}</span><span class="x" title="Ukloni">✕</span>`;
    chip.querySelector('.lbl').addEventListener('click', () => playRadio(t.url, t.defaultName));
    chip.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation();
      const filtered = getStoredPlaylist().filter((x) => x.url !== t.url);
      saveStoredPlaylist(filtered);
      renderSavedStations();
    });
    ul.appendChild(chip);
  });
}

$('btnPlayAllSaved').addEventListener('click', () => {
  const list = getStoredPlaylist();
  if (!list.length) return;
  if (!webamp) {
    initWebamp({ tracks: list, autoPlay: true });
  } else {
    webamp.setTracksToPlay(list);
  }
  showMsg(`Pokrećem ${list.length} stanica…`, 'info', 2500);
  showPlayerView();
});
$('radioSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('radioSearchBtn').click();
});
document.querySelectorAll('#radioChips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#radioChips .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    doRadioSearch('', $('radioCountry').value, chip.dataset.tag);
  });
});

// ── Skins (Algolia + r2.webampskins.org) ──
async function searchSkins(query, hitsPerPage = 60) {
  const body = {
    params: `hitsPerPage=${hitsPerPage}&query=${encodeURIComponent(query)}&filters=NOT nsfw:true`,
  };
  const res = await fetch(ALGOLIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-API-Key': ALGOLIA_API_KEY,
      'X-Algolia-Application-Id': ALGOLIA_APP_ID,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Algolia ' + res.status);
  const data = await res.json();
  return (data.hits || []).map((h) => ({ md5: h.md5, fileName: h.fileName, nsfw: !!h.nsfw }));
}

async function randomSkins(count = 60) {
  // Algolia free tier caps visible results at ~1000, so usable pages = floor(1000/count).
  // First request page 0 to learn actual nbPages, then re-request a random valid page.
  async function call(page) {
    const body = {
      params: `hitsPerPage=${count}&query=&page=${page}&filters=NOT nsfw:true`,
    };
    const res = await fetch(ALGOLIA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-API-Key': ALGOLIA_API_KEY,
        'X-Algolia-Application-Id': ALGOLIA_APP_ID,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Algolia ' + res.status);
    return res.json();
  }
  const first = await call(0);
  const nbPages = Math.max(1, first.nbPages || 1);
  // If only one page, just return it.
  if (nbPages <= 1) {
    return (first.hits || []).map((h) => ({ md5: h.md5, fileName: h.fileName, nsfw: !!h.nsfw }));
  }
  const randPage = Math.floor(Math.random() * nbPages);
  const data = randPage === 0 ? first : await call(randPage);
  return (data.hits || []).map((h) => ({ md5: h.md5, fileName: h.fileName, nsfw: !!h.nsfw }));
}

function skinScreenshotUrl(md5) {
  return `${SKINS_CDN}/screenshots/${md5}.png`;
}
function skinWszUrl(md5) {
  return `${SKINS_CDN}/skins/${md5}.wsz`;
}

function renderSkins(skins) {
  const grid = $('skinResults');
  grid.innerHTML = '';
  skinGallery = skins;
  if (!skins.length) {
    grid.innerHTML = '<div class="hint">Nema skinova.</div>';
    return;
  }
  skins.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = 'skin-card';
    card.dataset.md5 = s.md5;
    const niceName = (s.fileName || '').replace(/\.wsz$/i, '');
    card.innerHTML = `
      <img loading="lazy" src="${skinScreenshotUrl(s.md5)}" alt="${escHtml(niceName)}"
           onerror="this.style.display='none'">
      <div class="skin-name">${escHtml(niceName)}</div>
    `;
    card.addEventListener('click', () => applySkinFromGallery(idx));
    grid.appendChild(card);
  });
}

async function doSkinSearch(q) {
  const grid = $('skinResults');
  grid.innerHTML = '<div class="hint"><span class="spinner"></span>Pretraga…</div>';
  try {
    const skins = q ? await searchSkins(q) : await randomSkins();
    renderSkins(skins);
  } catch (e) {
    grid.innerHTML = `<div class="hint">Greška: ${escHtml(e.message)}</div>`;
  }
}

$('skinSearchBtn').addEventListener('click', () => doSkinSearch($('skinSearch').value.trim()));
$('skinSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('skinSearchBtn').click();
});
$('skinRandomBtn').addEventListener('click', () => doSkinSearch(''));

// Load an initial random batch when Skins tab is first opened
let skinsLoadedOnce = false;
document.querySelector('.tab[data-tab="skins"]').addEventListener('click', () => {
  if (!skinsLoadedOnce) {
    skinsLoadedOnce = true;
    doSkinSearch('');
  }
});

// ── Webamp lifecycle ──
function initWebamp(opts = {}) {
  if (webamp) return webamp;

  const initial = {};
  if (opts.skinUrl) initial.initialSkin = { url: opts.skinUrl };
  if (opts.tracks && opts.tracks.length) initial.initialTracks = opts.tracks;

  // eslint-disable-next-line no-undef
  webamp = new Webamp({
    ...initial,
    // Disable Webamp's built-in hotkeys (Left/Right = seek ±5s, Z/X/C/V/B etc.).
    // They conflict with our Left/Right swipe/key bindings for skin switching,
    // and Left on a live radio stream crashes Webamp with a non-finite seek.
    enableHotkeys: false,
    windowLayout: {
      main:      { position: { left: 0, top: 0 } },
      equalizer: { position: { left: 0, top: 116 } },
      playlist:  { position: { left: 0, top: 232 }, size: { extraWidth: 0, extraHeight: 0 } },
    },
  });

  // Wire Webamp's own skin chrome to our app shell.
  // X (close) → cancel Webamp's own close, go back to launcher (keep instance alive).
  webamp.onWillClose((cancel) => {
    cancel();
    backToLauncher();
  });
  // _ (minimize) → toggle minimal/full mode.
  webamp.onMinimize(() => {
    userOverrideMode = true;
    const isMinimal = playerView.classList.contains('minimal');
    setPlayerMode(!isMinimal);
  });

  webamp.renderWhenReady($('webampHost')).then(() => {
    const root = document.getElementById('webamp');
    if (root && root.parentElement !== $('webampHost')) {
      $('webampHost').appendChild(root);
    }
    webampReady = true;
    applyWebampScale();
    startMediaStatusWatcher();
    if (opts.autoPlay) {
      try { webamp.play(); } catch (_) {}
    }
  });

  return webamp;
}

function isPortrait() {
  return window.matchMedia('(orientation: portrait)').matches;
}

function showPlayerView() {
  launcher.classList.add('hidden');
  playerView.classList.remove('hidden');
  // Default mode by orientation:
  //   landscape → minimal (just main window, scaled big and wide)
  //   portrait  → full (main + EQ + playlist stacked vertically)
  setPlayerMode(!isPortrait());
  document.body.classList.add('in-player');
  applyWebampScale();
  if (swipeHint) {
    setTimeout(() => swipeHint.classList.add('faded'), 5000);
  }
}

function setPlayerMode(minimal) {
  if (minimal) playerView.classList.add('minimal');
  else playerView.classList.remove('minimal', 'view-eq', 'view-pl');
  // Re-measure and rescale after layout change
  requestAnimationFrame(() => applyWebampScale());
}

// In minimal mode, tapping the EQ or PL toggle button on Webamp's main
// window swaps which single window is shown fullscreen (main / eq / playlist).
// Tapping the same button again returns to main.
function setMinimalView(which /* 'main' | 'eq' | 'pl' */) {
  if (!playerView.classList.contains('minimal')) return;
  playerView.classList.remove('view-eq', 'view-pl');
  if (which === 'eq') playerView.classList.add('view-eq');
  else if (which === 'pl') playerView.classList.add('view-pl');
  requestAnimationFrame(() => applyWebampScale());
}
document.addEventListener('click', (e) => {
  if (!webamp) return;
  if (playerView.classList.contains('hidden')) return;
  if (!playerView.classList.contains('minimal')) return; // full mode: let Webamp handle
  const eqBtn = e.target.closest && e.target.closest('#equalizer-button');
  const plBtn = e.target.closest && e.target.closest('#playlist-button');
  if (!eqBtn && !plBtn) return;
  if (eqBtn) {
    setMinimalView(playerView.classList.contains('view-eq') ? 'main' : 'eq');
  } else {
    setMinimalView(playerView.classList.contains('view-pl') ? 'main' : 'pl');
  }
});

// Auto-switch mode when orientation changes — but only if user hasn't
// explicitly overridden it (we track that via a flag set when user toggles).
let userOverrideMode = false;
function onOrientationChange() {
  if (playerView.classList.contains('hidden')) return;
  if (userOverrideMode) {
    // Just rescale to fit new viewport.
    applyWebampScale();
    return;
  }
  setPlayerMode(!isPortrait());
}
window.matchMedia('(orientation: portrait)').addEventListener?.('change', onOrientationChange);
// Fallback for older browsers
window.addEventListener('orientationchange', () => setTimeout(onOrientationChange, 200));

function backToLauncher() {
  playerView.classList.add('hidden');
  launcher.classList.remove('hidden');
  document.body.classList.remove('in-player');
  // Forget the manual override so next showPlayerView picks the orientation default.
  userOverrideMode = false;
}

// ── Scale Webamp to fit viewport ──
function applyWebampScale() {
  if (!webampReady) return;
  const root = document.getElementById('webamp');
  if (!root) return;

  // Reset any prior transform so getBoundingClientRect gives unscaled bbox.
  root.style.transform = '';
  root.style.left = '0px';
  root.style.top = '0px';
  root.style.position = 'absolute';

  // Measure combined bounding box of visible Webamp windows.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const wins = root.querySelectorAll(
    '#main-window, #equalizer-window, #playlist-window, #milkdrop-window'
  );
  for (const el of wins) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right);
    maxY = Math.max(maxY, r.bottom);
  }
  // Fallback if no measurable windows yet
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = WEBAMP_W; maxY = WEBAMP_H;
  }
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const topReserved = 0; // no controls bar — Webamp's own chrome handles UI
  const margin = 8;
  const availW = Math.max(100, vw - margin * 2);
  const availH = Math.max(100, vh - topReserved - margin);
  const scale = Math.max(1, Math.min(availW / boxW, availH / boxH));

  const scaledW = boxW * scale;
  const scaledH = boxH * scale;
  const targetX = margin + (availW - scaledW) / 2;
  const targetY = topReserved + (availH - scaledH) / 2;

  // Compensate so the bbox top-left lands on (targetX, targetY) after scale.
  root.style.transformOrigin = 'top left';
  root.style.transform = `scale(${scale.toFixed(3)})`;
  root.style.left = (targetX - minX * scale) + 'px';
  root.style.top = (targetY - minY * scale) + 'px';
  root.style.zIndex = '60';
}
window.addEventListener('resize', applyWebampScale);
window.addEventListener('orientationchange', () => setTimeout(applyWebampScale, 300));

// ── Skin switching ──
async function applySkinByMd5(md5, fileName) {
  const skin = { md5, fileName };
  if (!webamp) {
    initWebamp({ skinUrl: skinWszUrl(md5) });
    currentSkin = skin;
    persistLastSkin(skin);
    setHashSkin(skin);
    showPlayerView();
    return;
  }
  showMsg('Učitavam skin…', 'info', 1500);
  // Always open player view — without this, picking a skin from the launcher
  // when Webamp already exists silently changes the skin in the background.
  showPlayerView();
  try {
    await webamp.setSkinFromUrl(skinWszUrl(md5));
    currentSkin = skin;
    persistLastSkin(skin);
    setHashSkin(skin);
    document.querySelectorAll('.skin-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.md5 === md5);
    });
    setTimeout(applyWebampScale, 80);
    hideMsg();
  } catch (e) {
    showMsg('Greška pri učitavanju skina', 'error');
  }
}

function applySkinFromGallery(idx) {
  if (idx < 0 || idx >= skinGallery.length) return;
  skinIndex = idx;
  const s = skinGallery[idx];
  applySkinByMd5(s.md5, s.fileName);
}

function nextSkin(delta) {
  if (!skinGallery.length) return;
  if (skinIndex < 0) skinIndex = 0;
  else skinIndex = (skinIndex + delta + skinGallery.length) % skinGallery.length;
  applySkinFromGallery(skinIndex);
}

// Skin nav + mode toggle are now exclusively via swipe / keyboard;
// Webamp's own X (close) → backToLauncher, _ (minimize) → toggle mode.

// ── Touch swipe: ←→ prev/next skin, ↓ show EQ+playlist, ↑ minimal ──
(function attachSwipe() {
  const surface = playerView;
  let startX = 0, startY = 0, startT = 0;
  let tracking = false;

  surface.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.target;
    if (t.closest && t.closest('.player-controls')) { tracking = false; return; }
    // Ignore if started on a Webamp draggable handle (don't fight drag UX
    // when the user is in full mode and wants to move the EQ/playlist)
    if (t.classList && t.classList.contains('draggable')) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startT = Date.now();
    tracking = true;
  }, { passive: true });

  surface.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const dt = Date.now() - startT;
    if (dt > 700) return;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    // Primarily horizontal → skin change
    if (absX > 80 && absX > absY * 1.3) {
      nextSkin(dx < 0 ? 1 : -1);
      return;
    }
    // Primarily vertical → toggle EQ/playlist visibility
    if (absY > 70 && absY > absX * 1.3) {
      userOverrideMode = true;
      setPlayerMode(dy > 0 ? false : true); // down → full, up → minimal
    }
  }, { passive: true });
})();

// Keyboard for desktop testing
window.addEventListener('keydown', (e) => {
  if (playerView.classList.contains('hidden')) return;
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  switch (e.key) {
    case 'ArrowLeft':  nextSkin(-1); break;
    case 'ArrowRight': nextSkin(1); break;
    case 'ArrowDown':  userOverrideMode = true; setPlayerMode(false); break;
    case 'ArrowUp':    userOverrideMode = true; setPlayerMode(true); break;
  }
});

// ── Radio play ──
let lastStreamTrack = null; // remembered for stop→play re-load

function playRadio(url, name) {
  const track = { url, defaultName: name || 'Radio' };
  lastStreamTrack = track;
  addToStoredPlaylist(track);
  renderSavedStations();
  rebuildHash();
  if (!webamp) {
    initWebamp({ tracks: [track], autoPlay: true });
  } else {
    webamp.setTracksToPlay([track]);
  }
  showMsg('Starting: ' + name, 'info', 2500);
  showPlayerView();
}

// Watch for Webamp state transitions. HTML5 audio loses live stream after
// STOP — pressing PLAY won't reconnect. We detect STOPPED→PLAYING and
// re-load the last stream track to force a fresh fetch.
let lastMediaStatus = null;
let mediaStatusTimer = null;
function startMediaStatusWatcher() {
  if (mediaStatusTimer || !webamp) return;
  mediaStatusTimer = setInterval(() => {
    if (!webamp) return;
    let status;
    try { status = webamp.getMediaStatus(); } catch (_) { return; }
    if (lastMediaStatus === 'STOPPED' && status === 'PLAYING' && lastStreamTrack) {
      // Re-feed the same stream to force reconnect.
      try { webamp.setTracksToPlay([lastStreamTrack]); } catch (_) {}
    }
    lastMediaStatus = status;
  }, 500);
}
function stopMediaStatusWatcher() {
  if (mediaStatusTimer) { clearInterval(mediaStatusTimer); mediaStatusTimer = null; }
}

// ── Local files ──
$('fileInput').addEventListener('change', (e) => loadFiles(e.target.files));
$('tab-files').querySelector('.file-drop').addEventListener('dragover', (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = 'var(--accent)';
});
$('tab-files').querySelector('.file-drop').addEventListener('dragleave', (e) => {
  e.currentTarget.style.borderColor = '';
});
$('tab-files').querySelector('.file-drop').addEventListener('drop', (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    loadFiles(e.dataTransfer.files);
  }
});

function loadFiles(fileList) {
  const tracks = [];
  for (const f of fileList) {
    if (!f.type.startsWith('audio/')) continue;
    const url = URL.createObjectURL(f);
    activeTracks.push(url);
    tracks.push({ url, defaultName: f.name, blob: f });
  }
  if (!tracks.length) {
    showMsg('Nijedan audio fajl nije izabran', 'error');
    return;
  }
  renderFileList(tracks);
  if (!webamp) {
    initWebamp({ tracks, autoPlay: true });
  } else {
    webamp.setTracksToPlay(tracks);
  }
  showPlayerView();
}

function renderFileList(tracks) {
  const list = $('fileList');
  list.innerHTML = '';
  for (const t of tracks) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `<span class="file-name">${escHtml(t.defaultName)}</span>`;
    list.appendChild(row);
  }
}

// ── Fullscreen ──
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
  }
}
$('btnFullscreen').addEventListener('click', toggleFullscreen);

// ── PWA: install button ──
let deferredInstallPrompt = null;
const btnInstall = $('btnInstall');

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.navigator.standalone === true;

if (!isStandalone()) {
  // Show button by default on Android-like (will get native prompt once event fires);
  // iOS users see it always since there is no beforeinstallprompt there.
  btnInstall.classList.remove('hidden');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  btnInstall.classList.remove('hidden');
});

btnInstall.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (_) {}
    deferredInstallPrompt = null;
    return;
  }
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  alert(isIos
    ? 'Safari (iOS): Share (□↑) → „Add to Home Screen" → „Add".'
    : 'Chrome (Android): meni (⋮) → „Install app" / „Add to Home screen".');
});

window.addEventListener('appinstalled', () => btnInstall.classList.add('hidden'));

// ── PWA: service worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('service-worker.js', { updateViaCache: 'none' })
      .then((reg) => {
        // When a new SW is found, prompt user to reload so they get fresh
        // assets instead of one-version-stale stale-while-revalidate cache.
        if (!reg) return;
        const promptReload = () => {
          if (confirm('Nova verzija je dostupna. Osvežiti?')) location.reload();
        };
        if (reg.waiting) promptReload();
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              promptReload();
            }
          });
        });
      })
      .catch(() => {});
  });
}

$('btnClearPlaylist').addEventListener('click', () => {
  if (!confirm('Obrisati sačuvanu playlistu?')) return;
  clearStoredPlaylist();
  renderSavedStations();
  showMsg('Playlist obrisana.', 'success', 2000);
});

$('btnClearCache').addEventListener('click', async () => {
  if (!confirm('Obrisati keš i osvežiti stranicu?')) return;
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
    setTimeout(() => location.reload(), 500);
  } else {
    location.reload();
  }
});

// ── Utilities ──
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flagEmoji(code) {
  if (!code || code.length !== 2) return '';
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0))).join('');
}

// ── Share current state via Web Share API or clipboard ──
async function shareCurrent() {
  rebuildHash();
  if (!currentSkin && !lastStreamTrack) {
    showMsg('Nothing to share yet — pick a skin or station first.', 'info');
    return;
  }
  const url = location.href;
  const niceSkin = currentSkin ? (currentSkin.fileName || '').replace(/\.wsz$/i, '') : null;
  const niceStation = lastStreamTrack ? lastStreamTrack.defaultName : null;
  let title = 'Webamp PWA';
  if (niceStation && niceSkin) title = `${niceStation} (${niceSkin}) — Webamp PWA`;
  else if (niceStation)        title = `${niceStation} — Webamp PWA`;
  else if (niceSkin)           title = `${niceSkin} — Webamp PWA`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showMsg('URL copied to clipboard ✓', 'success');
  } catch (_) {
    prompt('Copy URL:', url);
  }
}
// Share drawer wiring
const _drawer = $('shareDrawer');
const _handle = $('shareHandle');
const _btnShare = $('btnShare');
const _btnDrawerClose = $('btnDrawerClose');
function openDrawer()  { if (_drawer) _drawer.classList.add('open'); }
function closeDrawer() { if (_drawer) _drawer.classList.remove('open'); }
if (_handle)          _handle.addEventListener('click', openDrawer);
if (_btnDrawerClose)  _btnDrawerClose.addEventListener('click', closeDrawer);
if (_btnShare) _btnShare.addEventListener('click', async () => {
  await shareCurrent();
  closeDrawer();
});

// ── App boot — restore last skin + radio + playlist from URL hash or LS ──
function bootRestoreSkin() {
  const fromHash  = parseHash();
  const fromStore = savedLastSkin();
  const skin  = fromHash.skin || fromStore;
  const radio = fromHash.radio;
  const playlist = getStoredPlaylist();

  // Build initial tracks: shared radio takes priority, then saved playlist.
  let initialTracks;
  if (radio) initialTracks = [radio];
  else if (playlist.length) initialTracks = playlist;

  if (!skin && !initialTracks) return;

  if (skin && skin.md5) {
    initWebamp({
      skinUrl: skinWszUrl(skin.md5),
      tracks: initialTracks,
      // Auto-play when the URL specifically asked for a radio station — that
      // implies "I shared this so you can listen".
      autoPlay: !!radio,
    });
    currentSkin = skin;
    persistLastSkin(skin);
  } else {
    initWebamp({ tracks: initialTracks, autoPlay: !!radio });
  }
  if (radio) {
    lastStreamTrack = radio;
    addToStoredPlaylist(radio);
    renderSavedStations();
  }
  rebuildHash();
  showPlayerView();
}

// ── Init ──
window.addEventListener('beforeunload', () => {
  for (const url of activeTracks) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
});

// Restore skin + playlist on boot, render saved stations UI.
window.addEventListener('load', () => {
  renderSavedStations();
  setTimeout(bootRestoreSkin, 50);
});

// React to manual hash changes (e.g. user pastes a shared URL while app open)
window.addEventListener('hashchange', () => {
  const skin = parseHashSkin();
  if (skin && skin.md5 && (!currentSkin || skin.md5 !== currentSkin.md5)) {
    applySkinByMd5(skin.md5, skin.fileName);
  }
});
