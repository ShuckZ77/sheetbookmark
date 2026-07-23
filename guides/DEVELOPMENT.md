# Development guide

Everything contributors, reviewers and future-you need. End users belong on the
[website](https://shuckz77.github.io/sheetbookmark/) or the short [README](../README.md).

## Build, test, load

```sh
npm run build      # → dist/chrome and dist/firefox (dev builds, pinned extension id)
npm run zip        # → store-upload zips (no manifest "key" — the store assigns the id)
npm test           # → full suite: unit, background integration, UI-boot, build invariants
```

No dependencies — no bundler, no framework, no `npm install`. Load `dist/chrome` via
*Load unpacked* (`chrome://extensions`, also Edge/Brave); load `dist/firefox/manifest.json`
via `about:debugging#/runtime/this-firefox`. Full walkthrough: [TESTING.md](TESTING.md).

## Structure

```
src/
  manifest.json      shared manifest; build patches per-browser background config
  config.js          baked OAuth client id, scope, sheet name
  background.js      capture, queue, per-tab flush, sync modes, note edits, imports
  lib/
    browser.js       API alias, browser/OS detection, bookmark-tree walking
    store.js         settings, queue, seen-URL cache, URL normalisation, error journal
    auth.js          Google OAuth implicit flow, per-engine redirect URIs
    sheets.js        Sheets + Drive client: sheets/tabs by id, rows, note cells
  ui/
    app.css          spreadsheet-paper theme, light + dark
    popup.html/.js   save with note, search, browse, per-row note editing
    options.html/.js connect states, cadence, imports, support, publisher setup
scripts/build.mjs    builds both targets, bakes client id, draws the icons
test/                node:test suites + DOM harness (no browser needed)
guides/              publisher docs: PUBLISHING, TESTING, ANALYTICS
```

Chrome requires an MV3 service worker; Firefox only supports an event page —
`scripts/build.mjs` merges the right `background` block per target.

## Schema contract

Sheet columns are a **stable core (A–I)** — `timestamp, id, folder, browser, profile,
os, source, title, url` — plus extensions appended strictly at the tail (currently
`note`). Never insert or reorder inside the core: reads/writes are positional, and a
header-mismatch guard refuses tabs created by older schemas rather than scrambling them.

## Security posture

- **No server, no telemetry.** Two pinned API origins (`sheets.googleapis.com`,
  `www.googleapis.com`); a test asserts every origin the code calls is granted.
- **Token hygiene.** ~1h access token in `storage.session` only; no refresh token, no
  client secret anywhere; CSRF `state` check on the OAuth flow.
- **Sheet data is untrusted.** Non-http(s) URLs from the sheet are refused at every
  exit (popup open, bookmark import). All rendering is `textContent`/`createElement`;
  no `innerHTML`, `eval`, or string timers anywhere (audited + grep-verified).
- **Formula injection blocked** by RAW cell writes; page-injected strings are
  length-capped; error journal scrubs URLs/tokens before storing (on-device only).
- **MV3 throughout**: no remote code, no content scripts, plain unminified source.

## Resource posture

Event-driven only: the service worker sleeps unless you act; instant mode schedules its
retry alarm only while the queue is non-empty (zero idle wakeups); no page ever gets a
content script; popup renders 60 rows and loads more on scroll; animations are
transform/opacity only.

## Roadmap (deliberately deferred)

- Visit stats (`visits`/`last_visit`, optional `history` permission)
- `site` / `reading` columns — until the display story earns them
- Account flag — superseded by notes
- Opt-in remote error reporting — local journal only until a user base justifies it

## Honest limitations

- Deletions don't propagate to browsers (append-only by design; deleting a **row**
  makes that page saveable again — the sheet is the source of truth).
- Bookmark edits aren't tracked; only creation is captured.
- Implicit-flow tokens last ~1h, renewed silently; Google labels the flow legacy —
  works today, likeliest future revisit.
- A fully revoked app loses per-file grants; reconnecting starts a fresh sheet.

## Publishing

One-time publisher setup (OAuth client, store accounts, listing copy):
[PUBLISHING.md](PUBLISHING.md). Analytics reality check: [ANALYTICS.md](ANALYTICS.md).
