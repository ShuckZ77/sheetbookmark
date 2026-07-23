# SheetBookmark

One Google Sheet, every browser — **and a separate tab per browser, so nothing ever overlaps.**
Star a page in Chrome on your Mac, and it appears in the `Chrome — MacBook` tab of a spreadsheet in
your own Google Drive. Firefox on your Linux box writes to its own tab in the same sheet. The popup
shows the union, searchable, from anywhere.

Runs on Chrome, Edge, Brave, Opera, Vivaldi and Firefox, across macOS, Windows and Linux, from a
single codebase with **no dependencies** — no bundler, no framework, no `npm install`.

## What a user does

1. Install the extension.
2. Click **Connect Google Sheets** and approve.
3. Bookmark pages exactly as they always did — `Ctrl`/`Cmd`+`D`, the star icon, or the
   extension's toolbar button.

The extension creates a **SheetBookmark** spreadsheet in the user's own Drive, adds a tab named
after this install, imports the bookmarks they already have, and starts syncing. No client ID, no
redirect URI, no sheet URL — the only thing anyone ever types is a label for the install
(e.g. `Chrome — MacBook Pro`), because no browser exposes its profile or device name to extensions.

**Install it in a second browser and click Connect: it finds the same sheet — even if you renamed
or moved it — and adds its own tab.** Reuse is keyed on file ownership, not the file's name, so
reinstalls never create duplicate sheets.

## How syncing works

**Browser → sheet** (automatic):

- Bookmarks made the normal way are captured by the `bookmarks.onCreated` event and pushed on the
  cadence you choose: **Instantly** (default, seconds after the star), every **15 min / 1 h / 8 h /
  24 h**, or **Manual only**. In Manual mode the toolbar icon badges how many are waiting.
- The **toolbar button always writes immediately**, whatever the mode — an explicit click is an
  explicit sync.
- Offline or signed out? Rows queue locally and flush when things return, retried by an alarm.
- **Sync now** buttons in the popup and options force a push at any time.

**Sheet → browser** (explicit, never automatic):

- **Get bookmarks from other browsers** copies anything the *other* tabs hold that this browser
  lacks into a `SheetBookmark` folder in its bookmarks. It only ever adds — it never deletes or
  overwrites, and imported items don't echo back into the sheet.
- The popup needs no import at all: it reads every tab live, searchable and filterable by browser,
  one click to open.

**Never overlapping:** each install writes only to its own tab, tracked by the tab's immutable
numeric ID — so users can freely rename tabs, rename the sheet, or move it anywhere in Drive, and
sync follows. If a user deletes an install's tab, the next sync recreates it.

## Sheet layout

One tab per install (named from its profile label). The schema is a **stable core (A–I)** that
never changes, followed by **extension columns appended strictly at the tail** — new features may
only ever add columns after the last one, so sparse optional data clusters at the right edge
instead of punching holes through the readable core:

| timestamp | id | folder | browser | profile | os | source | title | url | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- **note**: an editable field in the save popup, pre-filled from your text selection or the page's
  meta description (toolbar saves only — Ctrl+D can't read page content without `<all_urls>`).
  Every row in the popup also has a ✎ button to add or edit its note later — the extension locates
  the row by its immutable id and rewrites exactly that one cell. Notes are searched by the popup
  and never overwritten by sync.
- A tab whose header doesn't match this schema (from an older version) is **refused with a clear
  message**, never written to — positional writes into a stale tab would scramble rows.

- **timestamp** is IST (UTC+5:30) wall-clock time with an explicit offset — readable, sortable, and
  unambiguous when the same sheet is written from machines in different timezones.
- **description** auto-fills with the page's meta description on toolbar-button saves (the only
  capture path allowed to read page content without scary permissions). For Ctrl+D and imported
  bookmarks it starts empty — and it doubles as a **notes column**: rows are append-only, so
  anything users type there is never overwritten. It is searched by the popup.
- **source** is `toolbar`, `native`, or `import`. Cells are written `RAW`, so a title beginning
  with `=` is stored as text, never evaluated as a formula.
- Users may sort, filter, edit and delete rows freely, and add their own columns **after column J**
  — but must not insert or reorder columns inside A–J (writes are positional).

Deduplication is per-tab and URL-normalised: `https://www.example.com/post?utm_source=news` and
`https://example.com/post` are one bookmark. Two *different browsers* holding the same URL is
correct — each keeps it in its own tab.

---

## Publishing (one-time, you only)

The Connect button works because **one OAuth client — yours — is baked into the build**, exactly how
"Sign in with Google" works on any website. Users never see it.

**→ Full step-by-step: [guides/PUBLISHING.md](guides/PUBLISHING.md).** In brief:

1. Upload a **draft** zip to the Chrome Web Store (`npm run zip`) to get your permanent extension
   ID. The store assigns the ID, so this must come first.
2. Create a Google Cloud **Web application** OAuth client with the single scope
   `https://www.googleapis.com/auth/drive.file`, and register that ID's redirect URI.
3. `echo "YOUR-ID.apps.googleusercontent.com" > .keys/client-id.txt && npm run build`.
4. Publish the OAuth app to **In production** — with a non-sensitive scope this needs **no
   verification**, shows **no "unverified app" warning**, and has **no user cap**.

Total cost: **$5 once** (Chrome's developer fee). Firefox, Edge, Google Cloud, and the Sheets and
Drive APIs are free. A **privacy policy URL is mandatory** — `docs/PRIVACY.md` is written and ready to
host.

`drive.file` is load-bearing, not incidental: it is the only Drive scope that is *non-sensitive*, so
it avoids both OAuth verification and the paid annual CASA security assessment that *restricted*
scopes (`drive`, `drive.readonly`) drag in. It is also why the extension creates its own sheet
rather than accepting a pasted sheet ID — under `drive.file`, Google physically blocks access to
files the app didn't create. Widening the scope later would move you into a paid audit tier.

---

## Security posture

- **No server, no telemetry.** The extension talks to exactly two origins — `sheets.googleapis.com`
  and `www.googleapis.com` — both pinned in `host_permissions`, with a test asserting every origin
  the code calls is granted. Nothing reaches the developer.
- **Token hygiene.** The OAuth access token lives in `storage.session` (memory only, never disk),
  expires in ~1 h, and there is no refresh token and no client secret anywhere. The auth flow
  checks the `state` parameter against CSRF.
- **Sheet data is treated as untrusted.** A collaborator could edit the spreadsheet, so the popup
  refuses to open, and the importer refuses to create, anything that is not plain `http(s)` —
  `javascript:`/`data:` URLs stop at the boundary. All rendering uses `textContent`/`createElement`;
  a repo-wide audit finds no `innerHTML`, `eval`, or string timers.
- **Formula injection blocked** by writing cells RAW.
- **MV3 throughout** — no remotely hosted code, everything bundled, plain unminified source (which
  also keeps Firefox review simple).

## Development

```sh
npm run build      # → dist/chrome and dist/firefox (dev builds, pinned extension id)
npm run zip        # → store-upload zips (no manifest "key" — the store assigns the id)
npm test           # → 45 tests, no network, no browser
```

Load `dist/chrome` via *Load unpacked* on the extensions page; load
`dist/firefox/manifest.json` via `about:debugging#/runtime/this-firefox`.

```
src/
  manifest.json      shared manifest; the build patches in per-browser background config
  config.js          the baked OAuth client id, scope, and default sheet name
  background.js      capture, queue, per-tab flush, sync modes, both import directions
  lib/
    browser.js       API alias, browser/OS detection, bookmark-tree walking
    store.js         settings, write queue, seen-URL set, URL normalisation
    auth.js          Google OAuth implicit flow, per-engine redirect URIs
    sheets.js        Sheets + Drive client: find/create sheets, tabs by id, read, append
  ui/
    app.css          shared navy-and-green glass theme, light and dark
    popup.html/.js   save, search, browse all browsers, sync now
    options.html/.js connect, sync cadence, import, profile label, publisher setup
scripts/build.mjs    builds both targets, bakes the client id, draws the grid-bookmark icons
test/                unit, background integration, and UI-boot suites
```

Chrome requires an MV3 service worker and Firefox only supports an event page, so
`scripts/build.mjs` merges the right `background` block into each target's manifest.

## Roadmap (deliberately deferred)

- **Visit stats** (`visits`/`last_visit` + optional `history` permission): removed for now —
  snapshot semantics confused users and live counts would contradict the resource-gentleness goal.
- **Account flag**: superseded by the note field.
- **`site` / `reading` columns** (og:site_name, estimated reading time): captured but rarely
  surfaced anywhere useful; deferred until the display story earns them.
- **Opt-in remote error reporting**: local journal only until there's a user base to justify it.

## Honest limitations

- **Deletions don't propagate to browsers.** Removing a bookmark in a browser leaves its sheet row,
  and removing a row never touches any browser's bookmarks — a deliberate trade against the failure
  mode where a sync bug mass-deletes someone's bookmark bar. But the sheet is the truth for the
  extension itself: **deleting a row makes that page saveable again** — the extension re-checks the
  sheet before refusing a save as a duplicate, and re-learns its dedupe memory from the sheet on
  every refresh.
- **Bookmark *edits* aren't tracked** — only creation is captured.
- **Sign-in is quiet but not permanent.** The implicit flow holds a ~1-hour access token renewed
  silently against your Google session; signed out of Google in a browser, the next sync asks for
  one click. Google labels the implicit flow legacy — it works today with no announced shutdown,
  but it is the piece most likely to need revisiting.
- **A fully revoked app** (myaccount.google.com/permissions) loses its per-file grants; reconnecting
  starts a fresh sheet, and `drive.file` has no way to re-adopt the old one.
