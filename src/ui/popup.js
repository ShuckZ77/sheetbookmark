import { api, isSyncable } from '../lib/browser.js';

const $ = (id) => document.getElementById(id);
const send = (message) => api.runtime.sendMessage(message);

const RENDER_CHUNK = 60;

const state = { rows: [], query: '', browser: null, sheetId: '', renderLimit: RENDER_CHUNK };

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

let alreadySaved = false;

const saveLabelText = () => (alreadySaved ? '✓ Already saved' : 'Save this tab');

function paintSaveState() {
  $('save-label').textContent = saveLabelText();
  $('save-tab').classList.toggle('is-saved', alreadySaved);
}

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
  const haystack = `${row.title} ${row.url} ${row.note} ${row.folder}`.toLowerCase();
  return state.query.split(/\s+/).every((term) => haystack.includes(term));
}

let openEditor = null; // exactly one note editor exists at a time, whatever the list size

function closeEditor() {
  openEditor?.remove();
  openEditor = null;
}

function editNote(item, row) {
  if (openEditor?.parentElement === item) return closeEditor();
  closeEditor();

  const editor = document.createElement('div');
  editor.className = 'note-editor';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 500;
  input.placeholder = 'Add a note…';
  input.value = row.note ?? '';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-primary note-save';
  save.textContent = 'Save';

  const commit = async () => {
    save.disabled = true;
    const result = await send({ type: 'setNote', tab: row.tab, id: row.id, note: input.value });
    if (result?.ok) {
      row.note = result.note;
      closeEditor();
    } else {
      save.disabled = false;
      input.placeholder = result?.error ?? 'Could not save note';
      input.value = '';
    }
  };

  save.onclick = commit;
  input.onkeydown = (event) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') closeEditor();
  };

  editor.append(input, save);
  item.append(editor);
  openEditor = editor;
  input.focus();
}

function buildRow(row, index) {
  const host = hostOf(row.url);

  const item = document.createElement('li');
  item.className = 'row';
  item.style.setProperty('--i', String(Math.min(index, 14)));

  const line = document.createElement('div');
  line.className = 'row-line';

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

  const noteButton = document.createElement('button');
  noteButton.className = `note-btn${row.note ? ' has-note' : ''}`;
  noteButton.type = 'button';
  noteButton.title = row.note ? `Note: ${row.note}` : 'Add a note';
  noteButton.textContent = '✎';
  noteButton.onclick = () => editNote(item, row);

  line.append(button, noteButton);
  item.append(line);
  return item;
}

/** Fires only when the list bottom scrolls into view; renders the next chunk. */
const moreObserver = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) {
    state.renderLimit += RENDER_CHUNK;
    render();
  }
});

function render() {
  closeEditor();
  moreObserver.disconnect();

  const visible = state.rows.filter(matches);
  renderChips();

  const shown = visible.slice(0, state.renderLimit).map(buildRow);
  $('list').replaceChildren(...shown);
  if (visible.length > state.renderLimit && shown.length) moreObserver.observe(shown[shown.length - 1]);
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
 * Page details, readable here because the toolbar click grants activeTab. Ctrl+D captures
 * can't run this without <all_urls>, so only toolbar saves carry them. The note field is
 * pre-filled from the user's selection (first choice) or the page description — and is
 * theirs to edit before saving.
 */
let pageDetails = {};
async function readPageDetails(tabId) {
  try {
    const [injection] = await api.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta = (selector) => document.querySelector(selector)?.content || '';
        const selection = (window.getSelection?.().toString() || '').trim();
        const words = (document.body?.innerText || '').trim().split(/\s+/).filter(Boolean).length;
        return {
          description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
          selection,
          site: meta('meta[property="og:site_name"]'),
          words,
        };
      },
    });
    return injection?.result ?? {};
  } catch {
    return {}; // browser-internal pages refuse injection
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

    const result = await send({
      type: 'saveTab',
      tab: {
        title: tab.title ?? '',
        url: tab.url,
        note: $('note').value.trim().slice(0, 500),
      },
    });
    if (result?.ok) {
      label.textContent = result.deduped ? 'Already saved' : 'Saved ✓';
      button.classList.add('pop');
      setTimeout(() => button.classList.remove('pop'), 400);
      alreadySaved = true;
      // The row we just wrote goes straight on top — no network round-trip needed.
      if (result.row) {
        state.rows.unshift(result.row);
        render();
      }
      $('note').value = '';
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
      paintSaveState();
      button.disabled = false;
    }, 1500);
  }
}

/**
 * On open: the button tells the truth (already-saved pages say so), and the note field
 * is pre-filled so saving with a note is one glance and one click.
 */
async function showActiveTabState() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  $('save-sub').textContent = tab?.title ?? '';
  if (!tab?.url) return;

  const [saved, page] = await Promise.all([send({ type: 'isSaved', url: tab.url }), readPageDetails(tab.id)]);
  alreadySaved = Boolean(saved?.saved);
  paintSaveState();
  pageDetails = page;
  if (!$('note').value) $('note').value = ((page.selection || page.description) ?? '').trim().slice(0, 500);
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
    state.renderLimit = RENDER_CHUNK;
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

  await Promise.all([showActiveTabState(), loadRows()]);
}

init();
