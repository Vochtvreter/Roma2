// src/game/ordo/labour.ts — how the Ordo staffs, and manual labour targets (ARCHITECTURE §8.4, DESIGN §10.4). Owner: WP-C.
// Eleven steps in order (water → food → [priority] → required services → builders → pending inputs → winter stock →
// tools → oil → services → focus split → leftovers). Within a step: High priority first, then the best output per hand
// this season, then lowest id (Hearthlands' marginal-yield staffing). Each labour line keeps the Reason of the step that
// first staffed its category; later steps may add detail to it (the winter stock to the food line).
import { B as B$ } from '../balance';
import { HOUSE_TIERS as HOUSE_TIERS$, LABOR_CATS as LABOR_CATS$, RESOURCES as RESOURCES$ } from '../types';
import type { Building, BuildingDef, BuildingId, CoverageLayerId, GameState, LaborCat, LabourLine, LabourPlan, NeedId, Reason, ReasonCode, ResId, SimView } from '../types';
import { nextSeasonStart as nextSeasonStart$, seasonLength as seasonLength$, seasonOf as seasonOf$ } from '../calendar';
import { buildingRateOf, maxPotential, seasonMult } from '../economy';
import { settingValue } from '../decisions';
import { getBuilding as getBuilding$ } from '../lookup';
import { dayEpoch as dayEpoch$, memo as memo$ } from '../memo';
import { roadNeighbors as roadNeighbors$ } from '../derived';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from '../data/housing';
import { FOCUS_DEFS as FOCUS_DEFS$ } from '../data/decisions';
import { houseWants, materialNeeds } from './build';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, HOUSE_TIERS = HOUSE_TIERS$, LABOR_CATS = LABOR_CATS$, RESOURCES = RESOURCES$,
  nextSeasonStart = nextSeasonStart$, seasonLength = seasonLength$, seasonOf = seasonOf$, dayEpoch = dayEpoch$,
  memo = memo$, roadNeighbors = roadNeighbors$, BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$,
  FOCUS_DEFS = FOCUS_DEFS$,
  getBuilding = getBuilding$;

/** Works that stop drawing water while the Lex de annona pauses them (DESIGN §8.12 step 2): they get no hands. */
export const WATER_PAUSED: readonly BuildingId[] = ['caementarium', 'balneum', 'thermae'];
const NEED_LAYERS: Partial<Record<NeedId, CoverageLayerId[]>> = {
  water: ['water', 'fountain'], religion: ['shrine', 'temple'], market: ['market', 'macellum'], temple: ['temple'], baths: ['baths'], macellum: ['macellum'],
};
const LEFTOVER: LaborCat[] = ['materials', 'industry', 'services', 'food', 'water'];
const RES_N = RESOURCES.length;
const RES_IDX = Object.fromEntries(RESOURCES.map((r, k) => [r, k])) as Record<ResId, number>;
const MANUAL_ORDER: LaborCat[] = ['water', 'food', 'services', 'builders', 'materials', 'industry'];
const FAR = 1e9;

/** A staffable post; `i` is its place in the day's order (the plan keeps its hands in an array by it). */
interface Post { b: Building; def: BuildingDef; cat: LaborCat; res: ResId | null; rate: number; layers: CoverageLayerId[]; i: number }

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** A Reason with only meaningful params (no empty strings, no non-finite numbers). */
function reason(code: ReasonCode, params: Record<string, number | string | undefined>): Reason {
  const p: Reason['params'] = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && (typeof v === 'string' || Number.isFinite(v))) p[k] = v;
  return { code, params: p };
}

/** Staffable posts — finished, open, not damaged, idled or paused — High priority first, then output per hand, then id. */
function posts(s: GameState): Post[] {
  return memo(s, 'ordo.posts', dayEpoch(s) * 2 + (s.ordo.emergency.waterPause ? 1 : 0), () => {
    const out: Post[] = [];
    const season = seasonOf(s.day);
    for (const b of s.buildings) {
      const def = BUILDING_DEFS[b.type];
      if (b.status !== 'done' || !b.open || def.slots <= 0 || !def.labor) continue;
      if ((b.damagedUntil ?? 0) > s.day || (b.idleUntil ?? 0) > s.day) continue;
      if (s.ordo.emergency.waterPause && WATER_PAUSED.includes(b.type)) continue;
      const res = def.output?.res ?? null;
      const rate = res ? buildingRateOf(s, b, season, 'full', res) / def.slots : 0;   // = fullRate(s, b)[res] / slots
      out.push({ b, def, cat: def.labor, res, rate, layers: (def.service ?? []).map((x) => x.layer), i: 0 });
    }
    out.sort((a, c) => c.b.prio - a.b.prio || c.rate - a.rate || a.b.id - c.b.id);
    for (let i = 0; i < out.length; i++) out[i].i = i;
    return out;
  });
}

/** Coverage layers some house's current tier depends on. */
function requiredLayers(v: SimView): Set<CoverageLayerId> {
  const out = new Set<CoverageLayerId>();
  for (const t of HOUSE_TIERS) {
    if ((v.c.byTier[t] ?? 0) <= 0) continue;
    for (const n of TIER_DEFS[t].needs) for (const l of NEED_LAYERS[n] ?? []) out.add(l);
  }
  return out;
}

/** Sites builders can work today (stakes ending today start this tick), the Capitolium aside. */
function workableSites(s: GameState, v: SimView): Building[] {
  const out: Building[] = [];
  for (const id of v.d.sites) {
    const b = getBuilding(s, id);
    if (!b || b.type === 'capitolium') continue;
    if (b.status === 'building' || (b.status === 'staked' && s.day - b.placed >= B.construction.STAKE_DAYS)) out.push(b);
  }
  return out;
}

/** The plan's hands by building id: every post that took a hand, filled from the highest id down (a record that starts
 *  at a high key keeps sparse elements, not a backing array as long as the highest id). */
function perRecord(all: readonly Post[], hands: Int32Array): Record<number, number> {
  const ids: number[] = [];
  for (const p of all) if (hands[p.i] > 0) ids.push(p.i);
  ids.sort((a, c) => all[c].b.id - all[a].b.id);
  const per: Record<number, number> = {};
  for (const i of ids) per[all[i].b.id] = hands[i];
  return per;
}

/** The Ordo's daily labour plan with a Reason per line (DESIGN §10.4). Pure. */
export function planLabour(s: GameState, v: SimView): LabourPlan {
  const { c, f } = v;
  const W = c.workforce;
  const all = posts(s);
  const season = seasonOf(s.day);
  const focus = s.decisions.focus;
  // hands per post (by its place in the order) and output made per resource (by index), read and written hand by hand;
  // the plan's record by building id is filled once at the end
  const hands = new Int32Array(all.length);
  const made = new Float64Array(RES_N);
  const lines = new Map<LaborCat, { n: number; reason: Reason }>();
  const hungry = Math.max(...s.needs.hunger) > B.ordo.HUNGER_AT;
  let foodCap = Math.floor(W * (hungry ? B.ordo.FOOD_CAP_HUNGRY : B.ordo.FOOD_CAP));
  let free = W, food = 0, builders = 0;

  const note = (cat: LaborCat, n: number, why: Reason): void => {
    const l = lines.get(cat);
    if (l) l.n += n; else lines.set(cat, { n, reason: why });
  };
  /** Up to `n` hands to a post (slots, free hands and the food cap permitting); returns how many. */
  const add = (p: Post, n: number, why: Reason): number => {
    let k = Math.min(n, p.def.slots - hands[p.i], free);
    if (p.res === 'grain') k = Math.min(k, foodCap - food);
    if (k <= 0) return 0;
    hands[p.i] += k;
    free -= k;
    if (p.res === 'grain') food += k;
    if (p.res) made[RES_IDX[p.res]] += p.rate * k;
    note(p.cat, k, why);
    return k;
  };
  /** One hand at a time to the best producer of `res` until its output reaches `goal`; returns hands added. Each post
   *  takes hands while `add(p, 1)` would (its slots, the free hands, the food cap), the output summed hand by hand;
   *  the post's hands are noted once (the same line, reason and count as hand by hand). */
  const toward = (res: ResId, goal: number, why: Reason): number => {
    let n = 0;
    const grain = res === 'grain', ri = RES_IDX[res];
    for (const p of all) {
      if (made[ri] >= goal) break;
      if (p.res !== res || p.rate <= 0) continue;
      const slots = p.def.slots, rate = p.rate;
      let have = hands[p.i], m = made[ri], k = 0;
      while (m < goal && have < slots && free > 0 && (!grain || food < foodCap)) {
        have++; free--; k++;
        if (grain) food++;
        m += rate * 1;
      }
      if (k > 0) {
        hands[p.i] = have;
        made[ri] = m;
        note(p.cat, k, why);
        n += k;
      }
    }
    return n;
  };
  /** Staffs producers of `res` toward `goal`, and the producers of their inputs when those run short. */
  const feed = (res: ResId, goal: number, why: Reason): number => {
    let n = toward(res, goal, why);
    const draw: Partial<Record<ResId, number>> = {};
    for (const p of all) if (p.res === res && hands[p.i]) for (const r of RESOURCES) draw[r] = (draw[r] ?? 0) + (p.def.inputs?.[r] ?? 0) * hands[p.i];
    for (const r of RESOURCES) if ((draw[r] ?? 0) > 0 && s.res[r] < (draw[r] as number) * B.ordo.MATERIALS_ETA) n += toward(r, draw[r] as number, why);
    return n;
  };
  /** Hands do some good here: the output has room in the stores and the inputs are on hand. */
  const useful = (p: Post): boolean => {
    if (p.res && s.res[p.res] >= B.ordo.STORE_FULL * c.caps[p.res]) return false;
    const inp = p.def.inputs;
    return !inp || RESOURCES.every((r) => (inp[r] ?? 0) * (hands[p.i] + 1) <= s.res[r]);
  };
  const fill = (cat: LaborCat, n: number, why: Reason): number => {
    let k = 0;
    for (const p of all) if (p.cat === cat && k < n && useful(p)) k += add(p, n - k, why);
    return k;
  };

  // 1 · water: passive sources count first; wells to need × base, plus what the works draw
  const wr = settingValue(s, 'waterReserve');
  const thirsty = Math.max(...s.needs.thirst) > B.ordo.THIRST_AT;
  const prefill = season === 0 && (f.water.crunch?.lowestDoh ?? FAR) < wr;
  const [wBase, wWhy] = thirsty ? [B.ordo.WATER_THIRST, 'thirst'] : prefill ? [B.ordo.WATER_PREFILL, 'prefill'] : f.water.doh < wr ? [B.ordo.WATER_LOW, 'low'] : [B.ordo.WATER_BASE, ''];
  let draw = 0;
  const WATER = RES_IDX.water;
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (b.status !== 'done' || (s.ordo.emergency.waterPause && WATER_PAUSED.includes(b.type))) continue;
    if (def.passive?.res === 'water') made[WATER] += def.passive.perDay * seasonMult(s, b.type, season);
    const n = c.staffed[b.id] ?? 0;
    draw += (def.inputs?.water ?? 0) * n + (def.waterDraw && (def.slots === 0 || n > 0) ? def.waterDraw : 0);
  }
  const wGoal = c.need.water * wBase + draw;
  const wReason = reason('needWater', { need: r1(c.need.water), goal: r1(wGoal), why: wWhy });
  note('water', 0, wReason);
  for (const p of all) if (p.cat === 'water' && !p.res) add(p, 1, wReason);   // the castellum's keeper
  toward('water', wGoal, wReason);

  // 2 · food: to need × base, one hand at a time to the best field or lodge this season
  const gr = settingValue(s, 'grainReserve');
  const gNeed = c.need.grain;
  let fBase: number = 1, fWhy = '', topup = false;
  if (hungry) [fBase, fWhy] = [B.ordo.FOOD_HUNGRY, 'hungry'];
  else if (season === 3 && f.grain.doh < B.ordo.FOOD_HIEMS_DOH) [fBase, fWhy] = [B.ordo.FOOD_HIEMS, 'hiems'];
  else if (s.res.grain >= B.ordo.STORE_FULL * c.caps.grain) [fBase, fWhy] = [B.ordo.FOOD_FULL, 'full'];
  else if (f.grain.doh < gr) [fBase, topup] = [B.ordo.FOOD_LOW, true];
  const fGoal = gNeed * fBase;
  const fReason = topup
    ? reason('reserveTopup', { doh: Math.floor(f.grain.doh), keep: gr, need: r1(gNeed), goal: r1(fGoal) })
    : reason('needFood', { need: r1(gNeed), goal: r1(fGoal), why: fWhy });
  note('food', 0, fReason);
  toward('grain', fGoal, fReason);

  // priority remedies ("Fields first for 30 days") come directly after step 2
  const sites = workableSites(s, v);
  const capSite = s.buildings.find((b) => b.type === 'capitolium' && b.status === 'building');
  const bCap = Math.max(1, Math.floor(W * B.ordo.BUILDERS_MAX));
  for (const pr of s.ordo.priorities) {
    if (pr.until <= s.day) continue;
    const why = reason('priority', { cat: pr.cat, days: pr.until - s.day });
    if (pr.cat !== 'builders') {
      if (pr.cat === 'food') foodCap = Math.max(foodCap, Math.floor(W * B.ordo.FOOD_CAP_HUNGRY));
      fill(pr.cat, free, why);
    } else if (sites.length > 0 || capSite) {
      const k = Math.max(0, Math.min(bCap - builders, free));
      builders += k; free -= k;
      note('builders', k, why);
    }
  }

  // 3 · required services: every service some house's current tier depends on gets a hand, then half its slots
  const layers = requiredLayers(v);
  const req = all.filter((p) => p.layers.some((l) => layers.has(l)));
  const sReason = reason('requiredService', { n: req.length });
  for (const p of req) add(p, 1, sReason);
  for (const p of req) add(p, Math.ceil(p.def.slots * B.economy.SERVICE_FULL) - hands[p.i], sReason);

  // 4 · builders while a site is workable (plus the Capitolium crew in monument mode), ≤ 30% of the workforce
  if (sites.length > 0 || capSite) {
    const share = settingValue(s, 'builderShare') + (focus === 'materia' ? B.ordo.FOCUS.MATERIA_BUILDERS : 0);
    const remaining = sites.reduce((a, b) => a + b.work * (1 - b.progress), 0);
    const base = sites.length > 0 ? Math.min(Math.max(B.ordo.BUILDERS_MIN, Math.round(W * share)), Math.ceil(remaining)) : 0;
    const want = Math.min(bCap, base + (capSite ? B.construction.CAP_CREW : 0));
    const k = Math.max(0, Math.min(want - builders, free));
    builders += k; free -= k;
    note('builders', k, capSite
      ? reason('monument', { n: builders, crew: Math.max(0, builders - base) })
      : reason('builderShare', { n: builders, sites: sites.length }));
  }

  // 5 · producers of what the saving target, the pending wish, renovations and the Capitolium lack
  const { lack, forOf } = materialNeeds(s, v);
  for (const r of RESOURCES) {
    const q = lack[r] ?? 0;
    if (q <= 0 || r === 'denarii' || r === 'grain' || r === 'water') continue;
    const why = reason('pendingInput', { res: r, qty: Math.ceil(q), for: forOf[r] ?? 'wish' });
    why.params.n = feed(r, q / B.ordo.MATERIALS_ETA, why);
  }

  // 6 · winter stockpile: Autumnus and the last days of Aestas, to need × 1.35 while the store is short
  if (season === 2 || (season === 1 && nextSeasonStart(s.day) - s.day <= B.ordo.WINTER_LEAD)) {
    const gap = (gNeed - maxPotential(s, 'grain', 3)) * seasonLength(nextSeasonStart(s.day, 3));
    const target = Math.min(c.caps.grain, Math.max(gNeed * gr * (focus === 'copia' ? B.ordo.FOCUS.COPIA_WINTER : 1), gap));
    if (s.res.grain < target) {
      const stock = { stock: Math.floor(s.res.grain), target: Math.round(target) };
      toward('grain', gNeed * B.ordo.WINTER_FILL, reason('winterStock', stock));
      Object.assign((lines.get('food') ?? { reason: fReason }).reason.params, stock);
    }
  }

  // 7 · tools while kits are fewer than half the tool-using works
  const users = s.buildings.filter((b) => b.status === 'done' && BUILDING_DEFS[b.type].tool).length + sites.length;
  const kits = B.ordo.TOOLS_PER * users;
  if (s.res.tools < kits) feed('tools', (kits - s.res.tools) / B.ordo.MATERIALS_ETA, reason('tools', { kits: Math.floor(s.res.tools), goal: Math.ceil(kits) }));

  // 8 · olive groves to the great houses' oil × 1.2
  const oil = houseWants(s, v).t4Res * B.housing.GOODS.oil;
  if (oil > 0) toward('oil', oil * B.ordo.LUXURY, reason('luxuryStaff', { demand: r1(oil) }));

  // 9 · the remaining service slots
  const svc = reason('serviceFull', {});
  for (const p of all) if (p.cat === 'services') add(p, p.def.slots, svc);

  // 10 · the rest by the focus weights; 11 · any useful open post; the others idle (forage, help the builders)
  const rest = free;
  const split = FOCUS_DEFS[focus].split;
  const fs = reason('focusSplit', { focus });
  for (const cat of LABOR_CATS) if ((split[cat] ?? 0) > 0 && cat !== 'builders') fill(cat, Math.floor(rest * (split[cat] ?? 0)), fs);
  const left = reason('leftover', {});
  for (const cat of LEFTOVER) fill(cat, free, left);
  left.params.idle = free;

  const out: LabourLine[] = [];
  for (const [cat, l] of lines) out.push({ cat, target: cat === 'builders' ? builders : l.n, have: c.catStaffed[cat], slots: c.catSlots[cat], reason: l.reason });
  return { perBuilding: perRecord(all, hands), builders, lines: out };
}

/** Manual labour: the player's category targets → buildings (prioritised categories first; High first, then nearest the forum). */
export function manualPlan(s: GameState, v: SimView): LabourPlan {
  const { c, d } = v;
  const steps = (b: Building): number => {
    let m = FAR;
    for (const i of roadNeighbors(s, b)) if (d.stepsToForum[i] >= 0) m = Math.min(m, d.stepsToForum[i]);
    return m;
  };
  const all = posts(s).map((p) => ({ p, k: steps(p.b) }))
    .sort((a, b) => b.p.b.prio - a.p.b.prio || a.k - b.k || a.p.b.id - b.p.b.id).map((x) => x.p);
  const order = [...new Set([...s.ordo.priorities.filter((p) => p.until > s.day).map((p) => p.cat), ...MANUAL_ORDER])];
  const per: Record<number, number> = {};
  const lines: LabourLine[] = [];
  let free = c.workforce, builders = 0;
  for (const cat of order) {
    const want = Math.max(0, Math.floor(s.ordo.manual[cat] ?? 0));
    if (want <= 0) continue;
    let got = 0;
    if (cat === 'builders') got = builders = Math.min(want, free);
    else for (const p of all) {
      if (p.cat !== cat || got >= want || free - got <= 0) continue;
      const k = Math.min(p.def.slots, want - got, free - got);
      per[p.b.id] = k;
      got += k;
    }
    free -= got;
    lines.push({ cat, target: got, have: c.catStaffed[cat], slots: c.catSlots[cat], reason: { code: 'priority', params: { cat, n: want, manual: 1 } } });
  }
  return { perBuilding: per, builders, lines };
}
