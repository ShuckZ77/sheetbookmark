# Analytics — what you get, what you don't, and setup

Verified against store docs (July 2026). Short version: **all three stores give you free
install/user analytics automatically — there is nothing to configure except one opt-in on Chrome.**

## What each store provides (all free)

| Metric | Chrome Web Store | Firefox AMO | Edge Add-ons |
| --- | --- | --- | --- |
| Daily installs | ✅ | ✅ (downloads) | ✅ |
| Uninstalls | ✅ | ❌ | ❌ (has enabled-vs-disabled instead) |
| Weekly/active users | ✅ (counts installs, not activity) | ✅ (from Firefox telemetry) | ✅ (+ enabled / disabled / unknown split) |
| Store-listing impressions / page views | ✅ impressions incl. search | ❌ | ✅ true page views |
| Country / language / OS breakdowns | ✅ | ✅ (by version/OS/country/lang) | ✅ (region/OS/language filters) |
| Campaign attribution (UTM) | ✅ | ✅ (download source) | ❌ |
| CSV export | ✅ | ✅ | ✅ |
| History window | undocumented | long | up to *All time* |
| Ratings analytics | ❌ | ❌ | ❌ |
| Crash / error reports | ❌ | ❌ | ❌ |
| Stats API | ❌ (publish-only API) | ❌ | ❌ |

**The honest gap, on every store:** none of them tell you whether people actually *use* the
extension — "users" means installed-and-enabled, not active. And there are no crash reports.
The only way to know usage is self-instrumentation (see bottom).

## Setup, per store

### Firefox (AMO) — nothing to enable
1. Publish the add-on (see [PUBLISHING.md](PUBLISHING.md)).
2. Stats collect automatically from Firefox telemetry, aggregated, no PII.
3. View: [addons.mozilla.org](https://addons.mozilla.org) → *Tools → Manage My Submissions* → your
   add-on → **Statistics**. Private to you. Export CSV from the dashboard.

### Edge (Partner Center) — nothing to enable
1. Publish the extension.
2. View: [Partner Center](https://partner.microsoft.com/dashboard) → Microsoft Edge program → your
   extension → **Analytics**.
3. Four reports (Weekly users, Enabled/Disabled, Installs, Page views), each filterable by region,
   OS and language; ranges from last month to all-time; **Export CSV** button on each.

### Chrome (when you publish there) — one opt-in
1. Built-in reports need nothing: [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   → your item → **Analytics**: Installs & Uninstalls, Impressions, Weekly Users, all with
   country/language/OS filters and CSV export.
2. **Optional GA4:** item → *Store listing* → **Additional metrics** → *Opt in to Google Analytics*.
   Notes: the store creates and owns the GA4 property (you get Marketer role only), retention is
   2 months, and it adds an `install` event you can mark as a key event. Useful for funnel
   (listing view → install), not for usage.

### Campaign links (which showcase channel works)
When sharing the listing, append UTM parameters:

```
https://addons.mozilla.org/…/bookmark-sheet-sync/?utm_source=twitter&utm_medium=social&utm_campaign=launch
https://chromewebstore.google.com/detail/<id>?utm_source=producthunt&utm_medium=referral&utm_campaign=launch
```

Chrome surfaces these in the Impressions report; AMO shows downloads-by-source. Edge ignores UTMs —
compare its page-view count against dated posts instead.

### Suggested routine
Monthly: export CSVs from each dashboard into a `metrics/` folder. That builds the time series the
stores don't promise to keep, and it's the only cross-store view you'll get — there is no API.

## Self-instrumentation (currently: none, on purpose)

The extension ships with **zero telemetry** — "no server, nothing reaches the developer" is both a
privacy-policy claim and a selling point. If you ever want real usage data (bookmarks synced/day,
feature adoption), the compliant path is:

1. Add an explicit opt-in toggle (off by default) in options.
2. Send anonymous events via GA4 Measurement Protocol from the background worker.
3. Update `docs/PRIVACY.md` **and** every store's data-usage form *before* shipping it — an
   undisclosed data flow is the classic store-takedown trigger.

Don't do this until a concrete question demands it.
