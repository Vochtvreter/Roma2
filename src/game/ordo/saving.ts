// src/game/ordo/saving.ts — the saving target, reservations and the spending rule (ARCHITECTURE §8.4, DESIGN §10.5, §7.2). Owner: WP-C.
// Saving target = petition fee (once its other requirements are met) + player plans + pin + requests + the pending wish.
// Every Ordo spend except survival draws only on stock above it (and keeps the treasury floor); renovations and
// export contracts read the same reservation, so saving never deadlocks building or renovation.
import { B } from '../balance';
import { RESOURCES } from '../types';
import type { BuildingId, Cost, GameState, Reason, ResId, SimView } from '../types';
import { addCost, canAfford, missing, scaleCost } from '../state';
import { petitionNeeds, settingValue } from '../decisions';
import { capitoliumFlow } from '../construction';
import { censusEpoch, memo, structEpoch } from '../memo';
import { seasonOf } from '../calendar';
import { buildingRate } from '../economy';
import { fx } from '../fx';
import { BUILDING_DEFS } from '../data/buildings';
import { walkWishes } from './build';

/** What a saving part is for, in priority order. */
export type SavingKind = 'petition' | 'plan' | 'pin' | 'request' | 'wish';
/** One player-ordered part of the saving target; `req` is the request it stands for. */
export interface SavingPart { kind: SavingKind; cost: Cost; type?: BuildingId; req?: GameState['ordo']['requests'][number] }

/** A work's cost as the Ordo budgets it: the registry cost (castellum: plus its route), with the path discounts. */
export function workCost(s: GameState, type: BuildingId, routeLen = 0): Cost {
  const def = BUILDING_DEFS[type];
  let cost = def.perTile && routeLen > 0 ? addCost(def.cost, scaleCost(def.perTile.cost, routeLen)) : def.cost;
  if (type === 'castellum') cost = scaleCost(cost, fx(s, 'castellumCost'));
  if (type === 'lacus') cost = scaleCost(cost, fx(s, 'lacusCost'));
  return cost;
}

/** The player-ordered parts of the saving target in priority order: petition fee, plans, pin, requests. */
export function savingParts(s: GameState, v: SimView): SavingPart[] {
  const key = `${s.day}|${structEpoch(s)}|${censusEpoch(s)}|${s.ordo.pin}|${JSON.stringify(s.ordo.requests)}|${JSON.stringify(s.decisions.paths)}`;
  return memo(s, 'ordo.parts', key, () => {
    const out: SavingPart[] = [];
    const pn = petitionNeeds(s, v);
    if (pn && pn.rank !== null && pn.ready) out.push({ kind: 'petition', cost: pn.fee });
    for (const b of s.buildings) {
      if (b.owner === 'player' && b.status === 'plan') out.push({ kind: 'plan', cost: workCost(s, b.type, b.route?.length), type: b.type });
    }
    if (s.ordo.pin) out.push({ kind: 'pin', cost: workCost(s, s.ordo.pin), type: s.ordo.pin });
    for (const req of s.ordo.requests) out.push({ kind: 'request', cost: workCost(s, req.type), type: req.type, req });
    return out.filter((p) => RESOURCES.some((r) => (p.cost[r] ?? 0) > 0));
  });
}

/** Sum of the parts' costs. */
export function partsCost(parts: readonly SavingPart[]): Cost {
  return parts.reduce<Cost>((a, p) => addCost(a, p.cost), {});
}

let walking = false;   // re-entrancy guard: a module the wish walk consults may itself ask for the reservation

/** What the Ordo is saving for (the whole target; `for` names its first part), or null. */
export function savingFor(s: GameState, v: SimView): { cost: Cost; for: SavingKind } | null {
  const parts = savingParts(s, v);
  let pending = null;
  if (!walking) {
    walking = true;
    try { pending = walkWishes(s, v).pending; } finally { walking = false; }
  }
  const cost = pending ? addCost(partsCost(parts), pending.cost) : partsCost(parts);
  if (!RESOURCES.some((r) => (cost[r] ?? 0) > 0)) return null;
  return { cost, for: parts[0]?.kind ?? 'wish' };
}

/** The next CAP_RESERVE_DAYS of Capitolium materials at its current flow (gradual materials × fx capMat). */
export function capitoliumAhead(s: GameState): Cost {
  const b = s.buildings.find((x) => x.type === 'capitolium' && x.status !== 'done');
  const rate = b ? capitoliumFlow(s)?.rate ?? 0 : 0;
  if (!b || rate <= 0 || b.work <= 0) return {};
  const work = Math.min(b.work * (1 - b.progress), rate * B.ordo.CAP_RESERVE_DAYS);
  return scaleCost(B.construction.CAP_MAT, (fx(s, 'capMat') * work) / b.work);
}

/** Stock held back from ordinary spending: the saving target plus the next 30 days of Capitolium materials. */
export function reserved(s: GameState, v: SimView): Cost {
  return addCost(savingFor(s, v)?.cost ?? {}, capitoliumAhead(s));
}

/** The treasury floor the Ordo keeps (halved under the Mercatura focus). */
export function treasuryFloor(s: GameState): number {
  return settingValue(s, 'treasuryFloor') * (s.decisions.focus === 'mercatura' ? B.ordo.FOCUS.MERCATURA_FLOOR : 1);
}

/** Paying `cost` leaves the denarii at or above the treasury floor. */
export function floorOk(s: GameState, cost: Cost): boolean {
  const d = cost.denarii ?? 0;
  return d <= 0 || s.res.denarii - d >= treasuryFloor(s);
}

/** stock − reserved covers the cost and denarii stay ≥ the treasury floor (survival spending ignores both). */
export function canSpend(s: GameState, cost: Cost, v: SimView, opts?: { survival?: boolean }): boolean {
  if (opts?.survival) return canAfford(s, cost);
  return canAfford(s, cost, reserved(s, v)) && floorOk(s, cost);
}

/** Net output per day of every good from finished buildings (inputs subtracted), at today's staffing or with every slot filled. */
export function outputRates(s: GameState, mode: 'current' | 'full'): Partial<Record<ResId, number>> {
  return memo(s, `ordo.rates.${mode}`, `${s.day}|${structEpoch(s)}|${censusEpoch(s)}`, () => {
    const out: Partial<Record<ResId, number>> = {};
    const season = seasonOf(s.day);
    for (const b of s.buildings) {
      const r = buildingRate(s, b, season, mode);
      for (const k of RESOURCES) if (r[k]) out[k] = (out[k] ?? 0) + (r[k] as number);
    }
    return out;
  });
}

/** Days until the stock covers `lack` at today's pace (coin by its 30-day average, grain and water by the forecast); null if something never comes in. */
export function etaDays(s: GameState, v: SimView, lack: Cost): number | null {
  const rates = outputRates(s, 'current');
  let eta = 0;
  for (const r of RESOURCES) {
    const q = lack[r] ?? 0;
    if (q <= 0) continue;
    const rate = r === 'denarii' ? v.f.coin.net30 : r === 'grain' ? v.f.grain.net : r === 'water' ? v.f.water.net : rates[r] ?? 0;
    if (!(rate > 0)) return null;
    eta = Math.max(eta, q / rate);
  }
  return Math.ceil(eta);
}

/** The ticker's "Saving: 40 stone (≈ 9 d)": the first good the target still lacks; null when nothing is lacking. */
export function savingReason(s: GameState, v: SimView): Reason | null {
  const sv = savingFor(s, v);
  if (!sv) return null;
  const lack = missing(s, sv.cost);
  const res = RESOURCES.find((r) => (lack[r] ?? 0) > 0);
  if (!res) return null;
  const first = savingParts(s, v)[0];
  const forWhat = first ? first.type ?? first.kind : walkWishes(s, v).pending?.type ?? 'wish';
  const eta = etaDays(s, v, lack);
  const params: Reason['params'] = { qty: Math.ceil(lack[res] ?? 0), res, for: forWhat };
  if (eta !== null) params.eta = eta;
  return { code: 'saving', params };
}
