import { api, detectBrowser, detectOs } from '../lib/browser.js';
import { getRedirectUri } from '../lib/auth.js';
import { isConfiguredBuild } from '../config.js';
import { getErrorLog, getSettings, setSettings } from '../lib/store.js';

const API_ORIGINS = ['https://sheets.googleapis.com/*', 'https://www.googleapis.com/*'];

const $ = (id) => document.getElementById(id);
const send = (message) => api.runtime.sendMessage(message);

function setStatus(id, text, tone = '') {
  const status = $(id);
  status.textContent = text;
  status.className = `status ${tone}`.trim();
}

function agoText(when) {
  if (!when) return '';
  const minutes = Math.round((Date.now() - when) / 60000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Synced ${hours} h ago` : `Synced ${Math.round(hours / 24)} d ago`;
}

/**
 * The hero is a state machine with no dead ends: healthy shows green + last sync;
 * an expired Google session flips the pill amber and offers "Sign in again" right
 * there; sync tools stay parked until connected.
 */
function showConnected(connected, tabName = '', { needsAuth = false, lastSyncAt = 0 } = {}) {
  $('connected-state').classList.toggle('hidden', !connected);
  $('disconnected-state').classList.toggle('hidden', connected);
  if (tabName) $('tab-name').textContent = tabName;

  const pill = $('conn-pill');
  pill.textContent = needsAuth ? 'Signed out' : 'Connected';
  pill.className = `pill ${needsAuth ? 'warn' : 'ok'}`;
  $('reauth').classList.toggle('hidden', !needsAuth);
  $('last-sync').textContent = connected && !needsAuth ? agoText(lastSyncAt) : '';

  $('sync-card').classList.toggle('waiting', !connected);
  $('sync-now').disabled = !connected;
  $('import-others').disabled = !connected;
}

async function refresh() {
  const status = await send({ type: 'status' });
  showConnected(Boolean(status?.connected), status?.tabName, status ?? {});
  return status;
}

/**
 * Chrome grants manifest host permissions at install, so this is a no-op there. Firefox
 * lets the user revoke them from about:addons and only re-grants from a user gesture —
 * which is why it runs inside the Connect click rather than at page load.
 */
async function ensureApiPermission() {
  if (await api.permissions.contains({ origins: API_ORIGINS })) return true;
  return api.permissions.request({ origins: API_ORIGINS });
}

function offerSheetChoices(choices) {
  const list = $('sheet-choice-list');
  list.replaceChildren();
  for (const { id, name } of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-ghost';
    button.textContent = name;
    button.onclick = () => connect(id);
    list.append(button);
  }
  $('sheet-choices').classList.remove('hidden');
}

async function connect(choice) {
  const button = $('connect');
  const label = $('connect-label');
  button.disabled = true;

  // Persist the label before the Google round-trip so it names the tab being created.
  const profileLabel = $('profile').value.trim() || $('profile').placeholder;
  await setSettings({ profileLabel });

  try {
    if (!(await ensureApiPermission())) {
      setStatus('status', 'Access to the Google APIs was declined.', 'err');
      return;
    }

    label.textContent = 'Waiting for Google…';
    setStatus('status', 'A Google window will ask you to authorize access.');

    const result = await send({ type: 'connect', choice });
    if (result?.needsChoice) {
      setStatus('status', '');
      offerSheetChoices(result.choices);
      return;
    }
    if (!result?.ok) {
      setStatus('status', result?.error ?? 'Could not connect.', 'err');
      return;
    }

    $('sheet-choices').classList.add('hidden');
    showConnected(true, result.tabName, { lastSyncAt: Date.now() });
    const imported = result.imported
      ? ` Imported ${result.imported} existing bookmark${result.imported === 1 ? '' : 's'} into your tab.`
      : '';
    setStatus('status', `Connected.${imported}`, 'ok');
  } catch (error) {
    setStatus('status', error.message, 'err');
  } finally {
    label.textContent = 'Connect Google Sheets';
    button.disabled = false;
  }
}

async function syncNow() {
  const button = $('sync-now');
  button.disabled = true;
  try {
    setStatus('sync-status', 'Syncing…');
    const result = await send({ type: 'syncNow' });
    if (!result?.ok) return setStatus('sync-status', result?.error ?? 'Sync failed.', 'err');
    setStatus(
      'sync-status',
      result.written ? `Synced ${result.written} bookmark${result.written === 1 ? '' : 's'}.` : 'Already up to date.',
      'ok',
    );
  } finally {
    button.disabled = false;
  }
}

async function importFromSheet() {
  const button = $('import-others');
  button.disabled = true;
  try {
    setStatus('sync-status', 'Reading your other browsers’ tabs…');
    const result = await send({ type: 'importFromSheet' });
    if (!result?.ok) return setStatus('sync-status', result?.error ?? 'Import failed.', 'err');
    setStatus(
      'sync-status',
      result.imported
        ? `Added ${result.imported} bookmark${result.imported === 1 ? '' : 's'} to the “${result.folder}” folder.`
        : 'Nothing new — this browser already has everything.',
      'ok',
    );
  } finally {
    button.disabled = false;
  }
}

async function reauth() {
  const button = $('reauth');
  button.disabled = true;
  try {
    const result = await send({ type: 'authorize' });
    if (result?.ok) {
      setStatus('status', 'Signed in — syncing resumed.', 'ok');
      await refresh();
    } else {
      setStatus('status', result?.error ?? 'Sign-in did not complete.', 'err');
    }
  } finally {
    button.disabled = false;
  }
}

async function disconnect() {
  await send({ type: 'disconnect' });
  showConnected(false);
  $('connect-label').textContent = 'Reconnect Google Sheets';
  setStatus('status', 'Signed out on this browser. Your sheet is untouched.');
}

async function openSheet() {
  const { sheetId } = await getSettings();
  if (sheetId) api.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${sheetId}` });
}

/** Everything a bug report needs, nothing the user would mind pasting publicly. */
async function buildDiagnostics() {
  const [settings, browser, os, log] = await Promise.all([getSettings(), detectBrowser(), detectOs(), getErrorLog()]);
  const manifest = api.runtime.getManifest();
  const recent = log.slice(-8).map((entry) => `- ${entry.at} [${entry.context}] ${entry.message}`);
  return [
    `SheetBookmark v${manifest.version} — ${browser} · ${os}`,
    `connected: ${Boolean(settings.sheetId)} · sync: ${settings.syncMode} · capture ⌘D: ${settings.captureNative} · visit stats: ${settings.visitStats}`,
    recent.length ? `recent errors:\n${recent.join('\n')}` : 'recent errors: none',
  ].join('\n');
}

async function reportIssue() {
  const body = `**What happened?**\n\n(describe the problem here)\n\n---\n\n\u0060\u0060\u0060\n${await buildDiagnostics()}\n\u0060\u0060\u0060\n`;
  const url = `https://github.com/ShuckZ77/sheetbookmark/issues/new?title=${encodeURIComponent('[bug] ')}&body=${encodeURIComponent(body)}`;
  api.tabs.create({ url });
}

async function copyDiagnostics() {
  await navigator.clipboard.writeText(await buildDiagnostics());
  setStatus('support-status', 'Diagnostics copied — paste them anywhere.', 'ok');
}

async function reset() {
  if (!confirm('Sign this browser out and clear its local sync record? Your sheet in Drive is not touched.')) return;
  await send({ type: 'disconnect' });
  await api.storage.local.clear();
  location.reload();
}

/**
 * Firefox derives its redirect URI from the extension at runtime, so the publisher can
 * only discover it by opening this page in Firefox. Surface it here, already converted
 * to the loopback form Google will actually accept.
 */
async function showPublisherSetup(browser) {
  $('unconfigured').classList.remove('hidden');
  $('connect').disabled = true;
  $('browser-name').textContent = browser;

  const redirectUri = getRedirectUri();
  $('redirect').value = redirectUri;

  if (redirectUri.startsWith('http://127.0.0.1/')) {
    $('redirect-hint').textContent =
      'Firefox needs this loopback form: Google refuses to register the extensions.allizom.org address, because ' +
      'that would mean proving you own Mozilla’s domain. Nothing listens on this port — Firefox intercepts the ' +
      'redirect itself. Add it to the same OAuth client alongside the Chromium one.';
  }

  $('copy-redirect').onclick = async () => {
    await navigator.clipboard.writeText(redirectUri);
    $('copy-redirect').textContent = 'Copied';
    setTimeout(() => ($('copy-redirect').textContent = 'Copy'), 1200);
  };
}

async function init() {
  const [settings, browser, os] = await Promise.all([getSettings(), detectBrowser(), detectOs()]);

  if (!isConfiguredBuild()) await showPublisherSetup(browser);

  $('profile').placeholder = `${browser} — ${os}`;
  $('profile').value = settings.profileLabel;
  $('capture-native').checked = settings.captureNative;
  $('visit-stats').checked = settings.visitStats;
  $('sync-mode').value = settings.syncMode;

  $('connect').onclick = () => connect();
  $('reauth').onclick = reauth;
  // Continuity, not amnesia: an install that has synced before offers to RE-connect.
  if (settings.tabName || settings.importDone) $('connect-label').textContent = 'Reconnect Google Sheets';
  $('disconnect').onclick = disconnect;
  $('open-sheet').onclick = openSheet;
  $('sync-now').onclick = syncNow;
  $('import-others').onclick = importFromSheet;
  $('reset').onclick = reset;
  $('report-issue').onclick = reportIssue;
  $('copy-diag').onclick = copyDiagnostics;
  $('capture-native').onchange = (event) => setSettings({ captureNative: event.target.checked });
  $('visit-stats').onchange = async (event) => {
    // The permission prompt must come from this click; declined means the box stays off.
    if (event.target.checked) {
      const granted = await api.permissions.request({ permissions: ['history'] }).catch(() => false);
      if (!granted) {
        event.target.checked = false;
        return;
      }
    } else {
      await api.permissions.remove({ permissions: ['history'] }).catch(() => {});
    }
    await setSettings({ visitStats: event.target.checked });
  };
  $('sync-mode').onchange = (event) => send({ type: 'setSync', syncMode: event.target.value });
  $('profile').onchange = (event) => setSettings({ profileLabel: event.target.value.trim() });

  await refresh();
}

init();
