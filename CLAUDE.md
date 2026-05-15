# Webamp PWA — project notes for Claude Code

Static mobile-first PWA (sledi `~/claude/ccskills/pwa-static-mobile.md` recept) koji uvozi celokupan Webamp 2.9 player u browser, sa galerijom skinova iz Skin Museum-a i internet radiom iz Radio Browser API-ja.

Cilj: telefon u landscape → Webamp player na ceo ekran. PWA-installable.

**Branding napomena:** projekat se zove „Webamp PWA", ne „Winamp". Naziv „Winamp" je registrovan trademark (Llama Group SA). U code-u i UI tekstovima koristimo isključivo „Webamp" (po imenu open-source biblioteke koja sve i radi — by captbaritone). Reference na „Winamp 2" su isključivo deskriptivne (nominative fair use) — Webamp je reimplementacija Winamp 2 look-a.

## Architecture in one paragraph

`index.html` ima dva region-a koje JS prebacuje: `#launcher` (Radio/Skinovi/Fajlovi tabovi) i `#playerView` (Webamp). `app.js` lazy-init Webamp tek na prvi user action (klik na stanicu, izbor fajla, izbor skina). `Webamp` instanca se mount-uje preko `renderWhenReady(host)`, a zatim se preko CSS-a (`transform: scale(var(--webamp-scale))` na `#webamp` root) skalira u viewport. Skin se menja preko `webamp.setSkinFromUrl(url)`. Radio i lokalni fajlovi se ubacuju preko `webamp.appendTracks([{ url, defaultName }])`.

## Non-obvious bits

- **`#webamp` root je positioned absolutely u document.body** — Webamp ignoriše parent target za pozicioniranje prozora. Zato JS posle scaling-a ručno postavi `left/top` na centriran offset (`applyWebampScale`).
- **Webamp dimenzije** koje koristimo za scaling: `WEBAMP_W=275`, `WEBAMP_H=350` (main 116 + EQ 116 + playlist 116 stacked, default). Ako se default izmeni, prilagoditi.
- **Swipe detekcija** ignoriše touchstart na `.draggable` (da Webamp-ovo prevlačenje prozora ne aktivira swipe) i na `.player-controls`.
- **Algolia kredencijali** (`HQ9I5Z6IM5` / `6466695ec3f624a5fccf46ec49680e51`, index `Skins`) su public read-only — izvučeni iz skins.webamp.org JS bundle-a. Ako prestane da radi → ponovo pogledati taj bundle.
- **CORS** je verifikovan za sve tri API rute (radio-browser.info, algolia.net, r2.webampskins.org) — sve odgovaraju `Access-Control-Allow-Origin: *`.
- **Service worker** kešira shell + r2.webampskins.org assets (oba `.wsz` i `.png` screenshot-ovi). Radio strim NE kešira (ide na lokalni HTML5 audio koji Webamp pravi).
- **`.htaccess` DirectoryIndex** — bez njega Apache servira directory listing umesto index.html-a (lokalni dev gotcha).
- **`apple-mobile-web-app-capable`** uz `display: fullscreen` u manifestu — za iOS koji nema beforeinstallprompt; korisniku se prikaže manual fallback alert.

## Što NE radi (poznati limiti)

- iOS PWA mode ima ograničenu fullscreen podršku (Safari ne ulazi u pravi fullscreen iz add-to-home-screen-a). Landscape lock takođe ne radi pouzdano. Glavni use-case je Android Chrome.
- Webamp je dizajniran za miš — drag/click/double-click po prozorima na ekranu sa multi-touch-em nije savršen UX, ali osnovne kontrole (play/pause/track skip) rade.
- Skin Museum nudi 65k+ skinova ali nemamo "browse all" — samo search ili random-page (50 stranica × 60 = ~3000 dostupnih kroz random). Za potpunu galeriju trebalo bi paginated load.

## Bump cache na promene

Nakon svake izmene HTML/JS/CSS/icons/manifest, **bump `CACHE_VERSION` u `service-worker.js`** (`v1` → `v2`...). Bez toga korisnici ostaju na staroj verziji.

## Reference za radio mode

Vidi `~/websites/serverplay/radioplay/` — odakle je preuzeta logika za Radio Browser API. Tamošnji "browser mode" je upravo ono što ovde radimo (direktan HTML5 audio strim, bez VLC-a).
