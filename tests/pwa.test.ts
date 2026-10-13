// tests/pwa.test.ts — the installable app (ARCHITECTURE §13.11, DESIGN §15.11): where the game runs (src/ui/platform.ts:
// standalone, iOS, Safari, from probes of matchMedia and navigator), what the Menu and the title offer there, the Safari
// reminder only in a Safari tab; the service worker's build step (scripts/precache.ts) and its template (public/sw.js),
// run over stand-in caches and network; the manifest, index.html's links, and the icons: their sizes, an opaque ground,
// and the aquila at whole-number scales, inside the safe circle on the maskable one. Headless: platform.ts does no DOM work at import.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import {
  bringLabel, isIOS, isSafari, isStandalone, keepCopyWhy, menuEntries, persistLine, platformOf, safariTab,
} from '../src/ui/platform';
import type { Hands, Platform, Probe } from '../src/ui/platform';
import { SW_FILE, buildId, precacheFiles, swSource } from '../scripts/precache';

const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
} as const;

/** A matchMedia that matches the given display modes only. */
const modes = (...m: string[]): Probe['matchMedia'] => (q: string) => ({ matches: m.some((d) => q === `(display-mode: ${d})`) });
const nav = (ua: string, extra: Partial<NonNullable<Probe['navigator']>> = {}): Probe['navigator'] => ({ userAgent: ua, platform: 'iPhone', maxTouchPoints: 5, ...extra });

describe('where the game runs (src/ui/platform.ts)', () => {
  it('standalone: an app display mode, or iOS’s own flag; a browser tab is none', () => {
    const rows: [Probe, boolean][] = [
      [{ matchMedia: modes('standalone') }, true],
      [{ matchMedia: modes('fullscreen') }, true],
      [{ matchMedia: modes('minimal-ui') }, true],
      [{ matchMedia: modes('browser') }, false],
      [{ matchMedia: modes(), navigator: { standalone: true } }, true],    // iOS before display-mode
      [{ matchMedia: modes(), navigator: { standalone: false } }, false],
      [{}, false],                                                         // no matchMedia at all
      [{ matchMedia: () => { throw new Error('no'); } }, false],
    ];
    for (const [p, want] of rows) expect(isStandalone(p), JSON.stringify(p.navigator ?? null)).toBe(want);
  });

  it('iOS: an iPhone, an iPad, an iPad asking for the desktop site; not a Mac, not Android', () => {
    expect(isIOS({ navigator: nav(UA.iphoneSafari) })).toBe(true);
    expect(isIOS({ navigator: nav(UA.iphoneApp) })).toBe(true);
    expect(isIOS({ navigator: nav(UA.ipadSafari, { platform: 'iPad' }) })).toBe(true);
    expect(isIOS({ navigator: nav(UA.macSafari, { platform: 'MacIntel', maxTouchPoints: 5 }) })).toBe(true);
    expect(isIOS({ navigator: nav(UA.macSafari, { platform: 'MacIntel', maxTouchPoints: 0 }) })).toBe(false);
    expect(isIOS({ navigator: nav(UA.androidChrome, { platform: 'Linux armv8l' }) })).toBe(false);
    expect(isIOS({})).toBe(false);
  });

  it('Safari: Safari on the iPhone, the iPad and the Mac; no other browser, nor the Home Screen app', () => {
    const rows: [string, boolean][] = [
      [UA.iphoneSafari, true], [UA.ipadSafari, true], [UA.macSafari, true], [UA.iphoneApp, false], [UA.iphoneChrome, false],
      [UA.iphoneFirefox, false], [UA.androidChrome, false], [UA.samsung, false], [UA.winChrome, false], [UA.edge, false], [UA.firefox, false],
      [UA.headless, false],
    ];
    for (const [ua, want] of rows) expect(isSafari({ navigator: nav(ua) }), ua).toBe(want);
  });

  it('the Safari reminder only in a Safari tab: never in the app, nor in another browser', () => {
    const tab = platformOf({ matchMedia: modes('browser'), navigator: nav(UA.iphoneSafari) });
    const app = platformOf({ matchMedia: modes('standalone'), navigator: nav(UA.iphoneApp) });
    const appSafariUa = platformOf({ matchMedia: modes('standalone'), navigator: nav(UA.iphoneSafari) });
    const chrome = platformOf({ matchMedia: modes('browser'), navigator: nav(UA.winChrome, { platform: 'Win32', maxTouchPoints: 0 }) });
    expect(safariTab(tab)).toBe(true);
    expect([app, appSafariUa, chrome].map(safariTab)).toEqual([false, false, false]);
    expect(keepCopyWhy(tab)).toBe('The colony lives only in this browser, and Safari forgets sites left unvisited for a week.');
    expect(keepCopyWhy(app)).toBe('The colony lives only in this app.');
    expect(keepCopyWhy(appSafariUa)).not.toMatch(/Safari/);
    expect(keepCopyWhy(chrome)).toBe('The colony lives only in this browser.');
  });

  it('the Menu by platform: Copy save in an iOS tab, Full screen on Android-like touch, storage where it can say', () => {
    const P = (standalone: boolean, ios: boolean, fullscreen: boolean): Platform => ({ standalone, ios, safari: ios, fullscreen });
    const rows: [string, Platform, Hands, { copy: boolean; fullscreen: boolean }][] = [
      ['iPhone, Safari tab', P(false, true, false), 'touch', { copy: true, fullscreen: false }],
      ['iPhone, Home Screen app', P(true, true, false), 'touch', { copy: false, fullscreen: false }],
      ['iPad, Safari tab (fullscreen API, swiped away)', P(false, true, true), 'touch', { copy: true, fullscreen: false }],
      ['iPad with a trackpad, Safari tab', P(false, true, true), 'mixed', { copy: true, fullscreen: false }],
      ['Android phone, Chrome tab (an installed app shares its storage)', P(false, false, true), 'touch', { copy: false, fullscreen: true }],
      ['Android phone, installed app', P(true, false, true), 'touch', { copy: false, fullscreen: true }],
      ['Android phone without the fullscreen API', P(false, false, false), 'touch', { copy: false, fullscreen: false }],
      ['iPhone, Chrome tab (its Home Screen app is apart too)', { standalone: false, ios: true, safari: false, fullscreen: false }, 'touch', { copy: true, fullscreen: false }],
      ['Mac, Safari tab', { standalone: false, ios: false, safari: true, fullscreen: true }, 'mouse', { copy: false, fullscreen: false }],
      ['Chromebook, touch and trackpad', P(false, false, true), 'mixed', { copy: false, fullscreen: true }],
      ['desktop, a mouse', P(false, false, true), 'mouse', { copy: false, fullscreen: false }],
      ['desktop, installed app', P(true, false, true), 'mouse', { copy: false, fullscreen: false }],
    ];
    for (const [what, pl, hands, want] of rows) {
      expect(menuEntries(pl, hands, true), what).toEqual({ ...want, persist: true });
      expect(menuEntries(pl, hands, false).persist, what).toBe(false);
    }
  });

  it('the title’s hand-off: only in an iOS Home Screen app (its storage apart from Safari’s) with no colony yet', () => {
    const iosApp: Platform = { standalone: true, ios: true, safari: false, fullscreen: false };
    const androidApp: Platform = { standalone: true, ios: false, safari: false, fullscreen: true };
    const desktopApp: Platform = { standalone: true, ios: false, safari: false, fullscreen: true };
    const tab: Platform = { standalone: false, ios: true, safari: true, fullscreen: false };
    expect(bringLabel(iosApp, false)).toBe('Bring your colony from Safari');
    expect(bringLabel(androidApp, false)).toBeNull();   // an installed app shares the browser's storage
    expect(bringLabel(desktopApp, false)).toBeNull();
    expect(bringLabel(iosApp, true)).toBeNull();
    expect(bringLabel(tab, false)).toBeNull();
  });

  it('the storage line says persistent, not, or that the browser cannot say', () => {
    expect(persistLine(true)).toMatch(/^Persistent/);
    expect(persistLine(false)).toMatch(/^Not persistent/);
    expect(persistLine(null)).toMatch(/cannot say/);
  });
});

describe('the service worker (scripts/precache.ts, public/sw.js)', () => {
  it('precaches the build but the worker, source maps and a woff whose woff2 is there', () => {
    const files = ['index.html', 'sw.js', 'assets/index-AbC123_x.js', 'assets/index-AbC123_x.js.map', 'assets/index-Qq9.css',
      'assets/silkscreen-latin-400-normal-CtPo2yA5.woff2', 'assets/silkscreen-latin-400-normal-D0DfPJut.woff', 'assets/only-woff-Zz1.woff',
      'icons/icon-192.png', 'manifest.webmanifest', 'favicon.svg', 'index.html'];
    expect(precacheFiles(files)).toEqual(['assets/index-AbC123_x.js', 'assets/index-Qq9.css', 'assets/only-woff-Zz1.woff',
      'assets/silkscreen-latin-400-normal-CtPo2yA5.woff2', 'favicon.svg', 'icons/icon-192.png', 'index.html', 'manifest.webmanifest']);
    for (const f of precacheFiles(files)) expect(f.startsWith('/') || f.startsWith('http'), f).toBe(false);   // relative: any sub-path
  });

  it('the build id follows every byte and name, not the order files were listed in', () => {
    const a = { file: 'index.html', bytes: new Uint8Array([1, 2, 3]) }, b = { file: 'assets/x.js', bytes: new Uint8Array([4]) };
    const id = buildId([a, b]);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(buildId([b, a])).toBe(id);
    expect(buildId([a, { ...b, bytes: new Uint8Array([5]) }])).not.toBe(id);
    expect(buildId([a, { ...b, file: 'assets/y.js' }])).not.toBe(id);
  });

  it('public/sw.js carries the two lines the build writes, and the written worker parses', () => {
    const tpl = readFileSync(join(PUBLIC, SW_FILE), 'utf8');
    const out = swSource(tpl, 'abc123def456', ['assets/index-1.js', 'index.html']);
    expect(out).toContain("const BUILD = 'abc123def456';");
    expect(out).toContain('const PRECACHE = ["assets/index-1.js","index.html"];');
    expect(out).not.toContain("const BUILD = 'dev';");
    expect(() => new Function(out)).not.toThrow();
    expect(() => swSource('self.x = 1;', 'abc', [])).toThrow(/BUILD or PRECACHE/);
    expect(() => swSource(tpl, "a'b", [])).toThrow();
  });

  it('the worker stays in its folder: relative URLs, no other origin', () => {
    const tpl = readFileSync(join(PUBLIC, SW_FILE), 'utf8');
    expect(tpl).toMatch(/url\.origin !== self\.location\.origin/);
    expect(tpl).toMatch(/new URL\('\.\/', self\.location\.href\)/);
    expect(tpl).not.toMatch(/['"`]\/(?!\/)/);   // no root-absolute path: the app lives in a sub-path
  });

  it('install fetches past the HTTP cache into a cache named for the folder and the build; activate drops only the folder’s older ones', async () => {
    const w = worker('/Roma2/', 'b2', ['index.html', 'assets/index-1.js']);
    w.storage.set('castra-/Roma2/-b1', new Map());     // this folder's last build
    w.storage.set('castra-/Roma3/-b1', new Map());     // another repo's pages, same origin
    w.storage.set('other', new Map());
    await w.emit('install');
    expect([...w.storage.get('castra-/Roma2/-b2')!.keys()]).toEqual([`${ORIGIN}/Roma2/`, `${ORIGIN}/Roma2/index.html`, `${ORIGIN}/Roma2/assets/index-1.js`]);
    expect(w.asked.map((a) => a.cache)).toEqual(['reload', 'reload', 'reload']);   // never an older page kept by the browser
    await w.emit('activate');
    expect([...w.storage.keys()].sort()).toEqual(['castra-/Roma2/-b2', 'castra-/Roma3/-b1', 'other']);
  });

  it('the app’s page network first, revalidated and kept; offline the kept one; another file opened in a tab is left alone', async () => {
    const w = worker('/Roma2/', 'b2', ['index.html']);
    await w.emit('install');
    w.net[`${ORIGIN}/Roma2/`] = { body: 'page B' };
    expect(await w.navigate(`${ORIGIN}/Roma2/?dev`)).toBe('page B');
    expect(w.asked.at(-1)?.cache).toBe('no-cache');
    expect(await w.kept()).toBe('page B');
    // sw.js, the manifest, an icon opened in a tab: not answered by the worker, so never kept as the page
    for (const f of ['sw.js', 'manifest.webmanifest', 'icons/icon-192.png']) expect(await w.navigate(`${ORIGIN}/Roma2/${f}`), f).toBeNull();
    expect(await w.navigate(`${ORIGIN}/Roma3/`)).toBeNull();   // another folder
    w.net[`${ORIGIN}/Roma2/index.html`] = { body: 'not a page', type: 'text/plain' };
    expect(await w.navigate(`${ORIGIN}/Roma2/index.html`)).toBe('not a page');
    expect(await w.kept()).toBe('page B');                      // only a page is kept
    w.online = false;
    expect(await w.navigate(`${ORIGIN}/Roma2/`)).toBe('page B');
  });
});

const ORIGIN = 'https://someone.github.io';
type Ev = { waitUntil(p: Promise<unknown>): void; respondWith(p: Promise<Response>): void; request?: { url: string; method: string; mode: string } };
/** Runs the written worker (`build`, `files`) of the folder `folder` in a stand-in of its scope: the origin's Cache
 *  Storage and the network are maps, and every fetch is recorded with its cache mode. */
function worker(folder: string, build: string, files: string[]) {
  const on: Record<string, (e: Ev) => void> = {};
  const storage = new Map<string, Map<string, Response>>();
  const net: Record<string, { body: string; type?: string }> = {};
  for (const f of ['', ...files]) net[`${ORIGIN}${folder}${f}`] = { body: `file ${f}` };
  const asked: { url: string; cache: string }[] = [];
  const st = { online: true };
  const url = (r: string | { url: string }): string => (typeof r === 'string' ? r : r.url);
  const fetch = async (input: string | { url: string }, init?: RequestInit): Promise<Response> => {
    const req = new Request(url(input), init ?? (input instanceof Request ? input : undefined));
    asked.push({ url: req.url, cache: req.cache });
    if (!st.online) throw new TypeError('offline');
    const f = net[req.url.split('?')[0]];
    return f ? new Response(f.body, { headers: { 'content-type': f.type ?? 'text/html' } }) : new Response('', { status: 404 });
  };
  const open = (name: string): Map<string, Response> => {
    if (!storage.has(name)) storage.set(name, new Map());
    return storage.get(name)!;
  };
  const caches = {
    open: async (name: string) => {
      const m = open(name);
      return {
        addAll: async (reqs: Request[]) => { for (const r of reqs) m.set(r.url, await fetch(r)); },
        put: async (r: string | { url: string }, res: Response) => { m.set(url(r), res); },
        match: async (r: string | { url: string }, o?: { ignoreSearch?: boolean }) => m.get(o?.ignoreSearch ? url(r).split('?')[0] : url(r))?.clone(),
      };
    },
    keys: async () => [...storage.keys()],
    delete: async (name: string) => storage.delete(name),
  };
  const scope = { location: new URL(`${ORIGIN}${folder}sw.js`), addEventListener: (t: string, f: (e: Ev) => void) => { on[t] = f; },
    skipWaiting: async () => undefined, clients: { claim: async () => undefined } };
  const src = swSource(readFileSync(join(PUBLIC, SW_FILE), 'utf8'), build, files);
  new Function('self', 'caches', 'fetch', src)(scope, caches, fetch);
  /** Fires an event; the promise its handler handed back (waitUntil or respondWith), or null when it handed none. */
  const emit = async (type: string, request?: Ev['request']): Promise<unknown> => {
    let p: Promise<unknown> | null = null;
    on[type]({ request, waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; } });
    return p;
  };
  return {
    storage, net, asked, emit,
    set online(v: boolean) { st.online = v; },
    /** A navigation's answer from the worker (the body), or null when the worker leaves it to the network. */
    navigate: async (u: string): Promise<string | null> => {
      const res = (await emit('fetch', { url: u, method: 'GET', mode: 'navigate' })) as Response | null;
      return res ? res.text() : null;
    },
    /** The page the worker keeps for an offline launch. */
    kept: async (): Promise<string | undefined> => (await (await caches.open(`castra-${folder}-${build}`)).match(`${ORIGIN}${folder}`))?.text(),
  };
}

// ───────────────────────────── the manifest, index.html and the icons ─────────────────────────────
interface Png { w: number; h: number; px: Buffer }   // px: RGB, 3 bytes a pixel
/** Reads the 8-bit RGB PNGs scripts/icons.mjs writes (filter 0 on every row). */
function readPng(file: string): Png {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let p = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]], `${file}: 8-bit RGB, not interlaced`).toEqual([8, 2, 0]);
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 3 + 1)]).toBe(0);
    raw.copy(px, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  }
  return { w, h, px };
}
const at = (g: Png, x: number, y: number): string => g.px.subarray((y * g.w + x) * 3, (y * g.w + x) * 3 + 3).toString('hex');

const GROUND = '15100d';
const ICONS = [
  { file: 'icons/apple-touch-icon-180.png', size: 180, scale: 5 },
  { file: 'icons/icon-192.png', size: 192, scale: 5 },
  { file: 'icons/icon-512.png', size: 512, scale: 14 },
  { file: 'icons/icon-512-maskable.png', size: 512, scale: 9, maskable: true },
] as const;

describe('the installable app: manifest, links and icons', () => {
  it('the manifest names the app, opens standalone in its own folder, on the chrome’s colour, with its icons', () => {
    const m = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ name: 'Castra Valeria', short_name: 'Castra', display: 'standalone', start_url: '.', scope: '.', background_color: '#15100d', theme_color: '#15100d' });
    expect(m.id).toBeUndefined();   // (an id would resolve against the origin, shared by every Pages repo: start_url is the id)
    const icons = m.icons as { src: string; sizes: string; type: string; purpose?: string }[];
    for (const i of icons) {
      expect(i.src.startsWith('/'), i.src).toBe(false);
      expect(existsSync(join(PUBLIC, i.src)), i.src).toBe(true);
      if (i.type === 'image/png') {
        const g = readPng(join(PUBLIC, i.src));
        expect(`${g.w}x${g.h}`, i.src).toBe(i.sizes);
      }
    }
    const png = (size: string, purpose: string): boolean => icons.some((i) => i.type === 'image/png' && i.sizes === size && (i.purpose ?? 'any').split(' ').includes(purpose));
    expect([png('192x192', 'any'), png('512x512', 'any'), png('512x512', 'maskable')]).toEqual([true, true, true]);
  });

  it('index.html links the manifest and the Home Screen icon by relative paths, with the web-app metas', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+" \/>/);
    expect(html).toContain('<meta name="theme-color" content="#15100d" />');
    for (const [, href] of html.matchAll(/<link [^>]*href="([^"]+)"/g)) {
      expect(href.startsWith('/') || /^https?:/.test(href), href).toBe(false);
      expect(existsSync(join(PUBLIC, href)), href).toBe(true);
    }
  });

  it('every icon: its size, an opaque ground, the aquila centred at a whole-number scale, the same art in each', () => {
    let cells: string | null = null;
    for (const ic of ICONS) {
      const g = readPng(join(PUBLIC, ic.file));
      expect([g.w, g.h], ic.file).toEqual([ic.size, ic.size]);
      for (const [x, y] of [[0, 0], [ic.size - 1, 0], [0, ic.size - 1], [ic.size - 1, ic.size - 1]]) expect(at(g, x, y), ic.file).toBe(GROUND);
      const k = ic.scale, off = (ic.size - 32 * k) / 2;
      expect(Number.isInteger(off) && off >= 0, ic.file).toBe(true);
      // outside the art's square: only ground
      for (let y = 0; y < ic.size; y++)
        for (let x = 0; x < ic.size; x++) {
          const inside = x >= off && x < off + 32 * k && y >= off && y < off + 32 * k;
          if (!inside) expect(at(g, x, y), `${ic.file} ${x},${y}`).toBe(GROUND);
        }
      // inside: every art pixel a whole k × k square of one colour
      let grid = '';
      for (let cy = 0; cy < 32; cy++)
        for (let cx = 0; cx < 32; cx++) {
          const c = at(g, off + cx * k, off + cy * k);
          for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) if (at(g, off + cx * k + dx, off + cy * k + dy) !== c) throw new Error(`${ic.file}: art pixel ${cx},${cy} is not a whole ${k}× square`);
          grid += c;
        }
      expect(grid.split(GROUND).length, `${ic.file}: the aquila is drawn`).toBeGreaterThan(100);
      if (cells === null) cells = grid; else expect(grid === cells, `${ic.file}: the same art as the others`).toBe(true);
      if ('maskable' in ic && ic.maskable) {
        // the safe circle (radius 40% of the side): the art's square, corners included, lies inside it
        const r = Math.hypot(16 * k, 16 * k);
        expect(r, ic.file).toBeLessThanOrEqual(0.4 * ic.size);
      }
    }
  });
});
