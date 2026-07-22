const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const APPEND_CHUNK = 500;

/**
 * Column contract: a STABLE CORE (A–I) that never changes order, then extension columns
 * appended strictly at the tail — new features may only ever add columns after the last
 * one, never insert in the middle. Sparse optional data therefore clusters at the right
 * edge of the sheet instead of punching holes through the readable core.
 */
export const COLUMNS = [
  'timestamp', 'id', 'folder', 'browser', 'profile', 'os', 'source', 'title', 'url',
  'description', 'site', 'reading', 'visits', 'last_visit', 'account',
];

/** Ranges are derived from the column count so schema changes can never desync them. */
const LAST_COL = String.fromCharCode(64 + COLUMNS.length);

export class SheetsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SheetsError';
    this.status = status;
  }
}

async function request(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new SheetsError(`Sheets API ${response.status}: ${body.slice(0, 300)}`, response.status);
  }
  return response.status === 204 ? null : response.json();
}

const quoteTab = (tab) => `'${tab.replace(/'/g, "''")}'`;
const range = (tab, a1) => encodeURIComponent(`${quoteTab(tab)}!${a1}`);

/** Sheets rejects []*?:/\ in tab titles and caps length; profile labels become tab names. */
export function sanitizeTabTitle(label) {
  const cleaned = (label ?? '')
    .replace(/[[\]*?:/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'My browser';
}

/**
 * Every spreadsheet this app can list. Under drive.file the listing can ONLY contain
 * files the app itself created, so no name filter is needed — which is what makes sheet
 * reuse survive the user renaming or moving it. Newest-modified first.
 */
export async function findAppSheets(token) {
  const query = encodeURIComponent(`mimeType='${SHEET_MIME}' and trashed=false`);
  const data = await request(
    token,
    `${DRIVE}/files?q=${query}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&pageSize=25`,
  );
  return data.files ?? [];
}

/** True if the id still points at a live (non-trashed) file this app can reach. */
export async function sheetExists(token, sheetId) {
  try {
    const file = await request(token, `${DRIVE}/files/${sheetId}?fields=id,trashed`);
    return Boolean(file.id) && !file.trashed;
  } catch (error) {
    if (error instanceof SheetsError && (error.status === 404 || error.status === 403)) return false;
    throw error;
  }
}

/** Tabs are tracked by numeric id, not title, so users can rename them freely in Sheets. */
export async function listTabs(token, sheetId) {
  const meta = await request(token, `${BASE}/${sheetId}?fields=sheets.properties`);
  return (meta.sheets ?? []).map((sheet) => ({
    tabId: sheet.properties.sheetId,
    title: sheet.properties.title,
  }));
}

async function ensureHeader(token, sheetId, title) {
  const header = await request(token, `${BASE}/${sheetId}/values/${range(title, `A1:${LAST_COL}1`)}`);
  if (!header.values?.length) {
    await request(token, `${BASE}/${sheetId}/values/${range(title, 'A1')}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [COLUMNS] }),
    });
  }
}

/** Creates the spreadsheet with this install's tab already present. */
export async function createSheet(token, name, tabTitle) {
  const created = await request(token, BASE, {
    method: 'POST',
    body: JSON.stringify({ properties: { title: name }, sheets: [{ properties: { title: tabTitle } }] }),
  });
  const sheetId = created.spreadsheetId;
  const tabId = created.sheets?.[0]?.properties?.sheetId ?? 0;
  await ensureHeader(token, sheetId, tabTitle);
  return { sheetId, tabId, title: tabTitle };
}

/**
 * Adopts the tab with this title if one exists (a reinstall on the same browser), or
 * creates it. Returns the numeric tab id that all later writes key on.
 */
export async function ensureOwnTab(token, sheetId, title) {
  const tabs = await listTabs(token, sheetId);
  const existing = tabs.find((tab) => tab.title === title);
  if (existing) {
    await ensureHeader(token, sheetId, existing.title);
    return existing;
  }

  const reply = await request(token, `${BASE}/${sheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  const props = reply.replies?.[0]?.addSheet?.properties ?? {};
  await ensureHeader(token, sheetId, title);
  return { tabId: props.sheetId ?? 0, title };
}

/** The current title of a tab, or null if the user deleted it. */
export async function resolveTabTitle(token, sheetId, tabId) {
  const tabs = await listTabs(token, sheetId);
  return tabs.find((tab) => tab.tabId === tabId)?.title ?? null;
}

const toValues = (row) => COLUMNS.map((column) => row[column] ?? '');

/**
 * valueInputOption is RAW rather than USER_ENTERED so that a page title beginning
 * with `=` is stored as text instead of being evaluated as a spreadsheet formula.
 */
export async function appendRows(token, sheetId, tab, rows) {
  for (let offset = 0; offset < rows.length; offset += APPEND_CHUNK) {
    const chunk = rows.slice(offset, offset + APPEND_CHUNK).map(toValues);
    await request(
      token,
      `${BASE}/${sheetId}/values/${range(tab, `A:${LAST_COL}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: chunk }) },
    );
  }
}

const toRow = (values) => Object.fromEntries(COLUMNS.map((column, index) => [column, values[index] ?? '']));

/** Rows of a single tab, headers skipped. */
export async function readTabRows(token, sheetId, tab) {
  const data = await request(token, `${BASE}/${sheetId}/values/${range(tab, `A2:${LAST_COL}`)}?majorDimension=ROWS`);
  return (data.values ?? []).map(toRow);
}

/**
 * Every tab's rows in two calls (metadata + batchGet), so the popup can show the union
 * of all browsers and the importer can tell foreign tabs from this install's own.
 */
export async function readAllTabs(token, sheetId) {
  const tabs = await listTabs(token, sheetId);
  if (!tabs.length) return [];

  const ranges = tabs.map((tab) => `ranges=${range(tab.title, `A2:${LAST_COL}`)}`).join('&');
  const data = await request(token, `${BASE}/${sheetId}/values:batchGet?majorDimension=ROWS&${ranges}`);
  const valueRanges = data.valueRanges ?? [];

  return tabs.map((tab, index) => ({
    ...tab,
    rows: (valueRanges[index]?.values ?? []).map(toRow),
  }));
}
