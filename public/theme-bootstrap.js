// Must run BEFORE the bundle, otherwise light mode flashes on every
// reload. See docs/12-theming.md.
//
// This lives in `public/` rather than inline in `index.html` so that the
// shipped Content-Security-Policy can be `script-src 'self'` with no
// 'unsafe-inline' and no hash or nonce to keep in sync — a static host cannot
// mint a per-response nonce anyway. See docs/09-security-privacy.md.
// It is loaded as a classic, render-blocking script: `type="module"` is
// deferred, which would reintroduce exactly the flash this file prevents.
// Vite copies `public/` verbatim, so no build entry is needed.
;(function () {
  try {
    var mode = localStorage.getItem('nc-theme') || 'system'
    var dark =
      mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  } catch (e) {}
})()
