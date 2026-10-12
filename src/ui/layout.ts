// src/ui/layout.ts — the layout engine (ARCHITECTURE §13.10, DESIGN §15.10): one game screen, the map full-bleed underneath
// and one panel on top that takes the shape the window allows. Owner: WP-H.
// Pure part (tests/layout.test.ts): classify() turns #app's size and the pointer media into size classes, an input class
// and a host — the panel's shape: SHEET (a bottom sheet: portrait phones), DRAWER (a right-hand drawer: landscape phones,
// short windows), DOCK (a docked pane: tablets, foldables, small windows), COLUMNS (today's desktop). Each host has three
// detents, the panel's resting positions: closed · half · full (players see sheet closed/half/full, drawer spine/half/full,
// dock and columns spine/docked/wide). route() says where an intent takes the panel; reveal() maps a lesson or remedy
// target the host hides to the proxy that shows it; the lesson table says how each opening lesson shows its pointer.
// DOM part: one Layout (UI.build) observes #app and the pointer media, writes data-w, data-h, data-input, data-host,
// data-detent (and data-tiny) on #app — CSS keys on these only — owns the panel's detent (SidePanel.toggle asks it) and
// hands the camera its insets: the free rect, the map the UI leaves in view (view.setInsets).
// The SHEET host (portrait phones, P2b) is styled (sheet.css) and its DOM is sheet.ts's: the panel rests at closed (the
// grabber and the voice line over the 5-slot bar), half or full, its heights worked out here (sheetHeights) and slid by
// sheet.ts; tabs, placing, the inspector and the lessons route through go(). The other hosts keep today's panel (full =
// half until P3/P4 style them), their free rect measured from today's CSS (panels.css, mobile.css, left.css).
import { TABS } from '../game/types';
import type { TabId } from '../game/types';
import { LESSONS, lessonPointer } from '../game/intro';
import type { Lesson, LessonId } from '../game/intro';
import type { Game } from './types';
import type { SidePanel } from './panels';
import { BACK_RANK, registerBack } from './history';

// ───────────────────────────── classes and hosts (pure) ─────────────────────────────
/** Width class of #app (CSS px): compact < 600 · medium 600–959 · expanded 960–1439 · large ≥ 1440. */
export type WClass = 'compact' | 'medium' | 'expanded' | 'large';
/** Height class of #app: short < 480 · regular 480–759 · tall ≥ 760. */
export type HClass = 'short' | 'regular' | 'tall';
/** The hands in use: density follows these, never the width (44 px targets on touch and mixed). */
export type InputClass = 'touch' | 'mixed' | 'mouse';
/** The panel's shape. */
export type Host = 'sheet' | 'drawer' | 'dock' | 'columns';
/** The panel's resting position; code says closed/half/full on every host. */
export type Detent = 'closed' | 'half' | 'full';
/** The pointer media: (pointer: coarse), (any-pointer: fine), (any-pointer: coarse). */
export interface Media { coarse: boolean; anyFine: boolean; anyCoarse: boolean }
/** What classify() says about a window. */
export interface Classes { w: WClass; h: HClass; input: InputClass; host: Host; tiny: boolean }
/** An #app-relative (or canvas-relative) box in CSS px. */
export interface Box { left: number; top: number; right: number; bottom: number }

export const HOSTS: readonly Host[] = ['sheet', 'drawer', 'dock', 'columns'];
export const DETENTS: readonly Detent[] = ['closed', 'half', 'full'];

/** The thresholds, in CSS px of #app (SPEC A §1, platform.md §14). */
export const BP = {
  medium: 600, expanded: 960, large: 1440,   // width classes
  regular: 480, tall: 760,                  // height classes
  sheet: 720,                               // a docked pane needs 300–360 px of panel plus 400 px of map
  columnsMouse: 1280,                       // both columns (300 + 380) and ≥ 600 px of map, for a mouse
  tinyW: 360, tinyH: 420,                   // too small for a part-way sheet
} as const;

/** Touch: a coarse primary pointer and no fine one. Mixed: a coarse primary with a trackpad or mouse (an iPad with a
 *  Magic Keyboard), or a fine primary with a touch screen (a touch laptop, a Chromebook). Else a mouse. */
export function inputClass(m: Media): InputClass {
  if (m.coarse && !m.anyFine) return 'touch';
  if ((m.coarse && m.anyFine) || (!m.coarse && m.anyCoarse)) return 'mixed';
  return 'mouse';
}

/** The classes and the host of a w × h (CSS px) #app. Hosts, first match wins: DRAWER when short and under 960 px wide ·
 *  SHEET under 720 px wide · COLUMNS for a mouse from 1280 px, or any input from 1440 px · else DOCK. Tiny (under 360 px
 *  wide or 420 px tall) takes the half detent off the sheet. */
export function classify(w: number, h: number, m: Media): Classes {
  const wc: WClass = w < BP.medium ? 'compact' : w < BP.expanded ? 'medium' : w < BP.large ? 'expanded' : 'large';
  const hc: HClass = h < BP.regular ? 'short' : h < BP.tall ? 'regular' : 'tall';
  const input = inputClass(m);
  const host: Host = h < BP.regular && w < BP.expanded ? 'drawer'
    : w < BP.sheet ? 'sheet'
      : (input === 'mouse' && w >= BP.columnsMouse) || w >= BP.large ? 'columns' : 'dock';
  return { w: wc, h: hc, input, host, tiny: w < BP.tinyW || h < BP.tinyH };
}

// ───────────────────────────── detents (pure) ─────────────────────────────
/** Where each host's panel rests by default: phones show the map (sheet and drawer closed), tablets and desktops the
 *  docked pane (today's open panel). */
export const DEFAULT_DETENT: Readonly<Record<Host, Detent>> = { sheet: 'closed', drawer: 'closed', dock: 'half', columns: 'half' };

/** What players call each detent on each host (labels, tooltips; code says closed/half/full). */
export const DETENT_NAMES: Readonly<Record<Host, Readonly<Record<Detent, string>>>> = {
  sheet: { closed: 'closed', half: 'half', full: 'full' },
  drawer: { closed: 'spine', half: 'half', full: 'full' },
  dock: { closed: 'spine', half: 'docked', full: 'wide' },
  columns: { closed: 'spine', half: 'docked', full: 'wide' },
};

const RANK: Readonly<Record<Detent, number>> = { closed: 0, half: 1, full: 2 };

/** The detents a host offers: a tiny sheet has no half (closed ↔ full). */
export function detentsOf(host: Host, tiny: boolean): readonly Detent[] {
  return host === 'sheet' && tiny ? ['closed', 'full'] : DETENTS;
}

/** A detent the host offers for `d`: half on a tiny sheet becomes full going up from closed, closed coming down. */
export function fitDetent(d: Detent, from: Detent, host: Host, tiny: boolean): Detent {
  if (detentsOf(host, tiny).includes(d)) return d;
  return RANK[from] < RANK[d] ? 'full' : 'closed';
}

/** One step down (Back, Esc): full → half → closed, a tiny sheet full → closed. */
export function stepDown(d: Detent, host: Host, tiny: boolean): Detent {
  if (d === 'full') return detentsOf(host, tiny).includes('half') ? 'half' : 'closed';
  return 'closed';
}

/** The detent to keep when the classes change (a resize, a fold, a rotation). A tiny sheet has no half, so half becomes
 *  full there and is marked `forced`; once half is offered again (the window grew, the phone unfolded), a forced full goes
 *  back to half, so the tiny rule never outlives the tiny window. A full the player chose stays full. */
export function keepDetent(d: Detent, forced: boolean, host: Host, tiny: boolean): { detent: Detent; forced: boolean } {
  const offered = detentsOf(host, tiny);
  if (!offered.includes(d)) return { detent: 'full', forced: true };   // only half is ever missing
  if (forced && d === 'full' && offered.includes('half')) return { detent: 'half', forced: false };
  return { detent: d, forced: forced && d === 'full' };
}

/** The detent to keep when the classes change (pure; tests/layout.test.ts): `from`, the host before (null: the first
 *  measure, a load). Entering the SHEET (a load, a turn to portrait) shows the map, the sheet closed, unless a tab was
 *  opened just now (`justOpened`: its own detent stands); any other change keeps the player's detent (keepDetent). The
 *  other hosts keep it until P3 and P4 style them. */
export function hostEntryDetent(d: Detent, forced: boolean, from: Host | null, to: Host, tiny: boolean, justOpened: boolean): { detent: Detent; forced: boolean } {
  if (from !== to && to === 'sheet' && !justOpened) return keepDetent('closed', false, to, tiny);
  return keepDetent(d, forced, to, tiny);
}

/** True when `d` stands above the host's default: a layer Back and Esc close (history.ts). */
export function aboveDefault(d: Detent, host: Host): boolean {
  return RANK[d] > RANK[DEFAULT_DETENT[host]];
}

// ───────────────────────────── the sheet (pure) ─────────────────────────────
/** The phone bar's five stable slots, in order. A tab not yet revealed leaves its slot empty and the others keep their
 *  places; Annales has no slot (key L, the voice line's ACTA lines, the Breviarium and the menu reach it). */
export const BAR_SLOTS: readonly TabId[] = ['council', 'advisors', 'build', 'people', 'trade'];

/** A tab's slot on the phone bar, 1 to 5; 0 for one the bar does not carry. */
export function barSlot(tab: TabId): number {
  return BAR_SLOTS.indexOf(tab) + 1;
}

/** The sheet's half detent: clamp(240 px, 44% of #app, 380 px), 50% on a regular-height phone (Safari's 553–659 px tall
 *  windows, whose 44% left the tab body 181 px). */
export const SHEET = { halfMin: 240, halfMax: 380, halfShare: 0.44, halfShareRegular: 0.5 } as const;

/** What the sheet's heights are worked out from, in #app px: #app's height, the HUD's foot, the bar's height, the
 *  grabber and voice line (`head`: all a closed sheet shows), and the height class. */
export interface SheetGeom { H: number; top: number; bar: number; head: number; h: HClass }

/** The sheet's height above the bar at each detent (pure): closed is the head alone; half is SHEET's clamp; full reaches
 *  the HUD's foot. Half never exceeds full nor falls under the head, so a short window still shows the head whole. */
export function sheetHeights(g: SheetGeom): Record<Detent, number> {
  const full = Math.max(g.head, Math.round(g.H - g.top - g.bar));
  const share = g.h === 'regular' ? SHEET.halfShareRegular : SHEET.halfShare;
  const half = Math.round(Math.min(SHEET.halfMax, Math.max(SHEET.halfMin, share * g.H)));
  return { closed: Math.min(g.head, full), half: Math.max(g.head, Math.min(full, half)), full };
}

/** px per ms: a drag released faster than this is a fling, and goes on to the next detent its way. */
export const FLING = 0.45;

/** Where a released drag of the sheet comes to rest (pure): `height`, the sheet's height under the finger; `v`, its
 *  speed (px per ms, upwards positive). A fling goes to the next offered detent past the finger in its direction (the top
 *  or the bottom one when none is left); a slow release, to the nearest. */
export function snapDetent(height: number, v: number, hs: Readonly<Record<Detent, number>>, offered: readonly Detent[]): Detent {
  const by = [...offered].sort((a, b) => hs[a] - hs[b]);
  if (v >= FLING) return by.find((d) => hs[d] > height + 1) ?? by[by.length - 1];
  if (v <= -FLING) return [...by].reverse().find((d) => hs[d] < height - 1) ?? by[0];
  return by.reduce((best, d) => (Math.abs(hs[d] - height) < Math.abs(hs[best] - height) ? d : best), by[0]);
}

/** A tap on the grabber (pure): closed → half → full → closed; a tiny sheet, closed ↔ full. */
export function cycleDetent(d: Detent, offered: readonly Detent[]): Detent {
  const i = offered.indexOf(d);
  return offered[(i + 1) % offered.length];
}

/** A tap on a slot of the phone bar (pure): the open tab's own slot folds a sheet that is up; any other slot, or the
 *  open tab's while the sheet is closed, opens that tab (route: its detent). */
export function slotTap(tab: TabId, cur: TabId, d: Detent): 'close' | 'open' {
  return tab === cur && d !== 'closed' ? 'close' : 'open';
}

// ───────────────────────────── routing (pure) ─────────────────────────────
/** Who asked to open a tab: a ticker line, danger chip or portrait ('chip'), its key (Shift: wide), a remedy, a lesson,
 *  or a tab button on the bar, rail or spine. */
export type OpenFrom = 'chip' | 'key' | 'remedy' | 'lesson' | 'tab';
/** What the player (or the game on their tap) wants the panel to make room for. */
export type Intent =
  | { kind: 'place' }                                                  // placing a work or a tool
  | { kind: 'focus' }                                                  // inspecting a building or tile (map, ledger row)
  | { kind: 'open'; tab: TabId; from?: OpenFrom; shift?: boolean }    // a tab
  | { kind: 'lesson'; lesson: LessonId };                              // an opening lesson's pointer
/** Where the panel is now. */
export interface RouteCtx { host: Host; detent: Detent; tiny: boolean }
/** Where an intent takes it: the detent; `remember`, keep the current one for Back or ✕ to restore; `card`, show the
 *  context card (the inspector in the sheet's slot). */
export interface Route { detent: Detent; remember: boolean; card: boolean }

/** The tabs a portrait phone opens at full: long ledgers (the rest open at half, with the map above them). */
export const SHEET_FULL_TABS: readonly TabId[] = ['council', 'trade', 'annals'];

/** How each opening lesson shows its pointer (UI-side: never a field of src/game/intro.ts). 'tab': it opens its tab
 *  (the target is a row there); 'map': the map must show (the target rides on it), so a full panel steps down;
 *  'frame': it points at the frame (the HUD, a tab button), and the panel stays where the player has it. */
export const LESSON_VIEW: Readonly<Record<LessonId, 'tab' | 'map' | 'frame'>> = {
  fields: 'tab', water: 'tab', homes: 'tab', ordo: 'tab', charter: 'tab',
  advisors: 'frame', speed: 'frame', works: 'tab', overlays: 'map', edicts: 'tab',
};

function openDetent(tab: TabId, from: OpenFrom | undefined, shift: boolean, c: RouteCtx): Detent {
  const fit = (d: Detent): Detent => fitDetent(d, 'closed', c.host, c.tiny);   // opening: a tiny sheet's half is full, never closed
  if (c.host === 'sheet') {
    if (from === 'chip') return fit('half');
    return fit(SHEET_FULL_TABS.includes(tab) ? 'full' : 'half');   // each tab its own detent, a slot tap's switch too
  }
  if (c.host === 'drawer') return from === 'tab' && c.detent === 'full' ? 'full' : 'half';
  if (from === 'key' && shift) return 'full';                       // Shift + the tab's key: wide
  if (from === 'chip') return 'half';
  return c.detent === 'full' ? 'full' : 'half';                     // docked, unless the player has it wide
}

/** The detent an intent goes to (pure; tests/layout.test.ts). Place and focus clear a phone's map and remember the
 *  detent they left (focus also opens the context card); on a tablet or desktop the pane stays. A tab opens part-way
 *  on a phone (full for the long ledgers), docked elsewhere unless already wide. A lesson follows LESSON_VIEW. */
export function route(i: Intent, c: RouteCtx): Route {
  const phone = c.host === 'sheet' || c.host === 'drawer';
  const keep: Route = { detent: c.detent, remember: false, card: false };
  switch (i.kind) {
    case 'place': return phone ? { detent: 'closed', remember: true, card: false } : keep;
    case 'focus': return phone ? { detent: 'closed', remember: true, card: true } : keep;
    case 'open': return { detent: openDetent(i.tab, i.from, i.shift === true, c), remember: false, card: false };
    case 'lesson': {
      const v = LESSON_VIEW[i.lesson], tab = LESSONS.find((l) => l.id === i.lesson)?.tab;
      if (v === 'tab' && tab) return { detent: openDetent(tab, 'lesson', false, c), remember: false, card: false };
      if (v === 'map' && c.detent === 'full') return { detent: stepDown('full', c.host, c.tiny), remember: false, card: false };
      return keep;
    }
  }
}

// ───────────────────────────── targets and proxies (pure) ─────────────────────────────
/** The frame's targets a lesson or remedy can point at (ids the hosts place; a tab's button is #tab-<id>). */
const FRAME: readonly string[] = ['#hud', '#hud-menu', '#speed', '#objective', '#counsel', '#ticker', '#overlay-bar', '#zoom-ctl', ...TABS.map((t) => `#tab-${t}`)];
/** The SHEET's own frame: the tool column's Via and Mappae buttons (mapbar.ts MapColumn). */
const SHEET_FRAME: readonly string[] = ['#map-via', '#map-mappae'];
/** What the SHEET leaves out of today's frame: the Res Gestae (in the Breviarium), the overlay bar (in the Mappae
 *  popover), the ticker (in the voice line, and only in calm) and Annales' tab button (no slot on the bar). */
const SHEET_HIDES: readonly string[] = ['#objective', '#overlay-bar', '#ticker', '#tab-annals'];
/** The map's own tools: they ride on the map, so a full panel (which covers it) hides them. */
export const MAP_TOOLS: readonly string[] = ['#overlay-bar', '#zoom-ctl', '#ticker', ...SHEET_FRAME];
/** The frame targets each host shows. The SHEET: its [❚❚][1× ▾] pair is #speed itself (it glows as it is); the tool
 *  column's buttons stand in for what it hides (SHEET_HIDES). P3 takes the overlay bar off the DRAWER too. */
export const VISIBLE: Readonly<Record<Host, readonly string[]>> = {
  sheet: [...FRAME.filter((x) => !SHEET_HIDES.includes(x)), ...SHEET_FRAME], drawer: FRAME, dock: FRAME, columns: FRAME,
};
/** Per host, a hidden target → the visible proxy that glows instead. The SHEET: the Res Gestae glows the HUD, whose
 *  every figure opens the Breviarium that holds it; the overlay bar, the Mappae button that opens it ("Show me" opens
 *  the popover too: bringTarget); the ticker, the voice line that speaks its lines in calm; Annales, the menu, which
 *  has its row. P3: the DRAWER's overlay bar and its spine's slots. */
export const REVEAL: Readonly<Record<Host, Readonly<Record<string, string>>>> = {
  sheet: { '#objective': '#hud', '#overlay-bar': '#map-mappae', '#ticker': '#counsel', '#tab-annals': '#hud-menu' },
  drawer: {}, dock: {}, columns: {},
};

/** The selector to glow for a target on a host: its proxy where the host hides it, else itself. */
export function reveal(selector: string, host: Host): string {
  return REVEAL[host][selector] ?? selector;
}

/** True for a frame target (a bare id the hosts place); anything else is a row of the open tab's body. */
export function inFrame(selector: string): boolean {
  return /^#[\w-]+$/.test(selector);
}

/** Whether a target shows on a host at a detent: a row of the tab body needs the panel up; a frame target must be one the
 *  host shows, and the map's tools are hidden under a full panel. */
export function shownAt(selector: string, host: Host, d: Detent): boolean {
  if (!inFrame(selector)) return d !== 'closed';
  if (!VISIBLE[host].includes(selector)) return false;
  return !(d === 'full' && MAP_TOOLS.includes(selector));
}

/** What a lesson's pointer glows: its target, else its anchor's row, else its tab's button (lessonPointer, counsel.ts). */
export function lessonTarget(l: Lesson): string | null {
  const p = lessonPointer(l);
  if (p.glow) return p.glow;
  if (p.open && p.anchor) return `[data-anchor="${p.anchor}"]`;
  const tab = p.open ?? l.tab;
  return tab ? `#tab-${tab}` : null;
}

// ───────────────────────────── the engine (DOM) ─────────────────────────────
/** What an onChange notice is about: the classes or host, the detent, or the free rect. */
export type LayoutChange = 'classes' | 'detent' | 'free';

/** What the SHEET host's own DOM (sheet.ts) does for the engine: the head's height (the grabber and the voice line: all
 *  a closed sheet shows) and the slide from one height to another, ending at rest on detent `to`. */
export interface SheetHooks {
  head(): number;
  slide(fromH: number, toH: number, to: Detent, instant: boolean): void;
}

const QUERIES = ['(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)'] as const;
/** Bridge to today's CSS off the SHEET: mobile.css's phone block (< 900 px) folds a dock's sheet and the drawer while
 *  placing. */
const PHONE_CSS = '(max-width: 899px)';
/** The tab bar a folded bottom sheet keeps on screen off the SHEET host (panels.css: translateY(calc(100% - 52px))). */
const SHEET_BAR = 52;
/** CSS px of map kept between a pre-positioned ghost's free rect and the placing banner above which it must show. */
const BANNER_GAP = 8;
/** CSS px kept between the free rect and the SHEET's tool column. */
const COLUMN_GAP = 4;
/** A tab opened this recently (ms) keeps its detent through a host change; otherwise entering the SHEET closes it. */
const JUST_OPENED_MS = 1000;
const ZERO: Box = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

let active: Layout | null = null;
/** "Show me" helpers that bring a target the host hides into view (bringTarget), by selector. */
const bringers = new Map<string, () => boolean>();

/** The selector to glow for a target in the current host (layout.reveal; itself before the layout runs, as in tests). */
export function revealTarget(selector: string): string {
  return active ? active.reveal(selector) : selector;
}

/** The current host, or null before the layout runs (headless tests): the widgets a phone's sheet shapes ask it. */
export function currentHost(): Host | null {
  return active ? active.host : null;
}

/** Moves the panel for an intent (Layout.go) once the layout runs; a no-op before (headless tests). */
export function routeIntent(i: Intent): void {
  active?.go(i);
}

/** Registers how the host brings a target it hides into view on an explicit "Show me" (the SHEET's Mappae popover holds
 *  the overlay bar): the function returns whether it did. */
export function registerBringer(selector: string, bring: () => boolean): void {
  bringers.set(selector, bring);
}

/** "Show me" on a target: the host brings it into view where it can (the SHEET opens the Mappae popover for the overlay
 *  bar); true when it did. The glow (pulseTarget) follows, on the target itself once it shows. */
export function bringTarget(selector: string): boolean {
  try { return bringers.get(selector)?.() ?? false; } catch (e) { console.error('[layout] bring', e); return false; }
}

function shown(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function listen(m: MediaQueryList, f: () => void): void {
  if (typeof m.addEventListener === 'function') m.addEventListener('change', f);
  else m.addListener(f);   // Safari before 14
}

const sameBox = (a: Box, b: Box): boolean => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/** The layout engine: one instance, created by UI.build() and exposed as UI.layout (window.cv.ui.layout in ?dev). The one
 *  source of truth for the panel's detent: SidePanel.toggle() asks it (panelToggle), and setDetent() writes the panel
 *  (SidePanel.show, and on the SHEET the slide of sheet.ts). Recomputes on a resize of #app's content box (rotation,
 *  fold, a resized window), a change of the pointer media (a keyboard docked), and refresh() (the chrome shown or
 *  hidden, placing). Widgets that live in a different place per host register a mount (onMount): it runs whenever the
 *  host changes, before anything is measured. */
export class Layout {
  private cls: Classes;
  private det: Detent;
  private lastOpen: Detent = 'half';           // a toggle opens the panel to the detent it last had open
  private forced = false;                      // the detent is full only because a tiny sheet has no half (keepDetent)
  private kept: Detent | null = null;          // the detent a remembering route left (place, focus): restore()
  private lifted: string | null = null;        // who raised a closed sheet to half for a while (lift, drop)
  private openedAt = -Infinity;                // when a tab was last opened (go): a host change just then keeps its detent
  private heights: Record<Detent, number> | null = null;   // the SHEET's height at each detent (sizeSheet)
  private sheetHooks: SheetHooks | null = null;
  private free: Box = ZERO;
  private ins: Box = ZERO;                     // the free rect as canvas insets (CSS px), as given to the view
  private started = false;
  private readonly mq: MediaQueryList[];
  private readonly subs = new Set<(why: LayoutChange) => void>();
  private readonly mounts: ((host: Host) => void)[] = [];
  private readonly ro: ResizeObserver | null = null;
  private readonly hud: HTMLElement | null;
  private readonly sideEl: HTMLElement | null;
  private readonly left: HTMLElement | null;
  private readonly banner: HTMLElement | null;
  private readonly tabs: HTMLElement | null;   // the tab buttons: the SHEET's bar, wherever it is hosted
  private readonly column: HTMLElement | null; // the SHEET's map tool column (#map-col)

  constructor(private readonly g: Game, private readonly app: HTMLElement, private readonly side: SidePanel) {
    this.hud = app.querySelector<HTMLElement>('#hud');
    this.sideEl = app.querySelector<HTMLElement>('#side');
    this.left = app.querySelector<HTMLElement>('#left');
    this.banner = app.querySelector<HTMLElement>('#place-banner');
    this.tabs = app.querySelector<HTMLElement>('#tabs');
    this.column = app.querySelector<HTMLElement>('#map-col');
    this.mq = QUERIES.map((q) => matchMedia(q));
    this.cls = classify(app.clientWidth, app.clientHeight, this.media());
    this.det = side.expanded ? 'half' : 'closed';
    side.layout = this;
    active = this;
    for (const m of this.mq) listen(m, () => this.update());
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.update());
      this.ro.observe(app);   // the content box: inside the safe-area insets (the SHEET's #app runs under them)
      // the chrome growing, shown, hidden
      for (const el of [this.hud, this.sideEl, this.left, this.banner, this.tabs, this.column]) if (el) this.ro.observe(el);
    } else window.addEventListener('resize', () => this.update());
    // a detent above the host's default is a layer Back and Esc close, one step at a time (full → half → closed). The
    // Breviarium, the phone's speed popover and the tool column's popovers have their own (tray.ts, hud.ts, mapbar.ts);
    // P2c's context card will too
    registerBack({ rank: BACK_RANK.detent, open: () => this.layerOpen(), close: () => this.setDetent(stepDown(this.det, this.cls.host, this.cls.tiny)) });
    this.update();
  }

  /** The current classes (a copy). */
  get classes(): Classes { return { ...this.cls }; }
  get host(): Host { return this.cls.host; }
  get input(): InputClass { return this.cls.input; }
  get tiny(): boolean { return this.cls.tiny; }
  /** The panel's detent (closed when it shows no tab: #side.empty). */
  get detent(): Detent { return this.det; }
  /** The detents this host offers now (a tiny sheet has no half). */
  get offered(): readonly Detent[] { return detentsOf(this.cls.host, this.cls.tiny); }
  /** The SHEET's height above the bar at each detent (#app px, a copy), or null on any other host. */
  get sheetHeights(): Record<Detent, number> | null { return this.heights ? { ...this.heights } : null; }

  /** Moves the panel to a detent: the host's own for `d` (a tiny sheet has no half), the panel written at once
   *  (`instant`: no slide), then the camera insets for the detent's target (never mid-slide). On the SHEET the sheet
   *  slides there (sheet.ts) from `fromH`, the height a drag let go at, else the detent it leaves. `user`: the player
   *  moved it by hand (the grabber, the open tab's slot): what a remembering route kept is no longer the way back. */
  setDetent(d: Detent, opts: { instant?: boolean; fromH?: number; user?: boolean } = {}): void {
    const to = fitDetent(d, this.det, this.cls.host, this.cls.tiny);
    const hs = this.cls.host === 'sheet' ? this.heights : null, sheet = hs ? this.sheetHooks : null;
    this.lifted = null;   // whoever raised it for a while (lift), it is someone else's move now
    if (opts.user) this.kept = null;
    if (to === this.det && this.side.expanded === (to !== 'closed')) {
      if (sheet && hs && opts.fromH !== undefined) sheet.slide(opts.fromH, hs[to], to, opts.instant === true);   // a drag let go where it began
      return;
    }
    const from = this.det;
    this.det = to;
    this.forced = d === 'half' && to === 'full';   // half asked for on a tiny sheet: half again once the window allows
    if (to !== 'closed') this.lastOpen = this.forced ? 'half' : to;   // (and a toggle reopens at half once it does)
    this.side.show(to !== 'closed', opts.instant === true);
    this.app.dataset.detent = to;
    if (sheet && hs) sheet.slide(opts.fromH ?? hs[from], hs[to], to, opts.instant === true);
    this.update();
    if (from !== to) this.emit('detent');
  }

  /** SidePanel.toggle(): open to the last open detent, or close. */
  panelToggle(open: boolean): void {
    this.setDetent(open ? (this.det === 'closed' ? this.lastOpen : this.det) : 'closed');
  }

  /** Routes an intent (route()) and moves the panel there; a remembering route keeps the detent it left for restore().
   *  The SHEET routes its tabs, the voice line's chips, placing, the inspector and the lessons through it; the other
   *  hosts route their tabs (with today's result) until P3/P4 wire the rest. A tab opened is a new place to come back
   *  from: a focus kept before it is no longer the way back. */
  go(i: Intent): Route {
    const r = route(i, { host: this.cls.host, detent: this.det, tiny: this.cls.tiny });
    if (i.kind === 'open') { this.openedAt = performance.now(); this.kept = null; }
    if (r.remember && this.kept === null) this.kept = this.det;
    this.setDetent(r.detent);
    return r;
  }

  /** Puts back the detent a remembering route left (✕ on the context card, the end of placing); false when none. */
  restore(): boolean {
    const d = this.kept;
    this.kept = null;
    if (d === null) return false;
    this.setDetent(d);
    return true;
  }

  /** Drops what a remembering route kept: a work was placed, and the sheet stays where placing put it (closed). */
  forget(): void { this.kept = null; }

  /** Raises a closed panel to half for a while (`why`: who, as the counsel unfolding its card on the SHEET); drop() with
   *  the same `why` closes it again, unless anything else moved the panel since. */
  lift(why: string): void {
    if (this.det !== 'closed') return;
    this.setDetent('half');
    if (this.det !== 'closed') this.lifted = why;
  }

  /** Closes a panel lift() raised for `why`, if nothing else has moved it since. */
  drop(why: string): void {
    if (this.lifted !== why) return;
    this.lifted = null;
    if (this.det !== 'closed') this.setDetent('closed');
  }

  /** The #app-relative rect of map the UI leaves free, with the panel at its detent's target (a copy). */
  freeRect(): Box { return { ...this.free }; }

  /** The selector to glow for a lesson or remedy target here: its proxy where this host hides it, unless it shows after
   *  all (the SHEET's overlay bar in its open Mappae popover glows itself). */
  reveal(selector: string): string {
    const proxy = reveal(selector, this.cls.host);
    if (proxy !== selector && inFrame(selector) && shown(document.querySelector<HTMLElement>(selector))) return selector;
    return proxy;
  }

  /** Calls `cb` after the classes, the detent or the free rect change; returns the unsubscribe. */
  onChange(cb: (why: LayoutChange) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  /** Registers a widget's placement per host: `mount(host)` runs now and on every host change, before the layout measures
   *  (the SHEET re-hosts the counsel, the ticker, the tab bar, the overlay bar and the zoom buttons). */
  onMount(mount: (host: Host) => void): void {
    this.mounts.push(mount);
    this.runMount(mount);
    this.update();
  }

  /** The SHEET host's DOM (sheet.ts) registers itself: the engine asks it the head's height and has it slide. Its
   *  elements are observed, so a voice line that grows a row resizes the closed sheet. */
  attachSheet(hooks: SheetHooks, observe: readonly HTMLElement[]): void {
    this.sheetHooks = hooks;
    for (const el of observe) this.ro?.observe(el);
    this.update();
    const hs = this.heights;
    if (hs) hooks.slide(hs[this.det], hs[this.det], this.det, true);   // at rest on the detent from the start
  }

  /** Measures again now: the chrome was shown or hidden (the title), or placing began or ended. Synchronous, so the
   *  camera call that follows (view.startPlacing's ensureVisible, attach's centring) sees the new free rect. */
  refresh(): void { this.update(); }

  // ───────────────────────────── internals ─────────────────────────────
  private media(): Media {
    return { coarse: this.mq[0].matches, anyFine: this.mq[1].matches, anyCoarse: this.mq[2].matches };
  }

  private emit(why: LayoutChange): void {
    for (const cb of this.subs) { try { cb(why); } catch (e) { console.error('[layout] onChange', e); } }
  }

  private runMount(mount: (host: Host) => void): void {
    try { mount(this.cls.host); } catch (e) { console.error('[layout] mount', e); }
  }

  /** The detent layer of the Back and Esc chain is open: a game, the panel showing a tab, above the host's default. */
  private layerOpen(): boolean {
    return this.g.mode === 'game' && shown(this.sideEl) && aboveDefault(this.det, this.cls.host);
  }

  private update(): void {
    const W = this.app.clientWidth, H = this.app.clientHeight;
    if (!W || !H) return;   // not laid out (a hidden frame): keep what we have
    const c = classify(W, H, this.media()), was = this.cls, first = !this.started;
    this.started = true;
    const shape = first || c.w !== was.w || c.h !== was.h || c.input !== was.input || c.host !== was.host || c.tiny !== was.tiny;
    const host = !first && c.host !== was.host;
    this.cls = c;
    if (host) for (const m of this.mounts) this.runMount(m);   // the host's DOM in place before anything is measured
    // the host's default (hostEntryDetent): entering the SHEET shows the map, the sheet closed, unless a tab was opened
    // just now. A tiny sheet has no half (full instead), and a full forced so goes back to half once the window allows it
    const k = hostEntryDetent(this.det, this.forced, first ? null : was.host, c.host, c.tiny, performance.now() - this.openedAt <= JUST_OPENED_MS);
    const turned = k.detent !== this.det;
    this.det = k.detent;
    this.forced = k.forced;
    if (turned && k.detent !== 'closed') this.lastOpen = k.forced ? 'half' : k.detent;
    if (shape || turned) this.write();
    if (this.side.expanded !== (this.det !== 'closed')) this.side.show(this.det !== 'closed', true);
    const hs = this.sizeSheet(H);
    if (hs && (turned || host || first) && this.sheetHooks) this.sheetHooks.slide(hs[this.det], hs[this.det], this.det, true);   // at rest there
    const free = this.measure(W, H), ins = this.insets(free);
    const moved = !sameBox(free, this.free) || !sameBox(ins, this.ins);
    this.free = free;
    this.ins = ins;
    if (moved || host) this.g.view.setInsets(ins, { host, canvasZoom: c.host === 'columns' });
    if (shape && !first) this.emit('classes');
    if (turned && !first) this.emit('detent');
    if (moved && !first) this.emit('free');
  }

  private write(): void {
    const a = this.app.dataset, c = this.cls;
    a.w = c.w; a.h = c.h; a.input = c.input; a.host = c.host; a.detent = this.det;
    if (c.tiny) a.tiny = ''; else delete a.tiny;
  }

  /** The bar's height: the SHEET's tab buttons at the foot of #app (0 while it is hidden). */
  private barH(): number {
    return shown(this.tabs) ? this.tabs.offsetHeight : 0;
  }

  /** The SHEET's height at each detent (sheetHeights over the live HUD, bar and head), written on #app as --sheet-closed,
   *  --sheet-half and --sheet-full for sheet.css; null (and the properties gone) on any other host. */
  private sizeSheet(H: number): Record<Detent, number> | null {
    const st = this.app.style;
    if (this.cls.host !== 'sheet' || !this.sheetHooks) {
      if (this.heights) { for (const d of DETENTS) st.removeProperty(`--sheet-${d}`); this.heights = null; }
      return null;
    }
    const top = shown(this.hud) ? this.hud.offsetTop + this.hud.offsetHeight : 0;
    const hs = sheetHeights({ H, top, bar: this.barH(), head: this.sheetHooks.head(), h: this.cls.h });
    const was = this.heights;
    if (!was || DETENTS.some((d) => hs[d] !== was[d])) {
      this.heights = hs;
      for (const d of DETENTS) st.setProperty(`--sheet-${d}`, `${hs[d]}px`);
    }
    return this.heights;
  }

  /** The free rect at rest, in #app px: below the HUD, then per host. The SHEET: above the sheet at its detent's height
   *  (sizeSheet: never its slide) and the bar under it, and left of the tool column; while placing the sheet steps aside
   *  and the placing banner stands over the bar instead. Elsewhere, from today's CSS: clear of the panel at the detent's
   *  target (its box without the slide: offset* ignore transforms), a folded bottom sheet keeping its 52 px tab bar; right
   *  of the left column where it stands as one (narrower than half of #app: from 900 px, and on a landscape phone; below
   *  that it is a band of cards across the map). Everywhere, above the placing banner while placing, so a pre-positioned
   *  ghost shows over it. What floats over the free map (the map's tools, the ticker, a band of cards off the SHEET) is
   *  not taken out: the inspector steps a target clear of it. P3 and P4 replace the rest with their hosts' geometry. */
  private measure(W: number, H: number): Box {
    const box = { left: 0, top: 0, right: W, bottom: H };
    if (this.app.classList.contains('in-title')) return box;   // the title hides the chrome: all of the map shows
    if (shown(this.hud)) box.top = Math.max(0, this.hud.offsetTop + this.hud.offsetHeight);
    const placing = this.app.classList.contains('placing');
    if (this.cls.host === 'sheet') {
      const up = this.heights && shown(this.sideEl) && !placing ? this.heights[this.det] : 0;
      box.bottom = Math.min(box.bottom, H - this.barH() - up);
      const col = this.column;
      if (shown(col)) box.right = Math.min(box.right, col.offsetLeft - COLUMN_GAP);
    } else {
      const side = this.sideEl;
      if (shown(side)) {
        const sheet = side.offsetWidth >= W - 1;   // a bottom sheet spans #app; the panel and the drawer stand at the right
        const down = this.det === 'closed' || (placing && matchMedia(PHONE_CSS).matches);
        if (sheet) box.bottom = Math.min(box.bottom, down ? H - SHEET_BAR : side.offsetTop);
        else if (!down) box.right = Math.min(box.right, side.offsetLeft);
      }
      const col = this.left;
      if (shown(col) && col.offsetWidth < W / 2) box.left = Math.max(box.left, col.offsetLeft + col.offsetWidth);
    }
    const ban = this.banner;
    if (placing && shown(ban)) box.bottom = Math.min(box.bottom, ban.offsetTop - BANNER_GAP);
    if (box.bottom < box.top) box.bottom = box.top;
    if (box.right < box.left) box.right = box.left;
    return box;
  }

  /** The free rect as insets of the canvas (view.mapRect: the canvas need not sit at #app's origin). */
  private insets(f: Box): Box {
    const m = this.g.view.mapRect();
    if (!m.width || !m.height) return ZERO;
    const r = (v: number): number => Math.max(0, Math.round(v));
    return { top: r(f.top - m.top), left: r(f.left - m.left), right: r(m.left + m.width - f.right), bottom: r(m.top + m.height - f.bottom) };
  }
}
