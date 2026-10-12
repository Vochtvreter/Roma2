// src/ui/platform.ts — where the game runs (DESIGN §15.11, ARCHITECTURE §13.11): a browser tab or an installed app (from
// the Home Screen: standalone), on iOS or not, in Safari or not; and what follows from it. Owner: WP-H.
// Since iOS 26 a site added to the Home Screen opens as its own web app, with storage apart from Safari's: a colony begun
// in Safari is not there. So an iOS tab offers to copy its save (the Menu), and the app, empty, to bring it in (the
// title), through the clipboard (an installed app on Android or a desktop shares the browser's storage: neither shows); Safari's 7-day eviction of a site's storage is mentioned only in a Safari tab (the app
// keeps its own); the app asks once for persistent storage, which the Menu reports; and an Android-like touch device gets
// a Full screen toggle (iOS has none on the iPhone, and on the iPad a swipe drops it). The pure part (tests/pwa.test.ts)
// reads a probe of the window — its matchMedia, navigator and document.fullscreenEnabled — so tables can test every
// platform; the DOM part reads the real one, and does nothing at import (headless tests import the modules that use it).

/** What the pure helpers read of the window (each part optional: a test passes only what it varies). */
export interface Probe {
  matchMedia?: (q: string) => { matches: boolean };
  navigator?: { standalone?: boolean; userAgent?: string; platform?: string; maxTouchPoints?: number };
  fullscreenEnabled?: boolean;
}

/** The platform as the UI needs it. */
export interface Platform {
  standalone: boolean;   // an installed app or a Home Screen web app, not a browser tab
  ios: boolean;          // an iPhone or an iPad (iPadOS says it is a Mac: a Mac with a touch screen is an iPad)
  safari: boolean;       // Safari itself (not Chrome, Firefox or Edge for iOS, nor any other browser)
  fullscreen: boolean;   // document.fullscreenEnabled
}

const DISPLAY_APP = ['standalone', 'fullscreen', 'minimal-ui'] as const;

/** Running as an app, not in a browser tab: a display mode other than the browser's, or iOS's own flag. */
export function isStandalone(p: Probe): boolean {
  const mm = p.matchMedia;
  if (mm && DISPLAY_APP.some((d) => { try { return mm(`(display-mode: ${d})`).matches; } catch { return false; } })) return true;
  return p.navigator?.standalone === true;
}

/** An iPhone, iPod or iPad (also an iPad that asks for the desktop site: a 'MacIntel' with touch points). */
export function isIOS(p: Probe): boolean {
  const n = p.navigator;
  if (!n) return false;
  if (/\b(iPhone|iPad|iPod)\b/.test(n.userAgent ?? '')) return true;
  return n.platform === 'MacIntel' && (n.maxTouchPoints ?? 0) > 1;
}

/** Safari (macOS, iOS, iPadOS): a WebKit 'Safari' user agent that names no other browser. */
export function isSafari(p: Probe): boolean {
  const ua = p.navigator?.userAgent ?? '';
  // (no word boundary before the brands: 'HeadlessChrome', 'YaBrowser … Chrome' are Chrome too)
  return /\bSafari\//.test(ua) && /\bAppleWebKit\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|EdgA?\/|OPR\/|OPiOS|SamsungBrowser|Android)/.test(ua);
}

/** The platform of a probe (pure). */
export function platformOf(p: Probe): Platform {
  return { standalone: isStandalone(p), ios: isIOS(p), safari: isSafari(p), fullscreen: p.fullscreenEnabled === true };
}

/** A Safari tab: the one place a site's storage is wiped after 7 days of Safari use without a visit. */
export function safariTab(pl: Platform): boolean {
  return pl.safari && !pl.standalone;
}

/** Why to keep a copy of the colony (pure): it lives only here; in a Safari tab, also the 7-day rule. */
export function keepCopyWhy(pl: Platform): string {
  const where = pl.standalone ? 'The colony lives only in this app' : 'The colony lives only in this browser';
  return safariTab(pl) ? `${where}, and Safari forgets sites left unvisited for a week.` : `${where}.`;
}

/** The hands in use, as the layout classes them (layout.ts InputClass, kept apart here to stay import-free). */
export type Hands = 'touch' | 'mixed' | 'mouse';

/** The Menu's platform entries (pure; tests/pwa.test.ts). `copy`: the one-tap copy of the save for the Home Screen app,
 *  in a browser tab on iOS only, the one place whose Home Screen app keeps its storage apart from the tab's (an installed
 *  app on Android or a desktop shares the browser's: nothing to bring over); never in the app itself. `fullscreen`: the
 *  Full screen toggle, where the browser offers it on an Android-like touch device (touch or mixed hands, not iOS: an
 *  iPhone has no fullscreen, and on an iPad a swipe drops it). `persist`: the storage line, wherever the browser can say. */
export function menuEntries(pl: Platform, hands: Hands, storage: boolean): { copy: boolean; fullscreen: boolean; persist: boolean } {
  return {
    copy: !pl.standalone && pl.ios,
    fullscreen: pl.fullscreen && !pl.ios && hands !== 'mouse',
    persist: storage,
  };
}

/** The title's hand-off button (pure): only in a Home Screen app on iOS (its storage apart from Safari's: an installed
 *  app elsewhere shares the browser's), and only while it holds no colony. Null when there is none to show. */
export function bringLabel(pl: Platform, hasSave: boolean): string | null {
  return pl.standalone && pl.ios && !hasSave ? 'Bring your colony from Safari' : null;
}

/** The Menu's storage line (pure): persistent, not, or unknown (the browser cannot say). */
export function persistLine(persisted: boolean | null): string {
  if (persisted === null) return 'This browser cannot say whether it keeps the colony';
  return persisted ? 'Persistent: the browser keeps the colony' : 'Not persistent: the browser may clear it (keep a copy)';
}

// ───────────────────────────── the DOM part ─────────────────────────────
/** The platform of this window. */
export function platform(): Platform {
  if (typeof window === 'undefined') return { standalone: false, ios: false, safari: false, fullscreen: false };
  return platformOf({
    matchMedia: typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined,
    navigator: window.navigator as Probe['navigator'],
    fullscreenEnabled: typeof document !== 'undefined' && document.fullscreenEnabled === true,
  });
}

/** Whether the browser keeps this origin's storage (navigator.storage.persisted), or null when it cannot say. */
export async function storagePersisted(): Promise<boolean | null> {
  try { return (await navigator.storage?.persisted?.()) ?? null; } catch { return null; }
}

let persistAsked = false;
/** Asks the browser, once a session, not to evict this origin's storage (WebKit grants it to Home Screen apps). */
export function askPersist(): void {
  if (persistAsked) return;
  persistAsked = true;
  try { void navigator.storage?.persist?.().catch(() => false); } catch { /* not offered */ }
}

/** Writes `text` to the clipboard; false when the browser has no clipboard or refuses (the caller shows it to copy). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

/** How long a clipboard read may wait on the browser's own prompt (Safari's Paste callout, Chrome's permission) before
 *  the paste sheet opens instead: an unanswered prompt never leaves the button doing nothing. */
const PASTE_WAIT_MS = 10_000;

/** The clipboard's text, or null when the browser has no clipboard, refuses, holds none, or its prompt goes unanswered
 *  (the caller asks to paste). */
export async function pasteText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    const late = new Promise<null>((done) => { window.setTimeout(() => done(null), PASTE_WAIT_MS); });
    const t = await Promise.race([navigator.clipboard.readText(), late]);
    return t && t.trim() ? t : null;
  } catch { return null; }
}

/** The page is in full screen now. */
export function inFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** Enters full screen (the whole page: the HUD and the panels with the map), or leaves it. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* refused (no user gesture, or not allowed here) */ }
}

/** Registers the offline worker (public/sw.js; production builds only: main.ts), from the app's own folder (a relative
 *  URL: the GitHub Pages sub-path is its scope). `updated` runs when a newer build has taken over a page older than it:
 *  the next launch runs it. The page is network first, so an online launch already runs the newest build, and the
 *  worker that takes over then is its own: a page is older only when its own script (`script`: main.ts's
 *  import.meta.url) is not among the caches once the new worker is activated (its activate deletes the old cache; the
 *  page's controller changes before that, as the activation starts). */
export function registerWorker(script: string, updated: () => void): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const had = !!navigator.serviceWorker.controller;   // a first install takes over too: that is no update
  const check = (): void => { void caches.match(script).then((mine) => { if (!mine) updated(); }, () => undefined); };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const sw = navigator.serviceWorker.controller;
    if (!had || !sw) return;
    if (sw.state === 'activated') { check(); return; }
    const on = (): void => {
      if (sw.state === 'activating') return;
      sw.removeEventListener('statechange', on);
      if (sw.state === 'activated') check();
    };
    sw.addEventListener('statechange', on);
  });
  const go = (): void => { navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[castra] the offline worker did not install', e)); };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
