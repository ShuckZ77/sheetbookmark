/**
 * Drives background.js through a fake extension API and a fake Sheets/Drive endpoint, so
 * queueing, dedupe, per-tab writes, sync modes, the flush mutex, sheet reuse and both
 * import directions are exercised without a browser.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const TREE = [
  {
    title: '',
    children: [
      {
        title: 'Bookmarks Bar',
        children: [
          { title: 'Alpha', url: 'https://alpha.example/', dateAdded: 1700000000000 },
          { title: 'Reading', children: [{ title: 'Beta', url: 'https://beta.example/x', dateAdded: 1700000001000 }] },
          { title: 'Nope', url: 'javascript:void 0' },
        ],
      },
    ],
  },
];

function makeArea() {
  const data = new Map();
  return {
    async get(keys) {
      // Real chrome.storage returns a fresh deserialized copy each call — never a shared
      // reference. Cloning here keeps the mock honest (a caller can't mutate stored state).
      const clone = (v) => structuredClone(v);
      if (keys == null) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => data.has(key)).map((key) => [key, clone(data.get(key))]));
    },
    async set(patch) {
      for (const [key, value] of Object.entries(patch)) data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
    async clear() {
      data.clear();
    },
  };
}

const listeners = {};
const alarms = {};
let createdBookmarks = [];
let bookmarkSearchResults = [];

const chrome = {
  storage: { local: makeArea(), session: makeArea() },
  runtime: {
    onMessage: { addListener: (fn) => (listeners.message = fn) },
    onStartup: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    openOptionsPage: async () => {},
    getPlatformInfo: async () => ({ os: 'mac' }),
  },
  bookmarks: {
    onCreated: { addListener: (fn) => (listeners.created = fn) },
    getTree: async () => TREE,
    get: async () => [],
    search: async () => bookmarkSearchResults,
    create: async (node) => {
      createdBookmarks.push(node);
      return { id: `bm${createdBookmarks.length}` };
    },
  },
  alarms: {
    create: (name, opts) => (alarms[name] = opts),
    clear: async (name) => delete alarms[name],
    onAlarm: { addListener: (fn) => (listeners.alarm = fn) },
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  identity: {
    getRedirectURL: () => 'https://ext.chromiumapp.org/',
    launchWebAuthFlow: async ({ url }) => {
      const state = new URL(url).searchParams.get('state');
      const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file');
      return `https://ext.chromiumapp.org/#access_token=fresh&expires_in=3600&scope=${scope}&state=${state}`;
    },
  },
};

globalThis.chrome = chrome;
// The OAuth client id is baked at build time; inject one so getToken doesn't short-circuit.
globalThis.__BOOKMARK_CLIENT_ID__ = 'test-client.apps.googleusercontent.com';
await import('../src/background.js');
const { toISTStamp } = await import('../src/lib/store.js');

const HEADER_ORDER = ['timestamp', 'id', 'folder', 'browser', 'profile', 'os', 'source', 'title', 'url', 'note'];
const COLUMN = Object.fromEntries(HEADER_ORDER.map((name, index) => [name, index]));
/** Builds a positional sheet row from named fields — survives any future column reorder. */
const rowValues = (row) => HEADER_ORDER.map((name) => row[name] ?? '');
const HEADER = HEADER_ORDER;

/** Router state, reset per test. */
let appended = [];
let requests = [];
let nextStatus = () => 200;
let driveFiles = [];
let sheetTabs = [{ sheetId: 7, title: 'Test' }];
let tabValues = {}; // tab title → array of row value-arrays
let oldHeader = null; // set to simulate a tab created by an older schema
let errorBody = null; // custom error payload for >=400 replies
let throwNetwork = 0; // first N fetches reject like offline

function installFetch() {
  appended = [];
  requests = [];
  nextStatus = () => 200;
  driveFiles = [];
  sheetTabs = [{ sheetId: 7, title: 'Test' }];
  tabValues = {};
  oldHeader = null;
  errorBody = null;
  throwNetwork = 0;
  createdBookmarks = [];
  bookmarkSearchResults = [];

  globalThis.fetch = async (url, init = {}) => {
    if (throwNetwork > 0) { throwNetwork -= 1; throw new TypeError('Failed to fetch'); }
    const method = init.method ?? 'GET';
    const status = nextStatus(url, requests.length);
    requests.push({ url, method, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined });

    await new Promise((resolve) => setTimeout(resolve, 8)); // let callers interleave

    const reply = (body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (status >= 400) return reply(errorBody ?? { error: { message: 'nope' } });

    const bare = url.split('?')[0];

    if (url.includes('/drive/v3/files?')) return reply({ files: driveFiles });
    if (url.includes('/drive/v3/files/')) return reply({ id: 'any', trashed: false });

    // The router is stateful like the real API: created tabs appear in later listTabs calls.
    if (method === 'POST' && /\/v4\/spreadsheets$/.test(bare)) {
      const body = JSON.parse(init.body);
      const title = body.sheets?.[0]?.properties?.title ?? 'Sheet1';
      sheetTabs = [{ sheetId: 99, title }];
      return reply({ spreadsheetId: 'NEW', sheets: [{ properties: { sheetId: 99, title } }] });
    }
    if (url.includes(':batchUpdate')) {
      const body = JSON.parse(init.body);
      const title = body.requests?.[0]?.addSheet?.properties?.title ?? 'Added';
      sheetTabs = [...sheetTabs, { sheetId: 55, title }];
      return reply({ replies: [{ addSheet: { properties: { sheetId: 55, title } } }] });
    }
    if (url.includes('fields=sheets.properties')) {
      return reply({ sheets: sheetTabs.map((tab) => ({ properties: tab })) });
    }
    if (url.includes('values:batchGet')) {
      return reply({ valueRanges: sheetTabs.map((tab) => ({ values: tabValues[tab.title] ?? [] })) });
    }
    if (url.includes('A1%3AJ1')) return reply({ values: [oldHeader ?? HEADER] });
    if (url.includes(':append')) {
      const vals = JSON.parse(init.body).values;
      appended.push(...vals);
      const title = decodeURIComponent(url).match(/values\/'(.+)'!A:/)?.[1];
      if (title) tabValues[title] = [...(tabValues[title] ?? []), ...vals];
      return reply({});
    }
    if (url.includes('A2%3AJ')) {
      const title = decodeURIComponent(url).match(/values\/'(.+)'!A2:J/)?.[1] ?? '';
      return reply({ values: tabValues[title] ?? [] });
    }
    if (url.includes('B2%3AB')) {
      const title = decodeURIComponent(url).match(/values\/'(.+)'!B2:B/)?.[1] ?? '';
      return reply({ values: (tabValues[title] ?? []).map((row) => [row[1]]) });
    }
    return reply({});
  };
}

const send = (message) =>
  new Promise((resolve, reject) => {
    const keepOpen = listeners.message(message, {}, resolve);
    if (keepOpen !== true) reject(new Error('listener closed the channel'));
  });

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set({
    sheetId: 'SHEET',
    tabId: 7,
    tabName: 'Test',
    profileLabel: 'Test',
    syncMode: 'instant',
  });
  await chrome.storage.session.set({ accessToken: { token: 'good', expiresAt: Date.now() + 3600e3 } });
  installFetch();
});

const urlsOf = () => appended.map((row) => row[COLUMN.url]);
const idsOf = () => appended.map((row) => row[COLUMN.id]);
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const fromValues = (vals) => Object.fromEntries(HEADER_ORDER.map((k, i) => [k, vals[i] ?? '']));
const store_setCache = async (rows) => chrome.storage.local.set({ rowCache: { rows, at: Date.now() } });

// --- Capture and flush ------------------------------------------------------

test('saveTab appends one fully-populated row into this install’s own tab', async () => {
  const result = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });

  assert.equal(result.ok, true);
  assert.equal(appended.length, 1);

  const appendCall = requests.find((request) => request.url.includes(':append'));
  assert.ok(decodeURIComponent(appendCall.url).includes("'Test'!A:J"), 'row must land in the install’s own tab');

  const [row] = appended;
  assert.equal(row[COLUMN.url], 'https://alpha.example/');
  assert.equal(row[COLUMN.profile], 'Test');
  assert.equal(row[COLUMN.os], 'macOS');
  assert.equal(row[COLUMN.source], 'toolbar');
  assert.ok(!Number.isNaN(Date.parse(row[COLUMN.timestamp])));
  assert.match(row[COLUMN.id], /^[0-9a-f-]{36}$/);
});

test('saveTab refuses a page that is not http(s)', async () => {
  const result = await send({ type: 'saveTab', tab: { title: 'x', url: 'chrome://bookmarks' } });
  assert.deepEqual(result, { ok: false, error: 'unsupported' });
  assert.equal(appended.length, 0);
});

test('the same page under a tracking parameter is only written once', async () => {
  await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/post' } });
  // Reflect reality in the mock sheet: the row now exists in this install's tab.
  tabValues.Test = [rowValues({ timestamp: 't', title: 'Alpha', browser: 'Chrome', profile: 'Test', os: 'mac', source: 'toolbar', url: 'https://alpha.example/post' })];
  const second = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://www.alpha.example/post?utm_source=x' } });

  assert.equal(second.deduped, true);
  assert.equal(appended.length, 1);
});

test('deleting a row from the sheet makes the page saveable again (the user repro)', async () => {
  await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });
  assert.equal(appended.length, 1);

  // User deletes the row in the Sheets UI: the own tab no longer contains the URL.
  tabValues.Test = [];

  const again = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });
  assert.equal(again.deduped, undefined, 'must not refuse a page whose row is gone');
  assert.equal(appended.length, 2, 'the re-save writes a fresh row');
});

test('a Ctrl+D re-bookmark also heals after sheet-side deletion', async () => {
  await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });
  tabValues.Test = [];

  await listeners.created('x', { title: 'Alpha', url: 'https://alpha.example/', parentId: '1' });
  await settle(30);

  const { queue } = await chrome.storage.local.get('queue');
  assert.equal(queue.length, 1, 'the native capture is queued instead of refused');
});

test('when the verify read fails, the cache is trusted and nothing duplicates', async () => {
  await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });
  tabValues.Test = [];
  nextStatus = (url) => (url.includes('A2%3AJ') ? 500 : 200); // sheet read breaks

  const again = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });
  assert.equal(again.deduped, true, 'offline fallback refuses rather than risking duplicates');
  assert.equal(appended.length, 1);
});

test('a refresh rebuilds the seen-set from the sheet plus the queue', async () => {
  await chrome.storage.local.set({
    seenUrls: ['https://gone.example', 'https://kept.example', 'https://queued.example'],
    queue: [queuedRow('queued')],
    syncMode: 'manual',
  });
  tabValues.Test = [rowValues({ timestamp: 't', title: 'Kept', browser: 'Chrome', profile: 'Test', os: 'mac', source: 'toolbar', url: 'https://kept.example/' })];

  await send({ type: 'listRows', force: true });

  const { seenUrls } = await chrome.storage.local.get('seenUrls');
  const seen = new Set(seenUrls);
  assert.ok(!seen.has('https://gone.example'), 'deleted row un-learned');
  assert.ok(seen.has('https://kept.example'), 'live row kept');
  assert.ok(seen.has('https://queued.example'), 'queued row survives — it is not in the sheet yet');
});

test('a renamed own tab is followed by id, not recreated', async () => {
  sheetTabs = [{ sheetId: 7, title: 'My Renamed Tab' }];

  await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });

  const appendCall = requests.find((request) => request.url.includes(':append'));
  assert.ok(decodeURIComponent(appendCall.url).includes("'My Renamed Tab'!A:J"));
  assert.ok(!requests.some((request) => request.body?.requests?.[0]?.addSheet), 'no new tab was created');

  const { tabName } = await chrome.storage.local.get('tabName');
  assert.equal(tabName, 'My Renamed Tab', 'the stored display name follows the rename');
});

test('a deleted own tab is recreated rather than lost', async () => {
  sheetTabs = [{ sheetId: 1, title: 'Somebody Else' }]; // our tabId 7 is gone

  await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });

  const addSheet = requests.find((request) => request.body?.requests?.[0]?.addSheet);
  assert.equal(addSheet.body.requests[0].addSheet.properties.title, 'Test');

  const { tabId } = await chrome.storage.local.get('tabId');
  assert.equal(tabId, 55, 'the new tab id replaces the dead one');
  assert.equal(appended.length, 1);
});

// --- Flush concurrency ------------------------------------------------------

const queuedRow = (name) => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  browser: 'Chrome',
  profile: 'Test',
  os: 'macOS',
  title: name.toUpperCase(),
  url: `https://${name}.example/`,
  description: '',
  folder: '',
  source: 'native',
  id: `id-${name}`,
});

test('two flushes entering in the same tick never append a row twice', async () => {
  await chrome.storage.local.set({ queue: [queuedRow('a'), queuedRow('b')] });

  listeners.alarm({ name: 'sync' });
  listeners.alarm({ name: 'sync' });
  await settle(80);

  assert.deepEqual(idsOf().sort(), ['id-a', 'id-b'], 'a queued row was appended more than once');
  const { queue } = await chrome.storage.local.get('queue');
  assert.equal(queue.length, 0, 'the queue should be drained');
});

test('a save racing an alarm flush appends each bookmark exactly once', async () => {
  await Promise.all([
    send({ type: 'saveTab', tab: { title: 'A', url: 'https://a.example/' } }),
    send({ type: 'saveTab', tab: { title: 'B', url: 'https://b.example/' } }),
  ]);
  await send({ type: 'saveTab', tab: { title: 'C', url: 'https://c.example/' } });

  const ids = idsOf();
  assert.equal(new Set(ids).size, ids.length, 'a row was appended more than once');
  assert.deepEqual(urlsOf().sort(), ['https://a.example/', 'https://b.example/', 'https://c.example/']);
});

// --- Connect: create, reuse, choose ----------------------------------------

test('connect with no existing sheet creates one with this install’s tab and imports the tree', async () => {
  await chrome.storage.local.set({ sheetId: '', tabId: null, tabName: '' });
  driveFiles = [];

  const result = await send({ type: 'connect' });

  assert.equal(result.ok, true);
  assert.equal(result.sheetId, 'NEW');
  assert.equal(result.tabName, 'Test', 'tab named after the profile label');
  assert.equal(result.imported, 2);

  const stored = await chrome.storage.local.get(['sheetId', 'tabId', 'importDone']);
  assert.equal(stored.sheetId, 'NEW');
  assert.equal(stored.tabId, 99, 'tab id captured from the create response');
  assert.equal(stored.importDone, true);

  assert.deepEqual(urlsOf().sort(), ['https://alpha.example/', 'https://beta.example/x']);
  const alpha = appended.find((row) => row[COLUMN.url] === 'https://alpha.example/');
  assert.equal(alpha[COLUMN.folder], 'Bookmarks Bar');
  assert.equal(alpha[COLUMN.source], 'import');
  assert.equal(alpha[COLUMN.timestamp], toISTStamp(1700000000000));
});

test('connect reuses the app’s sheet even after the user renamed it', async () => {
  await chrome.storage.local.set({ sheetId: '', tabId: null });
  driveFiles = [{ id: 'EXIST', name: 'My Personal Bookmarks (renamed)' }];

  const result = await send({ type: 'connect' });

  assert.equal(result.sheetId, 'EXIST', 'ownership, not the name, decides reuse');
  const created = requests.some((r) => r.method === 'POST' && /\/v4\/spreadsheets$/.test(r.url.split('?')[0]));
  assert.equal(created, false, 'no duplicate sheet was created');
});

test('connect with several candidate sheets asks the user instead of guessing', async () => {
  await chrome.storage.local.set({ sheetId: '', tabId: null });
  driveFiles = [
    { id: 'A', name: 'SheetBookmark' },
    { id: 'B', name: 'Bookmark Sync (restored)' },
  ];

  const result = await send({ type: 'connect' });

  assert.equal(result.needsChoice, true);
  assert.equal(result.choices.length, 2);
  const { sheetId } = await chrome.storage.local.get('sheetId');
  assert.equal(sheetId, '', 'nothing is committed until the user picks');
});

test('connect honours the user’s sheet choice', async () => {
  await chrome.storage.local.set({ sheetId: '', tabId: null });

  const result = await send({ type: 'connect', choice: 'PICKED' });

  assert.equal(result.ok, true);
  const { sheetId } = await chrome.storage.local.get('sheetId');
  assert.equal(sheetId, 'PICKED');
});

test('a second connect does not re-import the tree', async () => {
  await chrome.storage.local.set({ importDone: true });

  const result = await send({ type: 'connect' });

  assert.equal(result.imported, 0);
  assert.equal(appended.length, 0);
});

// --- Sync modes -------------------------------------------------------------

test('manual mode queues native bookmarks and Sync now drains them', async () => {
  await chrome.storage.local.set({ syncMode: 'manual' });

  await listeners.created('x', { title: 'Gamma', url: 'https://gamma.example/', parentId: '1' });
  await settle(20);
  assert.equal(appended.length, 0, 'nothing must sync on its own in manual mode');

  const { queue } = await chrome.storage.local.get('queue');
  assert.equal(queue.length, 1);

  const result = await send({ type: 'syncNow' });
  assert.equal(result.written, 1);
  assert.equal(urlsOf()[0], 'https://gamma.example/');

  const { lastSyncAt } = await chrome.storage.local.get('lastSyncAt');
  assert.ok(lastSyncAt > 0);
});

test('the toolbar button writes immediately even in manual mode', async () => {
  await chrome.storage.local.set({ syncMode: 'manual' });

  const result = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });
  assert.equal(result.ok, true);
  assert.equal(appended.length, 1, 'an explicit click is an explicit sync');
});

test('setSync reconfigures the alarm', async () => {
  await send({ type: 'setSync', syncMode: '15' });
  assert.equal(alarms.sync.periodInMinutes, 15);

  await send({ type: 'setSync', syncMode: 'manual' });
  assert.equal(alarms.sync, undefined, 'manual mode runs no alarm');

  const bad = await send({ type: 'setSync', syncMode: 'sometimes' });
  assert.equal(bad.ok, false);
});

test('setSync back to instant is accepted and clears the standing alarm (C1 regression)', async () => {
  await send({ type: 'setSync', syncMode: '60' });
  assert.equal(alarms.sync.periodInMinutes, 60);

  const result = await send({ type: 'setSync', syncMode: 'instant' });
  assert.equal(result.ok, true, 'instant must not be rejected as an unknown mode');

  await chrome.storage.local.set({ queue: [] });
  await send({ type: 'setSync', syncMode: 'instant' });
  assert.equal(alarms.sync, undefined, 'no standing interval alarm remains in instant mode');
});

test('a failed second chunk does not re-append the first on retry (F2 regression)', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => queuedRow(`b${i}`));
  await chrome.storage.local.set({ queue: rows, syncMode: 'manual' });

  // First append (chunk 1, 500 rows) lands; second (chunk 2) fails once.
  let appendCalls = 0;
  nextStatus = (url) => {
    if (url.includes(':append')) { appendCalls += 1; return appendCalls === 2 ? 500 : 200; }
    return 200;
  };
  const first = await send({ type: 'syncNow' });
  assert.equal(first.ok, false, 'the batch reports failure when a chunk fails');

  // Retry: only the never-written rows remain queued.
  nextStatus = () => 200;
  await send({ type: 'syncNow' });

  const ids = appended.map((r) => r[COLUMN.id]);
  assert.equal(new Set(ids).size, ids.length, 'no row was appended twice across the failure+retry');
  assert.equal(new Set(ids).size, 600, 'every row landed exactly once');
});

test('the note is written through and the saved row comes back for optimistic display', async () => {
  const result = await send({
    type: 'saveTab',
    tab: { title: 'A', url: 'https://alpha.example/', note: 'my note' },
  });

  const [row] = appended;
  assert.equal(row[COLUMN.note], 'my note');
  assert.equal(result.row.note, 'my note', 'row returned to the popup');
  assert.equal(result.row.tab, 'Test', 'tagged with its sheet tab');
});

test('a note edited mid-flush is re-applied to the sheet, not lost (F3 regression)', async () => {
  // One row waiting; make its append pause so we can edit the note during the flush.
  await chrome.storage.local.set({ queue: [queuedRow('race')], syncMode: 'manual' });
  let resolveAppend;
  const gate = new Promise((r) => (resolveAppend = r));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url.includes(':append')) { await gate; }
    return realFetch(url, init);
  };

  const flushing = send({ type: 'syncNow' });
  await settle(15);
  // While the append is gated, the user edits the queued row's note.
  await send({ type: 'setNote', tab: 'Test', id: 'id-race', note: 'edited during flush' });
  resolveAppend();
  await flushing;
  globalThis.fetch = realFetch;

  const put = requests.find((r) => r.method === 'PUT' && r.body?.values?.[0]?.[0] === 'edited during flush');
  assert.ok(put, 'the edited note is written to its cell after the append');
});

test('setNote finds the row by id and rewrites exactly one cell', async () => {
  tabValues.Test = [
    rowValues({ timestamp: 't1', id: 'row-a', title: 'A', url: 'https://a.example/' }),
    rowValues({ timestamp: 't2', id: 'row-b', title: 'B', url: 'https://b.example/' }),
  ];

  const result = await send({ type: 'setNote', tab: 'Test', id: 'row-b', note: '  remember this  ' });

  assert.equal(result.ok, true);
  assert.equal(result.note, 'remember this', 'trimmed');
  const update = requests.find((r) => r.method === 'PUT' && decodeURIComponent(r.url).includes("'Test'!J3"));
  assert.ok(update, 'PUT lands on the note column of sheet row 3 (header + 2nd data row)');
  assert.deepEqual(update.body.values, [['remember this']]);
});

test('setNote on a row deleted from the sheet fails with a clear message', async () => {
  tabValues.Test = [];
  const result = await send({ type: 'setNote', tab: 'Test', id: 'ghost', note: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer exists/);
});

test('a tab with an outdated header is refused, not scrambled', async () => {
  await chrome.storage.local.set({ sheetId: '', tabId: null, tabName: '' });
  driveFiles = [{ id: 'OLD', name: 'My SheetBookmark Collection' }];
  sheetTabs = [{ sheetId: 7, title: 'Test' }];
  oldHeader = ['timestamp', 'browser', 'profile', 'os', 'title', 'url', 'folder', 'source', 'id'];

  const result = await send({ type: 'connect' });

  assert.equal(result.ok, false);
  assert.match(result.error, /older version/i, 'user gets an actionable message');
  assert.equal(appended.length, 0, 'nothing was written into the misaligned tab');
});

test('instant mode schedules a retry alarm only while the queue is non-empty', async () => {
  delete alarms.sync;

  // A failed flush leaves the row queued → the retry alarm must exist.
  await chrome.storage.session.clear();
  const original = chrome.identity.launchWebAuthFlow;
  chrome.identity.launchWebAuthFlow = async () => {
    throw new Error('User interaction required.');
  };
  await send({ type: 'saveTab', tab: { title: 'A', url: 'https://a.example/' } });
  assert.equal(alarms.sync?.periodInMinutes, 1, 'retry alarm scheduled while a row waits');

  // Sign-in returns, queue drains → the alarm is cleared: zero idle wakeups.
  chrome.identity.launchWebAuthFlow = original;
  await send({ type: 'authorize' });
  await settle(30);
  assert.equal(alarms.sync, undefined, 'no standing alarm once the queue is empty');
});

// --- Sheet → browser import -------------------------------------------------

test('importFromSheet copies only foreign, missing, safe bookmarks into a folder', async () => {
  sheetTabs = [
    { sheetId: 7, title: 'Test' },
    { sheetId: 8, title: 'Firefox — Laptop' },
  ];
  tabValues = {
    Test: [rowValues({ timestamp: 't', title: 'Mine', browser: 'Chrome', profile: 'Test', os: 'mac', source: 'toolbar', url: 'https://mine.example/' })],
    'Firefox — Laptop': [
      rowValues({ timestamp: 't', title: 'Alpha', browser: 'Firefox', profile: 'FF', os: 'linux', source: 'native', url: 'https://alpha.example/' }), // already in local tree
      rowValues({ timestamp: 't', title: 'Fresh', browser: 'Firefox', profile: 'FF', os: 'linux', source: 'native', url: 'https://fresh.example/' }),
      rowValues({ timestamp: 't', title: 'Evil', browser: 'Firefox', profile: 'FF', os: 'linux', source: 'native', url: 'javascript:alert(1)' }), // must never become a bookmark
    ],
  };

  const result = await send({ type: 'importFromSheet' });

  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);

  const [folder, bookmark] = createdBookmarks;
  assert.equal(folder.title, 'SheetBookmark');
  assert.equal(folder.url, undefined, 'first creation is the folder');
  assert.equal(bookmark.url, 'https://fresh.example/');
  assert.equal(bookmark.parentId, 'bm1');
  assert.equal(createdBookmarks.length, 2, 'nothing else was created');

  // No echo: the imported bookmark firing onCreated must not be pushed back to the sheet.
  await listeners.created('y', { title: 'Fresh', url: 'https://fresh.example/', parentId: 'bm1' });
  await settle(20);
  assert.equal(appended.length, 0);
});

test('an imported bookmark’s onCreated echo is suppressed, not re-queued (F1 regression)', async () => {
  sheetTabs = [
    { sheetId: 7, title: 'Test' },
    { sheetId: 8, title: 'Firefox — Laptop' },
  ];
  tabValues = {
    'Firefox — Laptop': [rowValues({ timestamp: 't', id: 'f1', title: 'Fresh', url: 'https://fresh.example/' })],
  };

  const imported = await send({ type: 'importFromSheet' });
  assert.equal(imported.imported, 1);

  // The folder + bookmark creation fire onCreated for the imported URL.
  await listeners.created('x', { title: 'Fresh', url: 'https://fresh.example/', parentId: 'bm1' });
  await settle(30);

  const { queue } = await chrome.storage.local.get('queue');
  assert.equal((queue ?? []).length, 0, 'the echo must NOT enter this install’s upload queue');
  assert.equal(appended.length, 0, 'and must never be appended to the own tab');
});

test('importFromSheet reuses an existing Bookmark Sync folder', async () => {
  bookmarkSearchResults = [{ id: 'existing-folder', title: 'SheetBookmark' }];
  sheetTabs = [
    { sheetId: 7, title: 'Test' },
    { sheetId: 8, title: 'Edge' },
  ];
  tabValues = { Edge: [rowValues({ timestamp: 't', title: 'New', browser: 'Edge', profile: 'E', os: 'win', source: 'native', url: 'https://new.example/' })] };

  const result = await send({ type: 'importFromSheet' });

  assert.equal(result.imported, 1);
  assert.equal(createdBookmarks.length, 1, 'no second folder');
  assert.equal(createdBookmarks[0].parentId, 'existing-folder');
});

// --- Status, auth, disconnect ----------------------------------------------

test('a toolbar save never leaves a one-row collapsed cache (F7 regression)', async () => {
  // Popup had loaded the full list; the cache holds it.
  await store_setCache([
    fromValues(rowValues({ timestamp: 't', id: 'old1', title: 'Old one', url: 'https://old1.example/' })),
    fromValues(rowValues({ timestamp: 't', id: 'old2', title: 'Old two', url: 'https://old2.example/' })),
  ]);

  await send({ type: 'saveTab', tab: { title: 'New', url: 'https://new.example/' } });

  // The flush wipes the cache; the reseed must NOT rebuild it as just the new row.
  const { rowCache } = await chrome.storage.local.get('rowCache');
  const cached = rowCache?.rows ?? [];
  assert.ok(
    !(cached.length === 1 && cached[0].url === 'https://new.example/'),
    'the cached list must not collapse to only the just-saved bookmark',
  );
});

test('status reports the sync mode, tab and queue', async () => {
  await chrome.storage.local.set({ syncMode: '60', lastSyncAt: 123 });

  const status = await send({ type: 'status' });

  assert.equal(status.connected, true);
  assert.equal(status.syncMode, '60');
  assert.equal(status.tabName, 'Test');
  assert.equal(status.lastSyncAt, 123);
  assert.equal(status.queued, 0);
});

test('a 401 invalidates the token, re-authorizes, and retries the write', async () => {
  nextStatus = (url, index) => (index === 0 ? 401 : 200);

  const result = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });

  assert.equal(result.ok, true);
  assert.equal(requests[0].auth, 'Bearer good', 'first attempt uses the cached token');
  assert.equal(requests[1].auth, 'Bearer fresh', 'retry uses a token minted by launchWebAuthFlow');
  assert.equal(appended.length, 1);
});

test('deleting the whole sheet in Drive drops the connection but keeps the bookmark queued', async () => {
  nextStatus = (url, index) => (index <= 1 ? 404 : 200); // listTabs 404, then sheetExists 404

  const result = await send({ type: 'saveTab', tab: { title: 'A', url: 'https://alpha.example/' } });

  assert.equal(result.ok, true);
  assert.equal(result.queued, true, 'the save is honest: kept, will sync after reconnect');
  const { sheetId, queue } = await chrome.storage.local.get(['sheetId', 'queue']);
  assert.equal(sheetId, '', 'dead connection cleared so the UI offers Connect again');
  assert.equal(queue.length, 1, 'nothing lost');
});

test('an offline toolbar save reports Saved-will-sync, never failure', async () => {
  throwNetwork = 5;

  const result = await send({ type: 'saveTab', tab: { title: 'A', url: 'https://alpha.example/' } });

  assert.equal(result.ok, true);
  assert.equal(result.queued, true);
  assert.equal(result.row.url, 'https://alpha.example/', 'row returned for optimistic display');
  const { queue } = await chrome.storage.local.get('queue');
  assert.equal(queue.length, 1);
});

test('editing the note of a row still in the upload queue edits the queue, no network', async () => {
  await chrome.storage.local.set({ queue: [queuedRow('pending')] });

  const result = await send({ type: 'setNote', tab: 'Test', id: 'id-pending', note: '  fresh note  ' });

  assert.equal(result.ok, true);
  assert.equal(result.note, 'fresh note');
  const { queue } = await chrome.storage.local.get('queue');
  assert.equal(queue[0].note, 'fresh note', 'queued row carries the note into its eventual flush');
  assert.equal(requests.length, 0, 'no API call was needed');
});

test('a 429 surfaces as a friendly queued-and-retrying message', async () => {
  nextStatus = () => 429;
  errorBody = { error: { message: 'Rate limit exceeded' } };

  const result = await send({ type: 'listRows', force: true });

  assert.equal(result.ok, false);
  assert.match(result.error, /rate limit.*sync automatically/i);
});

test('a consent where the checkbox was skipped is rejected with usable guidance', async () => {
  await chrome.storage.session.clear();
  const original = chrome.identity.launchWebAuthFlow;
  // Google "succeeds" but grants no scope — exactly what happens when the user
  // presses Continue without ticking the checkbox.
  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    const state = new URL(url).searchParams.get('state');
    return `https://ext.chromiumapp.org/#access_token=scopeless&expires_in=3600&state=${state}`;
  };

  try {
    const result = await send({ type: 'authorize' });
    assert.equal(result.ok, false);
    assert.match(result.error, /tick the checkbox/i, 'tells the user exactly what to do');

    const { accessToken } = await chrome.storage.session.get('accessToken');
    assert.equal(accessToken, undefined, 'a scopeless token is never cached');
  } finally {
    chrome.identity.launchWebAuthFlow = original;
  }
});

test('a 403 insufficient-scope response invalidates the token and asks to sign in again', async () => {
  errorBody = { error: { message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } };
  nextStatus = (url, index) => (index === 0 ? 403 : 200);

  const result = await send({ type: 'saveTab', tab: { title: 'A', url: 'https://alpha.example/' } });

  assert.equal(result.ok, false);
  assert.equal(result.needsAuth, true, 'surfaces as a sign-in prompt, not a dead-end error');
  assert.match(result.error, /sign in again/i);
  const { accessToken } = await chrome.storage.session.get('accessToken');
  assert.equal(accessToken, undefined, 'stale-scope token dropped');
  const { queue } = await chrome.storage.local.get('queue');
  assert.equal(queue.length, 1, 'the bookmark survives for after re-auth');
});

test('when sign-in fails the row stays queued and the badge is raised', async () => {
  await chrome.storage.session.clear();
  const original = chrome.identity.launchWebAuthFlow;
  chrome.identity.launchWebAuthFlow = async () => {
    throw new Error('User interaction required.');
  };

  try {
    const result = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });

    assert.equal(result.ok, false);
    assert.equal(result.needsAuth, true);
    assert.equal(appended.length, 0);

    const { queue, needsAuth } = await chrome.storage.local.get(['queue', 'needsAuth']);
    assert.equal(queue.length, 1, 'the bookmark must survive to be written after sign-in');
    assert.equal(needsAuth, true);
  } finally {
    chrome.identity.launchWebAuthFlow = original;
  }
});

test('disconnect clears the connection but keeps preferences', async () => {
  await chrome.storage.local.set({ importDone: true, syncMode: '15' });

  const result = await send({ type: 'disconnect' });

  assert.equal(result.ok, true);
  const stored = await chrome.storage.local.get(['sheetId', 'tabId', 'profileLabel', 'importDone', 'syncMode']);
  assert.equal(stored.sheetId, '');
  assert.equal(stored.tabId, null);
  assert.equal(stored.profileLabel, 'Test', 'the profile label survives sign-out');
  assert.equal(stored.importDone, true);
  assert.equal(stored.syncMode, '15');

  const { accessToken } = await chrome.storage.session.get('accessToken');
  assert.equal(accessToken, undefined, 'the cached token is dropped');
});
