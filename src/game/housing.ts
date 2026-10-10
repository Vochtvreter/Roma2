// src/game/housing.ts — house needs, evolution, renovation, decline, goods (ARCHITECTURE §8.3, DESIGN §7). Owner: WP-B.
// Houses are checked every CHECK_EVERY days on their own slot ((id + day) % 5 == 0); renovations finish daily.
import { B as B$ } from './balance';
import { HOUSE_TIERS as HOUSE_TIERS$, RESOURCES as RESOURCES$ } from './types';
import type {
  ActionResult, Building, BuildingId, CoverageLayerId, Cost, GameState, HousePref, HouseTierId, NeedId, SimView, TickContext,
} from './types';
import { houseDesir, houseHas, previewCoverage, previewDesir } from './coverage';
import { derived as derived$, footprintOf as footprintOf$ } from './derived';
import { fx as fx$ } from './fx';
import { dayEpoch as dayEpoch$, invalidateTiers as invalidateTiers$, memo as memo$, touchPeople as touchPeople$ } from './memo';
import { residents } from './census';
import { settingValue } from './decisions';
import { reserved } from './ordo/saving';
import { evictOverflow } from './people';
import { view } from './sim';
import { log } from './state';
import { getBuilding as getBuilding$ } from './lookup';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from './data/housing';
import { feminine as feminine$ } from './data/names';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, HOUSE_TIERS = HOUSE_TIERS$, RESOURCES = RESOURCES$, derived = derived$, footprintOf = footprintOf$,
  fx = fx$, dayEpoch = dayEpoch$, invalidateTiers = invalidateTiers$, memo = memo$, touchPeople = touchPeople$,
  BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$, feminine = feminine$,
  getBuilding = getBuilding$;

const H = B.housing;
const TOP = 4;
const PREFS: readonly HousePref[] = ['auto', 'insula', 'domus'];
/** The house needs a coverage layer satisfies. */
const LAYER_NEEDS: Record<CoverageLayerId, readonly NeedId[]> = {
  water: ['water'], fountain: ['water'], shrine: ['religion'], temple: ['temple', 'religion'],
  market: ['market'], macellum: ['macellum', 'market'], baths: ['baths'], culture: [],
};

function level(t: HouseTierId): number {
  return TIER_DEFS[t].level;
}

function tierBelow(t: HouseTierId): HouseTierId {
  const l = level(t) - 1;
  return HOUSE_TIERS.find((x) => level(x) === l) ?? t;
}

/** The tier a house would evolve into next (domusParva → insula or domus by preference); null at the top. */
export function nextTier(s: GameState, b: Building): HouseTierId | null {
  const h = b.house;
  if (!h || level(h.tier) >= TOP) return null;
  if (h.tier === 'domusParva') {
    if (h.pref === 'domus') return 'domus';
    if (h.pref === 'insula') return 'insula';
    return houseDesir(s, b.id) >= H.DESIR_DOMUS ? 'domus' : 'insula';
  }
  return HOUSE_TIERS[HOUSE_TIERS.indexOf(h.tier) + 1];
}

/** What a house is working toward: its next tier, or the other T4 branch when its preference asks for a conversion. */
export function targetTier(s: GameState, b: Building): HouseTierId | null {
  const h = b.house;
  if (!h || h.renovating) return null;
  if (level(h.tier) < TOP) return nextTier(s, b);
  return (h.pref === 'insula' || h.pref === 'domus') && h.pref !== h.tier ? h.pref : null;
}

/** The needs of `tier` this house does not meet, in the tier's need order ('street' always holds once placed). */
export function unmetNeeds(s: GameState, b: Building, tier: HouseTierId): NeedId[] {
  const t = TIER_DEFS[tier];
  const h = b.house;
  const out: NeedId[] = [];
  for (const n of t.needs) {
    let met: boolean;
    switch (n) {
      case 'water': met = houseHas(s, b.id, 'water') || houseHas(s, b.id, 'fountain'); break;
      case 'fed': met = s.fed >= B.needs.FED_MIN; break;
      case 'religion': met = houseHas(s, b.id, 'shrine') || houseHas(s, b.id, 'temple'); break;
      case 'market': met = houseHas(s, b.id, 'market') || houseHas(s, b.id, 'macellum'); break;
      case 'temple': met = houseHas(s, b.id, 'temple'); break;
      case 'desirability': met = t.desirMin === null || houseDesir(s, b.id) >= t.desirMin; break;
      case 'baths': met = houseHas(s, b.id, 'baths'); break;
      case 'macellum': met = houseHas(s, b.id, 'macellum'); break;
      case 'oil': met = (h?.oil ?? 0) >= H.SUPPLIED; break;
      case 'wine': met = (h?.wine ?? 0) >= H.SUPPLIED; break;
      case 'rank': met = s.rank >= t.rank; break;
      default: met = true;    // 'street' (always true once placed); 'materials' is the renovation-pool want
    }
    if (!met) out.push(n);
  }
  return out;
}

function covers(pool: Cost, cost: Cost): boolean {
  for (const r of RESOURCES) if ((cost[r] ?? 0) > (pool[r] ?? 0) + 1e-9) return false;
  return true;
}

/** The first unmet need of the next tier (the want bubble); 'materials' when every need holds but the renovation pool
 *  lacks the materials; null when nothing is wanted. */
export function firstWant(s: GameState, b: Building): NeedId | null {
  const next = targetTier(s, b);
  if (!next) return null;
  const unmet = unmetNeeds(s, b, next);
  if (unmet.length > 0) return unmet[0];
  const pool = memo(s, 'renovationPool', dayEpoch(s), () => renovationPool(s, view(s)));
  return covers(pool, TIER_DEFS[next].renovation) ? null : 'materials';
}

/** The first unmet need of the next tier, without firstWant's renovation-pool check ('materials' is no coverage need,
 *  so site scoring reads this and never reaches into the Ordo's reservation); null when every need holds. */
export function needWant(s: GameState, b: Building): NeedId | null {
  const next = targetTier(s, b);
  return next ? unmetNeeds(s, b, next)[0] ?? null : null;
}

/** Houses that a building of `type` at (x, y) would let evolve: their first want is a need it would satisfy. */
export function housesUnlockedBy(s: GameState, type: BuildingId, x: number, y: number): number[] {
  const out = new Set<number>();
  for (const pv of previewCoverage(s, type, x, y)) {
    const gives = LAYER_NEEDS[pv.layer];
    for (const id of pv.houses) {
      const b = getBuilding(s, id);
      const want = b ? firstWant(s, b) : null;
      if (want && gives.includes(want)) out.add(id);
    }
  }
  if (BUILDING_DEFS[type].desir[0] > 0) {
    const delta = new Map<number, number>();
    for (const d of previewDesir(s, type, x, y)) delta.set(d.tile, d.v);
    if (delta.size > 0) {
      for (const id of derived(s).houses) {
        const b = getBuilding(s, id);
        const next = b ? targetTier(s, b) : null;
        if (!b || !next || firstWant(s, b) !== 'desirability') continue;
        const tiles = footprintOf(b, s);
        let add = 0;
        for (const i of tiles) add += delta.get(i) ?? 0;
        if (houseDesir(s, id) + add / Math.max(1, tiles.length) >= (TIER_DEFS[next].desirMin ?? 0)) out.add(id);
      }
    }
  }
  return [...out].sort((a, c) => a - c);
}

/** True for an insula or domus covered by a fountain (the aquae variant). */
export function isAquae(s: GameState, b: Building): boolean {
  const h = b.house;
  return !!h && level(h.tier) === TOP && houseHas(s, b.id, 'fountain');
}

/** Tax per resident per day of a house, incl. declining ×0.5 and the aquae domus ×1.3. */
export function houseTax(s: GameState, b: Building): number {
  const h = b.house;
  if (!h) return 0;
  let t = TIER_DEFS[h.tier].tax;
  if (h.declining) t *= H.DECLINE_TAX;
  if (h.tier === 'domus' && isAquae(s, b)) t *= H.AQUAE_TAX;
  return t;
}

/** Materials renovations may draw today: per resource max(0, stock − the Ordo's reservations) × the Renovation setting. */
export function renovationPool(s: GameState, v: SimView): Cost {
  const res = reserved(s, v);
  const share = settingValue(s, 'renovation');
  const pool: Cost = {};
  for (const r of RESOURCES) {
    const free = Math.max(0, s.res[r] - (res[r] ?? 0)) * share;
    if (free > 0) pool[r] = free;
  }
  return pool;
}

/** The household that names a house (its principal family), for log lines. */
function householdName(s: GameState, b: Building): string {
  const fam = s.families.find((f) => f.home === b.id);
  const gens = fam?.gens ?? residents(s, b.id)[0]?.gens;
  return gens ? `of the gens ${feminine(gens)}` : 'by the forum';
}

function finishRenovation(s: GameState, ctx: TickContext, b: Building): void {
  const h = b.house!;
  const to = h.renovating!.to;
  const from = h.tier;
  h.tier = to;
  h.renovating = null;
  h.okDays = 0;
  h.badDays = 0;
  if (level(from) < TOP) {
    s.stats.evolved++;
    s.stats.evolvedBy[to] = (s.stats.evolvedBy[to] ?? 0) + 1;
  }
  ctx.fx.push({ kind: 'evolved', id: b.id, tier: to });
  log(s, 'good', `The ${TIER_DEFS[from].name.toLowerCase()} ${householdName(s, b)} becomes a ${TIER_DEFS[to].name.toLowerCase()}.`, undefined, b.id);
  evictOverflow(s, b.id);
}

function dropTier(s: GameState, ctx: TickContext, b: Building): void {
  const h = b.house!;
  const from = h.tier;
  h.tier = tierBelow(from);
  h.declining = false;
  h.declineDays = 0;
  h.badDays = 0;
  h.okDays = 0;
  h.recoverDays = 0;
  s.stats.devolved++;
  ctx.fx.push({ kind: 'declined', id: b.id });
  log(s, 'bad', `The ${TIER_DEFS[from].name.toLowerCase()} ${householdName(s, b)} falls back to a ${TIER_DEFS[h.tier].name.toLowerCase()}.`, ['highlight'], b.id);
  evictOverflow(s, b.id);
}

/** Daily housing step: renovations finish; houses due today check their needs: decline (after DECLINE_AFTER), recovery
 *  (RECOVER_DAYS), a one-tier drop after DROP_AFTER more days (never below T1; offline the counter stops at
 *  OFFLINE_DECLINE_STOP and nothing drops), and evolution (OK_DAYS of met needs, the throttle and the renovation pool). */
export function housingDay(s: GameState, ctx: TickContext): void {
  const day = s.day;
  const ids = derived(s).houses;
  let changed = false;
  for (const id of ids) {
    const b = getBuilding(s, id);
    if (b?.house?.renovating && day >= b.house.renovating.until) { finishRenovation(s, ctx, b); changed = true; }
  }
  const win = s.counters.renovWindow;
  if (day - win.start >= H.THROTTLE_WINDOW) { win.start = day; win.count = 0; }
  const allowed = 1 + Math.floor(ids.length / H.THROTTLE_PER);
  let pool: Cost | null = null;
  for (const id of ids) {
    if ((id + day) % H.CHECK_EVERY !== 0) continue;
    const b = getBuilding(s, id);
    const h = b?.house;
    if (!b || !h || h.renovating) continue;
    if (unmetNeeds(s, b, h.tier).length > 0) {
      h.okDays = 0;
      h.recoverDays = 0;
      if (!h.declining) {
        h.badDays += H.CHECK_EVERY;
        if (h.badDays >= H.DECLINE_AFTER) {
          h.declining = true;
          h.declineDays = 0;
          ctx.fx.push({ kind: 'declined', id });
          log(s, 'bad', `The ${TIER_DEFS[h.tier].name.toLowerCase()} ${householdName(s, b)} is declining.`, undefined, id);
          touchPeople(s);
        }
      } else {
        h.declineDays = Math.min(H.DROP_AFTER, h.declineDays + H.CHECK_EVERY);
        if (ctx.offline) h.declineDays = Math.min(h.declineDays, H.OFFLINE_DECLINE_STOP);
        else if (h.declineDays >= H.DROP_AFTER && level(h.tier) > H.MIN_DROP_LEVEL) { dropTier(s, ctx, b); changed = true; }
      }
      continue;
    }
    if (h.declining) {
      h.recoverDays += H.CHECK_EVERY;
      if (h.recoverDays >= H.RECOVER_DAYS) {
        h.declining = false;
        h.declineDays = 0;
        h.badDays = 0;
        h.recoverDays = 0;
        log(s, 'good', `The ${TIER_DEFS[h.tier].name.toLowerCase()} ${householdName(s, b)} is in good repair again.`, undefined, id);
        touchPeople(s);
      }
      continue;
    }
    h.badDays = 0;
    const next = targetTier(s, b);
    if (!next || unmetNeeds(s, b, next).length > 0) { h.okDays = 0; continue; }
    h.okDays += H.CHECK_EVERY;
    const conversion = level(h.tier) === TOP;
    if ((!conversion && h.okDays < H.OK_DAYS) || win.count >= allowed) continue;
    const cost = TIER_DEFS[next].renovation;
    pool ??= renovationPool(s, view(s));
    if (!covers(pool, cost)) continue;
    for (const r of RESOURCES) {
      const k = cost[r] ?? 0;
      if (k <= 0) continue;
      s.res[r] = Math.max(0, s.res[r] - k);
      pool[r] = (pool[r] ?? 0) - k;
      ctx.rates.cons[r].renovation = (ctx.rates.cons[r].renovation ?? 0) + k;
    }
    const days = (conversion ? H.CONVERT_DAYS : H.RENOVATE_DAYS) / fx(s, 'renovation');
    h.renovating = { until: day + Math.max(1, Math.ceil(days)), to: next };
    win.count++;
  }
  if (changed) invalidateTiers(s);   // tiers moved (beds, desirability, patricii), no work or road did
}

/** Delivers oil and wine to T3/T4 houses inside macellum coverage (domus first, then insulae, then by id) and updates
 *  their supply EMAs; T3 houses draw too, since they need a steady supply before they can become T4. */
export function goodsDay(s: GameState, ctx: TickContext): void {
  const list: { b: Building; rank: number; oil: boolean; wine: boolean }[] = [];
  for (const id of derived(s).houses) {
    const b = getBuilding(s, id);
    const h = b?.house;
    if (!b || !h) continue;
    const t = level(h.tier) === TOP || h.tier === 'domusParva' ? targetTier(s, b) ?? (h.renovating?.to ?? h.tier) : null;
    if (!t) {
      h.oil += H.SUPPLY_ALPHA * (0 - h.oil);
      h.wine += H.SUPPLY_ALPHA * (0 - h.wine);
      continue;
    }
    const wine = TIER_DEFS[t].needs.includes('wine') || h.tier === 'domus';
    list.push({ b, rank: h.tier === 'domus' ? 0 : h.tier === 'insula' ? 1 : 2, oil: true, wine });
  }
  list.sort((a, c) => a.rank - c.rank || a.b.id - c.b.id);
  for (const { b, oil, wine } of list) {
    const h = b.house!;
    const n = residents(s, b.id).length;
    const covered = houseHas(s, b.id, 'macellum');
    const deliver = (res: 'oil' | 'wine', want: boolean): void => {
      const need = want ? n * H.GOODS[res] : 0;
      if (need <= 0) { h[res] += H.SUPPLY_ALPHA * (0 - h[res]); return; }
      const got = covered ? Math.min(need, Math.max(0, s.res[res])) : 0;
      if (got > 0) {
        s.res[res] -= got;
        ctx.rates.cons[res].goods = (ctx.rates.cons[res].goods ?? 0) + got;
      }
      h[res] += H.SUPPLY_ALPHA * (got / need - h[res]);
    };
    deliver('oil', oil);
    deliver('wine', wine);
  }
}

/** Sets a house's evolution preference (auto / insula / domus); a finished T4 house converts when the other branch's
 *  needs hold (CONVERT_DAYS, its renovation materials; overflow residents become homeless). */
export function setHousePref(s: GameState, id: number, pref: HousePref): ActionResult {
  const b = getBuilding(s, id);
  if (!b?.house) return { ok: false, code: 'notFound', reason: 'There is no house there.' };
  if (!PREFS.includes(pref)) return { ok: false, code: 'invalid', reason: 'No such preference.' };
  if (b.house.pref === pref) return { ok: true, id };
  b.house.pref = pref;
  const name = householdName(s, b);
  const text = pref === 'auto' ? `The household ${name} will grow as the street allows.`
    : `The household ${name} sets its heart on ${pref === 'domus' ? 'an atrium house' : 'an insula'}.`;
  log(s, 'info', text, undefined, id);
  return { ok: true, id };
}
