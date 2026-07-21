# Publishing guide

Order of operations, costs, and every step. Verified against Google/Mozilla/Microsoft docs
(July 2026). Your plan — **Firefox and Edge first (both free), Chrome later ($5)** — is exactly the
right sequence and is how this guide is ordered.

**Costs:** Firefox **free** · Edge **free** · Chrome **$5 one-time** · Google Cloud + Sheets/Drive
APIs + OAuth **free**, no billing account.

Companion docs: [TESTING.md](TESTING.md) (try it locally first) · [ANALYTICS.md](ANALYTICS.md)
(what you can measure) · [PRIVACY.md](PRIVACY.md) (host this — every store demands the URL).

---

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

1. Push this repo to GitHub, enable **Pages** (Settings → Pages → deploy from branch), or paste
   `docs/PRIVACY.md` into any static host.
2. Put your real contact email into it first (there's a placeholder).
3. Keep the URL handy — you'll paste it into three dashboards.

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
   - Firefox loopback: build with no client ID, load `dist/firefox` in Firefox, open options — the
     **Publisher setup** card shows the exact `http://127.0.0.1/mozoauth2/<hash>` value. (Google
     rejects Firefox's real `extensions.allizom.org` URL — you'd have to prove you own Mozilla's
     domain; the loopback is Mozilla's official workaround, Firefox intercepts it, nothing listens.)
   - You'll append one more URI per store in Steps 5–6.
6. *Audience* → **Publish app → In production**. Because `drive.file` is non-sensitive: **no
   verification, no "unverified app" warning, no user cap.** (Optional, later: *brand verification*
   — 2–3 days — only to show your name/logo on the consent screen; needs a homepage domain you own.)
7. Bake and build:
   ```sh
   echo "YOUR-ID.apps.googleusercontent.com" > .keys/client-id.txt
   npm run build && npm run zip
   ```

Now run the full [TESTING.md](TESTING.md) checklist across all three browsers before submitting
anything.

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
4. Source code: our build is plain, unbundled, unminified — answer **no** to "does your submission
   require source code?"; no upload needed.
5. Listing: name, summary, description, icon, screenshots, category (e.g. *Bookmarks*), privacy
   policy URL.
6. Submit. Auto-signing usually completes in **~24 h**; manual review, if selected, takes longer.
7. Nothing OAuth-related changes: the published add-on keeps the pinned `gecko.id`, so the loopback
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
| `bookmarks` | Reads the user's bookmarks to sync them to that spreadsheet, and listens for `bookmarks.onCreated` so bookmarks saved with Ctrl/Cmd+D are captured. Writes happen in exactly one case: when the user clicks "Get bookmarks from other browsers", new bookmarks are created inside a dedicated "Bookmark Sync" folder. Nothing is ever modified or deleted. |
| `storage` | Stores the user's settings (sync cadence, profile label), the id of the spreadsheet and tab the extension created, a queue of bookmarks not yet uploaded, and the list of already-synced URLs used to avoid duplicates. |
| `activeTab` | When the user clicks the toolbar button, reads the title and URL of the current tab so it can be saved. Only on an explicit click. |
| `scripting` | Used together with activeTab, only on that same explicit click, to read the page's meta description so the sheet's description column can be filled. Never runs on any other page or event. |
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
