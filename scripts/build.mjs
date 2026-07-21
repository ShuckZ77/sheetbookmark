/**
 * Builds dist/chrome and dist/firefox from src/, and draws the atom icons.
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
    ...(manifestKey && !forStore ? { key: manifestKey } : {}),
  },
  firefox: {
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: { id: 'bookmark-sheet-sync@local', strict_min_version: '115.0' },
    },
  },
};

// --- Icons ------------------------------------------------------------------

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

const NAVY_TOP = [17, 43, 77];
const NAVY_BOTTOM = [6, 17, 31];
const ORBIT = [52, 211, 153];
const ELECTRON = [167, 243, 208];
const NUCLEUS = [52, 211, 153];

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
  const radius = size * 0.235;
  const nearestX = Math.min(Math.max(x, radius), size - radius);
  const nearestY = Math.min(Math.max(y, radius), size - radius);
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

/** Distance from an ellipse's outline, using the first-order approximation |f-1| / |grad f|. */
function distanceToEllipse(dx, dy, a, b, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;

  const f = (u * u) / (a * a) + (v * v) / (b * b);
  const gradient = 2 * Math.hypot(u / (a * a), v / (b * b));
  return gradient === 0 ? Infinity : Math.abs(f - 1) / gradient;
}

/**
 * An atom: orbits, electrons, and a nucleus on a navy tile.
 *
 * Detail is dropped as the tile shrinks. Three orbits plus three electrons is simply
 * more information than a 16px favicon can carry — it renders as a green smudge — so
 * the smallest sizes fall back to two crossed orbits and a nucleus.
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const centre = size / 2;

  const angles = size < 32 ? [0, Math.PI / 2] : [0, Math.PI / 3, (2 * Math.PI) / 3];
  const showElectrons = size >= 48;

  const a = size * 0.395;
  const b = size * (size < 32 ? 0.16 : 0.152);
  const stroke = Math.max(0.55, size * 0.021);
  const nucleusRadius = size * (size < 32 ? 0.155 : 0.125);
  const electronRadius = Math.max(1, size * 0.058);
  const halo = Math.max(0.9, size * 0.032);

  const electrons = showElectrons
    ? angles.map((angle, index) => {
        const t = index === 1 ? Math.PI : 0;
        const u = a * Math.cos(t);
        const v = b * Math.sin(t);
        return [
          centre + u * Math.cos(angle) - v * Math.sin(angle),
          centre + u * Math.sin(angle) + v * Math.cos(angle),
        ];
      })
    : [];

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

          const dx = x - centre;
          const dy = y - centre;
          const fromCentre = Math.hypot(dx, dy);
          let colour = lerp(NAVY_TOP, NAVY_BOTTOM, (x + y) / (2 * size));

          if (fromCentre <= nucleusRadius) {
            colour = NUCLEUS;
          } else if (fromCentre > nucleusRadius + halo) {
            const electron = electrons.find(([ex, ey]) => Math.hypot(x - ex, y - ey) <= electronRadius + halo);
            if (electron) {
              // The halo lets orbits pass visually behind each electron.
              if (Math.hypot(x - electron[0], y - electron[1]) <= electronRadius) colour = ELECTRON;
            } else if (angles.some((angle) => distanceToEllipse(dx, dy, a, b, angle) <= stroke)) {
              colour = ORBIT;
            }
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
      rgba[offset + 3] = Math.round((alpha / (SAMPLES * SAMPLES)) * 255);
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

  const archive = path.join(dist, `${pkg.name}-${target}-${pkg.version}.zip`);
  if (spawnSync('zip', ['-qr', archive, '.'], { cwd: out, stdio: 'inherit' }).status !== 0) {
    throw new Error(`zip failed for ${target}`);
  }
  console.log(`Packed ${path.relative(root, archive)}`);
}

if (!clientId) {
  console.log('\n⚠  No .keys/client-id.txt — the build has no OAuth client id, so the');
  console.log('   Connect button shows a "not configured" notice. Add the file to enable it.');
}
