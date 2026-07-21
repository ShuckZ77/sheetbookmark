import { SHEET_NAME } from './config.js';
import { AuthError, getToken, invalidateToken } from './lib/auth.js';
import { api, detectBrowser, detectOs, flattenTree, folderPathOf, isSyncable } from './lib/browser.js';
import {
  appendRows,
  createSheet,
  ensureOwnTab,
  findAppSheets,
  readAllTabs,
  readTabRows,
  resolveTabTitle,
  sanitizeTabTitle,
  sheetExists,
  SheetsError,
} from './lib/sheets.js';
import * as store from './lib/store.js';

const SYNC_ALARM = 'sync';
const FLUSH_DEBOUNCE_MS = 1500;
const CACHE_TTL_MS = 60_000;
const IMPORT_FOLDER = 'Bookmark Sync';

/** Minutes between alarm firings per mode. 'instant' keeps a 1-minute retry for offline queues. */
const ALARM_MINUTES = { instant: 1, 15: 15, 60: 60, 480: 480, 1440: 1440 };

/**
 * The browser's own bookmark sync can fire hundreds of onCreated events at once, and
 * each handler does a read-modify-write of the seen set and the queue. Serialising
 * those critical sections is what keeps them from clobbering each other.
 */
const withLock = (() => {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(
      () => {},
      () => {},
    );
    return run;
  };
})();

let environmentPromise;
const environment = () =>
  (environmentPromise ??= Promise.all([detectBrowser(), detectOs()]).then(([browser, os]) => ({ browser, os })));

async function buildRow({ title, url, description = '', folder = '', source, timestamp }) {
  const [{ browser, os }, { profileLabel }] = await Promise.all([environment(), store.getSettings()]);
  return {
    timestamp: timestamp ?? store.toISTStamp(),
    browser,
    profile: profileLabel,
    os,
    title,
    url,
    description,
    folder,
    source,
    id: crypto.randomUUID(),
  };
}

/** '!' when sign-in is needed; a count when bookmarks are waiting in manual mode. */
async function updateBadge() {
  const [{ needsAuth, syncMode }, queue] = await Promise.all([store.getSettings(), store.getQueue()]);
  if (needsAuth) {
    await api.action.setBadgeBackgroundColor({ color: '#d97706' });
    await api.action.setBadgeText({ text: '!' });
  } else if (syncMode === 'manual' && queue.length) {
    await api.action.setBadgeBackgroundColor({ color: '#2563eb' });
    await api.action.setBadgeText({ text: String(Math.min(queue.length, 99)) });
  } else {
    await api.action.setBadgeText({ text: '' });
  }
}

async function setNeedsAuth(needsAuth) {
  await store.setSettings({ needsAuth });
  await updateBadge();
}

/** Runs a Sheets call, refreshing the token once if the API rejects it as stale. */
async function callSheets(operation, { interactive = false } = {}) {
  const token = await getToken({ interactive });
  try {
    return await operation(token);
  } catch (error) {
    if (!(error instanceof SheetsError) || error.status !== 401) throw error;
    await invalidateToken();
    return operation(await getToken({ interactive }));
  }
}

// --- Own tab ----------------------------------------------------------------

/**
 * Returns the current title of this install's tab, surviving both renames (the id is
 * what we stored, so the new title is simply picked up) and outright deletion (the tab
 * is recreated). Never guesses by name once a tabId exists.
 */
async function ensureOwnTabLive(token) {
  const { sheetId, tabId, tabName, profileLabel } = await store.getSettings();

  if (tabId != null) {
    const title = await resolveTabTitle(token, sheetId, tabId);
    if (title) {
      if (title !== tabName) await store.setSettings({ tabName: title });
      return title;
    }
  }

  const wanted = sanitizeTabTitle(tabName || profileLabel || (await environment()).browser);
  const tab = await ensureOwnTab(token, sheetId, wanted);
  await store.setSettings({ tabId: tab.tabId, tabName: tab.title });
  return tab.title;
}

// --- Queue ------------------------------------------------------------------

let flushTimer;

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flush().catch((error) => console.error('[bookmark-sync] flush failed', error));
  }, FLUSH_DEBOUNCE_MS);
}

/** Adds every not-yet-seen candidate to the queue. Returns how many were new. */
async function record(candidates) {
  const result = await withLock(async () => {
    const seen = await store.getSeen();
    const rows = [];

    for (const candidate of candidates) {
      const key = store.normalizeUrl(candidate.url);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(await buildRow(candidate));
    }

    if (rows.length) {
      await store.saveSeen(seen);
      await store.setQueue([...(await store.getQueue()), ...rows]);
    }

    return { added: rows.length, skipped: candidates.length - rows.length };
  });

  await updateBadge();
  return result;
}

let flushing = false;

async function flush({ interactive = false } = {}) {
  // Claimed before the first await: otherwise the debounce timer, the alarm and a
  // Save click could each read the same queue and append every row three times.
  if (flushing) return { ok: true, skipped: true };
  flushing = true;

  try {
    const pending = await store.getQueue();
    if (!pending.length) return { ok: true, written: 0 };

    const { sheetId } = await store.getSettings();
    if (!sheetId) return { ok: false, error: 'Not connected' };

    await callSheets(async (token) => {
      const title = await ensureOwnTabLive(token);
      await appendRows(token, sheetId, title, pending);
    }, { interactive });

    // Anything enqueued while the network call was in flight must survive.
    const written = new Set(pending.map((row) => row.id));
    await withLock(async () => {
      const queue = await store.getQueue();
      await store.setQueue(queue.filter((row) => !written.has(row.id)));
    });

    await store.setSettings({ lastSyncAt: Date.now() });
    await store.setCache([]);
    await setNeedsAuth(false);
    return { ok: true, written: pending.length };
  } catch (error) {
    if (error instanceof AuthError && error.needsInteraction) {
      await setNeedsAuth(true);
      return { ok: false, needsAuth: true, error: error.message };
    }
    throw error;
  } finally {
    flushing = false;
  }
}

// --- Sync scheduling --------------------------------------------------------

async function configureAlarm() {
  const { syncMode } = await store.getSettings();
  await api.alarms.clear(SYNC_ALARM);
  const minutes = ALARM_MINUTES[syncMode];
  if (minutes) api.alarms.create(SYNC_ALARM, { periodInMinutes: minutes });
}

// --- Message handlers -------------------------------------------------------

async function handleStatus() {
  const [settings, { browser }, queue] = await Promise.all([store.getSettings(), environment(), store.getQueue()]);
  const { sheetId, profileLabel, needsAuth, syncMode, lastSyncAt, tabName } = settings;

  return {
    ok: true,
    connected: Boolean(sheetId),
    needsAuth,
    profile: profileLabel || browser,
    sheetId,
    tabName,
    browser,
    syncMode,
    lastSyncAt,
    queued: queue.length,
  };
}

/** An explicit toolbar click always writes immediately, whatever the sync mode. */
async function handleSaveTab({ tab }) {
  if (!isSyncable(tab?.url)) return { ok: false, error: 'unsupported' };

  const { added } = await record([
    {
      title: tab.title || tab.url,
      url: tab.url,
      description: (tab.description ?? '').slice(0, 500),
      source: 'toolbar',
    },
  ]);
  if (!added) return { ok: true, deduped: true };

  return flush();
}

const flattenTabs = (tabs) => tabs.flatMap((tab) => tab.rows);

async function handleListRows({ force }) {
  const cache = await store.getCache();
  if (!force && cache?.rows?.length && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ok: true, rows: cache.rows };
  }

  const { sheetId } = await store.getSettings();
  if (!sheetId) return { ok: false, error: 'Not connected' };

  const rows = flattenTabs(await callSheets((token) => readAllTabs(token, sheetId)));
  await store.setCache(rows);
  await setNeedsAuth(false);
  return { ok: true, rows };
}

/** One-time upload of the existing bookmark tree. Returns how many rows were new. */
async function importExistingBookmarks() {
  const { importDone } = await store.getSettings();
  if (importDone) return 0;

  const candidates = flattenTree(await api.bookmarks.getTree()).map((bookmark) => ({
    title: bookmark.title,
    url: bookmark.url,
    folder: bookmark.folder,
    source: 'import',
    timestamp: bookmark.dateAdded ? store.toISTStamp(bookmark.dateAdded) : undefined,
  }));

  const { added } = await record(candidates);
  await store.setSettings({ importDone: true });
  if (added) await flush({ interactive: true });
  return added;
}

/**
 * Resolves this account's bookmark sheet: the stored one if still alive, else whatever
 * sheet this app previously created — matched by ownership, not by name, so renames and
 * moves in Drive never cause a duplicate. Only with zero candidates is one created; with
 * several (e.g. restored Drive trash) the user picks once.
 */
async function handleConnect({ choice } = {}) {
  const result = await callSheets(async (token) => {
    const settings = await store.getSettings();

    let sheetId = settings.sheetId && (await sheetExists(token, settings.sheetId)) ? settings.sheetId : null;

    if (!sheetId && choice) {
      if (await sheetExists(token, choice)) sheetId = choice;
      else return { error: 'That sheet is no longer reachable.' };
    }

    if (!sheetId) {
      const candidates = await findAppSheets(token);
      if (candidates.length > 1) {
        return { needsChoice: true, choices: candidates.map(({ id, name }) => ({ id, name })) };
      }
      if (candidates.length === 1) {
        sheetId = candidates[0].id;
      } else {
        const wanted = sanitizeTabTitle(settings.profileLabel || (await environment()).browser);
        const created = await createSheet(token, SHEET_NAME, wanted);
        await store.setSettings({ sheetId: created.sheetId, tabId: created.tabId, tabName: created.title });
        return { sheetId: created.sheetId, ownTitle: created.title };
      }
    }

    await store.setSettings({ sheetId });
    const ownTitle = await ensureOwnTabLive(token);
    return { sheetId, ownTitle };
  }, { interactive: true });

  if (result.needsChoice || result.error) return { ok: !result.error, ...result };

  // Seed the dedupe set from this install's own tab only — other browsers legitimately
  // hold the same URLs in their tabs, and that must not block this one from saving them.
  const ownRows = await callSheets((token) => readTabRows(token, result.sheetId, result.ownTitle));
  await withLock(async () => {
    const seen = await store.getSeen();
    for (const row of ownRows) if (row.url) seen.add(store.normalizeUrl(row.url));
    await store.saveSeen(seen);
  });

  await setNeedsAuth(false);
  const imported = await importExistingBookmarks();
  await configureAlarm();
  return { ok: true, sheetId: result.sheetId, tabName: result.ownTitle, imported };
}

async function handleSyncNow() {
  const result = await flush({ interactive: true });
  if (!result.ok) return result;

  const { sheetId } = await store.getSettings();
  if (sheetId) {
    const rows = flattenTabs(await callSheets((token) => readAllTabs(token, sheetId)));
    await store.setCache(rows);
  }
  await store.setSettings({ lastSyncAt: Date.now() });
  return result;
}

async function handleSetSync({ syncMode }) {
  if (!(syncMode in ALARM_MINUTES) && syncMode !== 'manual') return { ok: false, error: 'Unknown sync mode' };
  await store.setSettings({ syncMode });
  await configureAlarm();
  await updateBadge();
  return { ok: true };
}

async function ensureImportFolder() {
  const matches = await api.bookmarks.search({ title: IMPORT_FOLDER });
  const folder = matches.find((node) => !node.url && node.title === IMPORT_FOLDER);
  if (folder) return folder.id;
  const created = await api.bookmarks.create({ title: IMPORT_FOLDER });
  return created.id;
}

/**
 * Sheet → browser, on explicit request only: pulls bookmarks that other installs' tabs
 * hold and this browser lacks, into a dedicated folder. Never deletes, and marks the
 * URLs as seen first so onCreated does not echo them back into this install's tab.
 */
async function handleImportFromSheet() {
  const { sheetId, tabId } = await store.getSettings();
  if (!sheetId) return { ok: false, error: 'Not connected' };

  const tabs = await callSheets((token) => readAllTabs(token, sheetId), { interactive: true });
  const foreign = tabs.filter((tab) => tab.tabId !== tabId).flatMap((tab) => tab.rows);

  const local = new Set(flattenTree(await api.bookmarks.getTree()).map((b) => store.normalizeUrl(b.url)));
  const fresh = [];
  const picked = new Set();
  for (const row of foreign) {
    if (!isSyncable(row.url)) continue;
    const key = store.normalizeUrl(row.url);
    if (local.has(key) || picked.has(key)) continue;
    picked.add(key);
    fresh.push(row);
  }

  if (!fresh.length) return { ok: true, imported: 0 };

  await withLock(async () => {
    const seen = await store.getSeen();
    for (const key of picked) seen.add(key);
    await store.saveSeen(seen);
  });

  const parentId = await ensureImportFolder();
  for (const row of fresh) {
    await api.bookmarks.create({ parentId, title: row.title || row.url, url: row.url });
  }

  return { ok: true, imported: fresh.length, folder: IMPORT_FOLDER };
}

async function handleDisconnect() {
  await invalidateToken();
  await store.setSettings({ sheetId: '', tabId: null, needsAuth: false });
  await api.alarms.clear(SYNC_ALARM);
  await api.action.setBadgeText({ text: '' });
  return { ok: true };
}

const HANDLERS = {
  status: handleStatus,
  saveTab: handleSaveTab,
  listRows: handleListRows,
  connect: handleConnect,
  disconnect: handleDisconnect,
  syncNow: handleSyncNow,
  setSync: handleSetSync,
  importFromSheet: handleImportFromSheet,
  authorize: async () => {
    await getToken({ interactive: true });
    await setNeedsAuth(false);
    await flush();
    return { ok: true };
  },
};

async function toErrorResponse(error) {
  if (error instanceof AuthError && error.needsInteraction) {
    await setNeedsAuth(true);
    return { ok: false, needsAuth: true, error: error.message };
  }
  console.error('[bookmark-sync]', error);
  return { ok: false, error: error.message };
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  handler(message).then(sendResponse, (error) => toErrorResponse(error).then(sendResponse));
  return true;
});

// --- Browser events ---------------------------------------------------------

api.bookmarks.onCreated.addListener(async (_id, node) => {
  const { captureNative, syncMode } = await store.getSettings();
  if (!captureNative || !isSyncable(node?.url)) return;

  const { added } = await record([
    {
      title: node.title || node.url,
      url: node.url,
      folder: await folderPathOf(node.parentId),
      source: 'native',
    },
  ]);

  // Interval and manual modes leave the row queued for the alarm or the Sync button.
  if (added && syncMode === 'instant') scheduleFlush();
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  flush().catch((error) => console.error('[bookmark-sync] scheduled flush failed', error));
});

api.runtime.onStartup.addListener(() => {
  configureAlarm().catch(() => {});
});

api.runtime.onInstalled.addListener(async (details) => {
  await configureAlarm();
  if (details.reason === 'install' && !(await store.isConnected())) {
    await api.runtime.openOptionsPage();
  }
});
