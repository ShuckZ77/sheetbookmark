import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLUMNS,
  SheetsError,
  appendRows,
  ensureOwnTab,
  findAppSheets,
  readAllTabs,
  readTabRows,
  resolveTabTitle,
  sanitizeTabTitle,
} from '../src/lib/sheets.js';

// browser.js reaches for the extension API at import time, so stand one up before loading
// it or anything downstream of it.
globalThis.chrome = { storage: { local: {}, session: {} }, runtime: {} };
const { flattenTree, isSyncable } = await import('../src/lib/browser.js');
const { normalizeUrl } = await import('../src/lib/store.js');
const { toGoogleRedirectUri } = await import('../src/lib/auth.js');

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const reply = responder(url, calls.length) ?? {};
    const payload = reply.body ?? {};
    return {
      ok: reply.status === undefined || reply.status < 400,
      status: reply.status ?? 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return calls;
}

// --- URL normalisation ------------------------------------------------------

test('normalizeUrl collapses variants of the same page', () => {
  const canonical = 'https://example.com/post';

  assert.equal(normalizeUrl('https://www.example.com/post'), canonical);
  assert.equal(normalizeUrl('https://EXAMPLE.com/post#section-2'), canonical);
  assert.equal(normalizeUrl('https://example.com:443/post'), canonical);
  assert.equal(normalizeUrl('https://example.com/post?utm_source=news&utm_medium=email'), canonical);
  assert.equal(normalizeUrl('https://example.com/post?fbclid=abc&gclid=def'), canonical);
});

test('normalizeUrl keeps meaningful differences', () => {
  assert.notEqual(normalizeUrl('https://example.com/a'), normalizeUrl('https://example.com/b'));
  assert.notEqual(normalizeUrl('http://example.com/a'), normalizeUrl('https://example.com/a'));
  assert.equal(normalizeUrl('https://example.com/s?q=cats'), 'https://example.com/s?q=cats');
  assert.equal(normalizeUrl('https://example.com/s?b=2&a=1'), normalizeUrl('https://example.com/s?a=1&b=2'));
});

test('normalizeUrl strips the trailing slash only on a bare root', () => {
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com/docs/'), 'https://example.com/docs/');
});

test('normalizeUrl survives input that is not a URL', () => {
  assert.equal(normalizeUrl('  NoT a Url '), 'not a url');
  assert.equal(normalizeUrl(undefined), '');
});

// --- Bookmark tree ----------------------------------------------------------

test('isSyncable rejects non-web bookmarks', () => {
  assert.ok(isSyncable('https://example.com'));
  assert.ok(isSyncable('http://example.com'));
  assert.ok(!isSyncable('javascript:alert(1)'));
  assert.ok(!isSyncable('place:folder=TOOLBAR'));
  assert.ok(!isSyncable('chrome://bookmarks'));
  assert.ok(!isSyncable(undefined));
});

test('flattenTree records folder paths and drops folders themselves', () => {
  const tree = [
    {
      title: '',
      children: [
        {
          title: 'Bookmarks Bar',
          children: [
            { title: 'Anthropic', url: 'https://anthropic.com', dateAdded: 1 },
            { title: 'Reading', children: [{ title: 'Post', url: 'https://example.com/post', dateAdded: 2 }] },
          ],
        },
        { title: 'Other Bookmarks', children: [{ title: 'Bad', url: 'javascript:void 0' }] },
      ],
    },
  ];

  assert.deepEqual(flattenTree(tree), [
    { title: 'Anthropic', url: 'https://anthropic.com', folder: 'Bookmarks Bar', dateAdded: 1 },
    { title: 'Post', url: 'https://example.com/post', folder: 'Bookmarks Bar / Reading', dateAdded: 2 },
  ]);
});

// --- OAuth redirect ---------------------------------------------------------

test('toGoogleRedirectUri passes a Chromium redirect through untouched', () => {
  const chromium = 'https://mgnpkeagoiicjmpmldlfjhpbkkjgcfnb.chromiumapp.org/';
  assert.equal(toGoogleRedirectUri(chromium), chromium);
});

test('toGoogleRedirectUri rewrites a Firefox redirect to the loopback form', () => {
  assert.equal(
    toGoogleRedirectUri('https://a1b2c3d4e5.extensions.allizom.org/'),
    'http://127.0.0.1/mozoauth2/a1b2c3d4e5',
  );
});

// --- Manifest coverage ------------------------------------------------------

test('every API host the code calls is covered by host_permissions', async () => {
  // A mocked fetch cannot catch a missing host permission, but a real browser blocks the
  // request outright. Adding the Drive API without its origin was exactly that bug.
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../src/lib/sheets.js', import.meta.url), 'utf8');

  const origins = new Set([...source.matchAll(/'(https:\/\/[^/']+)/g)].map((m) => m[1]));
  assert.ok(origins.size >= 2, 'expected both the Sheets and Drive hosts in sheets.js');

  const granted = manifest.host_permissions.map((pattern) => pattern.replace(/\/\*$/, ''));
  for (const origin of origins) {
    assert.ok(granted.includes(origin), `${origin} is called but not in host_permissions`);
  }
});

// --- Error journal ----------------------------------------------------------

test('logError scrubs URLs and tokens and caps the journal at 50', async () => {
  const data = new Map();
  globalThis.chrome.storage.local = {
    get: async (key) => (data.has(key) ? { [key]: data.get(key) } : {}),
    set: async (patch) => Object.entries(patch).forEach(([k, v]) => data.set(k, v)),
  };
  const { logError, getErrorLog } = await import('../src/lib/store.js');

  await logError('sync', new Error('failed for https://secret.example/私 with ya29.abc-DEF token'));
  for (let i = 0; i < 60; i += 1) await logError('loop', `err ${i}`);

  const log = await getErrorLog();
  assert.equal(log.length, 50, 'journal is capped');
  assert.equal(log[log.length - 1].message, 'err 59', 'newest entries survive');

  const first = JSON.stringify(log);
  assert.ok(!first.includes('secret.example'), 'URLs scrubbed');
  assert.ok(!first.includes('ya29.abc'), 'token-shaped strings scrubbed');
});

// --- Tab titles -------------------------------------------------------------

test('sanitizeTabTitle strips characters Sheets rejects and caps length', () => {
  assert.equal(sanitizeTabTitle('Chrome — MacBook'), 'Chrome — MacBook');
  assert.equal(sanitizeTabTitle('Work[1]: */?\\test'), 'Work 1 test');
  assert.equal(sanitizeTabTitle('   '), 'My browser');
  assert.equal(sanitizeTabTitle(undefined), 'My browser');
  assert.equal(sanitizeTabTitle('x'.repeat(200)).length, 80);
});

// --- Drive lookup -----------------------------------------------------------

test('findAppSheets queries by ownership, never by name', async () => {
  const calls = stubFetch(() => ({ body: { files: [{ id: 'A', name: 'Renamed by user' }] } }));

  const sheets = await findAppSheets('tok');
  assert.equal(sheets[0].id, 'A');
  assert.ok(calls[0].url.includes('drive/v3/files?'));
  // fields=files(id,name,…) legitimately mentions "name"; the q= FILTER must not.
  const query = new URL(calls[0].url).searchParams.get('q');
  assert.ok(!query.includes('name'), 'a name filter would break rename-proof reuse');
});

// --- Tabs -------------------------------------------------------------------

const TABS_META = { sheets: [{ properties: { sheetId: 7, title: 'Chrome — Mac' } }] };

test('ensureOwnTab adopts an existing tab with the wanted title', async () => {
  const calls = stubFetch((url) => {
    if (url.includes('fields=sheets.properties')) return { body: TABS_META };
    return { body: { values: [COLUMNS] } }; // header already present
  });

  const tab = await ensureOwnTab('tok', 'SHEET', 'Chrome — Mac');
  assert.deepEqual(tab, { tabId: 7, title: 'Chrome — Mac' });
  assert.ok(!calls.some((call) => call.body?.requests), 'no addSheet when the tab exists');
});

test('ensureOwnTab creates the tab and its header when missing', async () => {
  const calls = stubFetch((url, index) => {
    if (url.includes('fields=sheets.properties')) return { body: TABS_META };
    if (url.includes(':batchUpdate')) {
      return { body: { replies: [{ addSheet: { properties: { sheetId: 55, title: 'Firefox — Linux' } } }] } };
    }
    if (url.includes('A1%3AJ1')) return { body: {} }; // no header yet
    return { body: {} };
  });

  const tab = await ensureOwnTab('tok', 'SHEET', 'Firefox — Linux');
  assert.deepEqual(tab, { tabId: 55, title: 'Firefox — Linux' });

  const headerWrite = calls.find((call) => call.init.method === 'PUT');
  assert.deepEqual(headerWrite.body.values[0], COLUMNS);
});

test('resolveTabTitle follows renames by id and reports deletion as null', async () => {
  stubFetch(() => ({ body: TABS_META }));
  assert.equal(await resolveTabTitle('tok', 'SHEET', 7), 'Chrome — Mac');
  assert.equal(await resolveTabTitle('tok', 'SHEET', 99), null);
});

// --- Values -----------------------------------------------------------------

test('appendRows chunks at 500 and posts RAW values in column order', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  const rows = Array.from({ length: 501 }, (_, index) => ({
    timestamp: `t${index}`,
    browser: 'Chrome',
    profile: 'Work',
    os: 'macOS',
    title: `Title ${index}`,
    url: `https://example.com/${index}`,
    description: '',
    folder: '',
    source: 'toolbar',
    id: `id-${index}`,
  }));

  await appendRows('tok', 'SHEET', 'Chrome — Mac', rows);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.values.length, 500);
  assert.equal(calls[1].body.values.length, 1);
  assert.ok(calls[0].url.includes('valueInputOption=RAW'), 'formulas must not be evaluated');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  // Explicit order assertion: stable core (A–I), then the extension tail.
  assert.deepEqual(calls[1].body.values[0], [
    't500',
    'id-500',
    '',
    'Chrome',
    'Work',
    'macOS',
    'toolbar',
    'Title 500',
    'https://example.com/500',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
});

test('appendRows escapes a tab name containing a quote', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  await appendRows('tok', 'SHEET', "Rishi's tab", [{ url: 'https://example.com' }]);
  assert.ok(calls[0].url.includes(encodeURIComponent("'Rishi''s tab'!A:O")));
});

test('readTabRows maps positional cells onto column names', async () => {
  stubFetch(() => ({
    body: { values: [['2026-01-01T00:00:00.000Z', 'x1', '', 'Firefox', 'Home', 'Linux', 'native', 'T', 'https://x.dev']] },
  }));

  const [row] = await readTabRows('tok', 'SHEET', 'Bookmarks');
  assert.equal(row.timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(row.browser, 'Firefox');
  assert.equal(row.url, 'https://x.dev');
  assert.equal(row.folder, '', 'missing trailing cells become empty strings');
  assert.equal(Object.keys(row).length, COLUMNS.length);
});

test('readAllTabs pairs each tab with its rows in two requests', async () => {
  const calls = stubFetch((url) => {
    if (url.includes('fields=sheets.properties')) {
      return {
        body: {
          sheets: [
            { properties: { sheetId: 7, title: 'Chrome' } },
            { properties: { sheetId: 8, title: 'Firefox' } },
          ],
        },
      };
    }
    return {
      body: {
        valueRanges: [
          { values: [['t', 'a1', '', 'Chrome', 'W', 'mac', 'toolbar', 'A', 'https://a.dev']] },
          { values: [] },
        ],
      },
    };
  });

  const tabs = await readAllTabs('tok', 'SHEET');
  assert.equal(calls.length, 2, 'one metadata call plus one batchGet');
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].tabId, 7);
  assert.equal(tabs[0].rows[0].url, 'https://a.dev');
  assert.deepEqual(tabs[1].rows, []);
});

test('a rejected token surfaces as a 401 SheetsError', async () => {
  stubFetch(() => ({ status: 401, body: { error: { message: 'Invalid Credentials' } } }));

  await assert.rejects(
    () => readTabRows('stale', 'SHEET', 'Bookmarks'),
    (error) => {
      assert.ok(error instanceof SheetsError);
      assert.equal(error.status, 401);
      return true;
    },
  );
});
