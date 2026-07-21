# Privacy Policy — Bookmark Sheet Sync

_Last updated: 13 July 2026_

Bookmark Sheet Sync saves your browser bookmarks into a Google Sheet that lives in **your own
Google Drive**, so you can reach them from any browser.

## The short version

**There is no server.** The extension has no backend, and the developer receives no data of any
kind. Your bookmarks travel directly from your browser to your own Google account, and nowhere else.

## What the extension handles

| Data | Why | Where it goes |
| --- | --- | --- |
| Bookmark page titles, URLs, folder names — and, when you save via the toolbar button, the page's public meta description | This is the thing being synced | A spreadsheet **the extension creates in your own Google Drive** |
| The browser name, OS, and the profile label you type | Written into each row so you can tell which browser saved what | The same spreadsheet |
| A Google OAuth access token | To authorize writing to that one spreadsheet | Held in your browser's **session memory only**. Never written to disk, never transmitted anywhere except to Google |
| Your settings, an upload queue, and a list of already-synced URLs | To work offline and avoid duplicate rows | Stored **locally in your browser** (`storage.local`). Never transmitted |

## What the extension does *not* do

- It does **not** send any data to the developer, or to any third-party server.
- It does **not** collect analytics, telemetry, or tracking of any kind.
- It does **not** read your browsing history, or the content of pages you visit.
- It does **not** sell, rent, or transfer your data to anyone.
- It does **not** modify or delete your existing browser bookmarks. It reads them, and the
  only time it ever creates any is when you click "Get bookmarks from other browsers" —
  new entries are then added inside a dedicated `Bookmark Sync` folder, nothing else is
  touched, and nothing is ever deleted.

## Scope of Google Drive access

The extension requests exactly one Google scope: `https://www.googleapis.com/auth/drive.file`.

This is the narrowest Drive scope Google offers. It grants access **only to files the extension
itself creates** — that is, the single `Bookmark Sync` spreadsheet. The extension **cannot see,
read, or touch any other file in your Google Drive**, and that is enforced by Google, not merely
promised here.

## Limited Use

> The use of information received from Google APIs will adhere to the
> [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
> including the Limited Use requirements.

Data is used solely to provide the bookmark-syncing feature that is the extension's single, stated
purpose, and is prominent in its user interface.

## Deleting your data

- **Disconnect** or **Reset this install** in the extension's options clears the stored token, the
  sheet reference, and the local sync record on that browser.
- The spreadsheet is yours. Delete it from Google Drive at any time, like any other file.
- Revoke the extension's access entirely at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Contact

<!-- Replace with a real contact address before publishing. -->
Questions: `iitbhu.rishish@gmail.com`
