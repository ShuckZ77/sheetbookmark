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
  assert.equal(doc.getElementById('step-connect').textContent, '1', 'step 1 not yet done');
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
  assert.equal(doc.getElementById('step-connect').textContent, '✓', 'step 1 shows done');
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

test('popup.js shows the setup notice when not connected', async () => {
  installGlobals(page('popup.html'), { status: { ok: true, connected: false } });

  await script('popup.js');
  await settle();

  const doc = globalThis.document;
  assert.equal(doc.getElementById('notice').classList.contains('hidden'), false, 'setup notice visible');
  assert.equal(doc.getElementById('main').classList.contains('hidden'), true, 'main panel stays hidden');
  assert.equal(typeof doc.getElementById('notice-action').onclick, 'function', 'setup CTA wired');
});
