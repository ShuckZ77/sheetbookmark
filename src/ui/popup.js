import { api, isSyncable } from '../lib/browser.js';

const $ = (id) => document.getElementById(id);
const send = (message) => api.runtime.sendMessage(message);

const state = { rows: [], query: '', browser: null, sheetId: '' };

const RELATIVE_UNITS = [
  ['year', 365 * 24 * 3600e3],
  ['month', 30 * 24 * 3600e3],
  ['day', 24 * 3600e3],
  ['hour', 3600e3],
  ['minute', 60e3],
];

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });

function timeAgo(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const elapsed = then - Date.now();
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) return relativeTime.format(Math.round(elapsed / size), unit);
  }
  return relativeTime.format(Math.round(elapsed / 1000), 'second');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Keeps monogram tiles inside the navy-to-green family rather than a full rainbow. */
function hueOf(host) {
  let hash = 0;
  for (const character of host) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 148 + (hash % 62);
}

const busy = (isBusy) => $('mark').classList.toggle('busy', isBusy);

function setPill(text, tone = '') {
  const pill = $('status-pill');
  pill.textContent = text;
  pill.className = `pill ${tone}`.trim();
}

function showNotice(text, actionLabel, onAction) {
  $('notice-text').textContent = text;
  const button = $('notice-action');
  button.textContent = actionLabel;
  button.onclick = onAction;
  $('notice').classList.remove('hidden');
}

function renderChips() {
  const browsers = [...new Set(state.rows.map((row) => row.browser).filter(Boolean))].sort();
  const chips = $('chips');
  chips.replaceChildren();
  if (browsers.length < 2) return;

  for (const label of ['All', ...browsers]) {
    const value = label === 'All' ? null : label;
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(state.browser === value));
    chip.onclick = () => {
      state.browser = value;
      render();
    };
    chips.append(chip);
  }
}

function matches(row) {
  if (state.browser && row.browser !== state.browser) return false;
  if (!state.query) return true;
  const haystack = `${row.title} ${row.url} ${row.description} ${row.folder}`.toLowerCase();
  return state.query.split(/\s+/).every((term) => haystack.includes(term));
}

function buildRow(row, index) {
  const host = hostOf(row.url);

  const item = document.createElement('li');
  item.className = 'row';
  item.style.setProperty('--i', String(Math.min(index, 14)));

  const button = document.createElement('button');
  button.className = 'row-btn';
  button.type = 'button';
  // Rows come from the sheet, which a collaborator could edit; never open anything
  // that is not plain http(s) — javascript:/data: URLs stop here.
  button.onclick = () => {
    if (isSyncable(row.url)) api.tabs.create({ url: row.url });
  };

  const monogram = document.createElement('span');
  monogram.className = 'mono';
  monogram.style.setProperty('--hue', String(hueOf(host)));
  monogram.textContent = (host.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();

  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = row.title || row.url;

  const meta = document.createElement('span');
  meta.className = 'row-meta';
  const hostSpan = document.createElement('span');
  hostSpan.className = 'host';
  hostSpan.textContent = host;
  meta.append(hostSpan);

  for (const [text, className] of [
    [row.profile, 'who'],
    [timeAgo(row.timestamp), 'when'],
  ]) {
    if (!text) continue;
    const dot = document.createElement('span');
    dot.className = 'dim';
    dot.textContent = '·';
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    meta.append(dot, span);
  }

  const body = document.createElement('span');
  body.className = 'row-body';
  body.append(title, meta);

  button.append(monogram, body);
  item.append(button);
  return item;
}

function render() {
  const visible = state.rows.filter(matches);
  renderChips();

  $('list').replaceChildren(...visible.slice(0, 300).map(buildRow));
  $('empty').classList.toggle('hidden', visible.length > 0);

  const total = state.rows.length;
  $('count').textContent = visible.length === total ? `${total} saved` : `${visible.length} of ${total}`;
}

async function loadRows({ force = false } = {}) {
  busy(true);
  try {
    const result = await send({ type: 'listRows', force });
    if (result?.ok) {
      state.rows = result.rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      render();
    } else if (result?.needsAuth) {
      setPill('Sign in needed', 'warn');
      showNotice('Your Google session expired.', 'Sign in', authorize);
    }
  } finally {
    busy(false);
  }
}

async function authorize() {
  const button = $('notice-action');
  button.disabled = true;
  busy(true);
  try {
    const result = await send({ type: 'authorize' });
    if (!result?.ok) return;
    $('notice').classList.add('hidden');
    setPill('Synced', 'ok');
    await loadRows({ force: true });
  } finally {
    button.disabled = false;
    busy(false);
  }
}

/**
 * The page's meta description, readable here because the toolbar click grants activeTab.
 * Ctrl+D captures can't do this without the <all_urls> permission, so only toolbar saves
 * carry a description — the sheet column doubles as a user-editable notes field.
 */
async function readDescription(tabId) {
  try {
    const [injection] = await api.scripting.executeScript({
      target: { tabId },
      func: () =>
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content ||
        '',
    });
    return injection?.result ?? '';
  } catch {
    return ''; // browser-internal pages refuse injection
  }
}

async function saveActiveTab() {
  const button = $('save-tab');
  const label = $('save-label');
  button.disabled = true;
  busy(true);

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      label.textContent = 'No tab to save';
      return;
    }

    const description = await readDescription(tab.id);
    const result = await send({ type: 'saveTab', tab: { title: tab.title ?? '', url: tab.url, description } });
    if (result?.ok) {
      label.textContent = result.deduped ? 'Already saved' : 'Saved';
      await loadRows({ force: true });
    } else if (result?.needsAuth) {
      label.textContent = 'Sign in needed';
      setPill('Sign in needed', 'warn');
      showNotice('Your Google session expired.', 'Sign in', authorize);
    } else {
      label.textContent = result?.error ? 'Could not save' : 'Not a savable page';
    }
  } finally {
    busy(false);
    setTimeout(() => {
      label.textContent = 'Save this tab';
      button.disabled = false;
    }, 1500);
  }
}

async function showActiveTabTitle() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  $('save-sub').textContent = tab?.title ?? '';
}

async function init() {
  // The refresh control is a full sync: push anything pending, then re-read every tab.
  $('refresh').onclick = async () => {
    busy(true);
    try {
      await send({ type: 'syncNow' });
    } finally {
      busy(false);
    }
    await loadRows({ force: true });
  };
  $('open-options').onclick = () => api.runtime.openOptionsPage();
  $('save-tab').onclick = saveActiveTab;
  $('search').oninput = (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  };

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== $('search')) {
      event.preventDefault();
      $('search').focus();
    }
  });

  const status = await send({ type: 'status' });
  state.sheetId = status?.sheetId ?? '';
  $('open-sheet').onclick = () => {
    if (state.sheetId) api.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${state.sheetId}` });
  };

  if (!status?.connected) {
    setPill('Not set up');
    $('open-sheet').classList.add('hidden');
    showNotice('Connect Google Sheets to start syncing bookmarks.', 'Open setup', () => api.runtime.openOptionsPage());
    return;
  }

  $('profile-label').textContent = status.profile;
  $('main').classList.remove('hidden');

  if (status.needsAuth) {
    setPill('Sign in needed', 'warn');
    showNotice('Your Google session expired.', 'Sign in', authorize);
  } else {
    setPill(status.queued ? `${status.queued} pending` : 'Synced', status.queued ? '' : 'ok');
  }

  await Promise.all([showActiveTabTitle(), loadRows()]);
}

init();
