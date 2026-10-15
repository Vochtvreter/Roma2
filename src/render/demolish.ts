// src/render/demolish.ts — the demolish tool's armed works and their words on the map (DESIGN §5.3, §15.8). Owner: WP-F.
// A click (a tap) on a work arms it; a press dragged across the map sweeps a rectangle and arms every work it touches.
// Armed works show red under what pulling them down would do (game/demolition.ts demolitionImpact: the homes and their
// people, the workers, the homes left without water or a shrine, what comes back), and a second click on them pulls
// them down (ViewCallbacks.onDemolish). The armed state never runs out on a timer: it holds until the mouse leaves the
// armed works (a finger has no hover: until a tap elsewhere), Esc or Back (ui/history.ts), or a right-click; a second
// click that comes under CONFIRM_GUARD_MS after the first is ignored (a double-click is not a decision). The words and
// the tap's verdict are pure (tests/demolish.test.ts); the view keeps one Doom and draws it here.
import type { GameState, Rect } from '../game/types';
import { W } from '../game/map';
import { derived } from '../game/derived';
import { getBuilding } from '../game/state';
import { costWords } from '../game/demolition';
import type { DemolitionImpact } from '../game/demolition';
import { BUILDING_DEFS } from '../game/data/buildings';
import { NEED_META } from '../game/data/housing';
import type { Insets } from './camera';
import { TILE } from './camera';
import { label } from './placement';
import { footprintRect } from './buildings';

/** A second click this soon after the first (ms) is ignored: a double-click arms, it never pulls down. */
export const CONFIRM_GUARD_MS = 400;
/** The armed works pulse this long (ms), then hold steady: a paused map left armed draws nothing more (P7). */
export const PULSE_MS = 3000;

/** Works picked for pulling down: one work clicked (rect null), or every work a sweep's rectangle touches. `ids` are all
 *  the works picked (the principia too: a click on it still holds the selection); the impact says which come down. */
export interface Doom { ids: number[]; rect: Rect | null; at: number; touch: boolean; impact: DemolitionImpact }

/** What a click on the map does with the demolish tool: on the armed works (or inside an armed sweep) it confirms, or
 *  is ignored while the guard runs; on another work it arms that one; on bare ground it disarms. */
export function demolishTap(d: Doom | null, id: number | null, tile: number, now: number): 'confirm' | 'early' | 'arm' | 'disarm' {
  if (d && covers(d, id, tile)) return now - d.at < CONFIRM_GUARD_MS ? 'early' : 'confirm';
  return id === null ? 'disarm' : 'arm';
}

/** Whether the pointer at this work and tile is on the armed works (or inside an armed sweep's rectangle). */
export function covers(d: Pick<Doom, 'ids' | 'rect'>, id: number | null, tile: number | null): boolean {
  if (id !== null && d.ids.includes(id)) return true;
  if (!d.rect || tile === null) return false;
  const x = tile % W, y = Math.floor(tile / W), r = d.rect;
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The tile rectangle between two corner tiles of a sweep (both included). */
export function sweepRect(a: number, b: number): Rect {
  const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 };
}

/** Every work whose footprint touches a tile rectangle, in id order. */
export function sweepIds(s: GameState, r: Rect): number[] {
  const at = derived(s).buildingAt, out = new Set<number>();
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (at[y * W + x] > 0) out.add(at[y * W + x]);
  return [...out].sort((a, c) => a - c);
}

export type Tone = 'bad' | 'warn' | 'info';

function n(k: number, one: string, many: string): string {
  return `${k} ${k === 1 ? one : many}`;
}

/** A need as the homes lose it: 'water', 'a shrine', 'a market hall'. */
function needWord(need: keyof typeof NEED_META): string {
  const l = NEED_META[need].label;
  return l.charAt(0).toLowerCase() + l.slice(1);
}

/** The lines over armed works, top first (a sweep being dragged: its count, without the homes that lose a need):
 *  'Click again to demolish all 6' · '2 homes, 14 people · 3 workers out of work' · '3 homes lose water · 1 home loses a
 *  shrine' · '25% back: 8 denarii, 2 timber'. */
export function impactLines(imp: DemolitionImpact, opts: { touch: boolean; sweep?: boolean }): { text: string; tone: Tone }[] {
  const k = imp.ids.length;
  if (k === 0) {
    const t = imp.spared[0];
    return [{ text: t ? `The ${BUILDING_DEFS[t].latin} cannot be pulled down` : 'Nothing to pull down here', tone: 'bad' }];
  }
  const out: { text: string; tone: Tone }[] = [];
  const word = opts.touch ? 'Tap' : 'Click';
  out.push({ text: opts.sweep ? `${n(k, 'work', 'works')} to pull down` : `${word} again to demolish${k > 1 ? ` all ${k}` : ''}`, tone: 'bad' });
  const who: string[] = [];
  if (imp.homes) who.push(`${n(imp.homes, 'home', 'homes')}, ${n(imp.people, 'person', 'people')}`);
  if (imp.workers) who.push(`${n(imp.workers, 'worker', 'workers')} out of work`);
  if (imp.sites) who.push(`${n(imp.sites, 'site', 'sites')} abandoned`);
  if (who.length) out.push({ text: who.join(' · '), tone: 'info' });
  if (imp.losing.length) out.push({ text: imp.losing.map((l) => `${n(l.homes, 'home loses', 'homes lose')} ${needWord(l.need)}`).join(' · '), tone: 'warn' });
  const back = costWords(imp.refund);
  out.push({
    text: back.length === 0 ? 'Nothing comes back' : `${imp.frac !== null ? `${Math.round(imp.frac * 100)}% back` : 'Back'}: ${back.join(', ')}`,
    tone: 'info',
  });
  return out;
}

const TONE: Record<Tone, string> = { bad: '#e5554a', warn: '#f2c94c', info: '#f4ead6' };
const EDGE = '#f0a04b';

/** Draws picked works (a sweep being dragged, or the armed ones): each footprint that would come down red (pulsing for
 *  PULSE_MS after it was armed; the principia is never tinted), a sweep's rectangle outlined, and the impact's lines
 *  above them. `k`: device px per world px (the labels keep 12 CSS px clear of the works). */
export function drawDoom(g: CanvasRenderingContext2D, s: GameState, d: Doom, sweep: boolean, time: number, k: number, ins: Insets): void {
  const a = sweep || time - d.at >= PULSE_MS ? 0.4 : 0.3 + 0.2 * Math.sin(time / 120);
  g.fillStyle = `rgba(229,85,74,${a})`;
  let top: Rect | null = d.rect;
  for (const id of d.ids) {
    const b = getBuilding(s, id);
    if (!b) continue;
    const r = footprintRect(s, b);
    if (d.impact.ids.includes(id)) g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    if (!d.rect && (!top || r.y < top.y)) top = r;
  }
  if (d.rect) {
    const r = d.rect, X = r.x * TILE, Y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
    g.fillStyle = EDGE;
    g.fillRect(X, Y, w, 2); g.fillRect(X, Y + h - 2, w, 2); g.fillRect(X, Y, 2, h); g.fillRect(X + w - 2, Y, 2, h);
  }
  if (!top) return;
  let y = top.y * TILE - 8 - 12 / k;
  const x = (top.x + top.w / 2) * TILE;
  const lines = impactLines(d.impact, { touch: d.touch, sweep });
  for (let i = lines.length - 1; i >= 0; i--) y -= label(g, lines[i].text, x, y, TONE[lines[i].tone], ins);
}
