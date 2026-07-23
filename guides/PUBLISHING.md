# Publishing guide

Order of operations, costs, and every step. Verified against Google/Mozilla/Microsoft docs
(July 2026). Your plan — **Firefox and Edge first (both free), Chrome later ($5)** — is exactly the
right sequence and is how this guide is ordered.

**Costs:** Firefox **free** · Edge **free** · Chrome **$5 one-time** · Google Cloud + Sheets/Drive
APIs + OAuth **free**, no billing account.

Companion docs: [TESTING.md](TESTING.md) (try it locally first) · [ANALYTICS.md](ANALYTICS.md)
(what you can measure) · [PRIVACY.md](../docs/PRIVACY.md) (host this — every store demands the URL).

---

## Start here — the order that always applies

Whether it's just you testing locally or a user installing from a store, **the extension cannot
connect until Google knows about it.** This part is unconditional, in this order:

1. **Google Cloud project** → enable **Sheets API** + **Drive API** (Step 2.1–2.2).
2. **Google Auth Platform** → External audience, single scope `drive.file` (Step 2.3–2.4).
3. **OAuth client** (Web application) → register the redirect URIs (Step 2.5).
4. **Bake the client ID** → `npm run build` (Step 2.7).

Only what comes *after* differs:

| | Just you, locally | Real users |
| --- | --- | --- |
| OAuth app status | *Testing* is fine — add yourself as a test user | **Publish app → In production** (Step 2.6) |
| Privacy policy hosted | Not needed yet | **Required** (Step 1) |
| Store accounts | Not needed | Steps 4–6 |
| Then | Run the [TESTING.md](TESTING.md) checklist | Submit to stores |

## Why the order matters

OAuth redirect URIs are derived from extension IDs, and each store assigns its own ID. So the
dependency chain is:

```
Google Cloud OAuth client  ──▶  bake client ID  ──▶  build
        ▲                                              │
        └── add each store's redirect URI ◀── store assigns ID (draft upload)
```

Firefox is the exception that makes it easy: its redirect URI comes from the `gecko.id` **pinned in
our manifest**, so it's known *now*, before any store upload. That's another reason Firefox-first
is right.

---

## Step 1 — Host the privacy policy (10 min)

Every store requires a public privacy-policy URL (OAuth token = user data, no exemption).

1. Replace the placeholder contact email in `docs/PRIVACY.md` with a real one.
2. Push this repo to GitHub. The repo must be **public** (free accounts can't serve Pages from
   private repos).
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, Folder: **`/docs`**
   → Save.
4. Wait 1–2 minutes (watch the repo's **Actions** tab for the *pages build and deployment* run to
   go green). GitHub converts each `.md` in `docs/` to a page; `docs/index.md` becomes the site
   root — without it the root URL 404s even though the sub-pages work.
5. Your URLs (pattern `https://<username>.github.io/<repo>/…`):
   - Homepage: `https://<username>.github.io/<repo>/`
   - **Privacy policy — the one you paste into every store dashboard:**
     `https://<username>.github.io/<repo>/PRIVACY.html`
6. Verify both in a private browser window **before** pasting anywhere. If the root 404s but
   `PRIVACY.html` loads, `docs/index.md` is missing from the deployed branch — push it.

## Step 2 — Google Cloud OAuth client (20 min)

Google renamed the old "OAuth consent screen" — it's now **Google Auth Platform** in the console.

1. [console.cloud.google.com](https://console.cloud.google.com) → ☰ → *IAM & Admin → Create a
   Project* (no billing account needed).
2. ☰ → *APIs & Services → Library* → enable **Google Sheets API** and **Google Drive API** (do this
   before scopes, or the scope won't be listed).
3. ☰ → *Google Auth Platform → Branding* → Get Started: app name, support email, **Audience:
   External**, contact email, agree to the User Data Policy. Add the privacy-policy URL from Step 1.
4. *Data Access* → **Add or remove scopes** → exactly one:
   `https://www.googleapis.com/auth/drive.file`. Nothing else — this single choice is what keeps
   publishing free (see "Scope economics" below).
5. *Clients* → **Create client** → type **Web application** (never "Chrome Extension" — that type
   is `getAuthToken`-only, which Firefox lacks). Add redirect URIs:
   - `https://lmkchpbfpmencebnadolcfpchmfcnapg.chromiumapp.org/` (dev builds: Chrome **and** Edge
     unpacked, ID pinned by the manifest key)
   - Firefox loopback: load `dist/firefox` via `about:debugging#/runtime/this-firefox` → click
     **Inspect** on the extension → in its console run `browser.identity.getRedirectURL()`. It
     returns `https://<hash>.extensions.allizom.org/`; register `http://127.0.0.1/mozoauth2/<hash>`
     (that first label, before the dot). (Google rejects the `allizom.org` form — you'd have to
     prove you own Mozilla's domain; the loopback is Mozilla's official workaround, Firefox
     intercepts it, nothing listens. In un-baked builds the options page's Publisher-setup card
     shows the converted value directly.)
   - You'll append one more URI per store in Steps 5–6.
6. *Audience* → **Publish app → In production**. Because `drive.file` is non-sensitive: **no
   verification, no "unverified app" warning, no user cap.** (Optional, later: *brand verification*
   — 2–3 days — only to show your name/logo on the consent screen; needs a homepage domain you own.)
7. **The downloaded JSON.** After creating the client, the console offers *Download JSON*. That
   file is only a container for the client's metadata — the **single value this project uses is
   `client_id`** (the string ending `.apps.googleusercontent.com`). Open the JSON, copy it, bake it:
   ```sh
   echo "YOUR-ID.apps.googleusercontent.com" > .keys/client-id.txt
   np
   ```
   The build's "no OAuth client id" warning disappears, and the options page's *Publisher setup*
   card is replaced by a live **Connect Google Sheets** button.

   The JSON also contains a `client_secret`. **We never use it** — the implicit flow authenticates
   with the client ID plus the pre-registered redirect URI alone (that's the whole point: an
   extension has nowhere safe to keep a secret). Do not commit the JSON to the repo: the client ID
   is public by design, the secret is not. `.keys/client-id.txt` holds only the public part and is
   safe to commit.

8. **Verify the wiring** before touching any store: reload the unpacked extension, open options →
   Connect → approve → the *SheetBookmark* sheet appears in your Drive. Then run the full
   [TESTING.md](TESTING.md) checklist across all three browsers.

### Why "Web application" and not "Chrome Extension" — the compatibility story

The console's client types are not cosmetic — they select *which OAuth mechanism* the client can
serve, and only one of them is vendor-neutral:

- The **"Chrome Extension"** client type exists solely for `chrome.identity.getAuthToken()`,
  Chrome's proprietary shortcut. It doesn't use redirect URIs at all — you bind the client to a
  Chrome Web Store item ID, and the token is minted through the Google account **signed into the
  Chrome browser itself**. That machinery ships only in Google-branded Chrome: Firefox has no
  `getAuthToken` in its identity API at all, and Edge/Brave/Opera/Vivaldi lack the Google-account
  plumbing it depends on. One client type, one browser, one store ID, and only the profile's own
  Google account.
- The **"Web application"** type is plain, standards-based redirect OAuth: "send the token to one
  of these pre-registered URLs." Our code uses `identity.launchWebAuthFlow()`, which every engine
  implements (Chromium *and* Firefox), and which is nothing more than "open Google's sign-in page
  in a popup, wait for it to redirect to the magic URL, hand that URL back." Any browser that can
  open a popup qualifies.

What makes it *wider* compatible in practice:

| | Chrome Extension client (`getAuthToken`) | Web application client (`launchWebAuthFlow`) |
| --- | --- | --- |
| Chrome | ✅ (only if signed into Chrome) | ✅ |
| Edge, Brave, Opera, Vivaldi | ❌ | ✅ |
| Firefox | ❌ API doesn't exist | ✅ |
| Google account used | the browser profile's, only | any — the user picks at the consent screen |
| Redirect URIs per client | none (bound to one CWS item) | many — dev, Firefox, Edge store, Chrome store all on **one** client |
| Client secret needed | no | no (implicit flow ignores it) |

So "Web application" here doesn't mean "a website" — it means *redirect-based OAuth*, the only
mechanism all six target browsers share. The extension simply plays the role of a web app whose
"site" is the redirect URL the browser intercepts (`chromiumapp.org` on Chromium, the loopback on
Firefox).

## Step 3 — Prepare listing assets (once, reused everywhere)

- **Icon**: `icons/icon-128.png` (already generated).
- **Screenshots**: 1280×800, 1–5 of them. Popup with bookmarks from several browsers, options page,
  and the Google Sheet with per-browser tabs make the story obvious.
- **Short description** (≈130 chars): *"Sync bookmarks from every browser into one Google Sheet in
  your own Drive — a tab per browser, searchable everywhere, no server."*
- **Long description**: lead with cross-browser + your-own-Drive + no-server/no-tracking; list the
  cadence options and the import button; state the single `drive.file` scope in plain words.
- Reviewer test note (all stores): *"Click Connect Google Sheets in options, sign in with any
  Google account — it creates its own spreadsheet in that account's Drive. Ctrl/Cmd+D any page and
  the row appears in the sheet within seconds. No credentials needed."*

## Step 4 — Firefox (AMO) — free, do first

1. Create a Firefox Account → [addons.mozilla.org](https://addons.mozilla.org) → *Tools → Submit a
   New Add-on*.
2. Channel: **Listed on this site** (that's the public showcase; "self-distribution" is for
   privately hosted signed builds).
3. Upload `dist/bookmark-sheet-sync-firefox-<version>.zip`.
5. Source code: our build is plain, unbundled, unminified — answer **no** to "does your submission
   require source code?"; no upload needed.
6. Listing: name, summary, description, icon, screenshots, category (e.g. *Bookmarks*), privacy
   policy URL.
7. Submit. Auto-signing usually completes in **~24 h**; manual review, if selected, takes longer.
8. Nothing OAuth-related changes: the published add-on keeps the pinned `gecko.id`, so the loopback
   redirect URI you registered in Step 2 already works. ✅ Live.

## Step 5 — Edge (Partner Center) — free, do second

1. [partner.microsoft.com/dashboard](https://partner.microsoft.com/dashboard) → enroll in the
   **Microsoft Edge program** (Microsoft account; **Individual** — company accounts add days of
   verification; note: account type and country are permanent).
2. *Create new extension* → upload `dist/bookmark-sheet-sync-chrome-<version>.zip` (the Chromium
   zip — Edge consumes the same package). **Don't submit yet.**
3. Grab the **extension ID** shown in the product overview/URL. Add
   `https://<that-id>.chromiumapp.org/` to the OAuth client (Step 2.5) — without this, Connect
   fails for Edge-store users *and* for the reviewer.
4. Fill listing (assets from Step 3; description 250–10,000 chars; logo ≥128×128), **Privacy** tab
   (policy URL, per-permission justifications — table below), Availability: **Public**.
5. Submit. Certification takes **up to 7 business days**. ✅ Live.

## Step 6 — Chrome (Web Store) — $5, whenever you're ready

1. Pick the Google account carefully (developer email is permanent), enable **2-Step Verification**
   (publishing is blocked without it), register at the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole), pay **$5** (one-time,
   covers 20 extensions).
2. Account tab → **Trader/Non-Trader declaration** (mandatory, EU DSA). Individual hobby project →
   *Non-Trader*, nothing verified. Company → *Trader*: legal name, address and SMS-verified phone,
   **published on your listing**.
3. **Add new item** → upload the Chromium zip → **draft only**. This assigns the permanent item ID.
   (Our zips deliberately contain no manifest `key` — the store rejects new items that have one.)
4. Add `https://<store-item-id>.chromiumapp.org/` to the OAuth client. Optionally copy the store's
   public key (item → Package → *View public key*) into `.keys/manifest-key.txt` so your local dev
   ID matches the store ID from now on.
5. Store listing + Privacy practices tabs (tables below), distribution **Public** (or *Unlisted*
   for a soft launch — same review, no public blast radius).
6. Submit. Review: days, sometimes weeks; chase support at 3 weeks. ✅ Live.

## Step 7 — Analytics

Everything is automatic except one Chrome opt-in — full walkthrough in
[ANALYTICS.md](ANALYTICS.md), including UTM-tagged showcase links and the monthly CSV routine.

---

## Store-form answers (copy-paste)

**Single purpose:**
> Sync the user's browser bookmarks to a single Google Sheet in their own Google Drive — one tab
> per browser — so that bookmarks saved in one browser can be searched, opened, and optionally
> imported from any other browser.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `identity` | Obtains a Google OAuth access token via `identity.launchWebAuthFlow`, so the user can authorize the extension to create and update its own bookmark spreadsheet in their Google Drive. |
| `bookmarks` | Reads the user's bookmarks to sync them to that spreadsheet, and listens for `bookmarks.onCreated` so bookmarks saved with Ctrl/Cmd+D are captured. Writes happen in exactly one case: when the user clicks "Get bookmarks from other browsers", new bookmarks are created inside a dedicated "SheetBookmark" folder. Nothing is ever modified or deleted. |
| `storage` | Stores the user's settings (sync cadence, profile label), the id of the spreadsheet and tab the extension created, a queue of bookmarks not yet uploaded, and the list of already-synced URLs used to avoid duplicates. |
| `activeTab` | When the user clicks the toolbar button, reads the title and URL of the current tab so it can be saved. Only on an explicit click. |
| `scripting` | Used together with activeTab, only on that same explicit click, to read the page's meta description and the user's selected text so the save popup can pre-fill the bookmark's note. Never runs on any other page or event. |
| `alarms` | Runs the sync schedule the user picks (instant with retry, or every 15 min / 1 h / 8 h / 24 h), and retries uploads that were queued while offline. |
| `https://sheets.googleapis.com/*` | Calls the Google Sheets API to create the bookmark spreadsheet, manage each browser's tab, and read and append rows. |
| `https://www.googleapis.com/*` | Calls the Google Drive API to find or verify the spreadsheet the extension created, under the `drive.file` scope. |

**Remote code:** No — MV3, everything bundled, plain source.
**Data usage:** handles *website content* (bookmark titles/URLs) and *authentication information*
(OAuth token, session-memory only). Not sold, not transferred, no server, no telemetry.

## Scope economics (why `drive.file` is non-negotiable)

| Scope | Google tier | Cost to publish |
| --- | --- | --- |
| **`drive.file`** ← ours | Non-sensitive | **Nothing** |
| `spreadsheets` | Sensitive | Verification review (days–weeks, demo video) |
| `drive`, `drive.readonly` | Restricted | Verification **+ paid annual CASA security assessment** |

If a future feature tempts you to widen the scope — don't. That single change converts a free
launch into a recurring paid audit.
