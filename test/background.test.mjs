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
      if (keys == null) return Object.fromEntries(data);
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => data.has(key)).map((key) => [key, data.get(key)]));
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
let historyVisits = {};

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
  history: { getVisits: async ({ url }) => historyVisits[url] ?? [] },
  identity: {
    getRedirectURL: () => 'https://ext.chromiumapp.org/',
    launchWebAuthFlow: async ({ url }) => {
      const state = new URL(url).searchParams.get('state');
      return `https://ext.chromiumapp.org/#access_token=fresh&expires_in=3600&state=${state}`;
    },
  },
};

globalThis.chrome = chrome;
// The OAuth client id is baked at build time; inject one so getToken doesn't short-circuit.
globalThis.__BOOKMARK_CLIENT_ID__ = 'test-client.apps.googleusercontent.com';
await import('../src/background.js');
const { toISTStamp } = await import('../src/lib/store.js');

const HEADER_ORDER = ['timestamp', 'id', 'folder', 'browser', 'profile', 'os', 'source', 'title', 'url', 'description', 'site', 'reading', 'visits', 'last_visit', 'account'];
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

function installFetch() {
  appended = [];
  requests = [];
  nextStatus = () => 200;
  driveFiles = [];
  sheetTabs = [{ sheetId: 7, title: 'Test' }];
  tabValues = {};
  createdBookmarks = [];
  bookmarkSearchResults = [];
  historyVisits = {};

  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const status = nextStatus(url, requests.length);
    requests.push({ url, method, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined });

    await new Promise((resolve) => setTimeout(resolve, 8)); // let callers interleave

    const reply = (body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (status >= 400) return reply({ error: { message: 'nope' } });

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
    if (url.includes('A1%3AO1')) return reply({ values: [HEADER] }); // header already present
    if (url.includes(':append')) {
      appended.push(...JSON.parse(init.body).values);
      return reply({});
    }
    if (url.includes('A2%3AO')) {
      const title = decodeURIComponent(url).match(/values\/'(.+)'!A2:O/)?.[1] ?? '';
      return reply({ values: tabValues[title] ?? [] });
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

// --- Capture and flush ------------------------------------------------------

test('saveTab appends one fully-populated row into this install’s own tab', async () => {
  const result = await send({ type: 'saveTab', tab: { title: 'Alpha', url: 'https://alpha.example/' } });

  assert.equal(result.ok, true);
  assert.equal(appended.length, 1);

  const appendCall = requests.find((request) => request.url.includes(':append'));
  assert.ok(decodeURIComponent(appendCall.url).includes("'Test'!A:O"), 'row must land in the install’s own tab');

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
  nextStatus = (url) => (url.includes('A2%3AO') ? 500 : 200); // sheet read breaks

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
  assert.ok(decodeURIComponent(appendCall.url).includes("'My Renamed Tab'!A:O"));
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

test('visit stats land in the row only when the user enabled them', async () => {
  historyVisits['https://alpha.example/'] = [{ visitTime: 1700000000000 }, { visitTime: 1700000500000 }];

  // Off by default: columns stay empty even though history has data.
  await send({ type: 'saveTab', tab: { title: 'A', url: 'https://alpha.example/' } });
  assert.equal(appended[0][COLUMN.visits], '', 'no history read without the opt-in');

  await chrome.storage.local.set({ syncMode: 'instant', visitStats: true, seenUrls: [] });
  await send({ type: 'saveTab', tab: { title: 'B', url: 'https://alpha.example/' } });

  const row = appended[1];
  assert.equal(row[COLUMN.visits], '2');
  assert.equal(row[COLUMN.last_visit], toISTStamp(1700000500000), 'latest visit, in IST');
});

test('toolbar extras (site, reading, account) are written through', async () => {
  await send({
    type: 'saveTab',
    tab: { title: 'A', url: 'https://alpha.example/', description: 'd', site: 'The Verge', reading: '7 min', account: 'yes' },
  });

  const [row] = appended;
  assert.equal(row[COLUMN.site], 'The Verge');
  assert.equal(row[COLUMN.reading], '7 min');
  assert.equal(row[COLUMN.account], 'yes');
  assert.equal(row[COLUMN.description], 'd');
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
