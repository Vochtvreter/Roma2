// src/game/site.ts — site multipliers, Ordo site scoring and the best slot (ARCHITECTURE §8.2, DESIGN §5.1, §10.5). Owner: WP-A.
// SCAFFOLD: every site is ×1.0 and scores 0; bestSlot is the lowest valid origin tile.
import type { Building, BuildingId, GameState, Owner, ReasonCode, SiteNote } from './types';
import { tx, ty } from './map';
import { validSlots } from './place';

/** Site multiplier and notes of a type at (x, y) (DESIGN §5.1 adjacency formulas). */
export function siteMultAt(s: GameState, type: BuildingId, x: number, y: number): { mult: number; notes: SiteNote[] } {
  // STUB(WP-A): fertile/loam/river/fields, woods density, quarry rock, clay, vein, neighbours.
  void s; void type; void x; void y;
  return { mult: 1, notes: [] };
}

/** Site multiplier of a placed building (memo per building on structEpoch + forest bucket). */
export function siteMult(s: GameState, b: Building): number {
  return siteMultAt(s, b.type, b.x, b.y).mult;
}

/** The Ordo's score for a type at (x, y) for a purpose (DESIGN §10.5). */
export function siteScore(s: GameState, type: BuildingId, x: number, y: number, purpose?: ReasonCode): { score: number; notes: SiteNote[] } {
  // STUB(WP-A): DESIGN §10.5 scoring tables (B.score).
  void purpose;
  return { score: 0, notes: siteMultAt(s, type, x, y).notes };
}

/** The best valid slot for a type (highest score, ties by lowest tile); null when there is none. */
export function bestSlot(s: GameState, type: BuildingId, opts?: { owner?: Owner; purpose?: ReasonCode }): { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null {
  const slots = validSlots(s, type, opts?.owner ?? 'ordo');
  let best: { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null = null;
  for (const tile of slots.keys()) {
    const x = tx(tile), y = ty(tile);
    const sc = siteScore(s, type, x, y, opts?.purpose);
    if (!best || sc.score > best.score || (sc.score === best.score && tile < best.tile)) best = { tile, x, y, score: sc.score, notes: sc.notes };
  }
  return best;
}
