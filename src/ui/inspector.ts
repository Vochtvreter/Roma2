// src/ui/inspector.ts — the house / building / block / tile inspector (ARCHITECTURE §13.3, DESIGN §15.4, §11.10). Owner: WP-I.
// Hover = a transient card bottom left, click = a closable popup pinned beside the target; signature-diffed like the panels (rebuild on discrete change, else updaters).
// A pinned target the UI covers (the panel, the sheet, the HUD, the map's tools) glides clear (view.ensureVisible, then dodge())
// rather than losing its card: when it is picked, and again when the layout moves the UI over it; never after a pan.
// The same target is not rebuilt while the mouse rests on its card, unless to answer a click there, nor while a press made in
// it is held (steady.ts): its buttons stay put.
// On a tablet (the DOCK) and the desktop the popup stands beside its target in the free map the layout leaves (its free
// rect: left of the docked pane, the spine, or the wide pane's strip of map; right of the desktop's left column).
// On a phone (the SHEET and the DRAWER: layout.ts) the popup is the context card (DESIGN §15.7): docked in the phone's slot
// (data-docked; never placed beside its target: above the SHEET's bar, at the bottom-left of the DRAWER's map), its brief
// first (briefParts: the head, the two or three most useful lines, the main actions) and More for the whole card; a work
// with posts carries its category's labour line (labourEl) to staff it in place; the camera glides the target clear of it.
import { BUILDER, F, T } from '../game/types';
import type { Building, GameState, Rect, ResId, SiteNote, Terrain } from '../game/types';
import type { Game, InspectTarget, Updater } from './types';
import type { Box } from './layout';
import { clear, fmt, fmtRunway, h, img, plural } from './dom';
import * as A from '../game/actions';
import { getBuilding } from '../game/state';
import { fertility, getMap, idx, isFertile, tx, ty, woodAt } from '../game/map';
import { derived, inCamp } from '../game/derived';
import { WALL_RING, ringsOf } from '../game/survey';
import { footfall, wearOf } from '../game/urbs';
import { canPlace, freePlot } from '../game/place';
import { worksQueue } from '../game/construction';
import { siteMult } from '../game/site';
import { effectiveRadius } from '../game/coverage';
import { census } from '../game/census';
import { forecast } from '../game/forecast';
import { personName } from '../game/people';
import { outputChain } from '../game/hints';
import { isAquae, nextTier, unmetNeeds } from '../game/housing';
import { reasonText } from '../game/ordo/reasons';
import { seasonOf, formatRoman } from '../game/calendar';
import { buildingVisible, toolRevealed } from '../game/reveal';
import { B } from '../game/balance';
import { BUILD_ORDER, BUILDING_DEFS, slotsOf } from '../game/data/buildings';
import { LAYER_META, TIER_DEFS } from '../game/data/housing';
import { RESOURCE_DEFS } from '../game/data/resources';
import { RANK_DEFS } from '../game/data/ranks';
import { buildingSprite, houseSprite } from '../render/art/index';
import { armedWithin, confirm2 } from './modals';
import { PointerHold } from './steady';
import { clearAround, currentFloating, currentFree, currentHost, isPhone } from './layout';
import { bar, btn, caps, lackLine, lacking, pct, rankReason, seg, typeSprite } from './tabs/common';
import { houseView } from './tabs/house';
import { labourEl } from './tabs/labour';

/** '+4,000 grain (4.2 months at today's 32/day)': what a store adds, in time at today's need for grain and water (§8.6). */
function storeText(s: GameState, r: ResId, n: number): string {
  const base = `+${fmt(n)} ${RESOURCE_DEFS[r].name.toLowerCase()}`;
  if (r !== 'grain' && r !== 'water') return base;
  const need = forecast(s)[r].need;
  return need > 0 ? `${base} (${fmtRunway(n / need)} at today's ${fmt(need)}/day)` : base;
}

const TERRAIN: Record<number, string> = {
  [T.grass]: 'Grassland', [T.meadow]: 'Meadow', [T.loam]: 'River loam', [T.scrub]: 'Scrub', [T.forest]: 'Forest',
  [T.dense]: 'Dense forest', [T.hills]: 'Hills', [T.rock]: 'Rock', [T.crag]: 'Crag', [T.river]: 'River',
};
const FEATURE: Record<number, string> = { [F.clay]: 'a clay bank', [F.ore]: 'an iron vein', [F.fons]: 'a spring', [F.lucus]: 'a sacred grove', [F.ruins]: 'old ruins' };
const DISTRICT = { praetentura: 'Praetentura', latera: 'Latera', retentura: 'Retentura', canabae: 'Canabae', vallum: 'Vetus vallum' } as const;
const RING = ['inside the castrum', 'in the canabae ring', 'in the outer ring', 'on the old camp wall'] as const;
const WEAR_WORD = ['a grassy track', 'a track', 'a busy road', 'a highway'] as const;
const NOTE: Record<SiteNote['code'], (v?: number) => string> = {
  river: (v) => `beside the river${v ? ` (${pct(1 + v)})` : ''}`, loam: () => 'on river loam', fields: (v) => `next to ${v ?? 1} fields`,
  forum: (v) => `${v ?? '?'} steps from the forum`, woods: (v) => `woods ${v !== undefined ? `×${fmt(v)}` : 'nearby'}`, rock: () => 'on hills and rock',
  clay: () => 'touching a clay bank', vein: (v) => `on an iron vein${v ? ` (quality ×${fmt(v)})` : ''}`, quarryNear: () => 'a quarry within 6 tiles',
  mineNear: () => 'a mine within 4 tiles', district: () => 'in its proper district', covers: (v) => `covers ${plural(v ?? 0, 'house', 'houses')}`,
  unblocks: (v) => `lets ${plural(v ?? 0, 'house', 'houses')} evolve`, felling: (v) => `felling gave ${v ?? 0} timber`, water: () => 'on the water table', via: () => 'touching the via',
};
const PRIO = ['Low', 'Normal', 'High'] as const;
const PRIO_IDS = ['0', '1', '2'] as const;
const STAGES = ['Podium', 'Cella', 'Columnae', 'Fastigium'] as const;

function staffOf(s: GameState, b: Building): number {
  return census(s).staffed[b.id] ?? 0;
}

/** Discrete facts of a target: a change rebuilds the card; everything continuous refreshes through updaters. */
function targetSig(s: GameState, t: InspectTarget, sticky: boolean): string {
  if (t.kind === 'building') {
    const b = getBuilding(s, t.id);
    if (!b) return `gone:${t.id}`;
    const hs = b.house;
    const next = hs ? nextTier(s, b) : null;
    return [`b${b.id}`, b.status, b.owner, +b.open, b.prio, staffOf(s, b), hs ? `${hs.tier}:${hs.pref}:${+hs.declining}:${+!!hs.renovating}` : '',
      next ? unmetNeeds(s, b, next).join(',') : '', +s.ordo.on.build, +s.ordo.on.labour, s.rank].join('|');
  }
  if (t.kind === 'block') {
    const p = derived(s).plotOwner;
    return `k${t.block}|${+s.ordo.reserved.includes(t.block)}|${[0, 1, 2, 3].map((i) => p[t.block * 4 + i]).join(',')}|${s.rank}`;
  }
  return `t${t.tile}|${derived(s).buildingAt[t.tile]}|${+sticky}|${s.rank}|${s.buildings.length}`;
}

const same = (a: InspectTarget | null, b: InspectTarget | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The kinds of card, as the brief tells them apart. */
export type CardKind = 'house' | 'works' | 'site' | 'block' | 'tile';
/** What the phone's docked card shows before More, per kind: its lines by usefulness (the first BRIEF_LINES of those it
 *  has) and its main actions. The parts are the card's own (data-part); anything else waits behind More. A house: a
 *  decline first, then what it waits for (its first want, with the button that fixes it), beds and its tier. A work: its
 *  hands and its category's labour line (staffed in place), else what it stores, serves or yields; Close it and the
 *  staffing priority. A site: how far it has come and why; ↑ Build first and Cancel. A block: its plots; Place a house
 *  plot and Reserve. Ground: what it is and the wall on it; Lay out the town wall and what could be built on it. */
export const BRIEF: Readonly<Record<CardKind, { lines: readonly string[]; acts: readonly string[] }>> = {
  house: { lines: ['declining', 'needs', 'renovating', 'beds', 'sub', 'finest'], acts: [] },
  works: { lines: ['staff', 'labour', 'benefit', 'stores', 'service', 'passive', 'chain'], acts: ['controls'] },
  site: { lines: ['progress', 'why', 'notes'], acts: ['queue'] },
  block: { lines: ['status', 'reserved', 'plots'], acts: ['actions'] },
  tile: { lines: ['facts', 'wall'], acts: ['walls', 'buildable'] },
};
export const BRIEF_LINES = 3;

/** The parts of a card its brief shows (pure; tests/sheet.test.ts), in the card's own order: its kind's most useful lines
 *  among `present` (at most BRIEF_LINES of them: a part made of several elements counts once) and all its actions. */
export function briefParts(kind: CardKind, present: readonly string[]): string[] {
  const t = BRIEF[kind];
  const lines = t.lines.filter((p) => present.includes(p)).slice(0, BRIEF_LINES);
  const keep = new Set([...lines, ...t.acts.filter((p) => present.includes(p))]);
  return present.filter((p, i) => keep.has(p) && present.indexOf(p) === i);
}

/** Names an element as one part of the card (data-part), for the phone's brief. */
function part<T extends HTMLElement>(el: T, id: string): T {
  el.dataset.part = id;
  return el;
}

const E = 0.5;   // px of slack: the boxes are fractional
const moved = (b: Box, dx: number, dy: number): Box => ({ left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy });

/** How far (CSS px, down positive) a target spanning [top, bottom] should move so a card at least `room` tall fits
 *  above or below it inside [y0, y1], the target itself staying inside [clear, y1] (clear of a band of cards the popup
 *  may cover but the target should not: a phone's Res Gestae and counsel). The least such move (down first on a tie);
 *  0 when none is needed, or none would do. */
export function roomShift(top: number, bottom: number, y0: number, y1: number, room: number, clear = y0): number {
  const fits = (d: number): boolean => top + d >= clear - E && bottom + d <= y1 + E && (top + d - y0 >= room - E || y1 - bottom - d >= room - E);
  let best: number | null = null;
  for (const d of [0, Math.max(0, clear - top), Math.max(0, room - (top - y0), clear - top), -(room - (y1 - bottom))]) {
    if (fits(d) && (best === null || Math.abs(d) < Math.abs(best) - E)) best = d;
  }
  return best ?? 0;
}

/** How much of box `t` the boxes `over` cover, in px² (overlaps under half a px on an axis do not count; the boxes'
 *  own overlaps are counted twice, which hardly matters: the UI's boxes seldom overlap). */
export function coveredArea(t: Box, over: readonly Box[]): number {
  let a = 0;
  for (const o of over) {
    const w = Math.min(t.right, o.right) - Math.max(t.left, o.left), hh = Math.min(t.bottom, o.bottom) - Math.max(t.top, o.top);
    if (w > E && hh > E) a += w * hh;
  }
  return a;
}

/** The least move (CSS px, right and down positive) that takes box `t` clear of every box in `over` while it stays in
 *  `within`. On each axis the move stays put or stops `m` px short of an edge of `within` or of a box (0 px short when no
 *  such move clears it). When none clears it all, the nearest of those leaving least of it covered, if that uncovers at
 *  least a quarter of it; else none. (0, 0) when it is clear already. */
export function dodge(t: Box, over: readonly Box[], within: Box, m: number): { dx: number; dy: number } {
  type Move = { dx: number; dy: number; a: number; d: number };   // a: the px² still covered, d: the distance
  const steps = (gaps: readonly number[], a0: number, a1: number, lo: number, hi: number, edge: (o: Box) => readonly [number, number]): number[] => {
    const out = [0];
    for (const g of gaps) {
      out.push(lo + g - a0, hi - g - a1);
      for (const o of over) { const [o0, o1] = edge(o); out.push(o0 - g - a1, o1 + g - a0); }
    }
    return out.filter((d) => d === 0 || (a0 + d >= lo - E && a1 + d <= hi + E));
  };
  const moves = (gaps: readonly number[]): Move[] => {
    const out: Move[] = [];
    for (const dx of steps(gaps, t.left, t.right, within.left, within.right, (o) => [o.left, o.right])) {
      for (const dy of steps(gaps, t.top, t.bottom, within.top, within.bottom, (o) => [o.top, o.bottom])) {
        out.push({ dx, dy, a: coveredArea(moved(t, dx, dy), over), d: Math.hypot(dx, dy) });
      }
    }
    return out;   // [0]: staying put
  };
  const nearest = (cs: readonly Move[], cap: number): Move | null => {
    let best: Move | null = null;
    for (const c of cs) if (c.a <= cap && (!best || c.d < best.d - E)) best = c;
    return best;
  };
  const clear = nearest(moves([m]), E) ?? nearest(moves([m, 0]), E);
  if (clear) return { dx: clear.dx, dy: clear.dy };
  // nothing clears it: the least cover, among moves within 2% of it the nearest (a hair less is no reason to go far)
  const all = moves([m, 0]), size = (t.right - t.left) * (t.bottom - t.top);
  const least = Math.min(...all.map((c) => c.a)), best = nearest(all, least + Math.max(E, size * 0.02));
  return best && all[0].a - best.a >= size / 4 ? { dx: best.dx, dy: best.dy } : { dx: 0, dy: 0 };
}

/** The pinned popup's place beside its target: the side its tail is on (`l`: the card right of the target, its tail on
 *  the card's left edge; `r` left of it; `t` below it; `b` above it; '' over the target's emptier edge, no tail), the
 *  card's top-left and its max-height (it scrolls inside below its natural height). */
export interface PopupSlot { side: 'l' | 'r' | 't' | 'b' | ''; left: number; top: number; maxH: number }
/** The popup's measures (CSS px): its gap to the target, its tallest and its least height (a shorter card keeps its
 *  own), what it keeps clear of the map's tools, and how far its tail stands from its corners. */
export const POPUP = { gap: 10, maxH: 560, minH: 180, clear: 8, tail: 14 } as const;

/** Where the pinned popup stands (pure; tests/layout.test.ts) for a target `r` in the free map `room` (both #app px),
 *  the card `w` wide and `natural` tall. Beside the target (right first), else below or above it where the whole card
 *  fits, else where there is more room; a target too big for any of these (the forum close up) gets the card over its
 *  emptier edge. Of the places where it fits whole, the one that covers least of the map's own `tools` (the zoom and the
 *  tool column, the overlay bar, the minimap, the ticker), so − and ⌂ stay in reach while it is open; and when that one
 *  still covers some, any side where a shorter card (down to POPUP.minH, scrolling inside) or one slid along its edge
 *  (its tail still on the target's middle) covers none, the tallest of those (a tablet's map tools under a card beside
 *  a target at the top of the map: the card ends above them). */
export function popupSlot(r: Box, room: Box, w: number, natural: number, tools: readonly Box[], o: typeof POPUP = POPUP): PopupSlot {
  const { gap, minH, clear: C, tail: T } = o;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  const fullH = Math.min(o.maxH, room.bottom - room.top), need = Math.min(natural, fullH);
  const below = room.bottom - (r.bottom + gap), above = r.top - gap - room.top;
  const at = (side: PopupSlot['side']): PopupSlot => {
    if (side === 't' || side === 'b') {
      const maxH = Math.min(o.maxH, side === 't' ? below : above);
      return { side, maxH, top: side === 't' ? r.bottom + gap : r.top - gap - Math.min(natural, maxH), left: clamp(cx - w / 2, room.left, Math.max(room.left, room.right - w)) };
    }
    return { side, maxH: fullH, top: clamp(cy - need / 2, room.top, room.bottom - need),
      left: side === 'l' ? r.right + gap : side === 'r' ? r.left - gap - w : room.right - r.right >= r.left - room.left ? Math.max(room.left, room.right - w) : room.left };
  };
  const hit = (p: PopupSlot): number => coveredArea({ left: p.left, top: p.top, right: p.left + w, bottom: p.top + Math.min(natural, p.maxH) }, tools);
  const fits = ([['l', r.right + gap + w <= room.right], ['r', r.left - gap - w >= room.left], ['t', need <= below], ['b', need <= above]] as const)
    .filter(([, ok]) => ok).map(([k]) => k);
  let best = at(fits[0] ?? (Math.max(below, above) >= minH ? (below >= above ? 't' : 'b') : ''));
  let least = hit(best);
  for (const k of fits.slice(1)) { const p = at(k), a = hit(p); if (a < least - E) { least = a; best = p; } }
  if (!best.side || least <= E) return best;
  const across = (t: Box, left: number): boolean => t.right > left + E && t.left < left + w - E;   // a tool in the card's columns
  const lo = Math.min(natural, minH);   // the card's least height: its own when it is shorter
  let alt: PopupSlot | null = null, tallest = 0;
  // a place clear of the tools where the card shows `h` px of itself (its max-height may leave it room to grow)
  const offer = (p: PopupSlot, h: number): void => { if (h >= lo - E && (!alt || h > tallest + E)) { alt = p; tallest = h; } };
  // beside it: as tall as the run of the room's height around the target's middle that no tool in the card's columns cuts
  for (const side of ['l', 'r'] as const) {
    const left = side === 'l' ? r.right + gap : r.left - gap - w;
    if (left < room.left - E || left + w > room.right + E) continue;
    let y0 = room.top, y1 = room.bottom, ok = true;
    for (const t of tools) {
      if (!across(t, left)) continue;
      if (t.bottom <= cy - T + E) y0 = Math.max(y0, t.bottom + C);
      else if (t.top >= cy + T - E) y1 = Math.min(y1, t.top - C);
      else { ok = false; break; }   // beside the target's middle: the tail would point into it
    }
    const maxH = Math.min(fullH, y1 - y0), h = Math.min(need, maxH);
    if (ok) offer({ side, left, maxH, top: clamp(cy - h / 2, y0, y1 - h) }, h);
  }
  // below or above it: its edge by the target stays, it slides sideways clear of a tool beside (its tail still over the
  // target's middle; as far as the room's edge where the map is narrow, a laptop's between the columns) and ends before
  // the tools further off
  for (const side of ['t', 'b'] as const) {
    const edge = side === 't' ? r.bottom + gap : r.top - gap, space = Math.min(o.maxH, side === 't' ? below : above);
    const lefts = [at(side).left, ...tools.flatMap((t) => [t.right + C, t.left - C - w]), room.left, room.right - w]   // (the room's edges: a narrow map)
      .filter((x) => x >= room.left - E && x + w <= room.right + E && x <= cx - T + E && x + w >= cx + T - E);
    for (const left of lefts) {
      let maxH = space, ok = true;
      for (const t of tools) {
        if (!across(t, left)) continue;
        if (side === 't' ? t.bottom <= edge + E : t.top >= edge - E) continue;   // on the target's side of the edge
        if (side === 't' ? t.top <= edge + E : t.bottom >= edge - E) { ok = false; break; }   // across the edge itself
        maxH = Math.min(maxH, side === 't' ? t.top - C - edge : edge - C - t.bottom);
      }
      const h = Math.min(natural, maxH);
      if (ok) offer({ side, left, maxH, top: side === 't' ? edge : edge - h }, Math.min(need, maxH));
    }
  }
  return alt ?? best;
}

const SEEK_MARGIN = 16;   // CSS px a covered target glides clear of the UI's edge
const CARD_GAP = 8;       // CSS px between what floats over the map and the room a card has beside it (layout.ts clearOf)
const NUDGE = 96;         // CSS px a target may slide sideways so its card fits beside it (a narrow free map)
/** What floats over the free map (the layout's free rect leaves it in): a target under it is covered too. On a phone
 *  the counsel and the ticker are in the voice line (outside the free rect: the SHEET's head, the DRAWER's pane head or
 *  its floating line) and the tool column (map-col) holds the zoom buttons and the Mappae and Via popovers; off the
 *  phones, the left column's cards and the map tools float. */
const FLOATING = ['objective', 'counsel', 'ticker', 'overlay-bar', 'zoom-ctl', 'minimap', 'side-toggle', 'map-col'] as const;

/** The inspector: hover cards in #inspector (bottom left); a clicked target opens a closable popup beside it on the map
 *  (on the phone SHEET: the context card, docked above the bar). */
export class Inspector {
  private readonly hoverCard: InspectorCard;
  private readonly popup: InspectorCard;
  private hover: InspectTarget | null = null;
  /** A clicked card opened (true) or closed (false): the UI root routes the phone's sheet for it (a focus clears the
   *  map; closing puts the sheet back). Not told when one pinned card replaces another. */
  onPin: ((on: boolean) => void) | null = null;
  /** The context card came up docked in the phone sheet's slot (its root) or went (null): the UI root docks it in the
   *  layout (Layout.dock), which measures the free map above it before the card glides its target there. */
  onDock: ((el: HTMLElement | null) => void) | null = null;

  constructor(g: Game, root: HTMLElement) {
    this.hoverCard = new InspectorCard(g, root, false);
    const pop = h('div', { class: 'ins-popup', role: 'dialog', 'aria-label': 'Selection' });
    (root.closest('#app') ?? document.body).appendChild(pop);
    this.popup = new InspectorCard(g, pop, true, (el) => this.onDock?.(el));
  }

  /** The pinned card's root (the popup; the context card on the phone). */
  get popupEl(): HTMLElement { return this.popup.el; }

  /** True while a clicked (sticky) card is pinned: Esc closes it before opening the menu. */
  get pinned(): boolean { return this.popup.target !== null; }

  /** The layout moved the UI (a detent, the host, the free rect): a pinned target it now covers glides clear again (not
   *  one whose card was already hidden: the player had panned it away). */
  reseek(): void { this.popup.reseek(); }

  /** Shows a target: a sticky one (click) opens the popup until closed or replaced; a transient one (hover) shows bottom left. */
  show(t: InspectTarget | null, sticky: boolean): void {
    if (sticky) {
      const was = this.popup.target !== null;
      this.popup.set(t);
      if (was !== (this.popup.target !== null)) this.onPin?.(!was);
    } else this.hover = t;
    this.hoverCard.set(same(this.hover, this.popup.target) ? null : this.hover);   // no second card for what the popup shows
  }

  /** Every frame: throttled card refreshes; the popup follows its target on the map. A pinned card whose building is gone
   *  (demolished from the card) closes itself, and says so (onPin), as its ✕ would. */
  frame(now: number): void {
    this.hoverCard.frame(now);
    const was = this.pinned;
    this.popup.frame(now);
    if (was && !this.pinned) this.onPin?.(false);
  }
}

/** One card slot: the hover card in #inspector, or the popup pinned to a clicked target. */
class InspectorCard {
  target: InspectTarget | null = null;
  private sig = '';
  private last = -Infinity;
  private readonly hold: PointerHold;
  private ups: Updater[] = [];
  private collapsed = false;
  private more = false;   // the docked card shows all of itself (More), not its brief; a new target starts brief
  private wasDocked = false;   // the last rebuild docked the card (the layout was told so)
  private placed = '';
  private seek = false;   // a new pinned target, or the UI moved: the camera brings it clear once (never after a pan: that is the player's)

  constructor(private readonly g: Game, private readonly root: HTMLElement, private readonly sticky: boolean,
    private readonly dock: ((el: HTMLElement | null) => void) | null = null) {
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    this.hold = new PointerHold(root);
  }

  /** The card's root element. */
  get el(): HTMLElement { return this.root; }

  /** The pinned card on a phone: the context card, docked in the phone's slot. */
  private get docked(): boolean { return this.sticky && isPhone(currentHost()); }

  set(t: InspectTarget | null): void {
    if (same(t, this.target)) return;
    this.target = t;
    this.seek = this.sticky && t !== null;
    this.more = false;
    this.last = -Infinity;   // a new target re-renders at once, not at the next throttled frame
  }

  /** Arms the seek again for the pinned target (Inspector.reseek), if its card still showed: one the player has panned
   *  out of view or under the panel stays there (a pan is the player's; only a cover the UI brings is undone). */
  reseek(): void { if (this.sticky && this.target && !this.root.hidden && this.root.style.visibility !== 'hidden') this.seek = true; }

  /** Throttled refresh: rebuild on a changed signature (not under a fresh click), else run the updaters. */
  frame(now: number): void {
    if (now - this.last >= B.time.UI_THROTTLE_MS) {
      this.last = now;
      const s = this.g.state;
      if (this.target?.kind === 'building' && !getBuilding(s, this.target.id)) this.target = null;
      const t = this.target;
      // the context card also carries a dispatch that waits (its row: dispatchRow)
      const sig = t ? `${t.kind}|${targetSig(s, t, this.sticky)}|${+this.collapsed}${+this.docked}${this.docked && s.choice ? `e${s.choice.event}:${s.choice.created}` : ''}` : '';
      const sameTarget = sig.split('|')[1] === this.sig.split('|')[1];
      const reshaped = t !== null && this.docked !== (this.root.dataset.docked !== undefined);   // the host changed: docked or not
      // the same target's card holds still under the mouse, and while a confirm in it is armed (Demolish? …)
      if (sig !== this.sig && (!sameTarget || reshaped || (!this.hold.holds(now) && !armedWithin(this.root)))) this.rebuild(t, sig, this.sticky);
      else for (const u of this.ups) { try { u(); } catch (e) { console.error('[inspector] updater', e); } }
    }
    if (this.sticky) this.place();
  }

  /** The target's tiles (a building's footprint, a block, a tile), for the camera. */
  private tiles(t: InspectTarget): Rect | null {
    if (t.kind === 'building') return this.g.view.buildingTiles(t.id);
    if (t.kind === 'block') { const k = getMap(this.g.state.seed).survey.blocks[t.block]; return k ? { x: k.x, y: k.y, w: 4, h: 4 } : null; }
    return { x: tx(t.tile), y: ty(t.tile), w: 1, h: 1 };
  }

  /** What of the UI stands over the map, in #app px: the HUD, the panel or the sheet as the layout's free rect leaves
   *  them (view.freeRect: at rest, never mid-slide), and what floats over the map (FLOATING). A left column is not all UI:
   *  only its cards are, and the map shows in the gap below them. */
  private cover(m: { left: number; top: number; width: number; height: number }, app: DOMRect): Box[] {
    const f = this.g.view.freeRect(), W = app.width, H = app.height, out: Box[] = [];
    let top = f.top + m.top, right = f.right + m.left, bottom = f.bottom + m.top;
    // what floats over the map (the DRAWER's line or card, the DOCK's head beside the spine) covers its own box, not the
    // band of map the free rect gave up beside it: a target beside the head is in view, and a click on it never pans
    const fl = currentFloating();
    if (fl) {
      ({ top, right, bottom } = fl.under);
      out.push(fl.box);
    }
    if (top > E) out.push({ left: 0, top: 0, right: W, bottom: top });
    if (right < W - E) out.push({ left: right, top: 0, right: W, bottom: H });
    if (bottom < H - E) out.push({ left: 0, top: bottom, right: W, bottom: H });
    for (const id of FLOATING) {
      const el = document.getElementById(id), b = el?.getBoundingClientRect();
      if (el && b && b.width && b.height && getComputedStyle(el).visibility !== 'hidden') {
        out.push({ left: b.left - app.left, top: b.top - app.top, right: b.right - app.left, bottom: b.bottom - app.top });
      }
    }
    return out;
  }

  /** The map's own tools as they stand over the map, in #app px: what a popup should keep clear of where it can. */
  private tools(app: DOMRect): Box[] {
    const out: Box[] = [];
    // (#map-tools whole: the corner its grid leaves between the overlay bar, the minimap and the zoom is no place for a
    // card either, beside them all)
    for (const id of ['map-tools', 'zoom-ctl', 'map-col', 'overlay-bar', 'minimap', 'ticker']) {
      const el = document.getElementById(id), b = el?.getBoundingClientRect();
      if (el && b && b.width && b.height && getComputedStyle(el).visibility !== 'hidden') {
        out.push({ left: b.left - app.left, top: b.top - app.top, right: b.right - app.left, bottom: b.bottom - app.top });
      }
    }
    return out;
  }

  /** The docked context card (the phone SHEET): never placed beside its target (sheet.css docks it above the bar), but
   *  its target glides clear into the free map above it (the layout's free rect ends there: Layout.dock), then clear of
   *  what floats over that map (the tool column), when it is picked and again whenever the layout moves (seek). It stays
   *  up when the player pans the target away. */
  private placeDocked(t: InspectTarget): void {
    const pop = this.root, view = this.g.view;
    this.apply('docked', () => {
      pop.style.visibility = '';
      pop.style.left = pop.style.top = pop.style.maxHeight = '';
      delete pop.dataset.tail;
    });
    if (!this.seek || view.placing) return;
    this.seek = false;
    const tl = this.tiles(t);
    if (!tl) return;
    const m = view.mapRect(), app = (pop.offsetParent ?? document.body).getBoundingClientRect();
    const mv = view.ensureVisible(tl, SEEK_MARGIN);
    const c = view.screenRect(tl.x, tl.y, tl.w, tl.h);
    const r: Box = { left: c.left + m.left + mv.dx, right: c.right + m.left + mv.dx, top: c.top + m.top + mv.dy, bottom: c.bottom + m.top + mv.dy };
    const map: Box = { left: m.left, top: m.top, right: m.left + m.width, bottom: m.top + m.height };
    const dg = dodge(r, this.cover(m, app), map, SEEK_MARGIN);
    if (dg.dx || dg.dy) view.panBy(dg.dx, dg.dy);
  }

  /** Pins the popup beside its target, inside the free map (the layout's free rect: below the HUD, clear of the panel at
   *  its detent and of the desktop's left column). A pinned target the UI covers glides clear first (once when picked,
   *  and again after the layout moves: seek). On a phone the popup is the docked context card instead (placeDocked). */
  private place(): void {
    const t = this.target, pop = this.root;
    if (!t || pop.hidden) return;
    if (pop.dataset.docked !== undefined) { this.placeDocked(t); return; }
    const view = this.g.view;
    const tl = this.tiles(t), c = tl ? view.screenRect(tl.x, tl.y, tl.w, tl.h) : null, m = view.mapRect();
    const r = c && { left: c.left + m.left, right: c.right + m.left, top: c.top + m.top, bottom: c.bottom + m.top };   // canvas → #app px
    const app = (pop.offsetParent ?? document.body).getBoundingClientRect();
    const column = document.getElementById('left')?.getBoundingClientRect();
    const M = 8, GAP = POPUP.gap, MIN_H = POPUP.minH;
    // the free map at rest, in #app px: the panel where it comes to rest, not mid-slide (none at all under the medium
    // DOCK's wide pane: the card hides, as for a target panned away)
    const vf = view.freeRect(), fl = currentFloating();
    // beside what floats over the map (the DOCK's head beside the spine): the card's room is the part of the map clear of
    // it that holds the target (a house left of the head keeps its card there), else the free rect's own larger part
    const fr = fl && r ? clearAround(fl.under, fl.box, (r.left + r.right) / 2, (r.top + r.bottom) / 2, CARD_GAP)
      : currentFree() ?? { left: vf.left + m.left, top: vf.top + m.top, right: vf.right + m.left, bottom: vf.bottom + m.top };
    const bx0 = Math.max(0, fr.left) + M, bx1 = Math.min(app.width, fr.right) - M;
    const by0 = Math.max(0, fr.top) + M, by1 = Math.min(app.height, fr.bottom) - M;
    const card = pop.firstElementChild as HTMLElement | null;
    const w = pop.offsetWidth;
    const natural = card ? card.scrollHeight + card.offsetHeight - card.clientHeight : 0;
    if (this.seek && r && tl && card && !view.placing) {   // (placing: the ghost has the camera; the seek waits)
      this.seek = false;
      const over = this.cover(m, app);
      const map: Box = { left: m.left, top: m.top, right: m.left + m.width, bottom: m.top + m.height };
      const outside = r.left < map.left - E || r.top < map.top - E || r.right > map.right + E || r.bottom > map.bottom + E;
      if (outside || coveredArea(r, over) > 0) {
        // under the UI or partly off the map: it glides into the free map (the card follows it there instead of hiding),
        // then clear of what floats over it (the map's tools, the ticker, a phone's cards). With no room beside it for
        // the card, a short slide sideways makes some (a laptop's narrow map between the columns); failing that, a slide
        // up or down makes room above or below for at least a short card (a phone's strip of map over its sheet), as
        // long as neither slide puts it back under something. A target already in view never moves (a click is not a pan)
        const mv = view.ensureVisible(tl, SEEK_MARGIN);
        const at = moved(r, mv.dx, mv.dy), dg = dodge(at, over, map, SEEK_MARGIN), to = moved(at, dg.dx, dg.dy);
        // the card's room where the panel comes to rest (the free rect), not where its slide has got to this frame
        const f = view.freeRect(), rx1 = Math.min(app.width, f.right + m.left) - M, ry1 = Math.min(app.height, f.bottom + m.top) - M;
        const beside = (d: number): boolean => to.right + d + GAP + w <= rx1 || to.left + d - GAP - w >= bx0;
        let dx = 0, dy = 0;
        if (!beside(0)) {
          const sx = roomShift(to.left, to.right, bx0, rx1, w + GAP + 1);   // + 1: the boxes are fractional
          if (sx && Math.abs(sx) <= NUDGE && beside(sx)) dx = sx;
          else {
            let clear = by0;   // a phone's band of cards over the map (not a column): the target stays below it
            if (column && column.width >= app.width / 2) {
              for (const id of ['objective', 'counsel']) {
                const e = document.getElementById(id)?.getBoundingClientRect();
                if (e && e.height) clear = Math.max(clear, e.bottom - app.top + M);
              }
            }
            dy = roomShift(to.top, to.bottom, by0, ry1, Math.min(natural, MIN_H) + GAP + 1, clear);
          }
          if (coveredArea(moved(to, dx, dy), over) > coveredArea(to, over) + E) dx = dy = 0;   // the target comes first
        }
        if (dg.dx + dx || dg.dy + dy) view.panBy(dg.dx + dx, dg.dy + dy);
      }
    }
    const off = !r || bx1 - bx0 < 1 || r.right < 0 || r.left > bx1 || r.bottom < by0 || r.top > by1;
    if (off || !r || !card) { this.apply('hidden', () => { pop.style.visibility = 'hidden'; }); return; }
    // beside the target, below or above it, clear of the map's tools where it can be (popupSlot)
    const { side, left, top, maxH } = popupSlot(r, { left: bx0, top: by0, right: bx1, bottom: by1 }, w, natural, this.tools(app));
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const hh = Math.min(natural, maxH);
    const T = POPUP.tail, tail = side === 't' || side === 'b' ? clamp(cx - left, T, w - T) : clamp(cy - top, T, hh - T);
    const key = `${Math.round(left)},${Math.round(top)},${Math.round(maxH)},${side},${Math.round(tail)}`;
    this.apply(key, () => {
      pop.style.visibility = '';
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      pop.style.maxHeight = `${Math.round(maxH)}px`;
      pop.dataset.tail = side;
      pop.style.setProperty('--tail', `${Math.round(tail)}px`);
    });
  }

  /** Writes the popup's style only when its placement changed. */
  private apply(key: string, write: () => void): void {
    if (key === this.placed) return;
    this.placed = key;
    write();
  }

  private rebuild(t: InspectTarget | null, sig: string, sticky: boolean): void {
    this.sig = sig;
    this.ups = [];
    clear(this.root);
    this.root.hidden = !t;
    this.placed = '';
    const docked = this.docked;
    if (docked) this.root.dataset.docked = ''; else delete this.root.dataset.docked;
    if (t) {
      const card = h('div', { class: `card ins-card${sticky ? ' sticky' : ''}${this.collapsed && !docked ? ' collapsed' : ''}${docked ? ' docked' : ''}${docked && this.more ? ' more' : ''}` });
      try { this.render(t, card, sticky); } catch (e) { console.error('[inspector] render', e); }
      if (docked) { this.dispatchRow(card); this.brief(card, t); }
      this.root.appendChild(card);
    }
    // the layout measures the free map above a docked card now (and again for each rebuild: its height may change)
    const el = this.sticky && docked && t ? this.root : null;
    if (el || this.wasDocked) this.dock?.(el);
    this.wasDocked = el !== null;
  }

  /** The context card stands where the voice line was, so a dispatch that waits (s.choice) shows on it, under its head:
   *  'NVNTIVS · <title> · Read', which gives the slot to the event card (the 'choice' anchor: the UI root's Read). */
  private dispatchRow(card: HTMLElement): void {
    const g = this.g, c = g.state.choice;
    if (!c) return;
    const row = h('button', { class: 'btn small ghost ins-dispatch', type: 'button', 'aria-label': `A dispatch waits: ${c.title}. Read it`,
      onclick: () => g.openTab('council', 'choice', 'chip') },
    h('span', { class: 'kicker' }, 'NVNTIVS'), h('span', { class: 'ins-dispatch-t' }, c.title), h('b', null, 'Read'));
    row.dataset.brief = '';
    card.querySelector('.ins-head')?.after(row);
  }

  /** The docked card's brief (briefParts): marks the parts it shows before More (data-brief), and gives the head its
   *  More button when anything waits behind it. */
  private brief(card: HTMLElement, t: InspectTarget): void {
    const parts = Array.from(card.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.part !== undefined);
    const b = t.kind === 'building' ? getBuilding(this.g.state, t.id) : undefined;
    const kind: CardKind = t.kind === 'block' ? 'block' : t.kind === 'tile' ? 'tile' : b?.house && b.status === 'done' ? 'house' : b?.status === 'done' ? 'works' : 'site';
    const keep = new Set(briefParts(kind, parts.map((p) => p.dataset.part ?? '')));
    for (const p of parts) if (keep.has(p.dataset.part ?? '')) p.dataset.brief = '';
    if (!parts.some((p) => p.dataset.brief === undefined)) return;
    const more = h('button', { class: 'btn small ghost ins-more', type: 'button', 'aria-expanded': String(this.more), onclick: () => {
      this.more = !this.more;
      card.classList.toggle('more', this.more);
      more.textContent = this.more ? 'Less ▾' : 'More ▴';
      more.setAttribute('aria-expanded', String(this.more));
      this.dock?.(this.root);   // the layout measures the card's new height at once (its glide follows: reseek)
    } }, this.more ? 'Less ▾' : 'More ▴');
    card.querySelector('.ins-ctl')?.prepend(more);
  }

  private head(card: HTMLElement, sprite: string, kicker: string, title: string, sticky: boolean): void {
    const g = this.g;
    const docked = this.docked;   // the context card: its brief is its folded form (More), no ▾
    card.append(h('div', { class: 'ins-head' }, h('div', { class: 'ins-img' }, img(sprite, 2)),
      h('div', { class: 'ins-titles' }, h('div', { class: 'kicker' }, kicker), h('div', { class: 'ins-title' }, title)),
      h('div', { class: 'ins-ctl' },
        docked ? null : h('button', { class: 'btn small ghost', type: 'button', 'aria-label': this.collapsed ? 'Expand' : 'Collapse', onclick: () => { this.collapsed = !this.collapsed; this.last = -Infinity; this.hold.release(); } }, this.collapsed ? '▸' : '▾'),
        sticky ? h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Close', onclick: () => { g.select(null); g.inspect(null, true); } }, '✕') : null)));
  }

  private render(t: InspectTarget, card: HTMLElement, sticky: boolean): void {
    const s = this.g.state;
    const open = !this.collapsed || this.docked;
    if (t.kind === 'building') {
      const b = getBuilding(s, t.id);
      if (!b) { card.append(h('div', { class: 'muted' }, 'It is gone.')); return; }
      const def = BUILDING_DEFS[b.type];
      if (b.house && b.status === 'done') {
        this.head(card, houseSprite(b.house.tier, isAquae(s, b), b.x, b.y), `DOMVS · T${TIER_DEFS[b.house.tier].level}${isAquae(s, b) ? ' · AQVAE' : ''}`, TIER_DEFS[b.house.tier].latin, sticky);
        if (open) card.append(...houseView(this.g, b, this.ups), this.demolish(b));
        return;
      }
      const sprite = b.status === 'done' ? buildingSprite(s, b, seasonOf(s.day)) : typeSprite(b.type);
      this.head(card, sprite, `${caps(def.latin)}${b.owner === 'ordo' ? ' · ORDO' : ''}`, def.name, sticky);
      if (open) card.append(...(b.status === 'done' ? this.works(b) : this.site(b)));
      return;
    }
    if (t.kind === 'block') { this.block(card, t.block, sticky); return; }
    this.tile(card, t.tile, sticky);
  }

  /** An unfinished site: state, progress, what it waits for, ↑, Cancel / Move. */
  private site(b: Building): HTMLElement[] {
    const g = this.g;
    const def = BUILDING_DEFS[b.type];
    const line = h('div', { class: 'ins-line' });
    const pb = bar();
    const refresh = (): void => {
      const s = g.state;
      const cur = getBuilding(s, b.id);
      if (!cur) return;
      if (cur.status === 'plan') { const lack = lacking(s, def.cost); line.textContent = `⌛ A plan: works begin when the stores hold ${lack ? lackLine(g, lack) : 'enough'}.`; pb.set(0, 'tab-bar plan'); return; }
      if (cur.status === 'staked') { line.textContent = `Staked by the Ordo. Builders start in ${plural(Math.max(0, cur.placed + B.construction.STAKE_DAYS - s.day), 'day', 'days')}; until then you may cancel it in full or move it.`; pb.set(1, 'tab-bar staked'); return; }
      const builders = s.people.filter((p) => p.work === BUILDER).length;
      const stage = cur.type === 'capitolium' ? ` · ${STAGES[Math.min(3, Math.floor(cur.progress * 4))]}` : '';
      line.textContent = `${Math.round(cur.progress * 100)}% of ${fmt(cur.work)} builder-days${stage} · ${plural(builders, 'builder', 'builders')} in the colony`;
      pb.set(cur.progress, cur.progress < B.construction.TRENCH ? 'tab-bar trench' : 'tab-bar gold');
    };
    refresh();
    this.ups.push(refresh);
    const out = [part(line, 'progress'), part(pb.el, 'progress')];
    if (b.reason) out.push(part(h('div', { class: 'ins-why' }, img('i_seal', 1), reasonText(b.reason)), 'why'));
    if (b.notes?.length) out.push(part(h('div', { class: 'ins-small muted' }, `Why here: ${b.notes.map((n) => NOTE[n.code](n.value)).join(', ')}.`), 'notes'));
    const first = worksQueue(g.state)[0]?.id === b.id;
    const btns = h('div', { class: 'ins-btns' }, btn(g, '↑ Build first', () => A.prioritise(g.state, b.id), { reason: first ? 'Already first in the queue.' : null }));
    if (b.status === 'staked' && b.owner === 'ordo') btns.append(btn(g, 'Move', () => { g.startPlacing({ kind: 'building', type: b.type, replaceId: b.id }); }, { tip: 'Place it elsewhere yourself; the stake is refunded.' }));
    if (b.type !== 'capitolium') {
      const full = b.status === 'plan' || (g.state.day - b.placed <= B.construction.FULL_REFUND_DAYS && b.progress <= 0);
      const c = h('button', { class: 'btn small danger', type: 'button' }, b.status === 'plan' ? 'Drop the plan' : `Cancel (${full ? '100' : Math.round(B.construction.REFUND_CANCEL * 100)}% back)`);
      confirm2(c, 'Click again to cancel', () => { g.act(A.cancelSite(g.state, b.id), { okSfx: 'click' }); });
      btns.append(c);
    }
    out.push(part(btns, 'queue'));
    return out;
  }

  /** A finished work: staff, output chain, coverage, storage, upkeep, site, Ordo reason, controls. */
  private works(b: Building): HTMLElement[] {
    const g = this.g;
    const s = g.state;
    const def = BUILDING_DEFS[b.type];
    const out: HTMLElement[] = [part(h('div', { class: 'ins-sub' }, def.benefit), 'benefit')];
    if (def.slots > 0) {
      const staff = h('div', { class: 'ins-line' });
      const names = h('div', { class: 'ins-small muted' });
      const refresh = (): void => {
        const st = g.state;
        const ppl = st.people.filter((p) => p.work === b.id);
        staff.textContent = `${ppl.length} of ${slotsOf(b.type, st.rank)} hands${b.open ? '' : ' · closed (CLAVSVM)'}`;
        names.textContent = ppl.map((p) => `${personName(p)}${def.skill && p.skills[def.skill] ? ` (${def.skill} ${Math.floor(p.skills[def.skill] ?? 0)})` : ''}`).join(', ');
      };
      refresh();
      this.ups.push(refresh);
      out.push(part(staff, 'staff'), part(names, 'names'));
      // the phone's context card staffs it in place: its category's labour line, the ± held to repeat (labour.ts); while
      // the Ordo holds labour the line has no ±, and says so, with the way to take it back (Edicta's Mandata)
      if (this.docked && def.labor) {
        const ordo = s.ordo.on.labour
          ? h('div', { class: 'ins-small muted ins-ordo-lab' }, 'The Ordo staffs these posts.',
            btn(g, 'Mandata', () => g.openTab('council', 'mandates', 'chip'), { cls: 'ghost', tip: 'Edicta · Mandata: take labour back to set the hands yourself.' }))
          : null;
        out.push(part(h('div', { class: 'ins-labour' }, labourEl(g, this.ups, [def.labor]), ordo), 'labour'));
      }
    }
    const chain = h('div', { class: 'ins-chain' });
    const refreshChain = (): void => {
      const rows = outputChain(g.state, b);
      chain.replaceChildren(...rows.map((r) => h('div', { class: 'tab-kv' }, h('span', { class: 'tab-kv-k' }, r.label), h('span', { class: 'tab-kv-v num' }, r.value))));
      if (def.output) {
        const all = g.rates.prod[def.output.res][b.type] ?? 0;
        const n = derived(g.state).counts[b.type] ?? 1;
        if (n > 1) chain.append(h('div', { class: 'ins-small muted' }, `All ${n} together: +${fmt(all)} ${RESOURCE_DEFS[def.output.res].name.toLowerCase()} yesterday.`));
      }
    };
    refreshChain();
    this.ups.push(refreshChain);
    if (def.output || def.passive) out.push(part(chain, 'chain'));
    if (def.inputs) out.push(part(h('div', { class: 'ins-small' }, `Uses ${Object.entries(def.inputs).map(([r, n]) => `${n} ${RESOURCE_DEFS[r as keyof typeof RESOURCE_DEFS].name.toLowerCase()}`).join(' + ')} per hand a day.`), 'uses'));
    if (def.passive && !def.output) out.push(part(h('div', { class: 'ins-small' }, `${def.passive.perDay} ${RESOURCE_DEFS[def.passive.res].name.toLowerCase()} a day with no hands.`), 'passive'));
    for (const sv of def.service ?? []) {
      const r = effectiveRadius(s, b, sv.layer);
      out.push(part(h('div', { class: `ins-line ${r ? '' : 'ins-bad'}` }, `${LAYER_META[sv.layer].label}: ${r ? `${r} road steps` : 'inactive'}${r && r < sv.radius ? ` (full ${sv.radius} at ${Math.ceil(def.slots * B.economy.SERVICE_FULL)} hands)` : ''}`), 'service'));
    }
    if (def.storage) {
      const store = def.storage;
      const line = h('div', { class: 'ins-line' });
      const refreshStore = (): void => { line.textContent = `Stores: ${(Object.keys(store) as ResId[]).map((r) => storeText(g.state, r, store[r] ?? 0)).join(' · ')}`; };
      refreshStore();
      this.ups.push(refreshStore);
      out.push(part(line, 'stores'));
    }
    const mult = siteMult(s, b);
    const site = Math.abs(mult - 1) > 0.01 ? `Site ${pct(mult)}` : 'Site';
    if (site !== 'Site' || b.notes?.length) out.push(part(h('div', { class: 'ins-small' }, `${site}${b.notes?.length ? `: ${b.notes.map((n) => NOTE[n.code](n.value)).join(', ')}` : ''}.`), 'site'));
    const flags: string[] = [];
    if (def.upkeep) flags.push(b.open ? `Upkeep ${fmt(def.upkeep)} den a day${b.unpaid ? ' · UNPAID: works at half pace' : ''}` : 'Closed: no upkeep');
    if ((b.toolUntil ?? 0) > s.day) flags.push(`Tool kit: +20%, ${plural((b.toolUntil ?? 0) - s.day, 'day', 'days')} left`);
    if ((b.damagedUntil ?? 0) > s.day) flags.push(`Damaged by fire until ${formatRoman(b.damagedUntil ?? 0)}`);
    if ((b.idleUntil ?? 0) > s.day) flags.push(`Idle until ${formatRoman(b.idleUntil ?? 0)}`);
    if ((b.bonusUntil ?? 0) > s.day) flags.push(`${pct(1 + (b.bonus ?? 0))} until ${formatRoman(b.bonusUntil ?? 0)}`);
    if ((b.youngUntil ?? 0) > s.day) flags.push(`Young grove: half yield until ${formatRoman(b.youngUntil ?? 0)}`);
    if (flags.length) out.push(part(h('div', { class: `ins-small ${b.unpaid ? 'ins-bad' : 'muted'}` }, flags.join(' · ')), 'flags'));
    if (b.reason) out.push(part(h('div', { class: 'ins-why' }, img('i_seal', 1), `Raised by the Ordo on ${formatRoman(b.placed)}: ${reasonText(b.reason)}`), 'why'));
    if (def.slots > 0) {
      out.push(part(h('div', { class: 'ins-btns' },
        btn(g, b.open ? 'Close it' : 'Reopen it', () => A.setOpen(g.state, b.id, !b.open), { cls: b.open ? '' : 'primary', tip: b.open ? 'Closed works keep their sprite and release their hands.' : 'Let it take hands again.' }),
        seg(g, PRIO_IDS.map((p, i) => ({ id: p, label: PRIO[i], tip: `${PRIO[i]} staffing priority` })), String(b.prio) as (typeof PRIO_IDS)[number],
          (p) => A.setPrio(g.state, b.id, Number(p) as 0 | 1 | 2))), 'controls'));
    }
    if (b.type !== 'principia' && b.type !== 'capitolium') out.push(this.demolish(b));
    return out;
  }

  private demolish(b: Building): HTMLElement {
    const g = this.g;
    const d = h('button', { class: 'btn small ghost ins-demolish', type: 'button' }, 'Demolish');
    confirm2(d, `Demolish? ${Math.round(B.construction.REFUND_DEMOLISH * 100)}% back`, () => { g.act(A.demolish(g.state, b.id), { okSfx: 'place' }); });
    return part(h('div', { class: 'ins-btns end' }, d), 'demolish');
  }

  private block(card: HTMLElement, id: number, sticky: boolean): void {
    const g = this.g;
    const s = g.state;
    const blk = getMap(s.seed).survey.blocks[id];
    if (!blk) return;
    const reserved = s.ordo.reserved.includes(id);
    const razed = s.urbs.razed !== null;                    // once the castrum is razed the canabae are the outer city
    const district = razed && blk.district === 'canabae' ? 'Urbs exterior' : DISTRICT[blk.district];
    const ring = razed ? (blk.ring === 0 ? 'in the inner city' : blk.ring === WALL_RING ? 'on the old wall line' : 'in the outer city') : RING[blk.ring];
    this.head(card, 'i_tool_reserve', `INSVLA · ${caps(district)}`, `A block ${ring}`, sticky);
    if (this.collapsed && !this.docked) return;
    const active = ringsOf(s).includes(blk.ring);
    const plots = [0, 1, 2, 3].map((i) => derived(s).plotOwner[id * 4 + i]);
    const free = plots.filter((p) => !p).length;
    const status = blk.masked ? 'The surveyors left this block to the fields.' : blk.reserved ? `Kept by the groma for the ${blk.reserved}.`
      : !active && blk.ring === WALL_RING ? 'The camp\'s vallum and fossa stand here. They come down once a town wall rings the whole town, and the line becomes house plots.'
      : !active ? `Surveyed for later: it joins the pomerium at ${RANK_DEFS[blk.ring].name}.` : `${free} of 4 plots free.`;
    card.append(part(h('div', { class: 'ins-line' }, status), 'status'));
    const usable = !blk.masked && !blk.reserved && active;
    if (usable) card.append(part(h('div', { class: 'ins-small muted' }, plots.map((p, i) => `plot ${i + 1}: ${p ? BUILDING_DEFS[getBuilding(s, p)?.type ?? 'area'].name.toLowerCase() : 'free'}`).join(' · ')), 'plots'));
    if (reserved) card.append(part(h('div', { class: 'ins-good' }, 'Reserved: the Ordo leaves it alone.'), 'reserved'));
    card.append(part(h('div', { class: 'ins-btns' },
        btn(g, 'Place a house plot', () => { g.startPlacing({ kind: 'building', type: 'area', at: freePlot(g.state, id, 'player') ?? undefined }); },
          { cls: 'primary', reason: usable && free ? null : 'No free plot to build on here.' }),
        btn(g, reserved ? 'Release the block' : 'Reserve the block', () => A.toggleReserveBlock(g.state, id),
          { tip: 'The Ordo never builds in a reserved block.', reason: blk.masked || blk.reserved ? 'Only surveyed house blocks can be reserved.' : !toolRevealed(s, 'reserve') ? 'The Reserve-block tool comes with Oppidum.' : null })), 'actions'));
  }

  /** The fortifications on a tile: the castrum's rampart and ditch (and when they will come down), or the town wall. */
  private walls(card: HTMLElement, tile: number): void {
    const g = this.g;
    const s = g.state;
    const mo = s.urbs.moenia;
    const rising = mo !== null && mo.done === null;
    const share = mo ? `${Math.round(mo.progress * 100)}%` : '';
    if (inCamp(s, tile)) {
      const what = getMap(s.seed).survey.wall[tile] === 2 ? 'A gate of the camp' : getMap(s.seed).survey.wall[tile] ? `The camp's ${s.rank >= 2 ? 'murus' : 'vallum'}` : 'The camp\'s fossa';
      const when = rising ? `The town wall is rising (${share}); when it stands, this rampart comes down and the old wall line becomes house plots.`
        : s.rank < B.urbs.MOENIA.RANK ? 'Once the colony is a Municipium you may ring the whole town with a wall (the Ordo does it as a Colonia, once the outer town outgrows the camp), and this rampart will come down.'
        : 'Lay out a town wall round the whole town and this rampart comes down once it stands: the camp becomes the inner city, its wall line house plots. As a Colonia the Ordo does it, once the outer town outgrows the camp.';
      card.append(part(h('div', { class: 'ins-head2' }, what), 'wall'), part(h('div', { class: 'ins-small' }, when), 'wall'));
      if (!mo) {
        const reason = s.rank < B.urbs.MOENIA.RANK ? 'Rome lets a Municipium wall the whole town.' : null;
        card.append(part(h('div', { class: 'ins-btns' }, btn(g, 'Lay out the town wall', () => g.act(A.commissionWalls(g.state), { okSfx: 'place' }),
          { cls: 'primary', reason, tip: `About ${B.urbs.MOENIA.WORK} builder-days, ${B.urbs.MOENIA.MAT.stone} stone and ${B.urbs.MOENIA.MAT.denarii} denarii a pace, drawn as it rises from what the Ordo is not saving.` })), 'walls'));
      }
      return;
    }
    if (!mo) return;
    const gate = mo.gates.includes(tile);
    card.append(part(h('div', { class: 'ins-head2' }, gate ? 'A gate of the town wall' : 'The town wall'), 'wall'),
      part(h('div', { class: 'ins-small' }, mo.done !== null
        ? `Finished ${formatRoman(mo.done)}: ${mo.tiles.length} paces of stone and ${mo.gates.length} gates ring the whole town.`
        : `Rising: ${share} of ${mo.tiles.length} paces and ${mo.gates.length} gates, from the work the builders spare.`), 'wall'));
  }

  private tile(card: HTMLElement, tile: number, sticky: boolean): void {
    const g = this.g;
    const s = g.state;
    const map = getMap(s.seed);
    const ter = map.terrain[tile];
    const feat = map.feature[tile];
    this.head(card, 'i_ov_terra', 'TERRA', `${TERRAIN[ter] ?? 'Land'}${FEATURE[feat] ? `, ${FEATURE[feat]}` : ''}`, sticky);
    if (this.collapsed && !this.docked) return;
    const d = derived(s);
    const facts: string[] = [];
    if (isFertile(ter as Terrain)) facts.push(`fertile ground ×${fertility(ter as Terrain).toFixed(2)}`);
    if (map.woodMax[tile] > 0) facts.push(`timber ${Math.round(woodAt(s, tile))} of ${Math.round(map.woodMax[tile])}`);
    if (map.vein[tile] > 0) facts.push(`ore quality ×${fmt(map.vein[tile])}`);
    if (map.waterTable[tile]) facts.push('on the water table');
    facts.push(d.pomerium[tile] ? 'inside the pomerium' : d.territory[tile] ? 'in our territory' : 'beyond our territory');
    const road = d.road[tile] ? footfall(s, tile) : 0;
    if (road > 0) facts.push(`${WEAR_WORD[wearOf(road)]}: about ${fmt(road)} walkers a day`);
    card.append(part(h('div', { class: 'ins-line' }, facts.join(' · ')), 'facts'), part(h('div', { class: 'ins-small muted' }, `(${tx(tile)}, ${ty(tile)})`), 'coords'));
    if (d.wall[tile]) this.walls(card, tile);
    if (!sticky) { card.append(h('div', { class: 'ins-small muted' }, 'Click the ground to see what could be built here.')); return; }
    const can = BUILD_ORDER.filter((type) => buildingVisible(s, type) && !rankReason(s, type))
      .map((type) => ({ type, c: canPlace(s, type, tile, { owner: 'player' }) }))
      .filter((x) => x.c.ok);
    card.append(part(h('div', { class: 'ins-group' }, h('div', { class: 'ins-head2' }, can.length ? 'Could be built here' : 'Nothing can be built on this spot.'),
      h('div', { class: 'ins-btns wrap' }, can.map(({ type, c }) => btn(g, [img(typeSprite(type), 1, 'chip-ico'), BUILDING_DEFS[type].name, c.ok && c.mult >= 1.05 ? ` ${pct(c.mult)}` : ''],
        () => { g.startPlacing({ kind: 'building', type, at: c.ok ? idx(c.x, c.y) : tile }); }, { cls: 'ghost' })))), 'buildable'));
  }
}
