// src/game/coverage.ts — road-BFS service coverage and desirability (ARCHITECTURE §8.2, DESIGN §7.4–7.5). Owner: WP-A.
// SCAFFOLD: every coverage layer is empty and desirability is 0 everywhere; effectiveRadius follows the activity rule.
import { B } from './balance';
import { LAYERS } from './types';
import type { AddKey, Building, BuildingId, Coverage, CoverageLayerId, GameState } from './types';
import { H, W } from './map';
import { memo, structEpoch } from './memo';
import { derived, footprintOf } from './derived';
import { census } from './census';
import { fxAdd } from './fx';
import { getBuilding } from './state';
import { BUILDING_DEFS } from './data/buildings';

/** Path radius bonus that applies to each layer (DESIGN §9.3). */
const RADIUS_BONUS: Partial<Record<CoverageLayerId, AddKey>> = {
  shrine: 'shrineRadius', temple: 'shrineRadius', market: 'marketRadius', macellum: 'marketRadius', baths: 'bathsRadius',
};

/** Effective radius of a building's service layer: DESIGN §5.2 activity rule, unpaid halving, path bonuses; 0 when inactive. */
export function effectiveRadius(s: GameState, b: Building, layer: CoverageLayerId): number {
  const def = BUILDING_DEFS[b.type];
  const svc = def.service?.find((x) => x.layer === layer);
  if (!svc || b.status !== 'done') return 0;
  let r = svc.radius;
  if (def.slots > 0) {
    if (!b.open) return 0;
    const n = census(s).staffed[b.id] ?? 0;
    if (n <= 0) return 0;
    if (n < Math.ceil(def.slots * B.economy.SERVICE_FULL)) r = Math.floor(B.economy.SERVICE_PARTIAL * r);
  }
  if (b.unpaid) r = Math.floor(r * B.economy.UNPAID);
  const bonus = RADIUS_BONUS[layer];
  if (bonus && r > 0) r += fxAdd(s, bonus);
  return Math.max(0, r);
}

/** Coverage layers over built roads and the per-house layer mask (memo on structEpoch). */
export function coverage(s: GameState): Coverage {
  const epoch = structEpoch(s);
  return memo(s, 'coverage', epoch, () => {
    // STUB(WP-A): BFS per layer from the road tiles touching each active service (DESIGN §7.4).
    const layers = {} as Record<CoverageLayerId, Uint8Array>;
    for (const l of LAYERS) layers[l] = new Uint8Array(W * H);
    const houseMask = new Map<number, number>();
    for (const id of derived(s).houses) houseMask.set(id, 0);
    return { layers, houseMask, key: String(epoch) };
  });
}

/** True when the house is covered by the layer. */
export function houseHas(s: GameState, houseId: number, layer: CoverageLayerId): boolean {
  const mask = coverage(s).houseMask.get(houseId) ?? 0;
  return ((mask >> LAYERS.indexOf(layer)) & 1) === 1;
}

/** Coverage of a would-be building at (x, y), as if built and fully staffed: covered road tiles and houses per layer. */
export function previewCoverage(s: GameState, type: BuildingId, x: number, y: number): { layer: CoverageLayerId; tiles: Uint8Array; houses: number[] }[] {
  // STUB(WP-A): empty previews, one per service layer of the type.
  void s; void x; void y;
  return (BUILDING_DEFS[type].service ?? []).map((svc) => ({ layer: svc.layer, tiles: new Uint8Array(W * H), houses: [] }));
}

/** Desirability per tile, clamped to DESIR_CLAMP (memo on structEpoch). */
export function desirability(s: GameState): Float32Array {
  // STUB(WP-A): Σ v · (1 − d/(r + 1)) over every source (DESIGN §7.5).
  return memo(s, 'desirability', structEpoch(s), () => new Float32Array(W * H));
}

/** A house's desirability: the average over its footprint tiles. */
export function houseDesir(s: GameState, houseId: number): number {
  const b = getBuilding(s, houseId);
  if (!b) return 0;
  const tiles = footprintOf(b, s);
  if (tiles.length === 0) return 0;
  const d = desirability(s);
  let sum = 0;
  for (const i of tiles) sum += d[i];
  return sum / tiles.length;
}

/** Desirability change a would-be building at (x, y) would make, per affected tile. */
export function previewDesir(s: GameState, type: BuildingId, x: number, y: number): { tile: number; v: number }[] {
  // STUB(WP-A): footprint influence of the type's desir [value, range].
  void s; void type; void x; void y;
  return [];
}
