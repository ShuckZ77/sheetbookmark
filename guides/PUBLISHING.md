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

## Step 3 — Listing assets (exact sizes — stores hard-reject wrong dimensions)

| Asset | Chrome | Edge | Firefox | File |
| --- | --- | --- | --- | --- |
| Icon | 128×128 in the zip ✔ (ships automatically) | 1:1, rec 300×300, min 128 (reuse icon-128) | from zip ✔ | `icons/icon-128.png` |
| Screenshots | **≥1 mandatory, exactly 1280×800 or 640×400**, max 5 | optional, exactly 640×480 or 1280×800, max 6 | flexible | `private/store-assets/shot-1..4.png` |
| Small promo tile | **440×280 MANDATORY** | 440×280 optional | — | `private/store-assets/tile-small.png` |
| Marquee tile | 1400×560 optional | 1400×560 optional | — | `private/store-assets/tile-marquee.png` |

Regenerate everything at exact sizes any time:

```sh
python3 scripts/store-assets.py && sh private/store-assets/render.sh
```

Copy blocks that every store asks for:

- **Short description**: *"Sync bookmarks from every browser into one Google Sheet in your own
  Drive — a tab per browser, searchable everywhere, no server."*
- **Long description**: the plain-text version used on AMO (front-load the first 250 characters;
  AMO renders NO HTML; Edge requires **minimum 250 characters**).
- **Reviewer test note** (all stores): *"Click Connect Google Sheets in options, sign in with any
  Google account — the extension creates its own spreadsheet in that account's Drive. Ctrl/Cmd+D
  any page and the row appears in the sheet within seconds. No test credentials needed."*

## Step 4 — Firefox (AMO) — free, do first

**Before uploading:** loopback redirect URI registered and Connect tested in Firefox (Step 2.5);
OAuth app **In production**; fresh artifact via `npm test && npm run zip`.

1. Firefox Account → [addons.mozilla.org](https://addons.mozilla.org) → *Tools → Submit a New
   Add-on* → channel **Listed**.
2. Upload `dist/sheetbookmark-firefox-<version>.zip`. Validator facts learned the hard way:
   - `data_collection_permissions` is **required** for new extensions. Ours declares
     `bookmarksInfo` + `websiteContent` — honest under Mozilla's "anything transmitted outside the
     local browser" definition even though data goes only to the user's own sheet.
   - **One-way door:** once a version ships the key, every future version must keep it.
   - Version floors: desktop **140**, Android **142** (`gecko_android`) — the releases that
     introduced the consent screen. Lower floors = validator warnings.
3. Compatibility: **Firefox desktop only** — leave *Firefox for Android* unchecked (no `bookmarks`
   API there; `gecko_android` in the manifest only scopes versions, it does not enable Android).
4. "Do you need to submit source code?" → **No.** The bullets describe minifiers/bundlers/template
   engines; every file in our zip is verbatim, readable source. (Fallback if ever queried: the
   public repo link.)
5. Listing: name, summary, the **plain-text** description (HTML tags are shown literally — do not
   use them), category *Bookmarks*, license **AGPL-3.0**, privacy policy URL, screenshots
   (`shot-1..4.png`), homepage (site) + support (GitHub issues).
6. Submit. Auto-signing usually **~24 h** after validation; human review can happen afterwards at
   any time.
7. **Shipping updates later:** bump the version (`package.json` — the build stamps the manifest),
   `npm test && npm run zip`, then upload **from the add-on's own page in the Developer Hub** —
   never via "Submit a New Add-on", which creates a duplicate listing with a new ID. Users are
   only re-prompted for consent if a *new* required data category is added. Listing text and
   images are editable any time without a new version (*Manage Listing*).

## Step 5 — Edge (Partner Center) — free, do second

1. Enroll: [partner.microsoft.com/dashboard](https://partner.microsoft.com/dashboard) → Microsoft
   Edge program. **Microsoft account only** (Outlook/Live/GitHub — work/school accounts cannot
   enroll). Choose **Individual**. ⚠ Country/region and the Individual/Company choice are
   **permanent**. Verification typically **3–5 business days** — you can prepare meanwhile.
2. *Create new extension* → upload `dist/sheetbookmark-chrome-<version>.zip` (Edge consumes the
   Chromium zip; the extra `browser_specific_settings` key is ignored). **Do not submit yet.**
3. Copy the **extension ID** from the product page → add
   `https://<that-id>.chromiumapp.org/` to the Google OAuth client. Skipping this bricks Connect
   for the reviewer and every Edge user.
4. Listing quirks that surprise people:
   - **Description must be 250–10,000 characters** — too short fails form validation.
   - **Name, short description and description come from the manifest and are read-only** in
     Partner Center — fixing a typo means rebuild + re-upload.
   - Logo 1:1 (300×300 recommended, `icons/icon-128.png` acceptable), screenshots optional
     (`shot-*.png` are the right size), up to 7 search terms.
5. **Privacy page:** single-purpose text; a justification box **per manifest permission** (reuse
   the table below); remote code → **No**; *"Does the extension handle personal information?"* →
   **Yes** (OAuth token counts) → which makes the **privacy policy URL mandatory**.
6. **Notes for certification** box: paste the reviewer test note from Step 3 — an OAuth extension
   the reviewer can't exercise is a certification failure waiting to happen.
7. Submit → certification up to **7 business days**. ✅ Live.

## Step 6 — Chrome (Web Store) — $5, whenever you're ready

1. Account: permanent-forever Google account, **2-Step Verification on** (publish is blocked
   without it), register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   pay **$5 one-time** (covers 20 extensions).
2. **Trader / Non-Trader declaration** (mandatory, EU DSA): individual hobby project → Non-Trader,
   nothing verified. Trader → legal name + address + **SMS-verified phone** (no non-SMS lines),
   all **displayed publicly** on the listing.
3. **Add new item** → upload the Chromium zip → **draft only**. This assigns the permanent item ID
   (our zips carry no manifest `key` — the store rejects new items that have one).
4. Register `https://<store-item-id>.chromiumapp.org/` on the OAuth client. Optionally copy the
   store's public key (item → Package → *View public key*) into `.keys/manifest-key.txt` so local
   dev and store share one ID.
5. Store listing — hard requirements: detailed description, category, language, ≥1 screenshot at
   **exactly 1280×800** (ours), and the **mandatory 440×280 small promo tile**. Optional: marquee
   1400×560, YouTube video.
6. **Privacy practices tab** (Submit stays disabled until complete): single purpose,
   per-permission justifications (table below), remote code → **No**, data-usage checkboxes +
   Limited Use certifications, privacy policy URL.
7. ⚠ **Policy in force since Aug 1, 2026:** all data collection must be *prominently disclosed
   in-product* (our Connect screen's "creates and manages its own bookmark sheet in your Drive"
   wording is that disclosure — keep it), and any future change to data practices must be
   *proactively communicated to users* (changelog + listing update at minimum).
8. Distribution: Public, or **Unlisted for a soft launch** (same review, no public blast radius).
   Submit. Review: days to a few weeks; **no edits while "Pending review"** — use ⋮ → *Cancel
   review* to return to draft, edit, resubmit. Chase support at 3 weeks.

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
