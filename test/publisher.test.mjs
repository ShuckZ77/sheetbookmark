/**
 * The publisher branch: a build with no OAuth client id baked in. config.js reads the id
 * once at module load, so this needs its own process — hence a separate file, and no
 * __BOOKMARK_CLIENT_ID__ injected here.
 *
 * This is the first screen the publisher sees, and the only place the Firefox redirect URI
 * can be discovered, so it is worth locking down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { freshImport, installGlobals, settle } from './dom-harness.mjs';

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ui');

test('an unconfigured build shows publisher setup with the redirect URI, and disables Connect', async () => {
  installGlobals(readFileSync(path.join(uiDir, 'options.html'), 'utf8'), { status: { ok: true, connected: false } });

  await freshImport(path.join(uiDir, 'options.js'));
  await settle();

  const doc = globalThis.document;
  assert.equal(doc.getElementById('unconfigured').classList.contains('hidden'), false, 'publisher card is shown');
  assert.equal(doc.getElementById('connect').disabled, true, 'Connect cannot be clicked without a client id');

  // The harness's identity.getRedirectURL() returns a Chromium-style URL, so it passes through.
  assert.equal(doc.getElementById('redirect').value, 'https://abc123.chromiumapp.org/', 'redirect URI to register');
  assert.equal(doc.getElementById('browser-name').textContent, 'Chrome');
  assert.equal(typeof doc.getElementById('copy-redirect').onclick, 'function', 'copy button wired');
});
