// src/game/housing.ts — house needs, evolution, renovation, decline, goods (ARCHITECTURE §8.3, DESIGN §7). Owner: WP-B.
// SCAFFOLD: nextTier/unmetNeeds/firstWant/houseTax are real enough for the UI; housingDay and goodsDay are no-ops.
import { B } from './balance';
import { HOUSE_TIERS } from './types';
import type { ActionResult, Building, BuildingId, Cost, GameState, HousePref, HouseTierId, NeedId, SimView, TickContext } from './types';
import { houseDesir, houseHas } from './coverage';
import { roadNeighbors } from './derived';
import { getBuilding, log } from './state';
import { TIER_DEFS } from './data/housing';

/** The tier a house would evolve into next (domusParva → insula or domus by preference); null at the top. */
export function nextTier(s: GameState, b: Building): HouseTierId | null {
  const h = b.house;
  if (!h) return null;
  const level = TIER_DEFS[h.tier].level;
  if (level >= 4) return null;
  if (h.tier === 'domusParva') {
    if (h.pref === 'domus') return 'domus';
    if (h.pref === 'insula') return 'insula';
    // STUB(WP-B): 'auto' chooses by desirability (B.housing.DESIR_DOMUS).
    return houseDesir(s, b.id) >= B.housing.DESIR_DOMUS ? 'domus' : 'insula';
  }
  return HOUSE_TIERS[HOUSE_TIERS.indexOf(h.tier) + 1];
}

/** The needs of `tier` this house does not meet, in the tier's need order. */
export function unmetNeeds(s: GameState, b: Building, tier: HouseTierId): NeedId[] {
  const t = TIER_DEFS[tier];
  const h = b.house;
  const out: NeedId[] = [];
  for (const n of t.needs) {
    let met: boolean;
    switch (n) {
      case 'street': met = roadNeighbors(s, b).length > 0; break;
      case 'water': met = houseHas(s, b.id, 'water') || houseHas(s, b.id, 'fountain'); break;
      case 'fed': met = s.fed >= B.needs.FED_MIN; break;
      case 'religion': met = houseHas(s, b.id, 'shrine') || houseHas(s, b.id, 'temple'); break;
      case 'market': met = houseHas(s, b.id, 'market') || houseHas(s, b.id, 'macellum'); break;
      case 'temple': met = houseHas(s, b.id, 'temple'); break;
      case 'desirability': met = t.desirMin === null || houseDesir(s, b.id) >= t.desirMin; break;
      case 'baths': met = houseHas(s, b.id, 'baths'); break;
      case 'macellum': met = houseHas(s, b.id, 'macellum'); break;
      case 'oil': met = (h?.oil ?? 0) >= B.housing.SUPPLIED; break;
      case 'wine': met = (h?.wine ?? 0) >= B.housing.SUPPLIED; break;
      case 'rank': met = s.rank >= t.rank; break;
      default: met = true;    // 'materials' is the renovation-pool want, never a listed need
    }
    if (!met) out.push(n);
  }
  return out;
}

/** The first unmet need of the next tier (what the want bubble shows); null when nothing is wanted. */
export function firstWant(s: GameState, b: Building): NeedId | null {
  const next = nextTier(s, b);
  if (!next) return null;
  // STUB(WP-B): 'materials' when every need holds but the renovation pool lacks materials.
  return unmetNeeds(s, b, next)[0] ?? null;
}

/** Houses that a building of `type` at (x, y) would let evolve. */
export function housesUnlockedBy(s: GameState, type: BuildingId, x: number, y: number): number[] {
  // STUB(WP-B): previewCoverage × unmetNeeds.
  void s; void type; void x; void y;
  return [];
}

/** Tax per resident per day of a house, incl. declining ×0.5 (STUB: aquae ×1.3). */
export function houseTax(s: GameState, b: Building): number {
  const h = b.house;
  if (!h) return 0;
  void s;
  return TIER_DEFS[h.tier].tax * (h.declining ? B.housing.DECLINE_TAX : 1);
}

/** True for an insula or domus covered by a fountain (the aquae variant). */
export function isAquae(s: GameState, b: Building): boolean {
  // STUB(WP-B): DESIGN §7.1 aquae variant.
  void s; void b;
  return false;
}

/** Materials the waiting renovations will need (the renovation pool). */
export function renovationPool(s: GameState, v: SimView): Cost {
  // STUB(WP-B): DESIGN §7.2.
  void s; void v;
  return {};
}

/** Daily housing step for the houses due today: needs, evolution, renovation, decline, drop (offline: no drop). */
export function housingDay(s: GameState, ctx: TickContext): void {
  // STUB(WP-B): DESIGN §7.2–7.3.
  void s; void ctx;
}

/** Delivers oil and wine to T4 houses and updates their supply EMAs. */
export function goodsDay(s: GameState, ctx: TickContext): void {
  // STUB(WP-B): DESIGN §7.6.
  void s; void ctx;
}

/** Sets a house's evolution preference (auto / insula / domus). */
export function setHousePref(s: GameState, id: number, pref: HousePref): ActionResult {
  const b = getBuilding(s, id);
  if (!b?.house) return { ok: false, code: 'notFound', reason: 'There is no house there.' };
  if (b.house.pref === pref) return { ok: true, id };
  b.house.pref = pref;
  log(s, 'info', pref === 'auto' ? 'A household will grow as the street allows.' : `A household sets its heart on ${pref === 'domus' ? 'an atrium house' : 'an insula'}.`, undefined, id);
  return { ok: true, id };
}
