/**
 * A DOM and extension-API stand-in just rich enough to boot the real popup.js and
 * options.js. Not a browser — but it runs every line those entry points execute on load,
 * which is the surface the background-script tests never touch.
 */

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...c) {
    c.forEach((x) => this.set.add(x));
  }
  remove(...c) {
    c.forEach((x) => this.set.delete(x));
  }
  toggle(c, force) {
    const on = force ?? !this.set.has(c);
    on ? this.set.add(c) : this.set.delete(c);
    return on;
  }
  contains(c) {
    return this.set.has(c);
  }
  get value() {
    return [...this.set].join(' ');
  }
  set value(v) {
    this.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.classList = new ClassList();
    this.style = { setProperty() {} };
    this._text = '';
    this._attrs = {};
    this.value = '';
    this.placeholder = '';
    this.checked = false;
    this.disabled = false;
    this.onclick = null;
    this.oninput = null;
    this.onchange = null;
  }
  set className(v) {
    this.classList.value = v;
  }
  get className() {
    return this.classList.value;
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text || this.children.map((c) => c.textContent).join('');
  }
  setAttribute(k, v) {
    this._attrs[k] = String(v);
  }
  getAttribute(k) {
    return this._attrs[k] ?? null;
  }
  append(...nodes) {
    nodes.forEach((node) => (node.parentElement = this));
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    nodes.forEach((node) => (node.parentElement = this));
    this.children = nodes;
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  addEventListener() {}
  focus() {}
}

class Doc {
  constructor(html) {
    this.byId = new Map();
    // Seed each element's initial class list from its tag, so `hidden` starts out exactly
    // as the real page has it.
    for (const [tag, id] of html.matchAll(/<[^>]*\bid="([\w-]+)"[^>]*>/g)) {
      if (this.byId.has(id)) continue;
      const el = new El('div');
      const className = tag.match(/\bclass="([^"]*)"/);
      if (className) el.className = className[1];
      this.byId.set(id, el);
    }
    this.body = new El('body');
  }
  getElementById(id) {
    return this.byId.get(id) ?? null;
  }
  createElement(tag) {
    return new El(tag);
  }
  addEventListener() {}
}

/**
 * browser.js captures `api = globalThis.chrome` once at import and Node caches the module,
 * so every test in a process must share ONE chrome object. This context is swapped per
 * test; the stable chrome reads through to it.
 */
export const ctx = { status: {}, rows: [], messages: [], store: new Map(), connectResult: { ok: true } };

const stableChrome = {
  runtime: {
    sendMessage: async (msg) => {
      ctx.messages.push(msg);
      if (msg.type === 'status') return ctx.status;
      if (msg.type === 'listRows') return { ok: true, rows: ctx.rows };
      if (msg.type === 'connect') return ctx.connectResult;
      if (msg.type === 'isSaved') return { ok: true, saved: ctx.savedState ?? false };
      if (msg.type === 'saveTab') return { ok: true, row: { ...msg.tab, tab: 'Test', id: 'new-id', timestamp: '2026-07-23T10:00:00+05:30', browser: 'Chrome' } };
      if (msg.type === 'setNote') return { ok: true, note: String(msg.note ?? '').trim() };
      return { ok: true };
    },
    openOptionsPage: async () => {},
    getManifest: () => ({ version: '1.0.0' }),
    getPlatformInfo: async () => ({ os: 'mac' }),
    // no getBrowserInfo → detectBrowser falls through to user-agent sniffing
  },
  identity: { getRedirectURL: () => 'https://abc123.chromiumapp.org/' },
  tabs: {
    query: async () => [{ title: 'Sample Tab', url: 'https://sample.example/' }],
    create: async () => {},
  },
  storage: {
    local: {
      get: async (keys) => {
        const want = keys == null ? [...ctx.store.keys()] : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(want.filter((k) => ctx.store.has(k)).map((k) => [k, ctx.store.get(k)]));
      },
      set: async (p) => Object.entries(p).forEach(([k, v]) => ctx.store.set(k, v)),
      remove: async (k) => ctx.store.delete(k),
      clear: async () => ctx.store.clear(),
    },
  },
  permissions: { contains: async () => true, request: async () => true, remove: async () => true },
  scripting: {
    executeScript: async () => [
      { result: { description: 'A sample description', selection: '', site: 'Sample Site', words: 440 } },
    ],
  },
};

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let globalsReady = false;

export function installGlobals(html, { status = {}, rows = [] } = {}) {
  ctx.status = status;
  ctx.rows = rows;
  ctx.messages = [];
  ctx.store = new Map();
  globalThis.document = new Doc(html);

  if (globalsReady) return ctx;
  globalThis.chrome = stableChrome;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  globalThis.browser = undefined;
  // navigator is a read-only accessor global in Node; shadow it with defineProperty.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Safari/537.36',
      userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] },
      clipboard: { writeText: async (text) => { ctx.clipboard = text; } },
    },
  });
  globalsReady = true;
  return ctx;
}

/** Cache-bust so each test re-runs the entry point's top-level init(). */
export const freshImport = (module) => import(`${module}?t=${process.hrtime.bigint()}`);

export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
