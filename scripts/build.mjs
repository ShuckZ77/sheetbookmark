/**
 * Builds dist/chrome and dist/firefox from src/, and draws the grid-bookmark icons.
 *
 *   node scripts/build.mjs          → unpacked folders, for loading in a browser
 *   node scripts/build.mjs --zip    → store-upload packages, plus a zip per target
 *
 * The two differ in one way that matters. The unpacked build carries the `key` from
 * .keys/manifest-key.txt, which pins the Chromium extension id so the OAuth redirect URI
 * is stable during development. The Chrome Web Store, however, assigns the id itself on
 * first upload and REJECTS a new item whose manifest contains `key` — so the zip omits it.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

// Pin the Chromium extension id (and therefore the OAuth redirect URI) via the committed
// public key, so it is stable across machines and installs before store publishing.
const keyFile = path.join(root, '.keys/manifest-key.txt');
const manifestKey = existsSync(keyFile) ? (await readFile(keyFile, 'utf8')).trim() : null;

// The OAuth client id is baked into config.js at build time from .keys/client-id.txt.
const clientIdFile = path.join(root, '.keys/client-id.txt');
const clientId = existsSync(clientIdFile) ? (await readFile(clientIdFile, 'utf8')).trim() : null;

const forStore = process.argv.includes('--zip');

/** Chrome wants a service worker; Firefox only supports an event page. Everything else is shared. */
const TARGETS = {
  chrome: {
    minimum_chrome_version: '102',
    background: { service_worker: 'background.js', type: 'module' },
    // The key ALWAYS ships in the dist folder so the unpacked extension keeps its pinned
    // id (and therefore its registered OAuth redirect URI) — even when --zip also runs.
    // It is stripped only inside the store archive, which is packed from a staging copy.
    ...(manifestKey ? { key: manifestKey } : {}),
  },
  firefox: {
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: 'bookmark-sheet-sync@local',
        // 140+ because data_collection_permissions (the built-in consent screen) shipped
        // in Firefox 140 — older versions would install without showing consent. 140 is
        // also the current ESR line, so enterprise stays covered. Zero users lost pre-launch.
        strict_min_version: '140.0',
        // Mozilla's built-in data-consent (required for new AMO submissions). Honest
        // declaration under their definition ("anything transmitted outside the local
        // browser"): bookmark records + the page-content note go to the USER'S OWN
        // Google Sheet. Nothing ever reaches the developer.
        data_collection_permissions: {
          required: ['bookmarksInfo', 'websiteContent'],
        },
      },
      // Android floor is separate: the consent key arrived there in 142. This only
      // scopes versions IF the add-on is ever offered on Android — availability itself
      // stays off via the AMO compatibility checkbox (no `bookmarks` API on Android).
      gecko_android: {
        strict_min_version: '142.0',
      },
    },
  },
};

// --- Icons ------------------------------------------------------------------

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

const NAVY_TOP = [16, 38, 66];
const NAVY_BOTTOM = [8, 20, 38];
const RIBBON_TOP = [16, 185, 129];
const RIBBON_BOTTOM = [5, 150, 105];
const CELL = [250, 250, 247];

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal 8-bit RGBA PNG encoder — enough for four icons, no dependencies. */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

function insideRoundedSquare(x, y, size) {
  const radius = size * 0.225;
  const nearestX = Math.min(Math.max(x, radius), size - radius);
  const nearestY = Math.min(Math.max(y, radius), size - radius);
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

/** Bookmark ribbon: a rectangle with a notch cut up into its bottom edge. */
function insideRibbon(x, y, size) {
  const half = size * 0.26;
  const dx = Math.abs(x - size / 2);
  if (dx > half || y < size * 0.12 || y > size * 0.9) return false;
  return y <= size * 0.9 - size * 0.18 * (1 - dx / half);
}

/**
 * The mark: a bookmark ribbon made of spreadsheet cells — the product in one shape.
 * Detail drops with size: 2×3 white cells at 48px+, 2×2 below, so the 16px favicon
 * stays crisp instead of mushing into a green smudge.
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const total = SAMPLES * SAMPLES;

  const rows = size >= 48 ? 3 : 2;
  const cols = 2;
  // Cell block sits in the ribbon's upper part, above the notch.
  const bx0 = size * (size >= 48 ? 0.29 : 0.28);
  const bx1 = size - bx0;
  const by0 = size * 0.18;
  const by1 = size * (size >= 48 ? 0.64 : 0.6);
  const gut = Math.max(1, size * (size >= 48 ? 0.035 : 0.06));

  const cellAt = (x, y) => {
    if (x < bx0 || x > bx1 || y < by0 || y > by1) return false;
    const cw = (bx1 - bx0) / cols;
    const ch = (by1 - by0) / rows;
    const inX = (x - bx0) % cw;
    const inY = (y - by0) % ch;
    return inX > gut / 2 && cw - inX > gut / 2 && inY > gut / 2 && ch - inY > gut / 2;
  };

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          if (!insideRoundedSquare(x, y, size)) continue;

          let colour = lerp(NAVY_TOP, NAVY_BOTTOM, (x + y) / (2 * size));
          if (insideRibbon(x, y, size)) {
            colour = cellAt(x, y) ? CELL : lerp(RIBBON_TOP, RIBBON_BOTTOM, y / size);
          }

          red += colour[0];
          green += colour[1];
          blue += colour[2];
          alpha += 1;
        }
      }

      if (alpha === 0) continue;
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(red / alpha);
      rgba[offset + 1] = Math.round(green / alpha);
      rgba[offset + 2] = Math.round(blue / alpha);
      rgba[offset + 3] = Math.round((alpha / total) * 255);
    }
  }

  return rgba;
}

// --- Build ------------------------------------------------------------------

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const base = JSON.parse(await readFile(path.join(src, 'manifest.json'), 'utf8'));

await rm(dist, { recursive: true, force: true });

const icons = path.join(root, 'icons');
await mkdir(icons, { recursive: true });
await Promise.all(SIZES.map((size) => writeFile(path.join(icons, `icon-${size}.png`), encodePng(size, renderIcon(size)))));
console.log(`Drew ${SIZES.length} icons`);

for (const [target, overrides] of Object.entries(TARGETS)) {
  const out = path.join(dist, target);
  await mkdir(out, { recursive: true });

  await cp(src, out, { recursive: true, filter: (file) => path.basename(file) !== 'manifest.json' });
  await cp(icons, path.join(out, 'icons'), { recursive: true });

  if (clientId) {
    const configPath = path.join(out, 'config.js');
    const config = await readFile(configPath, 'utf8');
    await writeFile(configPath, config.replace('__GOOGLE_OAUTH_CLIENT_ID__', clientId));
  }

  const manifest = { ...base, ...overrides, version: pkg.version };
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built dist/${target}`);

  if (!forStore) continue;

  // Stores assign extension ids themselves and reject a NEW item whose manifest carries
  // `key` — so the archive is packed from a staging copy with the key removed, leaving
  // the dist folder (and its pinned id) untouched for unpacked loading.
  let zipSource = out;
  if (manifest.key) {
    const stage = path.join(dist, `.stage-${target}`);
    await cp(out, stage, { recursive: true });
    const { key, ...storeManifest } = manifest;
    await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(storeManifest, null, 2)}\n`);
    zipSource = stage;
  }

  const archive = path.join(dist, `${pkg.name}-${target}-${pkg.version}.zip`);
  if (spawnSync('zip', ['-qr', archive, '.'], { cwd: zipSource, stdio: 'inherit' }).status !== 0) {
    throw new Error(`zip failed for ${target}`);
  }
  if (zipSource !== out) await rm(zipSource, { recursive: true, force: true });
  console.log(`Packed ${path.relative(root, archive)}`);
}

if (!clientId) {
  console.log('\n⚠  No .keys/client-id.txt — the build has no OAuth client id, so the');
  console.log('   Connect button shows a "not configured" notice. Add the file to enable it.');
}
