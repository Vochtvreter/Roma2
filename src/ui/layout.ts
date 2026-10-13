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
// sheet.ts; tabs, placing, the inspector and the lessons route through go(). One card at a time stands in the sheet's
// slot instead (dock: the context card or the event card, P2c), and the placing banner over the bar while placing; the
// free rect and --dock-h (what stands on the bar) follow whichever it is. The DRAWER host (landscape phones and short
// windows, P3; drawer.css) is the same nodes in another arrangement: the tab buttons a 56 px spine at the right edge, the
// panel a pane beside it (its widths worked out here: drawerWidths, slid sideways by sheet.ts), the voice line afloat at
// the bottom-left of the map while the pane is closed and the pane's head otherwise, the card slot and the placing banner
// at the bottom-left of the free map. The DOCK host (tablets, foldables, small windows, P4; dock.css) docks the panel at the
// right: its head the one-line Res Gestae and the counsel line (the left column folded in), then the tab bar and the body;
// closed it folds to a 56 px spine of tab icons (the head afloat top-right over the map), full it is wide (the whole
// width under 960 px, all but a 320 px strip of live map from 960, the Breviarium its first column there). Its widths are
// worked out here (dockWidths) and slid sideways by sheet.ts; the inspector stays a popup beside its target. The COLUMNS
// (the desktop, P5; columns.css) keep today's left column and 380 px panel; closed the panel folds to a 64 px badge spine
// at the right edge, full it is wide over the map, leaving 630 px of it, with the Breviarium its first column (under
// 1750 px there is no room for the left column beside them: it folds away while the panel is wide, columnsRoom): widths
// worked out here (columnsWidths), slid sideways by sheet.ts as the DOCK's. The DOCK and the COLUMNS carry the three-way view control
// (VIEWS: Urbs, Mensa, Tabularium; keys C, M, I, keyAction).
import { TABS } from '../game/types';
import type { TabId } from '../game/types';
import { LESSONS, introRunning, lessonPointer } from '../game/intro';
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

/** The phone hosts: the portrait SHEET and the landscape DRAWER share the phone's widgets (the voice line, the tool column,
 *  the card slot, the placing banner with ⟳, events through the voice line, modal sheets), arranged each its own way. */
export function isPhone(host: Host | null): boolean {
  return host === 'sheet' || host === 'drawer';
}

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
 *  opened just now (`justOpened`: its own detent stands); any other change keeps the player's detent (keepDetent): a
 *  phone turned to landscape keeps its ledger in the DRAWER's pane at the detent it had (a colony entered on a phone
 *  closes either panel: UI.hideTitle). The DOCK keeps it too: a tablet turned either way stays where the player had it.
 *  But a phone's closed panel is its host's default, not the player's choice: a foldable unfolded into the DOCK, or a
 *  window widened into the DOCK or the COLUMNS, docks the pane there (their default). */
export function hostEntryDetent(d: Detent, forced: boolean, from: Host | null, to: Host, tiny: boolean, justOpened: boolean): { detent: Detent; forced: boolean } {
  if (from !== to && to === 'sheet' && !justOpened) return keepDetent('closed', false, to, tiny);
  if (from !== null && isPhone(from) && !isPhone(to) && d === 'closed') return keepDetent(DEFAULT_DETENT[to], false, to, tiny);
  return keepDetent(d, forced, to, tiny);
}

/** True when `d` stands above the host's default. */
export function aboveDefault(d: Detent, host: Host): boolean {
  return RANK[d] > RANK[DEFAULT_DETENT[host]];
}

/** True when `d` is a layer Back and Esc close (history.ts; pure): a detent above the host's default; on the DOCK any
 *  detent but its docked pane, so the spine and the wide pane both come back to it (backDetent). The desktop COLUMNS'
 *  spine is no layer: closed is a view the player chose there (Urbs), so Esc from it goes on to the menu. */
export function isLayer(d: Detent, host: Host): boolean {
  return host === 'dock' ? d !== DEFAULT_DETENT.dock : aboveDefault(d, host);
}

/** Where one Back or Esc takes the panel from `d` (pure): one step down (stepDown: full → half → closed); on the DOCK
 *  back to the docked pane, from the spine and from wide alike. */
export function backDetent(d: Detent, host: Host, tiny: boolean): Detent {
  return host === 'dock' ? DEFAULT_DETENT.dock : stepDown(d, host, tiny);
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

/** A tap on a slot of the phone bar, or an icon of the drawer's spine (pure): the open tab's own slot folds a panel that
 *  is up; any other slot, or the open tab's while the panel is closed, opens that tab (route: its detent). */
export function slotTap(tab: TabId, cur: TabId, d: Detent): 'close' | 'open' {
  return tab === cur && d !== 'closed' ? 'close' : 'open';
}

// ───────────────────────────── the drawer (pure) ─────────────────────────────
/** The DRAWER's spine and pane (SPEC A §1, DESIGN §15.7): a 56 px spine of tab icons at the right edge (and the right
 *  safe area); beside it the pane, clamp(280 px, 42% of #app, 360 px) wide at half, everything left of the spine at full. */
export const DRAWER = { spine: 56, paneMin: 280, paneShare: 0.42, paneMax: 360 } as const;

/** The pane's width at each detent (pure): closed has none (the spine alone, the voice line afloat on the map); half is
 *  DRAWER's clamp of #app's width `W`, never wider than full; full reaches #app's left edge from the spine (`spine` px). A
 *  drag of the pane's left edge comes to rest on these (snapDetent over the widths, the finger's speed leftwards). */
export function drawerWidths(W: number, spine: number): Record<Detent, number> {
  const full = Math.max(0, Math.round(W - spine));
  const half = Math.round(Math.min(DRAWER.paneMax, Math.max(DRAWER.paneMin, DRAWER.paneShare * W)));
  return { closed: 0, half: Math.min(full, half), full };
}

/** The largest part of `box` clear of `ob` (pure), `gap` px off it: the part above, below, left or right of it, by area
 *  (above on a tie); the box itself when they do not meet. The DRAWER's free map beside what stands at its bottom-left:
 *  above a wide, short voice line or placing banner, right of a tall card. */
export function clearOf(box: Box, ob: Box, gap = 0): Box {
  const parts = clearParts(box, ob, gap);
  return parts ? parts.reduce((best, b) => (boxArea(b) > boxArea(best) ? b : best)) : { ...box };
}

/** The part of `box` clear of `ob` that holds the point (x, y) (pure): of the four clearOf weighs, the largest that holds
 *  it; clearOf's own choice when none does (the point under `ob`, or outside the box). The room a popup has beside a
 *  target that stands beside what floats over the map (the DOCK's head left of it, top-right), not only in the larger
 *  part the free rect keeps. */
export function clearAround(box: Box, ob: Box, x: number, y: number, gap = 0): Box {
  const holds = (clearParts(box, ob, gap) ?? []).filter((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom && boxArea(b) > 0);
  return holds.length ? holds.reduce((best, b) => (boxArea(b) > boxArea(best) ? b : best)) : clearOf(box, ob, gap);
}

/** The parts of `box` above, below, left and right of `ob`, `gap` px off it (in that order: the tie goes above); null
 *  when they do not meet. */
function clearParts(box: Box, ob: Box, gap: number): Box[] | null {
  if (ob.right <= box.left || ob.left >= box.right || ob.bottom <= box.top || ob.top >= box.bottom) return null;
  return [
    { ...box, bottom: Math.min(box.bottom, ob.top - gap) },
    { ...box, top: Math.max(box.top, ob.bottom + gap) },
    { ...box, right: Math.min(box.right, ob.left - gap) },
    { ...box, left: Math.max(box.left, ob.right + gap) },
  ];
}

function boxArea(b: Box): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

/** How many of a row's droppable items must leave it (pure) for it to fit: `need`, the row's width with all of them;
 *  `room`, the width it has; `widths`, each droppable item's width with its gap, in the order they go. The DRAWER's HUD
 *  (hud.ts): the date, then spirits, souls, coin, Aqua and Grain step into the Breviarium, which shows them all; the speed
 *  pair and the menu never do. */
export function priorityDrops(need: number, room: number, widths: readonly number[]): number {
  let over = need - room, n = 0;
  while (over > 0.5 && n < widths.length) over -= widths[n++];
  return n;
}

// ───────────────────────────── the dock (pure) ─────────────────────────────
/** The DOCK's pane (SPEC A §1 TABLETS, DESIGN §15.7): docked at the right, clamp(300 px, 40% of #app, 360 px) wide under
 *  960 px (medium), clamp(340 px, 30%, 400 px) from 960 (expanded); folded, a 56 px spine of tab icons; wide, the whole
 *  width at medium, and from 960 all but a 320 px strip of live map at the left, the Breviarium its first column. */
export const DOCK = {
  spine: 56, strip: 320,
  medium: { min: 300, share: 0.4, max: 360 }, expanded: { min: 340, share: 0.3, max: 400 },
} as const;

/** True for the width classes of a DOCK wide enough for the expanded pane, the minimap and the Breviarium column. */
export function dockExpanded(w: WClass): boolean {
  return w === 'expanded' || w === 'large';
}

/** The DOCK pane's width at each detent (pure), for #app's width `W` and width class `w`: closed is the spine; half the
 *  docked pane's clamp; full all of #app at medium, all but the live strip of map from 960 (never narrower than half). */
export function dockWidths(W: number, w: WClass): Record<Detent, number> {
  const wide = dockExpanded(w), p = wide ? DOCK.expanded : DOCK.medium;
  const half = Math.min(Math.round(W), Math.round(Math.min(p.max, Math.max(p.min, p.share * W))));
  const full = Math.max(half, Math.round(wide ? W - DOCK.strip : W));
  return { closed: Math.min(DOCK.spine, half), half, full };
}

// ───────────────────────────── the desktop columns (pure) ─────────────────────────────
/** The desktop COLUMNS (SPEC A §1 DESKTOP, DESIGN §15.1): today's left column (10 + 300 px: x10–310) and 380 px panel;
 *  folded, a 64 px badge spine at the right edge; wide (Tabularium), the panel over the map, its Breviarium column first
 *  (at least `brev` px) and the page beside it, leaving `map` px of live map (SPEC A's "wide: 100% − 630 px": the view
 *  control, the map tools, the ticker and the placing banner all fit there as beside the docked panel). Beside the left
 *  column that takes `left + map + brev + body` = 1750 px for a page in two columns (`body`: the tab body's 520 px
 *  container query, its padding, a thin scrollbar and the panel's border); a narrower window folds the left column away
 *  while the panel is wide (its Res Gestae and what awaits you stand in the Breviarium), the map at the left edge, unless
 *  the opening lessons speak in it: then the map gives way, down to a 320 px `strip` (columnsRoom). */
export const COLUMNS = { left: 310, panel: 380, spine: 64, map: 630, strip: 320, brev: 250, body: 560 } as const;

/** How the COLUMNS make room for the wide panel (pure; the layout writes data-fold or data-strip on #app for
 *  columns.css): 'beside' from 1750 px wide, the left column, 630 px of map and the panel side by side; under that
 *  'fold', the left column folds away while the panel is wide and the 630 px of map stand at the left edge; but never
 *  while the opening lessons run (`lessons`), whose card speaks in the left column: 'strip', the map giving way to the
 *  panel beside the left column, down to a 320 px strip (SPEC A §7's wide at 1440 px). */
export type ColumnsRoom = 'beside' | 'fold' | 'strip';
export function columnsRoom(W: number, lessons = false): ColumnsRoom {
  if (W >= COLUMNS.left + COLUMNS.map + COLUMNS.brev + COLUMNS.body) return 'beside';
  return lessons ? 'strip' : 'fold';
}

/** The COLUMNS panel's width at each detent (pure), for #app's width `W` (`lessons`: the opening lessons run): closed
 *  the spine; half today's 380 px panel; full all but the 630 px of map (and the left column beside it, columnsRoom),
 *  or, in a strip, the Breviarium and a two-column page as far as a 320 px strip of map allows; never narrower than half.
 *  (The panel's width alone: a lesson begun or ended changes only how the room is found.) */
export function columnsWidths(W: number, lessons = false): Record<Detent, number> {
  const half = Math.min(Math.round(W), COLUMNS.panel), room = columnsRoom(W, lessons);
  const full = room === 'fold' ? W - COLUMNS.map
    : room === 'beside' ? W - COLUMNS.left - COLUMNS.map
    : Math.min(COLUMNS.brev + COLUMNS.body, W - COLUMNS.left - COLUMNS.strip);
  return { closed: Math.min(COLUMNS.spine, half), half, full: Math.max(half, Math.round(full)) };
}

/** Whether the Breviarium stands as the first column of the panel (pure): the wide pane of the DOCK from 960 px wide, and
 *  of the COLUMNS. */
export function brevColumn(host: Host, w: WClass, d: Detent): boolean {
  return d === 'full' && (host === 'columns' || (host === 'dock' && dockExpanded(w)));
}

/** Whether the host carries the phones' tool column ([Via][Mappae][+][−][⌂], mapbar.ts MapColumn), the overlay bar in
 *  its Mappae popover (pure): the SHEET and the DRAWER, and the DOCK under 960 px wide (no room there for the minimap
 *  and the labelled overlay bar beside the pane). From 960 the DOCK's map tools are the desktop's (#map-tools). */
export function toolColumn(host: Host, w: WClass): boolean {
  return isPhone(host) || (host === 'dock' && !dockExpanded(w));
}

/** Whether the placing banner is the slim one with the reason row and ⟳ keep placing (mapbar.ts renderPlaceBanner):
 *  the phones' and the DOCK's; the desktop COLUMNS keep theirs. */
export function slimBanner(host: Host | null): boolean {
  return host !== null && host !== 'columns';
}

// ───────────────────────────── the view control (pure) ─────────────────────────────
/** One of the three named views (SPEC A graft 1): the panel's detents as the DOCK and the COLUMNS name them, with the
 *  key that goes there and the icon of its segment in the HUD's view control (hud.ts). */
export interface View { detent: Detent; key: string; latin: string; en: string; icon: string }
/** Urbs (the city: the panel folded), Mensa (map and ledger: docked), Tabularium (the ledgers: wide). */
export const VIEWS: readonly View[] = [
  { detent: 'closed', key: 'c', latin: 'Urbs', en: 'City', icon: 'i_view_closed' },
  { detent: 'half', key: 'm', latin: 'Mensa', en: 'Map & ledger', icon: 'i_view_half' },
  { detent: 'full', key: 'i', latin: 'Tabularium', en: 'Ledgers', icon: 'i_view_full' },
];
/** The hosts that carry the view control and its keys: the tablets' DOCK and the desktop COLUMNS (a phone's sheet and
 *  drawer move by their grabber, bar and spine). */
export const VIEW_HOSTS: readonly Host[] = ['dock', 'columns'];

/** The view a detent is (VIEWS). */
export function viewOf(d: Detent): View {
  return VIEWS.find((v) => v.detent === d) ?? VIEWS[1];
}

/** Each tab's letter (DESIGN §15.8): E V B P T L. */
export const TAB_KEYS: Readonly<Record<string, TabId>> = { e: 'council', v: 'advisors', b: 'build', p: 'people', t: 'trade', l: 'annals' };

/** What a letter key does to the panel (pure; tests/layout.test.ts): a tab's letter opens that tab, and with Shift on the
 *  DOCK or the COLUMNS opens it wide (route: from 'key' with shift); C, M and I go to the views Urbs, Mensa and
 *  Tabularium there (closed, half, full; nothing on a phone). Anything else: null. */
export type KeyAction = { kind: 'tab'; tab: TabId; wide: boolean } | { kind: 'view'; detent: Detent };
export function keyAction(key: string, shift: boolean, host: Host): KeyAction | null {
  const k = key.toLowerCase(), views = VIEW_HOSTS.includes(host);
  const tab = TAB_KEYS[k];
  if (tab) return { kind: 'tab', tab, wide: shift && views };
  const v = VIEWS.find((x) => x.key === k);
  return v && views ? { kind: 'view', detent: v.detent } : null;
}

// ───────────────────────────── routing (pure) ─────────────────────────────
/** Who asked to open a tab: a ticker line, danger chip or portrait ('chip'), its key (Shift: wide), a remedy, a lesson,
 *  or a tab button on the bar, rail or spine. */
export type OpenFrom = 'chip' | 'key' | 'remedy' | 'lesson' | 'tab';
/** What the player (or the game on their tap) wants the panel to make room for. */
export type Intent =
  | { kind: 'place' }                                                  // placing a work or a tool
  | { kind: 'focus' }                                                  // inspecting a building or tile (map, ledger row)
  | { kind: 'open'; tab: TabId; from?: OpenFrom; shift?: boolean; anchor?: string }   // a tab (at a row of it)
  | { kind: 'lesson'; lesson: LessonId };                              // an opening lesson's pointer
/** Where the panel is now (`w`: the width class; the DOCK's wide pane covers all of the map under 960 px). */
export interface RouteCtx { host: Host; detent: Detent; tiny: boolean; w?: WClass }
/** Where an intent takes it: the detent; `remember`, keep the current one for Back or ✕ to restore; `card`, show the
 *  context card (the inspector in the sheet's slot). */
export interface Route { detent: Detent; remember: boolean; card: boolean }

/** The tabs a portrait phone opens at full: long ledgers (the rest open at half, with the map above them). */
export const SHEET_FULL_TABS: readonly TabId[] = ['council', 'trade', 'annals'];

/** How each opening lesson shows its pointer (UI-side: never a field of src/game/intro.ts). 'tab': it opens its tab
 *  (the target is a row there; on the SHEET a lesson of CARD_LESSONS carries that row in its own card instead); 'map':
 *  the map must show (the target rides on it), so a full panel steps down; 'frame': it points at the frame (the HUD, a
 *  tab button), and the panel stays where the player has it. */
export const LESSON_VIEW: Readonly<Record<LessonId, 'tab' | 'map' | 'frame'>> = {
  fields: 'tab', water: 'tab', homes: 'tab', ordo: 'tab', charter: 'tab',
  advisors: 'frame', speed: 'frame', works: 'tab', overlays: 'map', edicts: 'tab',
};
/** The lessons whose job the SHEET's lesson card carries itself, so no tab need open for it (SPEC A graft 4): lesson I's
 *  Annona labour line (labourEl, counsel.ts) rides in its card at half, and its target glows there (CARD_ROWS). */
export const CARD_LESSONS: readonly LessonId[] = ['fields'];

/** Whether the SHEET's build tray (Aedificia at half) carries a tab anchor (pure; tests/sheet.test.ts): a work's card
 *  (b-<type>) and the cards themselves do; the Agenda, the works queue, the builders and the tools (road, pave…) are
 *  the whole tab's, which opens at full for them. */
export function trayHolds(anchor: string | undefined): boolean {
  return anchor === undefined || anchor === 'cards' || anchor.startsWith('b-');
}

function openDetent(tab: TabId, from: OpenFrom | undefined, shift: boolean, c: RouteCtx, anchor?: string): Detent {
  const fit = (d: Detent): Detent => fitDetent(d, 'closed', c.host, c.tiny);   // opening: a tiny sheet's half is full, never closed
  if (c.host === 'sheet') {
    if (tab === 'build' && !trayHolds(anchor)) return 'full';         // a row the build tray lacks: the whole tab
    if (from === 'chip') return fit('half');
    return fit(SHEET_FULL_TABS.includes(tab) ? 'full' : 'half');   // each tab its own detent, a slot tap's switch too
  }
  if (c.host === 'drawer') return from === 'tab' && c.detent === 'full' ? 'full' : 'half';
  if (from === 'key' && shift) return 'full';                       // Shift + the tab's key: wide
  if (from === 'chip') return 'half';
  return c.detent === 'full' ? 'full' : 'half';                     // docked, unless the player has it wide
}

/** The detent an intent goes to (pure; tests/layout.test.ts). Place and focus clear a phone's map and remember the
 *  detent they left (focus also opens the context card); on a tablet or desktop the pane stays, but for a wide one.
 *  Placing docks a wide pane (the DOCK's and the COLUMNS', any width), remembered: the banner and the ghost want the
 *  docked layout's map (in a 320 px strip the banner lost its ✕), and cancelling goes wide again. A focus docks the
 *  DOCK's wide pane under 960 px, which leaves no map at all, and does not remember it (SPEC A §7: a row's "show on map"
 *  docks the pane and its popup shows; the pane stays docked, and Esc then closes the popup). A tab opens part-way on a
 *  phone (full for the long ledgers), docked elsewhere unless already wide. A lesson follows LESSON_VIEW (on the COLUMNS
 *  its card, in the left column, always shows: the left column never folds while the lessons run, columnsRoom). */
export function route(i: Intent, c: RouteCtx): Route {
  const phone = c.host === 'sheet' || c.host === 'drawer';
  const keep: Route = { detent: c.detent, remember: false, card: false };
  const wide = !phone && c.detent === 'full';                                      // the DOCK's or the COLUMNS' wide pane
  const blind = wide && c.host === 'dock' && c.w !== undefined && !dockExpanded(c.w);   // … with no map left beside it
  switch (i.kind) {
    case 'place': return phone ? { detent: 'closed', remember: true, card: false } : wide ? { detent: 'half', remember: true, card: false } : keep;
    case 'focus': return phone ? { detent: 'closed', remember: true, card: true } : blind ? { detent: 'half', remember: false, card: false } : keep;
    case 'open': return { detent: openDetent(i.tab, i.from, i.shift === true, c, i.anchor), remember: false, card: false };
    case 'lesson': {
      const v = LESSON_VIEW[i.lesson], les = LESSONS.find((l) => l.id === i.lesson), tab = les?.tab;
      // the SHEET's lesson card carries the job: it unfolds at half (a tiny sheet's full), the map above it
      if (c.host === 'sheet' && CARD_LESSONS.includes(i.lesson)) return { detent: fitDetent('half', 'closed', c.host, c.tiny), remember: false, card: false };
      if (v === 'tab' && tab) return { detent: openDetent(tab, 'lesson', false, c, les?.anchor), remember: false, card: false };
      if (v === 'map' && c.detent === 'full') return { detent: stepDown('full', c.host, c.tiny), remember: false, card: false };
      return keep;
    }
  }
}

// ───────────────────────────── targets and proxies (pure) ─────────────────────────────
/** The frame's targets a lesson or remedy can point at (ids the hosts place; a tab's button is #tab-<id>). */
const FRAME: readonly string[] = ['#hud', '#hud-menu', '#speed', '#objective', '#counsel', '#ticker', '#overlay-bar', '#zoom-ctl', ...TABS.map((t) => `#tab-${t}`)];
/** The phones' own frame: the tool column's Via and Mappae buttons (mapbar.ts MapColumn), on the SHEET and the DRAWER. */
const SHEET_FRAME: readonly string[] = ['#map-via', '#map-mappae'];
/** What the phone hosts leave out of today's frame: the Res Gestae (in the Breviarium), the overlay bar (in the Mappae
 *  popover), the ticker (in the voice line, and only in calm) and Annales' tab button (no slot on the SHEET's bar; on the
 *  DRAWER's spine only while it is tall enough for six icons, so never counted on). */
const SHEET_HIDES: readonly string[] = ['#objective', '#overlay-bar', '#ticker', '#tab-annals'];
/** The map's own tools: they ride on the map, so a full panel (which covers it) hides them. */
export const MAP_TOOLS: readonly string[] = ['#overlay-bar', '#zoom-ctl', '#ticker', ...SHEET_FRAME];
/** What a phone host shows of the frame: its [❚❚][1× ▾] pair is #speed itself (it glows as it is); the tool column's
 *  buttons stand in for what it hides (SHEET_HIDES); the bar's slots or the spine's icons are the tab buttons. */
const PHONE_VISIBLE: readonly string[] = [...FRAME.filter((x) => !SHEET_HIDES.includes(x)), ...SHEET_FRAME];
/** The frame targets each host shows: the phones (SHEET and DRAWER) theirs, the others today's frame (the DOCK from
 *  960 px wide: its overlay bar stands on the map beside the minimap; under 960 see DOCK_TOOLS). */
export const VISIBLE: Readonly<Record<Host, readonly string[]>> = {
  sheet: PHONE_VISIBLE, drawer: PHONE_VISIBLE, dock: FRAME, columns: FRAME,
};
/** The DOCK under 960 px wide (toolColumn): today's frame (its HUD, the pane's head with the Res Gestae and the counsel,
 *  the tab buttons, the ticker), but the phones' tool column for the overlay bar: the Mappae button stands in for it. */
export const DOCK_TOOLS = {
  visible: [...FRAME.filter((x) => x !== '#overlay-bar'), ...SHEET_FRAME] as readonly string[],
  reveal: { '#overlay-bar': '#map-mappae' } as Readonly<Record<string, string>>,
} as const;

/** The frame targets a host shows at a width (pure): VISIBLE, but the DOCK's under 960 px (DOCK_TOOLS). */
export function visibleOn(host: Host, w?: WClass): readonly string[] {
  return host === 'dock' && w !== undefined && toolColumn(host, w) ? DOCK_TOOLS.visible : VISIBLE[host];
}
/** On a phone host, a hidden target → the visible proxy that glows instead: the Res Gestae glows the HUD, whose every
 *  figure opens the Breviarium that holds it; the overlay bar, the Mappae button that opens it ("Show me" opens the
 *  popover too: bringTarget); the ticker, the voice line that speaks its lines in calm; Annales, the menu, which has its
 *  row (on the DRAWER the spine's own icon glows itself whenever it shows: Layout.reveal). */
const PHONE_REVEAL: Readonly<Record<string, string>> = { '#objective': '#hud', '#overlay-bar': '#map-mappae', '#ticker': '#counsel', '#tab-annals': '#hud-menu' };
/** Per host, a hidden target → the visible proxy that glows instead (the phones: PHONE_REVEAL; the DOCK from 960 px
 *  wide shows its whole frame, and under 960 DOCK_TOOLS.reveal: revealOn). */
export const REVEAL: Readonly<Record<Host, Readonly<Record<string, string>>>> = {
  sheet: PHONE_REVEAL, drawer: PHONE_REVEAL, dock: {}, columns: {},
};

/** The hidden targets' proxies on a host at a width (pure): REVEAL, but the DOCK's under 960 px (DOCK_TOOLS). */
export function revealOn(host: Host, w?: WClass): Readonly<Record<string, string>> {
  return host === 'dock' && w !== undefined && toolColumn(host, w) ? DOCK_TOOLS.reveal : REVEAL[host];
}
/** Per host, a row of a tab body that a lesson's card carries too (CARD_LESSONS) → the card's own copy, which glows
 *  instead: the job is done there, without the tab. */
export const CARD_ROWS: Readonly<Record<Host, Readonly<Record<string, string>>>> = {
  sheet: { '.tab-lab[data-cat="food"]': '#counsel .tab-lab[data-cat="food"]' }, drawer: {}, dock: {}, columns: {},
};

/** The selector to glow for a target on a host: its proxy where the host hides it, the lesson card's own copy of a row
 *  it carries, else itself. */
export function reveal(selector: string, host: Host, w?: WClass): string {
  return revealOn(host, w)[selector] ?? CARD_ROWS[host][selector] ?? selector;
}

/** True for a frame target (a bare id the hosts place); anything else is a row of the open tab's body. */
export function inFrame(selector: string): boolean {
  return /^#[\w-]+$/.test(selector);
}

/** Whether a target shows on a host (at a width: the DOCK's frame depends on it) at a detent: a row of the tab body needs
 *  the panel up; a frame target must be one the host shows, and the map's tools are hidden under a full panel. */
export function shownAt(selector: string, host: Host, d: Detent, w?: WClass): boolean {
  if (!inFrame(selector)) return d !== 'closed';
  if (!visibleOn(host, w).includes(selector)) return false;
  return !(d === 'full' && MAP_TOOLS.includes(selector));
}

/** What "Show me" does for a lesson on a host (pure; tests/sheet.test.ts): lessonPointer's, except where the host's
 *  lesson card carries the job (CARD_LESSONS on the SHEET): no tab opens (`card`: the counsel's card unfolds instead),
 *  and the target glows on the card's own row (reveal: CARD_ROWS). A lesson that opens Aedificia on no row of it (VIII:
 *  "a work you choose") points a phone's or a tablet's Aedificia at its cards, every category (aedificia.ts focus): the
 *  SHEET's build tray, the DRAWER's and the DOCK's catalogue (their narrow pane would show the Agenda at the tab's top),
 *  not the category an earlier lesson left it on. */
export function hostPointer(l: Lesson, host: Host): { open: TabId | null; anchor?: string; glow: string | null; card: boolean } {
  const p = lessonPointer(l);
  if (host === 'sheet' && CARD_LESSONS.includes(l.id)) return { open: null, glow: p.glow, card: true };
  if ((isPhone(host) || host === 'dock') && p.open === 'build' && p.anchor === undefined) return { ...p, anchor: 'cards', card: false };
  return { ...p, card: false };
}

/** Whether a lesson arrives folded in the voice line rather than unfolded in the sheet (pure; tests/sheet.test.ts): on
 *  the SHEET, one whose job is a card of the build tray (hostPointer opens Aedificia at half: II, III, VIII), as the
 *  mockup has it. The tray then has the sheet's half to itself and the card's Place is whole in view as it pulses; the
 *  unfolded card would push it under the bar. Its line's Show me, or a tap, still unfolds it. */
export function lessonFolds(l: Lesson, host: Host): boolean {
  const p = hostPointer(l, host);
  return host === 'sheet' && p.open === 'build' && trayHolds(p.anchor);
}

/** What a lesson's pointer glows: its target, else its anchor's row, else its tab's button (lessonPointer, counsel.ts). */
export function lessonTarget(l: Lesson): string | null {
  const p = lessonPointer(l);
  if (p.glow) return p.glow;
  if (p.open && p.anchor) return `[data-anchor="${p.anchor}"]`;
  const tab = p.open ?? l.tab;
  return tab ? `#tab-${tab}` : null;
}

// ───────────────────────────── the covered map (pure) ─────────────────────────────
/** The UI covers all of the map (pure; tests/layout.test.ts), so its drawing is suspended (main.ts → view.suspend) while
 *  the colony runs on: the free rect at rest leaves no map (the SHEET full, from the HUD's foot to the bar; the DRAWER
 *  full, from the left edge to the spine; the DOCK's wide pane under 960 px, the whole width), or a modal stands on a
 *  phone host, where every modal is a full-screen sheet (sheet.css). Wide on a DOCK from 960 px or on the COLUMNS a strip
 *  of live map stays, and a desktop's or a tablet's modal is a card over the dimmed map: drawn (paused, its idle frames
 *  skipped). The title is no cover either: the map drifts behind its translucent veil. */
export function mapCovered(free: Box, host: Host, modal: boolean): boolean {
  return (modal && isPhone(host)) || free.right - free.left < 1 || free.bottom - free.top < 1;
}

// ───────────────────────────── the engine (DOM) ─────────────────────────────
/** What an onChange notice is about: the classes or host, the detent, or the free rect. */
export type LayoutChange = 'classes' | 'detent' | 'free';

/** What the phone hosts' own DOM (sheet.ts) does for the engine: the SHEET's head height (the grabber and the voice line:
 *  all a closed sheet shows); the slide from one extent to another (the SHEET's height, the DRAWER pane's width), ending
 *  at rest on detent `to`, which also puts the voice line where `to` wants it; the DRAWER's voice line while it
 *  floats on the map (the pane closed), or the DOCK's head afloat beside its spine, else null; and whether the panel is
 *  moving now (under the finger or sliding: the map it uncovers is live, whatever the detent's free rect says). */
export interface SheetHooks {
  head(): number;
  slide(fromH: number, toH: number, to: Detent, instant: boolean): void;
  floating(): HTMLElement | null;
  moving?(): boolean;
}

const QUERIES = ['(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)'] as const;
/** CSS px of map kept between a pre-positioned ghost's free rect and the placing banner above which it must show. */
const BANNER_GAP = 8;
/** CSS px kept between the free rect and the SHEET's tool column. */
const COLUMN_GAP = 4;
/** CSS px of map kept between the free rect and a card docked in the SHEET's slot (the context card, the event card). */
const CARD_GAP = 8;
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

/** The safe area (inside the notch, the rounded corners and the home indicator) in #app px, or null before the layout
 *  runs: the DRAWER's #app runs under the insets, and what opens over its map (the tool column's popovers) keeps clear. */
export function safeArea(): Box | null {
  return active ? active.safeRect() : null;
}

/** The panel's detent, or null before the layout runs (headless tests): Aedificia is a build tray at the SHEET's half. */
export function currentDetent(): Detent | null {
  return active ? active.detent : null;
}

/** Moves the panel for an intent (Layout.go) once the layout runs; a no-op before (headless tests). */
export function routeIntent(i: Intent): void {
  active?.go(i);
}

/** Moves the panel to a detent by the player's own hand (a tab's ⤢: Aedificia's Catalogue; the view control and its keys
 *  C, M and I), once the layout runs. */
export function moveDetent(d: Detent): void {
  active?.setDetent(d, { user: true });
}

/** The free map in #app px, as the layout measured it at rest (Layout.freeRect: empty when the panel covers it all, as
 *  the medium DOCK's wide pane does), or null before the layout runs. */
export function currentFree(): Box | null {
  return active ? active.freeRect() : null;
}

/** What floats over the map and the free map under it (Layout.floatingBox), or null (nothing floats, or before the layout
 *  runs). */
export function currentFloating(): { under: Box; box: Box } | null {
  return active ? active.floatingBox() : null;
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
  private keptTop = 0;                         // … and the tab body's scroll then (a closed sheet's body is not drawn)
  private keptTab: TabId | null = null;        // … of this tab: another tab opened since starts at its own top
  private lifted: string | null = null;        // who raised a closed sheet to half for a while (lift, drop)
  private openedAt = -Infinity;                // when a tab was last opened (go): a host change just then keeps its detent
  private heights: Record<Detent, number> | null = null;   // the SHEET's height at each detent (sizeSheet)
  private widths: Record<Detent, number> | null = null;    // the DRAWER pane's width at each detent (sizeDrawer)
  private dockW: Record<Detent, number> | null = null;     // the DOCK pane's width at each detent (sizeDock)
  private colsW: Record<Detent, number> | null = null;     // the COLUMNS panel's width at each detent (sizeColumns)
  private room: ColumnsRoom | null = null;     // how the COLUMNS make room for the wide panel (data-fold, data-strip)
  private lessons = false;                     // the opening lessons run (their card is the left column's counsel)
  private sheetHooks: SheetHooks | null = null;
  private card: HTMLElement | null = null;     // the card docked in a phone's slot (dock): the context card or the event card
  private dockPx = -1;                         // what stands on the SHEET's bar, as written to --dock-h
  private freeVars = '';                       // the DOCK's free map as written to --dock-free-t and --dock-free-r
  private free: Box = ZERO;
  private afloat: { under: Box; box: Box } | null = null;   // what floats over the free map and the map it stands on (measure)
  private ins: Box = ZERO;                     // the free rect as canvas insets (CSS px), as given to the view
  private edge = 0;                            // what the map's labels keep clear of beside the COLUMNS' panel (view labelEdge)
  private safe: Box = ZERO;                    // the safe area in #app px (safeArea)
  private started = false;
  private readonly mq: MediaQueryList[];
  private readonly subs = new Set<(why: LayoutChange) => void>();
  private readonly mounts: ((host: Host, c: Classes) => void)[] = [];
  private readonly ro: ResizeObserver | null = null;
  private readonly hud: HTMLElement | null;
  private readonly sideEl: HTMLElement | null;
  private readonly left: HTMLElement | null;
  private readonly banner: HTMLElement | null;
  private readonly tabs: HTMLElement | null;   // the tab buttons: the SHEET's bar, wherever it is hosted
  private readonly column: HTMLElement | null; // the SHEET's map tool column (#map-col)
  /** The window inside the safe-area insets (base.css #safe-box: fixed, invisible), whatever the host does with #app: the
   *  classes are read from it, so a host that runs #app under the insets (the DRAWER, the SHEET's height) never changes
   *  the size that chose it (a 900 × 490 window with a 20 px home indicator is a 900 × 470 DRAWER, not DRAWER and DOCK by
   *  turns). #app's own box is the geometry. */
  private readonly frame: HTMLElement;

  constructor(private readonly g: Game, private readonly app: HTMLElement, private readonly side: SidePanel) {
    this.hud = app.querySelector<HTMLElement>('#hud');
    this.sideEl = app.querySelector<HTMLElement>('#side');
    this.left = app.querySelector<HTMLElement>('#left');
    this.banner = app.querySelector<HTMLElement>('#place-banner');
    this.tabs = app.querySelector<HTMLElement>('#tabs');
    this.column = app.querySelector<HTMLElement>('#map-col');
    this.frame = document.getElementById('safe-box') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'safe-box' }));
    this.frame.setAttribute('aria-hidden', 'true');
    this.mq = QUERIES.map((q) => matchMedia(q));
    const [cw, ch] = this.frameSize(app.clientWidth, app.clientHeight);
    this.cls = classify(cw, ch, this.media());
    this.det = side.expanded ? 'half' : 'closed';
    side.layout = this;
    active = this;
    for (const m of this.mq) listen(m, () => this.update());
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.update());
      this.ro.observe(app);   // the geometry (the SHEET's and the DRAWER's #app run under the insets)
      this.ro.observe(this.frame);   // the classes: the window inside the insets
      // the chrome growing, shown, hidden
      for (const el of [this.hud, this.sideEl, this.left, this.banner, this.tabs, this.column]) if (el) this.ro.observe(el);
    } else window.addEventListener('resize', () => this.update());
    // a detent above the host's default is a layer Back and Esc close, one step at a time (full → half → closed); on the
    // DOCK the spine and the wide pane both come back to the docked pane (isLayer, backDetent). The Breviarium, the
    // phone's speed popover and the tool column's popovers have their own (tray.ts, hud.ts, mapbar.ts), as do the cards
    // in the sheet's slot (the selection's, history.ts; the event card's, ui/index.ts)
    registerBack({ rank: BACK_RANK.detent, open: () => this.layerOpen(), close: () => this.setDetent(backDetent(this.det, this.cls.host, this.cls.tiny)) });
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
  /** The sliding panel's extent at each detent (#app px, a copy): the SHEET's height above the bar, the DRAWER pane's
   *  width beside the spine, the DOCK pane's and the COLUMNS panel's width at the right edge. sheet.ts slides between
   *  these (and drags the phones'). */
  get extents(): Record<Detent, number> | null { const e = this.extentsNow(); return e ? { ...e } : null; }
  /** What stands on the SHEET's bar at rest, in px (also --dock-h on #app): the placing banner while placing, a card
   *  docked in the sheet's slot, else the sheet at its detent; 0 on any other host. The tool column rides on it. */
  get dockH(): number { return Math.max(0, this.dockPx); }
  /** The card docked in the phone's slot, if any (dock). */
  get docked(): HTMLElement | null { return this.card; }

  /** Docks a card in a phone's slot (null: none): the context card (the inspector's popup) or the event card. One at a
   *  time (the UI root sees to it): while it shows, the voice line steps aside behind it (#app[data-card]: on the SHEET the
   *  sheet, the bar staying; on the DRAWER the floating line) and the free rect ends clear of it (on the SHEET above it,
   *  the tool column riding on it; on the DRAWER, where it stands at the bottom-left of the map, above or beside it).
   *  Measured at once, so the camera call that follows (the card's glide of its target clear of it) sees the free map it
   *  leaves; its own growth is observed. */
  dock(el: HTMLElement | null): void {
    if (el === this.card) { this.update(); return; }
    if (this.card) this.ro?.unobserve(this.card);
    this.card = el;
    if (el) this.ro?.observe(el);
    this.update();
  }

  /** Moves the panel to a detent: the host's own for `d` (a tiny sheet has no half), the panel written at once
   *  (`instant`: no slide), then the camera insets for the detent's target (never mid-slide). On a phone the panel slides
   *  there (sheet.ts: the SHEET up or down, the DRAWER's pane sideways) from `fromH`, the extent a drag let go at, else
   *  the detent it leaves. `user`: the player moved it by hand (the grabber, the open tab's slot or spine icon): what a
   *  remembering route kept is no longer the way back. */
  setDetent(d: Detent, opts: { instant?: boolean; fromH?: number; user?: boolean } = {}): void {
    const to = fitDetent(d, this.det, this.cls.host, this.cls.tiny);
    // placing wants the docked layout's map (route: placing docks a wide pane): the DOCK's or the COLUMNS' pane going wide
    // while placing (I, ⤢, the view control, Shift with a tab's key) ends the placing first, as the player turns to the
    // ledgers; its end may have put back the wide pane placing had docked
    if (to === 'full' && this.det !== 'full' && !isPhone(this.cls.host) && this.g.view.placing !== null) {
      this.g.cancelPlacing();
      if (this.detent === 'full') return;   // (the getter: cancelPlacing moved it)
    }
    const hs = this.extentsNow(), sheet = hs ? this.sheetHooks : null;
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
   *  The phones (SHEET, DRAWER) route their tabs, the voice line's chips, placing, the inspector and the lessons through
   *  it; the DOCK and the COLUMNS their tabs (Shift with a key: wide), placing (a wide pane docks for it), the lessons and
   *  every "show on map" (App.select, App.focusTile, the focus row: the DOCK's wide pane under 960 px docks for them). A
   *  tab opened is a new place to come back from: a focus kept before it is no longer the way back; nor is anything kept
   *  for a placing that keeps nothing itself (a docked pane staying): its end must not restore an older detent. */
  go(i: Intent): Route {
    const r = route(i, { host: this.cls.host, detent: this.det, tiny: this.cls.tiny, w: this.cls.w });
    if (i.kind === 'open') { this.openedAt = performance.now(); this.kept = null; }
    if (i.kind === 'place' && !r.remember) this.kept = null;
    if (r.remember && this.kept === null) { this.kept = this.det; this.keptTop = this.side.scrollTop; this.keptTab = this.side.current; }
    this.setDetent(r.detent);
    return r;
  }

  /** Puts back the detent a remembering route left (✕ on the context card, the end of placing) and the tab body's scroll
   *  with it (once the body is drawn again, and only while that tab is still the one open: a bar slot that closed the
   *  card goes on to open its own tab at its top); false when none. */
  restore(): boolean {
    const d = this.kept, top = this.keptTop, tab = this.keptTab;
    this.kept = null;
    if (d === null) return false;
    this.setDetent(d);
    if (d !== 'closed' && top > 0) requestAnimationFrame(() => { if (this.side.current === tab) this.side.scrollBack(top); });
    return true;
  }

  /** Drops what a remembering route kept: a work was placed, and the sheet stays where placing put it (closed). */
  forget(): void { this.kept = null; }

  /** A colony entered on a tablet or the desktop (UI.hideTitle): never wide, the last colony's Tabularium left behind
   *  (nor the wide pane a toggle would reopen at: a new colony's first tab opens it so), and nothing it kept is the way
   *  back now. A panel folded stays folded, as the desktop's always did. */
  settle(): void {
    this.kept = null;
    if (this.lastOpen === 'full') this.lastOpen = 'half';
    if (this.det === 'full') this.setDetent('half', { instant: true });
  }

  /** Raises a closed panel to half for a while (`why`: who, as the counsel unfolding its card on a phone); drop() with
   *  the same `why` closes it again, unless anything else moved the panel since. Not while a card stands in a phone's
   *  slot: the panel stays closed behind it (and the counsel's card folded in its line). */
  lift(why: string): void {
    if (this.det !== 'closed' || this.cardShown()) return;
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

  /** What floats over the map, which the free rect keeps out of by taking the larger part beside it (clearOf): the
   *  DRAWER's floating voice line or docked card, the DOCK's head afloat beside the spine. Its own box, and the free map
   *  it stands on (the free rect before that clearing), in #app px; null when nothing floats. The inspector counts the
   *  box as covering, not the whole band clearOf gave up (a target beside the head is in view). */
  floatingBox(): { under: Box; box: Box } | null {
    return this.afloat ? { under: { ...this.afloat.under }, box: { ...this.afloat.box } } : null;
  }

  /** The UI covers all of the map now (mapCovered over the free rect at rest, this host, and whether a modal is open),
   *  and the panel is not moving (a drag down from full, or a slide, uncovers map the detent's rect does not count):
   *  main.ts asks every turn and suspends the map's drawing while it does. */
  covered(modal: boolean): boolean {
    return this.started && !(this.sheetHooks?.moving?.() ?? false) && mapCovered(this.free, this.cls.host, modal);
  }

  /** The safe area in #app px (a copy): all of #app where #app is inset already; on the DRAWER, inside the notch, the
   *  rounded corners and the home indicator, which its #app runs under. */
  safeRect(): Box { return { ...this.safe }; }

  /** The selector to glow for a lesson or remedy target here: its proxy where this host hides it, unless it shows after
   *  all (the SHEET's overlay bar in its open Mappae popover glows itself). */
  reveal(selector: string): string {
    const proxy = reveal(selector, this.cls.host, this.cls.w);
    if (proxy !== selector && inFrame(selector) && shown(document.querySelector<HTMLElement>(selector))) return selector;
    return proxy;
  }

  /** Calls `cb` after the classes, the detent or the free rect change; returns the unsubscribe. */
  onChange(cb: (why: LayoutChange) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  /** Registers a widget's placement per host: `mount(host, classes)` runs now and on every change of the host or of its
   *  width class, before the layout measures (the SHEET re-hosts the counsel, the ticker, the tab bar, the overlay bar and
   *  the zoom buttons; the DOCK its pane's head, and its tool column under 960 px wide). */
  onMount(mount: (host: Host, c: Classes) => void): void {
    this.mounts.push(mount);
    this.runMount(mount);
    this.update();
  }

  /** The phone hosts' DOM (sheet.ts) registers itself: the engine asks it the SHEET's head height and the DRAWER's
   *  floating voice line, and has it slide. Its elements are observed, so a voice line that grows a row resizes the closed
   *  sheet (or moves the drawer's free map). */
  attachSheet(hooks: SheetHooks, observe: readonly HTMLElement[]): void {
    this.sheetHooks = hooks;
    for (const el of observe) this.ro?.observe(el);
    this.update();
    const hs = this.extentsNow();
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

  private runMount(mount: (host: Host, c: Classes) => void): void {
    try { mount(this.cls.host, { ...this.cls }); } catch (e) { console.error('[layout] mount', e); }
  }

  /** The detent layer of the Back and Esc chain is open: a game, the panel showing a tab, at a detent that is a layer
   *  (above the host's default; on the DOCK, the spine or the wide pane). */
  private layerOpen(): boolean {
    return this.g.mode === 'game' && this.paneShown() && isLayer(this.det, this.cls.host);
  }

  /** The panel shows a tab (it stands, and the introduction has brought one: not #side.empty, which the DOCK keeps up,
   *  0 px wide, for its floating head). */
  private paneShown(): boolean {
    return shown(this.sideEl) && !this.sideEl?.classList.contains('empty');
  }

  /** The size the classes are read from: the window inside the safe-area insets (#safe-box), #app's own (`W` × `H`)
   *  before it is laid out. */
  private frameSize(W: number, H: number): [number, number] {
    const f = this.frame;
    return f.clientWidth && f.clientHeight ? [f.clientWidth, f.clientHeight] : [W, H];
  }

  /** The safe area in #app px: #safe-box's rect against #app's, within #app. */
  private safeIn(W: number, H: number): Box {
    const f = this.frame;
    if (!f.clientWidth || !f.clientHeight) return { left: 0, top: 0, right: W, bottom: H };
    const a = this.app.getBoundingClientRect(), r = f.getBoundingClientRect();
    return {
      left: Math.max(0, Math.round(r.left - a.left)), top: Math.max(0, Math.round(r.top - a.top)),
      right: Math.min(W, Math.round(r.right - a.left)), bottom: Math.min(H, Math.round(r.bottom - a.top)),
    };
  }

  private update(): void {
    const W = this.app.clientWidth, H = this.app.clientHeight;
    if (!W || !H) return;   // not laid out (a hidden frame): keep what we have
    const [cw, ch] = this.frameSize(W, H);
    const c = classify(cw, ch, this.media()), was = this.cls, first = !this.started;
    this.started = true;
    const shape = first || c.w !== was.w || c.h !== was.h || c.input !== was.input || c.host !== was.host || c.tiny !== was.tiny;
    const host = !first && c.host !== was.host;
    this.cls = c;
    // the host's DOM in place before anything is measured (a DOCK turned from 820 to 1180 px wide trades its tool column
    // for the minimap: a change of width class remounts too)
    if (host || (!first && c.w !== was.w)) for (const m of this.mounts) this.runMount(m);
    // how the COLUMNS make room for the wide panel (columnsRoom): under 1750 px the left column folds away while it is
    // wide (data-fold), unless the opening lessons speak in it: the map then gives way to a strip (data-strip)
    this.lessons = introRunning(this.g.state);
    const room = c.host === 'columns' ? columnsRoom(W, this.lessons) : null;
    if (room !== this.room) {
      this.room = room;
      for (const k of ['fold', 'strip'] as const) { if (room === k) this.app.dataset[k] = ''; else delete this.app.dataset[k]; }
    }
    // the host's default (hostEntryDetent): entering the SHEET shows the map, the sheet closed, unless a tab was opened
    // just now. A tiny sheet has no half (full instead), and a full forced so goes back to half once the window allows it
    const k = hostEntryDetent(this.det, this.forced, first ? null : was.host, c.host, c.tiny, performance.now() - this.openedAt <= JUST_OPENED_MS);
    const turned = k.detent !== this.det;
    this.det = k.detent;
    this.forced = k.forced;
    if (turned && k.detent !== 'closed') this.lastOpen = k.forced ? 'half' : k.detent;
    if (shape || turned) this.write();
    if (this.side.expanded !== (this.det !== 'closed')) this.side.show(this.det !== 'closed', true);
    const sh = this.sizeSheet(H), dw = this.sizeDrawer(W), kw = this.sizeDock(W), pw = this.sizeColumns(W);   // (each drops its properties off its host)
    const hs = sh ?? dw ?? kw ?? pw;
    // at rest there (and on the DOCK and the COLUMNS when the width class changes: the panel's widths change with it)
    if (hs && (turned || host || first || ((kw || pw) && c.w !== was.w)) && this.sheetHooks) this.sheetHooks.slide(hs[this.det], hs[this.det], this.det, true);
    this.writeDock(H);
    this.safe = this.safeIn(W, H);
    const free = this.measure(W, H), ins = this.insets(free);
    const moved = !sameBox(free, this.free) || !sameBox(ins, this.ins);
    this.free = free;
    this.ins = ins;
    this.writeFree(W);
    // the COLUMNS' ▸ and ⤢ stand --cols-edge over the map beside the panel (columns.css): the map's labels keep clear
    const edge = c.host === 'columns' && this.paneShown() ? parseFloat(getComputedStyle(this.app).getPropertyValue('--cols-edge')) || 0 : 0;
    if (moved || host || edge !== this.edge) this.g.view.setInsets(ins, { host, canvasZoom: c.host === 'columns', labelEdge: edge });
    this.edge = edge;
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

  /** The docked card while it shows on a phone (not while placing hides it, nor folded away), else null. */
  private cardShown(): HTMLElement | null {
    return isPhone(this.cls.host) && shown(this.card) ? this.card : null;
  }

  /** The sliding panel's extents at each detent now: the SHEET's heights, the DRAWER's, the DOCK's and the COLUMNS'
   *  widths. */
  private extentsNow(): Record<Detent, number> | null {
    const h = this.cls.host;
    return h === 'sheet' ? this.heights : h === 'drawer' ? this.widths : h === 'dock' ? this.dockW : this.colsW;
  }

  /** Writes what stands in a phone's slot: #app[data-card] while a docked card shows (the voice line steps aside:
   *  sheet.css, drawer.css), and on the SHEET --dock-h, the height of the banner, the card or the sheet at its detent
   *  (the tool column rides on it). Off the phones both go, and off the SHEET --dock-h. */
  private writeDock(H: number): void {
    const a = this.app;
    const card = this.cardShown();
    if (!!card !== ('card' in a.dataset)) { if (card) a.dataset.card = ''; else delete a.dataset.card; }
    let px = -1;
    if (this.cls.host === 'sheet') {
      const bar = this.barH(), ban = this.banner;
      if (a.classList.contains('placing') && shown(ban)) px = H - bar - ban.offsetTop;
      else if (card) px = H - bar - card.offsetTop;
      else px = this.heights?.[this.det] ?? 0;
      px = Math.max(0, Math.round(px));
    }
    if (px === this.dockPx) return;
    this.dockPx = px;
    if (px < 0) a.style.removeProperty('--dock-h');
    else a.style.setProperty('--dock-h', `${px}px`);
  }

  /** The DOCK's free map for what dock.css centres in it beside the folded pane (the event card, clear of the floating
   *  head): its top and its distance from #app's right edge, written on #app as --dock-free-t and --dock-free-r; gone
   *  off the DOCK. */
  private writeFree(W: number): void {
    const st = this.app.style, f = this.free;
    const v = this.cls.host === 'dock' ? `${Math.round(f.top)}px|${Math.max(0, Math.round(W - f.right))}px` : '';
    if (v === this.freeVars) return;
    this.freeVars = v;
    if (!v) { st.removeProperty('--dock-free-t'); st.removeProperty('--dock-free-r'); return; }
    const [t, r] = v.split('|');
    st.setProperty('--dock-free-t', t);
    st.setProperty('--dock-free-r', r);
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

  /** The DRAWER pane's width at each detent (drawerWidths over #app's width and the spine's), written on #app as
   *  --drawer-half and --drawer-full for drawer.css (the pane, and the tool column and toasts beside it); null (and the
   *  properties gone) on any other host. */
  private sizeDrawer(W: number): Record<Detent, number> | null {
    const st = this.app.style;
    if (this.cls.host !== 'drawer') {
      if (this.widths) { st.removeProperty('--drawer-half'); st.removeProperty('--drawer-full'); this.widths = null; }
      return null;
    }
    const ws = drawerWidths(W, shown(this.tabs) ? this.tabs.offsetWidth : 0);
    const was = this.widths;
    if (!was || DETENTS.some((d) => ws[d] !== was[d])) {
      this.widths = ws;
      st.setProperty('--drawer-half', `${ws.half}px`);
      st.setProperty('--drawer-full', `${ws.full}px`);
    }
    return this.widths;
  }

  /** The DOCK pane's width at each detent (dockWidths over #app's width and width class), written on #app as --dock-half
   *  and --dock-full for dock.css (the pane, and what stands beside it on the map: the tool column, the map tools, the
   *  ticker, the toasts, the event card, the placing banner); null (and the properties gone) on any other host. */
  private sizeDock(W: number): Record<Detent, number> | null {
    const st = this.app.style;
    if (this.cls.host !== 'dock') {
      if (this.dockW) { st.removeProperty('--dock-half'); st.removeProperty('--dock-full'); this.dockW = null; }
      return null;
    }
    const ws = dockWidths(W, this.cls.w);
    const was = this.dockW;
    if (!was || DETENTS.some((d) => ws[d] !== was[d])) {
      this.dockW = ws;
      st.setProperty('--dock-half', `${ws.half}px`);
      st.setProperty('--dock-full', `${ws.full}px`);
    }
    return this.dockW;
  }

  /** The COLUMNS panel's width at each detent (columnsWidths over #app's width and width class), written on #app as
   *  --cols-half and --cols-full for columns.css (the panel, and what stands beside it on the map keeps clear of it);
   *  null (and the properties gone) on any other host. */
  private sizeColumns(W: number): Record<Detent, number> | null {
    const st = this.app.style;
    if (this.cls.host !== 'columns') {
      if (this.colsW) { st.removeProperty('--cols-half'); st.removeProperty('--cols-full'); this.colsW = null; }
      return null;
    }
    const ws = columnsWidths(W, this.lessons);
    const was = this.colsW;
    if (!was || DETENTS.some((d) => ws[d] !== was[d])) {
      this.colsW = ws;
      st.setProperty('--cols-half', `${ws.half}px`);
      st.setProperty('--cols-full', `${ws.full}px`);
    }
    return this.colsW;
  }

  /** The free rect at rest, in #app px: below the HUD, then per host. The SHEET: above the sheet at its detent's height
   *  (sizeSheet: never its slide) and the bar under it, and left of the tool column; a card docked in the sheet's slot
   *  stands in the sheet's place (the free map ends above it); while placing the sheet steps aside and the placing
   *  banner stands over the bar instead. Everywhere, above the placing banner while placing, so a pre-positioned ghost
   *  shows over it. The DRAWER: inside the safe area (its #app runs under the insets), left of the spine, and of
   *  the pane at its detent's width (drawerWidths: never its slide; none while placing or a docked card has it aside),
   *  and of the tool column beside them; clear of what stands at the bottom-left of the map (clearOf: above it, or
   *  beside a tall card): the docked card, else the floating voice line while the pane is closed (the banner while
   *  placing, as everywhere). The DOCK: left of the pane at its detent's width (dockWidths: the spine, the docked pane, or
   *  the wide one, which leaves no map under 960 px and a 320 px strip from 960); the pane stays while placing; clear of
   *  the head afloat beside the spine (clearOf: below it, or left of a tall one). The COLUMNS: left of the panel at its
   *  detent's width (columnsWidths: the badge spine, today's 380 px panel, the wide one), right of the left column
   *  unless it folds away for the wide panel (under 1750 px, columnsRoom: columns.css hides it, the map at the left edge).
   *  What floats over the free map (the map's tools, the ticker, the view control) is not taken out: the inspector steps
   *  a target clear of it. */
  private measure(W: number, H: number): Box {
    let box = { left: 0, top: 0, right: W, bottom: H };
    let afloat: { under: Box; box: Box } | null = null;
    this.afloat = null;
    if (this.app.classList.contains('in-title')) return box;   // the title hides the chrome: all of the map shows
    if (shown(this.hud)) box.top = Math.max(0, this.hud.offsetTop + this.hud.offsetHeight);
    const placing = this.app.classList.contains('placing');
    if (this.cls.host === 'sheet') {
      const card = placing ? null : this.cardShown();   // the sheet stands aside behind a docked card
      const up = this.heights && shown(this.sideEl) && !placing && !card ? this.heights[this.det] : 0;
      box.bottom = Math.min(box.bottom, H - this.barH() - up);
      if (card) box.bottom = Math.min(box.bottom, card.offsetTop - CARD_GAP);
      const col = this.column;
      if (shown(col)) box.right = Math.min(box.right, col.offsetLeft - COLUMN_GAP);
    } else if (this.cls.host === 'drawer') {
      // inside the safe area (#app runs under the notch and the home indicator), left of the spine and of the pane (which
      // stays away while placing or a card stands in the slot: drawer.css)
      const sa = this.safe;
      box = { left: Math.max(box.left, sa.left), top: Math.max(box.top, sa.top), right: Math.min(box.right, sa.right), bottom: Math.min(box.bottom, sa.bottom) };
      const card = placing ? null : this.cardShown();
      const spine = shown(this.tabs) ? this.tabs.offsetLeft : W;
      const pane = this.widths && shown(this.sideEl) && !placing && !card ? this.widths[this.det] : 0;
      box.right = Math.min(box.right, spine - pane);
      const col = this.column;
      if (shown(col)) box.right = Math.min(box.right, col.offsetLeft - COLUMN_GAP);
      const voice = placing || card || this.det !== 'closed' ? null : this.sheetHooks?.floating() ?? null;
      const at = card ?? voice;
      if (at && shown(at)) {
        const fb = { left: at.offsetLeft, top: at.offsetTop, right: at.offsetLeft + at.offsetWidth, bottom: at.offsetTop + at.offsetHeight };
        afloat = { under: { ...box }, box: fb };
        box = clearOf(box, fb, CARD_GAP);
      }
    } else if (this.cls.host === 'dock') {
      const pane = this.dockW && this.paneShown() ? this.dockW[this.det] : 0;
      box.right = Math.min(box.right, W - pane);
      // the head afloat top-right over the map beside the spine (at rest there: no slide moves it): the free map is the
      // larger part clear of it, as beside the DRAWER's floating line, so the popup, the event card and a centred target
      // keep out from under it
      const head = this.sheetHooks?.floating() ?? null;
      if (head && shown(head)) {
        const a = this.app.getBoundingClientRect(), r = head.getBoundingClientRect();
        const fb = { left: r.left - a.left, top: r.top - a.top, right: r.right - a.left, bottom: r.bottom - a.top };
        afloat = { under: { ...box }, box: fb };
        box = clearOf(box, fb, CARD_GAP);
      }
    } else {
      const pane = this.colsW && this.paneShown() ? this.colsW[this.det] : 0;
      box.right = Math.min(box.right, W - pane);
      const col = this.left;
      if (shown(col) && col.offsetWidth < W / 2) box.left = Math.max(box.left, col.offsetLeft + col.offsetWidth);
    }
    const ban = this.banner;
    for (const b of afloat ? [box, afloat.under] : [box]) {
      if (placing && shown(ban)) b.bottom = Math.min(b.bottom, ban.offsetTop - BANNER_GAP);
      if (b.bottom < b.top) b.bottom = b.top;
      if (b.right < b.left) b.right = b.left;
    }
    this.afloat = afloat;
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
