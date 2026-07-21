/**
 * Everything that talks to the browser itself: the API alias, which browser and OS
 * we are running on, and reading the native bookmark tree.
 *
 * Firefox exposes `browser` with promise-returning APIs. Chromium exposes `chrome`,
 * which also returns promises for every API this extension uses under MV3, so a
 * single alias is enough and no polyfill is needed.
 */
export const api = globalThis.browser ?? globalThis.chrome;

/** The access token lives in session storage so it never touches disk. Firefox 115+. */
export const sessionStore = api.storage.session ?? api.storage.local;

const OS_NAMES = {
  mac: 'macOS',
  win: 'Windows',
  linux: 'Linux',
  cros: 'ChromeOS',
  android: 'Android',
  openbsd: 'OpenBSD',
};

/**
 * Best effort. Vivaldi hides itself from the user agent by default, so an occasional
 * wrong answer is expected — the profile label the user sets is the authoritative signal.
 */
export async function detectBrowser() {
  if (typeof api.runtime.getBrowserInfo === 'function') {
    try {
      const info = await api.runtime.getBrowserInfo();
      if (info?.name) return info.name;
    } catch {
      // fall through to user-agent sniffing
    }
  }

  if (globalThis.navigator?.brave) return 'Brave';

  const brands = (navigator.userAgentData?.brands ?? []).map((brand) => brand.brand);
  const hasBrand = (pattern) => brands.some((brand) => pattern.test(brand));
  if (hasBrand(/Vivaldi/i)) return 'Vivaldi';
  if (hasBrand(/Opera|OPR/i)) return 'Opera';
  if (hasBrand(/Microsoft Edge/i)) return 'Edge';

  const ua = navigator.userAgent;
  if (/Vivaldi/i.test(ua)) return 'Vivaldi';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  return 'Unknown';
}

export async function detectOs() {
  try {
    const { os } = await api.runtime.getPlatformInfo();
    return OS_NAMES[os] ?? os;
  } catch {
    return 'Unknown';
  }
}

/** `place:` (Firefox smart folders), `javascript:` and `chrome://` are not worth syncing. */
export const isSyncable = (url) => /^https?:\/\//i.test(url ?? '');

/**
 * Depth-first walk returning only real bookmarks, each tagged with the folder path it
 * was found under. The unnamed root contributes nothing to the path; "Bookmarks Bar" does.
 */
export function flattenTree(nodes, prefix = []) {
  const bookmarks = [];

  for (const node of nodes) {
    if (node.url) {
      if (!isSyncable(node.url)) continue;
      bookmarks.push({
        title: node.title || node.url,
        url: node.url,
        folder: prefix.join(' / '),
        dateAdded: node.dateAdded,
      });
    } else if (node.children) {
      bookmarks.push(...flattenTree(node.children, node.title ? [...prefix, node.title] : prefix));
    }
  }

  return bookmarks;
}

const MAX_DEPTH = 10;

/** Walks parentId upwards to reconstruct the folder path of a freshly created bookmark. */
export async function folderPathOf(parentId) {
  const parts = [];
  let id = parentId;

  for (let depth = 0; id && depth < MAX_DEPTH; depth += 1) {
    const [node] = await api.bookmarks.get(id).catch(() => []);
    if (!node) break;
    if (node.title) parts.unshift(node.title);
    id = node.parentId;
  }

  return parts.join(' / ');
}
