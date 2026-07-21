# Testing locally on Chrome, Edge and Firefox

Do this before publishing anywhere. One machine is enough.

## 0. Prerequisites (once)

1. OAuth client exists (see [PUBLISHING.md](PUBLISHING.md) §2) with these redirect URIs registered:
   - `https://lmkchpbfpmencebnadolcfpchmfcnapg.chromiumapp.org/` — covers Chrome **and** Edge
     unpacked builds, because the dev build pins the extension ID via the manifest `key`.
   - The Firefox loopback URI (`http://127.0.0.1/mozoauth2/<hash>`) — read it from the extension's
     options page in Firefox while no client ID is baked (the "Publisher setup" card).
2. Client ID baked: `echo "YOUR-ID.apps.googleusercontent.com" > .keys/client-id.txt`
3. Build: `npm run build`
4. If your OAuth app is still in **Testing** status, add your Google account as a test user.

## 1. Load the extension

| Browser | Where | What to pick |
| --- | --- | --- |
| Chrome | `chrome://extensions` → Developer mode → **Load unpacked** | `dist/chrome` folder |
| Edge | `edge://extensions` → Developer mode → **Load unpacked** | `dist/chrome` folder (same build — Edge is Chromium) |
| Firefox | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** | `dist/firefox/manifest.json` |

Firefox temporary add-ons vanish on restart — reload them each session.

## 2. Verification checklist

Run in this order; each step exercises a different subsystem.

1. **Connect (Chrome first).** Options → Connect Google Sheets → approve. ✅ A *Bookmark Sync*
   spreadsheet appears in Drive with one tab named after your profile label, and your existing
   bookmarks are imported into it.
2. **Instant capture.** `Cmd/Ctrl+D` any page. ✅ Row appears in Chrome's tab within seconds.
3. **Dedupe.** Toolbar-save the same page. ✅ "Already saved", no second row.
4. **Second browser joins (Edge).** Connect in Edge. ✅ No new spreadsheet; a second tab appears in
   the same sheet.
5. **Cross-browser read.** Open the popup in Edge. ✅ Chrome's bookmarks are listed and filterable.
6. **Sheet→browser.** Edge options → *Get bookmarks from other browsers*. ✅ A `Bookmark Sync`
   bookmarks folder appears containing Chrome's bookmarks; nothing else changes.
7. **Rename-proofing.** Rename the spreadsheet and a tab in the Sheets UI, then save a bookmark.
   ✅ Row lands in the renamed tab; no duplicate sheet or tab is created.
8. **Manual mode.** Options → cadence → *Manual only*; `Cmd/Ctrl+D` a page. ✅ Toolbar icon shows a
   count badge; nothing syncs until *Sync now*.
9. **Firefox.** Repeat 1, 2 and 5 in Firefox (its OAuth window uses the loopback redirect).
10. **Disconnect/reset.** ✅ Signs out locally; the sheet in Drive is untouched.

## 3. Where to look when something fails

- **Chrome/Edge:** `chrome://extensions` → the extension → *Service worker* → Inspect → Console.
- **Firefox:** `about:debugging` → the extension → **Inspect**.
- OAuth error `redirect_uri_mismatch` → the URI for *that* browser isn't on the OAuth client.
- `403` on API calls → Sheets/Drive API not enabled on the Cloud project, or you're not a test user.
