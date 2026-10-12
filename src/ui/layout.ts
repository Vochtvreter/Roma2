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
// Phase 1: the hosts are computed and exposed but not styled yet. Every open detent shows today's panel (full = half
// until P2/P4 style it), the free rect is measured from today's CSS (panels.css, mobile.css, left.css), and nothing routes
// through route() but the lessons' table test; P2 (SHEET), P3 (DRAWER) and P4 (DOCK) wire their callers and proxies.
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

/** True when `d` stands above the host's default: a layer Back and Esc close (history.ts). */
export function aboveDefault(d: Detent, host: Host): boolean {
  return RANK[d] > RANK[DEFAULT_DETENT[host]];
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
    if (from === 'tab' && c.detent !== 'closed') return c.detent;   // switching tabs keeps the player's detent
    return fit(SHEET_FULL_TABS.includes(tab) ? 'full' : 'half');
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
const FRAME: readonly string[] = ['#hud', '#speed', '#objective', '#counsel', '#ticker', '#overlay-bar', '#zoom-ctl', ...TABS.map((t) => `#tab-${t}`)];
/** The map's own tools: they ride on the map, so a full panel (which covers it) hides them. */
export const MAP_TOOLS: readonly string[] = ['#overlay-bar', '#zoom-ctl', '#ticker'];
/** The frame targets each host shows. P1: every host still shows today's frame. P2 takes #overlay-bar, #speed's five
 *  buttons and #objective off the SHEET (and P3 off the DRAWER) and REVEAL maps them to their proxies. */
export const VISIBLE: Readonly<Record<Host, readonly string[]>> = { sheet: FRAME, drawer: FRAME, dock: FRAME, columns: FRAME };
/** Per host, a hidden target → the visible proxy that glows instead (P2/P3: '#overlay-bar' → the Mappae button, '#speed'
 *  → the speed pair, '#objective' → the Breviarium button, a tab button → its nav slot). Empty while nothing is hidden. */
export const REVEAL: Readonly<Record<Host, Readonly<Record<string, string>>>> = { sheet: {}, drawer: {}, dock: {}, columns: {} };

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

const QUERIES = ['(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)'] as const;
/** P1 bridge to today's CSS: mobile.css's phone block (< 900 px) folds the sheet and the drawer while placing. */
const PHONE_CSS = '(max-width: 899px)';
/** The tab bar a folded bottom sheet keeps on screen (panels.css: translateY(calc(100% - 52px))). */
const SHEET_BAR = 52;
/** CSS px of map kept between a pre-positioned ghost's free rect and the placing banner above which it must show. */
const BANNER_GAP = 8;
const ZERO: Box = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

let active: Layout | null = null;

/** The selector to glow for a target in the current host (layout.reveal; itself before the layout runs, as in tests). */
export function revealTarget(selector: string): string {
  return active ? active.reveal(selector) : selector;
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
 *  (SidePanel.show). Recomputes on a resize of #app's content box (rotation, fold, a resized window), a change of the
 *  pointer media (a keyboard docked), and refresh() (the chrome shown or hidden, placing). */
export class Layout {
  private cls: Classes;
  private det: Detent;
  private lastOpen: Detent = 'half';           // a toggle opens the panel to the detent it last had open
  private forced = false;                      // the detent is full only because a tiny sheet has no half (keepDetent)
  private kept: Detent | null = null;          // the detent a remembering route left (place, focus): restore()
  private free: Box = ZERO;
  private ins: Box = ZERO;                     // the free rect as canvas insets (CSS px), as given to the view
  private started = false;
  private readonly mq: MediaQueryList[];
  private readonly subs = new Set<(why: LayoutChange) => void>();
  private readonly hud: HTMLElement | null;
  private readonly sideEl: HTMLElement | null;
  private readonly left: HTMLElement | null;
  private readonly banner: HTMLElement | null;

  constructor(private readonly g: Game, private readonly app: HTMLElement, private readonly side: SidePanel) {
    this.hud = app.querySelector<HTMLElement>('#hud');
    this.sideEl = app.querySelector<HTMLElement>('#side');
    this.left = app.querySelector<HTMLElement>('#left');
    this.banner = app.querySelector<HTMLElement>('#place-banner');
    this.mq = QUERIES.map((q) => matchMedia(q));
    this.cls = classify(app.clientWidth, app.clientHeight, this.media());
    this.det = side.expanded ? 'half' : 'closed';
    side.layout = this;
    active = this;
    for (const m of this.mq) listen(m, () => this.update());
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => this.update());
      ro.observe(app);   // the content box: inside the safe-area insets
      for (const el of [this.hud, this.sideEl, this.left, this.banner]) if (el) ro.observe(el);   // the chrome growing, shown, hidden
    } else window.addEventListener('resize', () => this.update());
    // a detent above the host's default is a layer Back and Esc close, one step at a time (full → half → closed)
    // TODO(P2): the context card, the tray and the Mappae popover register their own layers when they land
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

  /** Moves the panel to a detent: the host's own for `d` (a tiny sheet has no half), the panel written at once
   *  (`instant`: no slide), then the camera insets for the detent's target (never mid-slide). P1: half and full both show
   *  today's open panel. */
  setDetent(d: Detent, opts: { instant?: boolean } = {}): void {
    const to = fitDetent(d, this.det, this.cls.host, this.cls.tiny);
    if (to === this.det && this.side.expanded === (to !== 'closed')) return;
    const from = this.det;
    this.det = to;
    this.forced = d === 'half' && to === 'full';   // half asked for on a tiny sheet: half again once the window allows
    if (to !== 'closed') this.lastOpen = this.forced ? 'half' : to;   // (and a toggle reopens at half once it does)
    this.side.show(to !== 'closed', opts.instant === true);
    this.app.dataset.detent = to;
    this.update();
    if (from !== to) this.emit('detent');
  }

  /** SidePanel.toggle(): open to the last open detent, or close. */
  panelToggle(open: boolean): void {
    this.setDetent(open ? (this.det === 'closed' ? this.lastOpen : this.det) : 'closed');
  }

  /** Routes an intent (route()) and moves the panel there; a remembering route keeps the detent it left for restore().
   *  Not called by P1 callers yet: P2 routes placing, the context card, tabs and lessons through it. */
  go(i: Intent): Route {
    const r = route(i, { host: this.cls.host, detent: this.det, tiny: this.cls.tiny });
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

  /** The #app-relative rect of map the UI leaves free, with the panel at its detent's target (a copy). */
  freeRect(): Box { return { ...this.free }; }

  /** The selector to glow for a lesson or remedy target here (its proxy where this host hides it). */
  reveal(selector: string): string { return reveal(selector, this.cls.host); }

  /** Calls `cb` after the classes, the detent or the free rect change; returns the unsubscribe. */
  onChange(cb: (why: LayoutChange) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
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
    // a tiny sheet has no half (full instead), and a full forced so goes back to half once the window allows it
    const k = keepDetent(this.det, this.forced, c.host, c.tiny), turned = k.detent !== this.det;
    this.det = k.detent;
    this.forced = k.forced;
    if (turned && k.detent !== 'closed') this.lastOpen = k.forced ? 'half' : k.detent;
    // TODO(P2): a host change puts the panel at DEFAULT_DETENT[host] once SHEET and DRAWER style it (today the phone
    // panel opens as it always has, so P1 keeps the player's detent across hosts)
    if (shape || turned) this.write();
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

  /** The free rect at rest, in #app px, from today's CSS (P1): below the HUD; clear of the panel at the detent's target
   *  (its box without the slide: offset* ignore transforms), a folded bottom sheet keeping its 52 px tab bar; right of the
   *  left column where it stands as one (narrower than half of #app: from 900 px, and on a landscape phone; below that it
   *  is a band of cards across the map); above the placing banner while placing, so a pre-positioned ghost shows over it.
   *  The map's tools, the ticker and a phone's band of cards float over the free map and are not taken out (the
   *  inspector steps a target clear of them); P2–P4 replace this with each host's geometry.
   *  TODO(P2): SHEET's voice line and tool column replace the band of cards, the ticker and the map tools; the free rect
   *  then takes the bar and the tool column out (IMPL §1), and a phone's focusTile lands clear of everything. */
  private measure(W: number, H: number): Box {
    const box = { left: 0, top: 0, right: W, bottom: H };
    if (this.app.classList.contains('in-title')) return box;   // the title hides the chrome: all of the map shows
    if (shown(this.hud)) box.top = Math.max(0, this.hud.offsetTop + this.hud.offsetHeight);
    const side = this.sideEl;
    if (shown(side)) {
      const sheet = side.offsetWidth >= W - 1;   // a bottom sheet spans #app; the panel and the drawer stand at the right
      const down = this.det === 'closed' || (this.app.classList.contains('placing') && matchMedia(PHONE_CSS).matches);
      if (sheet) box.bottom = Math.min(box.bottom, down ? H - SHEET_BAR : side.offsetTop);
      else if (!down) box.right = Math.min(box.right, side.offsetLeft);
    }
    const col = this.left;
    if (shown(col) && col.offsetWidth < W / 2) box.left = Math.max(box.left, col.offsetLeft + col.offsetWidth);
    const ban = this.banner;
    if (this.app.classList.contains('placing') && shown(ban)) box.bottom = Math.min(box.bottom, ban.offsetTop - BANNER_GAP);
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
