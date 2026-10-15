// src/ui/focusrow.ts — the focus row (SPEC A graft 3, DESIGN §15.7, ARCHITECTURE §13.10): in the docked or wide panel of
// the tablet DOCK and the desktop COLUMNS, the last ledger row the player touched (a tap or a click: never a hover) that
// names something on the map stays lit, and the map answers it:
// one object centred in the free map and flashed, several (a labour category's works, the declining homes) brought into
// view together and each flashed. Owner: WP-H.
// Minimal and in one place: a row names its object in a data attribute (data-focus: focusOf* below build the value), and
// one delegated listener on the tab body (FocusRow) does the rest; the panels add no code of their own. The listener runs
// in the capture phase, before a row's own handler (a works row also selects its site, opening the popup beside it), so a
// wide pane under 960 px, which leaves no map, docks first (layout.route: focus) and the row's own centring lands in the
// map that shows. A press on a control inside the row (±, ↑, ✕, a chip) is the control's alone. The highlight survives
// the tab body's rebuilds (it is painted again after each). On the phones the rows behave as they always did (their
// focus is the context card).
// Pure part (tests/focusrow.test.ts): the attribute's values, their parsing, and what tiles they name in a state.
import type { BuildingId, GameState, LaborCat, Rect, Remedy } from '../game/types';
import { LABOR_CATS } from '../game/types';
import type { Game } from './types';
import type { Host } from './layout';
import { currentHost, routeIntent } from './layout';
import { getBuilding } from '../game/state';
import { footprintOf } from '../game/derived';
import { wallsRising } from '../game/urbs';
import { W, idx, tx, ty } from '../game/map';
import { BUILDING_DEFS } from '../game/data/buildings';

// ───────────────────────────── pure ─────────────────────────────
/** What a row names on the map: a building or site, a work the Ordo means to raise on a tile, the works a labour
 *  category staffs (the builders: the sites in hand, else the town wall while its crew raises it), or the homes in decline. */
export type FocusSpec =
  | { kind: 'building'; id: number }
  | { kind: 'wish'; type: BuildingId; tile: number }
  | { kind: 'labour'; cat: LaborCat }
  | { kind: 'declining' };

/** The hosts whose pane keeps a focus row: the tablet DOCK and the desktop COLUMNS (docked or wide: the map beside it). */
export const FOCUS_HOSTS: readonly Host[] = ['dock', 'columns'];

/** Whether a host keeps the focus row (pure); none before the layout runs. */
export function keepsFocus(host: Host | null): boolean {
  return host !== null && FOCUS_HOSTS.includes(host);
}

/** data-focus for a building or a site. */
export function focusOfBuilding(id: number): string { return `b:${id}`; }
/** data-focus for a work the Ordo would raise on a tile (an Agenda row). */
export function focusOfWish(type: BuildingId, tile: number): string { return `w:${type}:${tile}`; }
/** data-focus for a labour category (its works; the builders' sites and the rising town wall). */
export function focusOfLabour(cat: LaborCat): string { return `c:${cat}`; }

/** data-focus for an advisory, or null when it names nothing on the map (pure): a remedy that centres a building names
 *  that building; a block to clear, the block (the work's footprint on it); the Aedilis' declining homes name all of them. */
export function focusOfAdvisory(rule: string, remedies: readonly { remedy: Remedy }[]): string | null {
  const c = remedies.find((x) => x.remedy.kind === 'building' && x.remedy.op === 'center')?.remedy;
  if (c && c.kind === 'building') return focusOfBuilding(c.id);
  const k = remedies.find((x) => x.remedy.kind === 'clear')?.remedy;
  if (k && k.kind === 'clear') return focusOfWish(k.building, k.tile);
  return rule === 'aedilis.declining' ? 'decl' : null;
}

/** Reads a data-focus value (pure); null for anything it does not know. */
export function parseFocus(v: string | undefined): FocusSpec | null {
  if (!v) return null;
  if (v === 'decl') return { kind: 'declining' };
  const [k, a, b] = v.split(':');
  if (k === 'b' && /^\d+$/.test(a ?? '')) return { kind: 'building', id: Number(a) };
  if (k === 'w' && a && a in BUILDING_DEFS && /^\d+$/.test(b ?? '')) return { kind: 'wish', type: a as BuildingId, tile: Number(b) };
  if (k === 'c' && (LABOR_CATS as readonly string[]).includes(a ?? '')) return { kind: 'labour', cat: a as LaborCat };
  return null;
}

/** A building's footprint as a tile rect (its bounding box). */
function footRect(s: GameState, b: { type: BuildingId; x: number; y: number }): Rect {
  const tiles = footprintOf(b, s);
  let x0 = b.x, y0 = b.y, x1 = b.x, y1 = b.y;
  for (const i of tiles) { const x = i % W, y = Math.floor(i / W); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The tile rects a row names in a state (pure; tests/focusrow.test.ts), one per object, in the state's order: a
 *  building's footprint (none once it is gone); a wish's footprint at its tile (the work itself once it stands there); a
 *  labour category's finished works with posts (the builders': every site in hand, else the tile of the town wall its
 *  crew raises next); every home in decline. */
export function focusRects(s: GameState, f: FocusSpec): Rect[] {
  switch (f.kind) {
    case 'building': { const b = getBuilding(s, f.id); return b ? [footRect(s, b)] : []; }
    case 'wish': {
      const there = s.buildings.find((b) => b.type === f.type && b.x === tx(f.tile) && b.y === ty(f.tile));
      if (there) return [footRect(s, there)];
      const [w, h] = BUILDING_DEFS[f.type].size;
      return [{ x: tx(f.tile), y: ty(f.tile), w, h }];
    }
    case 'labour':
      if (f.cat === 'builders') {
        const out = s.buildings.filter((b) => b.status !== 'done').map((b) => footRect(s, b));
        // the wall answers when it is their only work: a stretch far from the sites would widen the union past the free
        // map, and ensureVisible would frame neither
        const at = out.length ? null : wallStretch(s);
        if (at !== null) out.push({ x: tx(at), y: ty(at), w: 1, h: 1 });
        return out;
      }
      return s.buildings.filter((b) => b.status === 'done' && BUILDING_DEFS[b.type].labor === f.cat && BUILDING_DEFS[b.type].slots > 0).map((b) => footRect(s, b));
    case 'declining': return s.buildings.filter((b) => b.house?.declining).map((b) => footRect(s, b));
  }
}

/** The tile of the town wall its crew raises next (the first not yet built, in building order: render/linear.ts
 *  builtWall), or null while no crew works on it (urbs.wallsRising: none surveyed, finished, or waiting for its stone
 *  and coin). */
export function wallStretch(s: GameState): number | null {
  const mo = s.urbs.moenia;
  if (!mo || !mo.tiles.length || !wallsRising(s)) return null;
  return mo.tiles[Math.min(mo.tiles.length - 1, Math.floor(mo.tiles.length * Math.max(0, Math.min(1, mo.progress))))];
}

/** The smallest tile rect holding every one of `rs` (pure), or null for none. */
export function unionRect(rs: readonly Rect[]): Rect | null {
  if (!rs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ───────────────────────────── the listener (DOM) ─────────────────────────────
const CONTROLS = 'button, input, select, textarea, summary, a[href], label';
const MARGIN = 24;   // CSS px a group of objects keeps from the free map's edges

/** The one listener on the tab body (#tab-body): a click on a row with data-focus, on the DOCK or the COLUMNS, lights
 *  the row and answers it on the map. A click only: hovering the rows does nothing. */
export class FocusRow {
  private key: string | null = null;   // the data-focus of the row the player touched last
  private booked = 0;                  // a repaint is booked for the next frame (the body changed)

  constructor(private readonly g: Game, private readonly body: HTMLElement) {
    body.addEventListener('click', (e) => this.onClick(e), true);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        if (this.booked || this.key === null) return;
        this.booked = requestAnimationFrame(() => { this.booked = 0; this.paint(); });
      }).observe(body, { childList: true, subtree: true });
    }
  }

  /** Lights the row of the last focus, if it is on the page, on a host that keeps one (and none elsewhere). */
  paint(): void {
    const on = keepsFocus(currentHost()) && this.key !== null;
    const want = on ? this.body.querySelector<HTMLElement>(`[data-focus="${CSS.escape(this.key ?? '')}"]`) : null;
    for (const el of this.body.querySelectorAll<HTMLElement>('.focus-row')) if (el !== want) el.classList.remove('focus-row');
    if (want && !want.classList.contains('focus-row')) want.classList.add('focus-row');
  }

  private onClick(e: MouseEvent): void {
    if (!keepsFocus(currentHost()) || !(e.target instanceof Element)) return;
    const row = e.target.closest<HTMLElement>('[data-focus]');
    if (!row || !this.body.contains(row)) return;
    const ctl = e.target.closest(CONTROLS);
    if (ctl && row.contains(ctl) && ctl !== row) return;   // the row's ±, ↑, ✕ or chip: the control's own
    const f = parseFocus(row.dataset.focus);
    const rects = f ? focusRects(this.g.state, f) : [], all = unionRect(rects);
    if (!all) return;   // nothing of it on the map now (a category with no works yet, a site gone)
    this.key = row.dataset.focus ?? null;
    this.paint();
    routeIntent({ kind: 'focus' });   // the wide pane under 960 px leaves no map: it docks (and stays docked), else nothing moves
    const v = this.g.view;
    if (rects.length === 1) v.centerOn(all);
    else v.ensureVisible(all, MARGIN);
    for (const r of rects) v.flash(idx(r.x, r.y), r.w, r.h);
  }
}
