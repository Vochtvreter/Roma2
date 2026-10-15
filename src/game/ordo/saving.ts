// src/game/ordo/saving.ts — the saving target, reservations and the spending rule (ARCHITECTURE §8.4, DESIGN §10.5, §7.2). Owner: WP-C.
// Saving target = petition fee (once its other requirements are met) + player plans + pin + requests + the pending wish.
// Every Ordo spend except survival draws only on stock above it (and keeps the treasury floor); renovations and
// export contracts read the same reservation, so saving never deadlocks building or renovation.
import { B as B$ } from '../balance';
import { PATH_DECISIONS as PATH_DECISIONS$, RESOURCES as RESOURCES$, SETTINGS as SETTINGS$ } from '../types';
import type { Building, BuildingId, Cost, GameState, Reason, ResId, SimView } from '../types';
import { addCost, canAfford, missing, scaleCost } from '../state';
import { petitionNeeds, settingValue } from '../decisions';
import { capitoliumFlow } from '../construction';
import { dayEpoch as dayEpoch$, memo as memo$, structEpoch as structEpoch$ } from '../memo';
import { seasonOf as seasonOf$ } from '../calendar';
import { buildingRate } from '../economy';
import { fx as fx$ } from '../fx';
import { placementCost } from '../place';
import { walkWishes } from './build';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, RESOURCES = RESOURCES$, PATH_DECISIONS = PATH_DECISIONS$, SETTINGS = SETTINGS$, dayEpoch = dayEpoch$,
  memo = memo$, structEpoch = structEpoch$, seasonOf = seasonOf$, fx = fx$;

/** The player's orders as the council's memos read them, and a version for each reading: `parts` turns when the pin, a
 *  request or a path changes (what the saving parts read), `walk` when any of those or the focus or a setting does (what
 *  the wish walk reads). Field-by-field compares instead of serialising the orders at every read; the versions come
 *  from one counter, so they are unique across states. */
interface Orders { pin: BuildingId | null; reqs: { type: BuildingId; day: number; house?: number }[]; paths: (string | undefined)[];
  focus: string; settings: number[]; parts: number; walk: number }
const orders = new WeakMap<GameState, Orders>();
let ordersCounter = 0;

/** The current versions of the player's orders on `s` (see Orders). */
export function ordersOf(s: GameState): Orders {
  let o = orders.get(s);
  if (!o) {
    o = { pin: null, reqs: [], paths: [], focus: '', settings: [], parts: ++ordersCounter, walk: ++ordersCounter };
    orders.set(s, o);
    copyOrders(o, s);
    return o;
  }
  const d = s.decisions, rq = s.ordo.requests;
  let parts = o.pin === s.ordo.pin && o.reqs.length === rq.length;
  for (let i = 0; parts && i < rq.length; i++) parts = o.reqs[i].type === rq[i].type && o.reqs[i].day === rq[i].day && o.reqs[i].house === rq[i].house;
  for (let i = 0; parts && i < PATH_DECISIONS.length; i++) parts = o.paths[i] === d.paths[PATH_DECISIONS[i]];
  let walk = parts && o.focus === d.focus;
  for (let i = 0; walk && i < SETTINGS.length; i++) walk = o.settings[i] === d.settings[SETTINGS[i]];
  if (walk) return o;
  if (!parts) o.parts = ++ordersCounter;
  o.walk = ++ordersCounter;
  copyOrders(o, s);
  return o;
}

function copyOrders(o: Orders, s: GameState): void {
  const d = s.decisions;
  o.pin = s.ordo.pin;
  o.reqs = s.ordo.requests.map((r) => ({ type: r.type, day: r.day, house: r.house }));
  o.paths = PATH_DECISIONS.map((p) => d.paths[p]);
  o.focus = d.focus;
  o.settings = SETTINGS.map((k) => d.settings[k]);
}

/** What a saving part is for, in priority order. */
export type SavingKind = 'petition' | 'plan' | 'pin' | 'request' | 'wish';
/** One player-ordered part of the saving target; `req` is the request it stands for. */
export interface SavingPart { kind: SavingKind; cost: Cost; type?: BuildingId; req?: GameState['ordo']['requests'][number] }

/** A work's cost as the Ordo budgets it: the registry cost (castellum: plus its route), with the path discounts. */
export function workCost(s: GameState, type: BuildingId, routeLen = 0): Cost {
  return placementCost(s, type, routeLen);
}

/** The player-ordered parts of the saving target in priority order: petition fee, plans, pin, requests. Set at the
 *  council's sitting like the wish walk (memo on day, structure epoch and the player's orders). */
export function savingParts(s: GameState, v: SimView): SavingPart[] {
  const key = `${s.day}|${structEpoch(s)}|${ordersOf(s).parts}`;
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

/** What the saving target keeps a good back for: the work of its first part that costs some ('petition' for the fee),
 *  else the wish it saves for; null when none does. The Capitolium's words name it (construction.capitoliumFlow). */
export function savingHolds(s: GameState, v: SimView, r: ResId): BuildingId | 'petition' | null {
  const part = savingParts(s, v).find((p) => (p.cost[r] ?? 0) > 0);
  if (part) return part.type ?? 'petition';
  if (walking) return null;   // asked from inside the wish walk, as savingFor: no wish is saved for yet
  walking = true;
  try {
    const w = walkWishes(s, v).pending;
    return w && (w.cost[r] ?? 0) > 0 ? w.type : null;
  } finally { walking = false; }
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

/** One building's net rate per day with every slot filled (memo on day and epochs): the labour posts and outputRates
 *  read the same figure, so it is computed once per building and key. */
export function fullRate(s: GameState, b: Building): Partial<Record<ResId, number>> {
  const cache = memo(s, 'ordo.full', dayEpoch(s), () => new Map<number, Partial<Record<ResId, number>>>());
  let r = cache.get(b.id);
  if (!r) { r = buildingRate(s, b, seasonOf(s.day), 'full'); cache.set(b.id, r); }
  return r;
}

/** Net output per day of every good from finished buildings (inputs subtracted), at today's staffing or with every slot filled. */
export function outputRates(s: GameState, mode: 'current' | 'full'): Partial<Record<ResId, number>> {
  return memo(s, `ordo.rates.${mode}`, dayEpoch(s), () => {
    const out: Partial<Record<ResId, number>> = {};
    const season = seasonOf(s.day);
    for (const b of s.buildings) {
      const r = mode === 'full' ? fullRate(s, b) : buildingRate(s, b, season, mode);
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
