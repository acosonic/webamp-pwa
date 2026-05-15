# Credits & Third-Party Notices

This project depends on third-party software and services. Huge thanks to
everyone involved.

## Webamp (bundled)

`vendor_js/webamp.bundle.min.js` is **Webamp** by Jordan Eldredge (captbaritone)
and contributors — a faithful, browser-based reimplementation of Winamp 2.
The entire player engine, skin rendering, audio handling, drag/drop window
chrome — all of it — is Webamp. This project is essentially a mobile PWA
shell around it.

- Source: <https://github.com/captbaritone/webamp>
- License: MIT
- Donate / support the author: <https://github.com/sponsors/captbaritone>

```
MIT License

Copyright (c) 2014–present Jordan Eldredge

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Skin Museum (skins.webamp.org) — fetched at runtime

Skin metadata (Algolia search) and skin/screenshot assets (Cloudflare R2) are
fetched live at runtime from <https://skins.webamp.org> and
<https://r2.webampskins.org>. No `.wsz` files are bundled or redistributed in
this repo. Skin Museum is also Jordan Eldredge's project — see above.

The individual classic Winamp skins themselves are user-uploaded artwork; their
original creators retain rights. They are preserved and made browsable by the
Skin Museum.

If you build on this project, please be considerate of Jordan's bandwidth /
API quotas. The service worker here caches every loaded skin aggressively so
each unique skin only hits his servers once per device.

## Radio Browser API — fetched at runtime

Radio station search results come from <https://www.radio-browser.info> — a
community-driven free database. Their data is licensed CC-BY-SA 4.0.
Per their request: please use a custom User-Agent if you fork this for higher
volume.

## "Winamp" trademark

"Winamp" is a registered trademark of Llama Group SA (formerly Nullsoft / AOL /
Radionomy). This project is **not affiliated** with Winamp or Llama Group.
References to "Winamp" are nominative fair use — describing what the Webamp
library re-implements.

## This project's own code

MIT licensed — see [LICENSE](LICENSE).
