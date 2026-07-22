/**
 * Runs the real build with --zip and asserts the two manifest invariants that OAuth
 * depends on. Regression for a real field failure: the zip step used to rebuild the
 * dist FOLDER without the manifest key, silently changing the unpacked extension's id —
 * and with it the OAuth redirect URI — to a path-derived value Google had never seen
 * (redirect_uri_mismatch on the next Connect).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const hasPinnedKey = existsSync(path.join(root, '.keys/manifest-key.txt'));

test('the dist folder keeps the pinned key even when --zip runs, and the archive drops it', (t) => {
  if (!hasPinnedKey) return t.skip('no .keys/manifest-key.txt in this checkout');

  execFileSync('node', ['scripts/build.mjs', '--zip'], { cwd: root });

  const folder = JSON.parse(readFileSync(path.join(root, 'dist/chrome/manifest.json'), 'utf8'));
  assert.ok(folder.key, 'unpacked dist/chrome must keep the key — its id pins the OAuth redirect URI');

  const archive = path.join(root, 'dist', `${pkg.name}-chrome-${pkg.version}.zip`);
  const zipped = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { cwd: root, encoding: 'utf8' }));
  assert.equal(zipped.key, undefined, 'store archives must not carry a key — stores assign the id');

  assert.ok(!existsSync(path.join(root, 'dist/.stage-chrome')), 'staging copy is cleaned up');
});
