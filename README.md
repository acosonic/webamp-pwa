# Webamp PWA

A mobile-first Progressive Web App that puts the classic 1990s desktop-player look in your browser — internet radio, the full Skin Museum at your fingertips, and your local MP3s. Installable on Android via Chrome (Add to Home Screen). Rotate to landscape and the main player window goes fullscreen; in portrait you get the main window + equalizer + playlist stacked vertically.

> **Unofficial hobby project.** Not affiliated with, endorsed by, or sponsored by Winamp or Llama Group SA. Built on top of the open-source [Webamp](https://github.com/captbaritone/webamp) library (by Jordan Eldredge / captbaritone, MIT). The name "Winamp" is mentioned in this README only descriptively (nominative fair use) — Webamp re-implements the look of Winamp 2 in JavaScript.

**Live demo:** <https://acosonic.com/projects/webamp-pwa/>

## Features

- 📻 **Internet radio** — search ~30,000 stations via [Radio Browser](https://www.radio-browser.info); the stream is fed straight into Webamp's playlist
- 🎨 **Skins** — search 65,000+ classic `.wsz` skins via [Skin Museum](https://skins.webamp.org) (Algolia + Cloudflare R2); tap a card to apply
- 📁 **Local files** — pick MP3 / OGG / WAV / M4A from your phone storage
- ⇆ **Swipe left/right** on the player → previous/next skin in the loaded gallery
- ⇅ **Swipe up/down** → toggle between minimal mode (just main window) and full mode (main + EQ + playlist)
- 📱 **Auto layout by orientation** — portrait shows all three windows stacked, landscape blows up just the main window
- 🔗 **Shareable URLs** — the current skin and station are encoded in the URL hash (`#skin=<md5>&radio=<url>...`); send the link and the recipient lands on the same state, ready to play
- 💾 **Persistence** — last skin + recently-played stations are kept in `localStorage` and restored on next launch
- 🌐 **Offline** — the app shell and any once-loaded skins/screenshots are cached by a service worker (`stale-while-revalidate`)

## Installing on Android

1. Open `https://<host>/webamp-pwa/` in Chrome (a real HTTPS cert is required; `localhost` is fine for development)
2. Tap the **⬇ Install** button in the launcher header, or pick **⋮ → Install app** from Chrome's menu
3. Launch from the home screen; rotate the phone freely — the layout adapts

## Architecture

```
index.html              — launcher (Radio / Skins / Files / About tabs) + player view
app.js                  — all the logic
style.css               — landscape-first mobile CSS
manifest.json           — PWA manifest
service-worker.js       — caches shell + r2.webampskins.org assets
vendor_js/
  webamp.bundle.min.js  — Webamp library (vendored, ~942 KB)
icons/                  — PWA icons (regenerated from icon-source.svg)
.htaccess               — DirectoryIndex + no-cache for SW/manifest + HSTS-unset
```

Single-page app. Webamp is lazy-initialised on the first user action (clicking a station, picking a file, or tapping a skin). The library renders absolutely-positioned windows; `app.js` moves the `#webamp` root into `#webampHost`, measures the children's bounding box, and applies a `transform: scale(...)` + offset so the chrome fits the viewport. Skins are swapped at runtime with `webamp.setSkinFromUrl(url)`; tracks are pushed via `webamp.setTracksToPlay([{ url, defaultName }])` (which both adds and plays — `appendTracks` only enqueues).

A small status-poll watcher detects `STOPPED → PLAYING` transitions and re-feeds the last live-stream track to force the browser's `<audio>` element to reconnect (HTML5 audio loses the connection on `stop()` for radio streams).

## Runtime data sources (all via CORS, no backend)

| Service | URL | Used for |
|---|---|---|
| Radio Browser | `https://all.api.radio-browser.info/json/stations/search` | station search results |
| Algolia (Skin Museum) | `https://HQ9I5Z6IM5-dsn.algolia.net/1/indexes/Skins/query` | skin search metadata |
| Cloudflare R2 (Skin Museum) | `https://r2.webampskins.org/skins/<md5>.wsz` + `.../screenshots/<md5>.png` | the skin file and its preview |

The Algolia credentials embedded in `app.js` are the same public read-only key the [skins.webamp.org](https://skins.webamp.org) site itself uses (extracted from its public JS bundle). Nothing here is private.

## Credits & attributions

This project is essentially a mobile PWA shell wrapped around code and data that other people built. All credit for the actual functionality goes to the upstream projects below.

### Webamp (the entire player engine)

[**Webamp**](https://github.com/captbaritone/webamp) by **Jordan Eldredge** ([captbaritone](https://github.com/captbaritone)) and contributors — a faithful, browser-based reimplementation of Winamp 2. The drag-and-drop windows, skin parser, audio handling, equalizer, playlist, Milkdrop integration — all of it — is Webamp. We bundle `webamp.bundle.min.js` (vendored under `vendor_js/`), MIT licensed. Full license text is included in [CREDITS.md](CREDITS.md).

If this project is useful to you, please consider [supporting Jordan](https://github.com/sponsors/captbaritone) — the upstream effort is single-handed and decades-long at this point.

### Skin Museum

The [**Winamp Skin Museum**](https://skins.webamp.org) (also by **Jordan Eldredge**) is the source for every skin in this app. The service worker caches loaded skins aggressively so each unique skin only hits the museum's Cloudflare R2 bucket once per device. We do not redistribute `.wsz` files — they are fetched live, on demand, from `r2.webampskins.org`.

The individual classic Winamp skins themselves are **user-uploaded artwork**. Their original creators retain rights; the Skin Museum preserves and makes them browsable under fair use / archival doctrine.

### Radio Browser

[**Radio Browser**](https://www.radio-browser.info) — a community-driven free database of streaming radio stations. The station metadata is licensed CC-BY-SA 4.0. Per their request, if you fork this and expect non-trivial traffic, set a custom `User-Agent` on the requests.

### Webamp PWA shell (this repo)

The HTML/CSS/JS/manifest/service-worker/icons in this repo are MIT-licensed — see [LICENSE](LICENSE). Author: **Aleksandar Pavic** (<acosonic@gmail.com>).

### Trademarks

"**Winamp**" is a registered trademark of **Llama Group SA** (formerly Nullsoft / AOL / Radionomy). This project is not affiliated with, endorsed by, or sponsored by Winamp or Llama Group. Any references to "Winamp" in source comments, documentation, or UI strings are descriptive (nominative fair use) — they refer to the original software that the Webamp library re-implements.

The Webamp PWA icon (`icon-source.svg` and the rasterised PNGs in `icons/`) is an original equalizer-bars design and does not use any Winamp imagery or marks.

## Development

Locally via Apache or any static HTTP server: `http://localhost/webamp-pwa/`. For phone testing you'll want a real HTTPS host (browsers refuse to register service workers on `https://` with a self-signed cert; plain `http://localhost` is treated as secure but is only reachable from the dev machine).

After any change to HTML/JS/CSS/manifest/icons, bump `CACHE_VERSION` in `service-worker.js` — otherwise the SW won't replace its cached shell on returning visitors.

### Regenerate icons

```bash
chromium --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot="$(pwd)/_master.png" "file://$(pwd)/icon-source.svg"
magick _master.png -crop 512x512+0+0 +repage _m512.png && rm _master.png
magick _m512.png -filter Lanczos -resize 512x512 icons/icon-512.png
magick _m512.png -filter Lanczos -resize 192x192 icons/icon-192.png
# ... see ~/claude/ccskills/pwa-static-mobile.md for the full size matrix
```

## License

MIT — see [LICENSE](LICENSE).
