# Changelog

## 1.0.3 — hardening release

A deep three-lens audit (sync engine, UI, security) after the first real-user report.
Every finding fixed; nothing deferred.

### Authentication (the bug your friend hit)
- **Consent checkbox skipped → 403.** Google's consent screen shows the Drive scope as an
  optional checkbox; skipping it returned a permission-less token that 403'd on first use.
  We now verify the granted scope at sign-in and, if it's missing, reject with the exact
  instruction ("tick the checkbox … then Continue").
- **403 self-heals**: a missing/revoked scope now surfaces as "sign in again" (with the
  bookmark preserved), not a dead-end error.
- **Single-flight sign-in**: concurrent auth (retry alarm + popup) no longer opens two
  consent windows or flashes a false "signed out" badge.
- Minimum Chrome raised to 106 (below that, `launchWebAuthFlow` promises don't exist).

### Sync correctness
- **"Get bookmarks from other browsers" no longer duplicates everything** into your tab
  (the import echo is now suppressed).
- **The popup no longer collapses to a single row for 60s after a save.**
- **Large imports can't double-append** on a mid-flush network blip (per-chunk queue removal).
- **A sheet deleted in Drive** cleanly drops the connection (bookmarks kept, queued) instead
  of failing forever; reconnecting re-imports your tree.
- **Sync back to "Instantly"** works again (it was wrongly rejected as an unknown mode).
- **Notes**: edits to a still-uploading bookmark, or made during a sync, are no longer lost;
  a renamed tab gives a clear "refresh and try again" instead of a raw API error.
- Offline/rate-limited actions now say "queued, will sync automatically" — never "failed".
- Dropped `si`/`spm` from tracking-param stripping (they're real content params on some
  sites and were wrongly deduping different pages together).
- Dedupe memory raised to 100k URLs.

### Privacy & security
- **Reads less.** The note pre-fill no longer reads page body text, site name, or word
  count — only the meta description and your current selection, only when you open the
  popup on a page. Privacy policy and site wording corrected to match exactly.
- Error journal scrubbing broadened (emails, Bearer tokens, markdown-fence breakout).
- Row cache bounded so a bloated shared sheet can't exhaust storage.

### Reliability
- Offline list-load, hand-added rows, note-button state, timestamp sorting, and several
  silent-failure paths now show clear feedback instead of a blank or misleading state.
