import { api } from './browser.js';

/**
 * Local settings, the pending write queue, and the record of what has already been
 * synced. All of it lives in storage.local rather than storage.sync on purpose: the
 * profile label must differ between two Chrome profiles signed into the same Google
 * account, and storage.sync would happily overwrite it across them.
 *
 * The sheet id is discovered or created on connect, never entered by the user. Each
 * install owns one tab in that sheet, tracked by numeric tabId so renames in the Sheets
 * UI cannot break writes. syncMode: 'instant' pushes seconds after capture; a number of
 * minutes ('15'…'1440') batches on that interval; 'manual' only moves on Sync now.
 */
const DEFAULTS = {
  sheetId: '',
  tabId: null,
  tabName: '',
  profileLabel: '',
  captureNative: true,
  syncMode: 'instant',
  visitStats: false,
  lastSyncAt: 0,
  importDone: false,
  needsAuth: false,
};

const SEEN_KEY = 'seenUrls';
const SEEN_CAP = 20_000;
const QUEUE_KEY = 'queue';
const CACHE_KEY = 'rowCache';

const TRACKING_PREFIX = /^(utm_|mc_|_hs)/i;
const TRACKING_EXACT = new Set(['fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'igshid', 'mkt_tok', 'si', 'spm']);

/**
 * Produces a comparison key, not something to store or navigate to. It drops the
 * fragment, the `www.` prefix and known tracking parameters, so the same article
 * bookmarked from a newsletter link and from search does not land in the sheet twice.
 */
export function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return (raw ?? '').trim().toLowerCase();
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.href;

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.username = '';
  url.password = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PREFIX.test(key) || TRACKING_EXACT.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  const serialized = url.toString();
  return url.pathname === '/' && !url.search ? serialized.replace(/\/$/, '') : serialized;
}

/**
 * Timestamps are written as IST (UTC+5:30) wall-clock time with an explicit offset —
 * readable in the sheet, still machine-parseable, and it sorts lexicographically because
 * the offset never changes. Currently fixed to IST by product decision; a timezone
 * setting can replace the constant later without touching the format.
 */
const IST_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const toISTStamp = (when = Date.now()) => `${IST_FORMAT.format(new Date(when)).replace(' ', 'T')}+05:30`;

export async function getSettings() {
  const stored = await api.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await api.storage.local.set(patch);
}

/** Connected means a sheet has been created or found and its id stored. */
export async function isConnected() {
  const { sheetId } = await getSettings();
  return Boolean(sheetId);
}

/** Normalised URLs already written to the sheet, newest last. */
export async function getSeen() {
  const { [SEEN_KEY]: list = [] } = await api.storage.local.get(SEEN_KEY);
  return new Set(list);
}

export async function saveSeen(seen) {
  await api.storage.local.set({ [SEEN_KEY]: [...seen].slice(-SEEN_CAP) });
}

export async function getQueue() {
  const { [QUEUE_KEY]: queue = [] } = await api.storage.local.get(QUEUE_KEY);
  return queue;
}

export async function setQueue(queue) {
  await api.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function getCache() {
  const { [CACHE_KEY]: cache = null } = await api.storage.local.get(CACHE_KEY);
  return cache;
}

export async function setCache(rows) {
  await api.storage.local.set({ [CACHE_KEY]: { rows, at: Date.now() } });
}

export async function resetAll() {
  await api.storage.local.clear();
}
