# QR dependencies

Pinned, local assets: no CDN, no camera images leave the browser.

- `qrcode.js` / `qrcode.d.ts`: qrcode-generator 2.0.4, npm package `dist/qrcode.mjs` and its declarations (default-export declaration adjusted). Copyright Kazuhiko Arase, MIT, see qrcode-LICENSE. Source: https://github.com/kazuhikoarase/qrcode-generator
- `jsqr.js`: jsqr 1.4.0 `dist/jsQR.js`, bundled as minified browser ESM using esbuild. `jsqr.d.ts` describes the used API. Copyright Cosmo Wolfe, MIT, see jsqr-LICENSE. Source: https://github.com/cozmo/jsQR

Update from verified npm tarballs and rerun QR round-trip/browser tests. Full notices must accompany redistributed builds.
