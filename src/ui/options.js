import { api, detectBrowser, detectOs } from '../lib/browser.js';
import { getRedirectUri } from '../lib/auth.js';
import { isConfiguredBuild } from '../config.js';
import { getSettings, setSettings } from '../lib/store.js';

const API_ORIGINS = ['https://sheets.googleapis.com/*', 'https://www.googleapis.com/*'];

const $ = (id) => document.getElementById(id);
const send = (message) => api.runtime.sendMessage(message);

function setStatus(id, text, tone = '') {
  const status = $(id);
  status.textContent = text;
  status.className = `status ${tone}`.trim();
}

/** The page guides: step 1 turns into a check once connected, and the sync tools stay parked until then. */
function showConnected(connected, tabName = '') {
  $('connected-state').classList.toggle('hidden', !connected);
  $('disconnected-state').classList.toggle('hidden', connected);
  if (tabName) $('tab-name').textContent = tabName;

  const step = $('step-connect');
  step.textContent = connected ? '✓' : '1';
  step.classList.toggle('done', connected);

  $('sync-card').classList.toggle('waiting', !connected);
  $('sync-now').disabled = !connected;
  $('import-others').disabled = !connected;
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
    showConnected(true, result.tabName);
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

async function disconnect() {
  await send({ type: 'disconnect' });
  showConnected(false);
  setStatus('status', 'Signed out on this browser. Your sheet is untouched.');
}

async function openSheet() {
  const { sheetId } = await getSettings();
  if (sheetId) api.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${sheetId}` });
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
  $('sync-mode').value = settings.syncMode;

  $('connect').onclick = () => connect();
  $('disconnect').onclick = disconnect;
  $('open-sheet').onclick = openSheet;
  $('sync-now').onclick = syncNow;
  $('import-others').onclick = importFromSheet;
  $('reset').onclick = reset;
  $('capture-native').onchange = (event) => setSettings({ captureNative: event.target.checked });
  $('sync-mode').onchange = (event) => send({ type: 'setSync', syncMode: event.target.value });
  $('profile').onchange = (event) => setSettings({ profileLabel: event.target.value.trim() });

  const status = await send({ type: 'status' });
  showConnected(Boolean(status?.connected), status?.tabName);
  if (status?.connected && status.needsAuth) {
    setStatus('status', 'Your Google session expired. Reconnect to resume syncing.', 'err');
  }
}

init();
