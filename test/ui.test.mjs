/**
 * Boots the real popup.js and options.js against the DOM harness. These entry points are
 * never loaded by the background tests; this confirms their init() runs end to end —
 * parsing each page's actual HTML, wiring handlers, rendering rows — without throwing.
 *
 * This file exercises a *configured* build. test/publisher.test.mjs covers the other
 * branch (no client id), which needs its own process because config.js reads the id once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { freshImport, installGlobals, settle } from './dom-harness.mjs';

// Must be set before anything imports config.js.
globalThis.__BOOKMARK_CLIENT_ID__ = 'test-client.apps.googleusercontent.com';

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ui');
const page = (name) => readFileSync(path.join(uiDir, name), 'utf8');
const script = (name) => freshImport(path.join(uiDir, name));

test('options.js offers the Connect button and sync controls when not yet connected', async () => {
  installGlobals(page('options.html'), { status: { ok: true, connected: false } });

  await script('options.js');
  await settle();

  const doc = globalThis.document;
  assert.equal(doc.getElementById('unconfigured').classList.contains('hidden'), true, 'build has a client id');
  assert.equal(doc.getElementById('connect').disabled, false, 'Connect is clickable');
  assert.equal(doc.getElementById('disconnected-state').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('connected-state').classList.contains('hidden'), true);

  // The whole point of the redesign: users are asked for none of this any more.
  assert.equal(doc.getElementById('client-id'), null, 'no client id field');
  assert.equal(doc.getElementById('sheet'), null, 'no sheet URL field');

  assert.equal(doc.getElementById('sync-mode').value, 'instant', 'default cadence pre-selected');
  assert.equal(typeof doc.getElementById('sync-mode').onchange, 'function', 'cadence change wired');
  assert.equal(doc.getElementById('sync-now').disabled, true, 'sync tools parked until connected');
  assert.equal(doc.getElementById('profile').placeholder, 'Chrome — macOS', 'label pre-filled from UA + platform');
  for (const id of ['connect', 'disconnect', 'open-sheet', 'sync-now', 'import-others', 'reset']) {
    assert.equal(typeof doc.getElementById(id).onclick, 'function', `${id} handler wired`);
  }
});

test('options.js shows the connected state and this install’s tab name', async () => {
  installGlobals(page('options.html'), {
    status: { ok: true, connected: true, needsAuth: false, sheetId: 'SHEET', tabName: 'Chrome — MacBook' },
  });

  await script('options.js');
  await settle();

  const doc = globalThis.document;
  assert.equal(doc.getElementById('connected-state').classList.contains('hidden'), false, 'connected panel shown');
  assert.equal(doc.getElementById('disconnected-state').classList.contains('hidden'), true, 'Connect button hidden');
  assert.equal(doc.getElementById('tab-name').textContent, 'Chrome — MacBook', 'own tab surfaced to the user');
  assert.equal(doc.getElementById('sync-now').disabled, false, 'sync tools unlocked');
});

test('popup.js renders rows from the sheet and wires its controls', async () => {
  const rows = [
    {
      timestamp: '2026-07-01T10:00:00.000Z',
      browser: 'Chrome',
      profile: 'Work — Chrome',
      title: 'Anthropic',
      url: 'https://anthropic.com',
      folder: '',
    },
    {
      timestamp: '2026-06-20T10:00:00.000Z',
      browser: 'Firefox',
      profile: 'Home — Firefox',
      title: 'MDN',
      url: 'https://developer.mozilla.org',
      folder: '',
    },
  ];
  const status = { ok: true, connected: true, needsAuth: false, profile: 'Work — Chrome', sheetId: 'SHEET', queued: 0 };
  const { messages } = installGlobals(page('popup.html'), { status, rows });

  await script('popup.js');
  await settle(40);

  const doc = globalThis.document;
  assert.ok(messages.some((m) => m.type === 'status'), 'asked background for status');
  assert.ok(messages.some((m) => m.type === 'listRows'), 'requested rows');
  assert.equal(doc.getElementById('profile-label').textContent, 'Work — Chrome');
  assert.equal(doc.getElementById('list').children.length, 2, 'both bookmarks rendered');
  assert.equal(doc.getElementById('main').classList.contains('hidden'), false, 'main panel visible');
  assert.equal(typeof doc.getElementById('save-tab').onclick, 'function', 'save handler wired');
  assert.equal(typeof doc.getElementById('search').oninput, 'function', 'search handler wired');
  assert.match(doc.getElementById('count').textContent, /2 saved/);
});

test('an expired session shows the amber pill and a Sign-in-again button in place', async () => {
  installGlobals(page('options.html'), {
    status: { ok: true, connected: true, needsAuth: true, sheetId: 'S', tabName: 'Chrome — Mac' },
  });

  await script('options.js');
  await settle();

  const doc = globalThis.document;
  assert.equal(doc.getElementById('conn-pill').textContent, 'Signed out');
  assert.ok(doc.getElementById('conn-pill').className.includes('warn'));
  assert.equal(doc.getElementById('reauth').classList.contains('hidden'), false, 'recovery button is right there');
  assert.equal(typeof doc.getElementById('reauth').onclick, 'function');
});

test('an install that synced before offers to REconnect, not connect', async () => {
  const ctx = installGlobals(page('options.html'), { status: { ok: true, connected: false } });
  ctx.store.set('tabName', 'Chrome — Mac');

  await script('options.js');
  await settle();

  assert.equal(globalThis.document.getElementById('connect-label').textContent, 'Reconnect Google Sheets');
});

test('Copy diagnostics assembles version, environment and settings', async () => {
  const ctx = installGlobals(page('options.html'), { status: { ok: true, connected: true, tabName: 'T' } });
  ctx.store.set('syncMode', 'instant');

  await script('options.js');
  await settle();

  const doc = globalThis.document;
  assert.equal(typeof doc.getElementById('report-issue').onclick, 'function', 'issue button wired');
  await doc.getElementById('copy-diag').onclick();

  assert.match(ctx.clipboard, /SheetBookmark v1\.0\.0 — Chrome · macOS/);
  assert.match(ctx.clipboard, /sync: instant/);
  assert.match(ctx.clipboard, /recent errors: none/);
});

test('the note field pre-fills on open and the user\'s edit is what gets saved', async () => {
  const status = { ok: true, connected: true, needsAuth: false, profile: 'W', sheetId: 'S', queued: 0 };
  const { messages } = installGlobals(page('popup.html'), { status, rows: [] });

  await script('popup.js');
  await settle(40);

  const doc = globalThis.document;
  assert.equal(doc.getElementById('note').value, 'A sample description', 'pre-filled from the page');

  doc.getElementById('note').value = 'my own words';
  await doc.getElementById('save-tab').onclick();

  const save = messages.find((m) => m.type === 'saveTab');
  assert.equal(save.tab.note, 'my own words', 'the edited note wins');
});

test('the per-row pencil opens a single editor and saves via setNote', async () => {
  const rows = [
    { timestamp: '2026-07-01T10:00:00+05:30', id: 'r1', tab: 'Chrome — Mac', browser: 'Chrome', profile: 'W', title: 'A', url: 'https://a.dev', note: '' },
    { timestamp: '2026-06-01T10:00:00+05:30', id: 'r2', tab: 'Chrome — Mac', browser: 'Chrome', profile: 'W', title: 'B', url: 'https://b.dev', note: 'old' },
  ];
  const status = { ok: true, connected: true, needsAuth: false, profile: 'W', sheetId: 'S', queued: 0 };
  const { messages } = installGlobals(page('popup.html'), { status, rows });

  await script('popup.js');
  await settle(40);

  const doc = globalThis.document;
  const list = doc.getElementById('list');
  const firstRow = list.children[0];
  const pencil = firstRow.children[0].children[1]; // row-line > [row-btn, note-btn]
  assert.equal(pencil.textContent, '✎');

  pencil.onclick();
  const editor = firstRow.children[1];
  assert.equal(editor.className, 'note-editor', 'editor appears inside the row');

  const [input, saveBtn] = editor.children;
  input.value = 'fresh note';
  await saveBtn.onclick();

  const sent = messages.find((m) => m.type === 'setNote');
  assert.equal(sent.id, 'r1');
  assert.equal(sent.tab, 'Chrome — Mac');
  assert.equal(sent.note, 'fresh note');
});

test('the save button reads Already saved when the page is in the sheet', async () => {
  const status = { ok: true, connected: true, needsAuth: false, profile: 'W', sheetId: 'S', queued: 0 };
  const ctx = installGlobals(page('popup.html'), { status, rows: [] });
  ctx.savedState = true;

  await script('popup.js');
  await settle(40);

  const doc = globalThis.document;
  assert.equal(doc.getElementById('save-label').textContent, '✓ Already saved');
  assert.equal(doc.getElementById('save-tab').classList.contains('is-saved'), true);
  assert.equal(typeof doc.getElementById('save-tab').onclick, 'function', 'still clickable — a click verifies and can heal');
});

test('popup.js shows the setup notice when not connected', async () => {
  installGlobals(page('popup.html'), { status: { ok: true, connected: false } });

  await script('popup.js');
  await settle();

  const doc = globalThis.document;
  assert.equal(doc.getElementById('notice').classList.contains('hidden'), false, 'setup notice visible');
  assert.equal(doc.getElementById('main').classList.contains('hidden'), true, 'main panel stays hidden');
  assert.equal(typeof doc.getElementById('notice-action').onclick, 'function', 'setup CTA wired');
});
