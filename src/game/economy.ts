// src/game/economy.ts — the one formula module: production, consumption, storage (ARCHITECTURE §8.3, DESIGN §8). Owner: WP-B.
// SCAFFOLD: output = perWorker × staffed × season (workerMult = 1); need = Σ stage NEED; caps = base + storage;
// one ration ratio for every group (no tiered rationing); spill above caps; no rot, evaporation, woods or tools.
import { B } from './balance';
import { RESOURCES } from './types';
import type { Building, BuildingId, Census, Essential, GameState, Person, Res, ResId, SeasonIndex, TickContext } from './types';
import type { Rng } from './rng';
import { census } from './census';
import { seasonOf } from './calendar';
import { fx, fxAdd } from './fx';
import { emptyRes } from './state';
import { BUILDING_DEFS } from './data/buildings';
import { RESOURCE_DEFS } from './data/resources';

const HIEMS: SeasonIndex = 3;

/** Grain portion: the Rationes edict, overridden by emergency rations (the lower wins). */
export function portion(s: GameState): number {
  const P = B.economy.PORTIONS as Readonly<Record<string, number>>;
  let p = P[s.decisions.edicts.rationes] ?? B.economy.PORTIONS.plenae;
  const em = s.ordo.emergency.rations;
  if (em !== 'none') p = Math.min(p, P[em]);
  return p;
}

/** Daily need of an essential at current portions (from the census). */
export function needPerDay(s: GameState, res: Essential, c?: Census): number {
  return (c ?? census(s)).need[res];
}

/** Season multiplier of a building type: data seasons, plus hiemsFields for the ager in Hiems. */
export function seasonMult(s: GameState, type: BuildingId, season: SeasonIndex): number {
  const q = BUILDING_DEFS[type].seasons;
  let m = q ? q[season] : 1;
  if (type === 'ager' && season === HIEMS) m += fxAdd(s, 'hiemsFields');
  return m;
}

/** The capped per-worker multiplier: min(MULT_CAP, site × skill × tool × productivity × fx × legacy). */
export function workerMult(s: GameState, b: Building, p: Person): number {
  // STUB(WP-B): DESIGN §8.1 (site, skill, tools, productivity, fx(key), legacy) capped at B.economy.MULT_CAP.
  void s; void b; void p;
  return 1;
}

/** One worker's output per day at a building in a season (DESIGN §8.1). */
export function workerOutput(s: GameState, b: Building, p: Person, season: SeasonIndex): number {
  const out = BUILDING_DEFS[b.type].output;
  if (!out) return 0;
  // STUB(WP-B): elder ×0.7 and unpaid ×0.5 factors.
  return out.perWorker * seasonMult(s, b.type, season) * workerMult(s, b, p);
}

/** Net resources per day of a building (inputs negative); 'full' = every slot staffed. */
export function buildingRate(s: GameState, b: Building, season: SeasonIndex, mode: 'current' | 'full'): Partial<Res> {
  const out: Partial<Res> = {};
  if (b.status !== 'done') return out;
  const def = BUILDING_DEFS[b.type];
  const n = mode === 'full' ? def.slots : (census(s).staffed[b.id] ?? 0);
  const sm = seasonMult(s, b.type, season);
  const add = (r: ResId, v: number): void => { out[r] = (out[r] ?? 0) + v; };
  if (def.output && n > 0) {
    add(def.output.res, def.output.perWorker * sm * n);
    if (def.inputs) for (const r of RESOURCES) { const k = def.inputs[r]; if (k) add(r, -k * n); }
  }
  if (def.passive) add(def.passive.res, def.passive.perDay * sm);
  if (def.waterDraw && (def.slots === 0 || n > 0)) add('water', -def.waterDraw);
  return out;
}

/** Best assignment of the workforce to existing producers of an essential (food cap applied) plus passive output. */
export function maxPotential(s: GameState, res: Essential, season: SeasonIndex): number {
  const c = census(s);
  let workers = res === 'grain' ? Math.floor(c.workforce * B.ordo.FOOD_CAP) : c.workforce;
  let total = 0;
  const per: { v: number; n: number }[] = [];
  for (const b of s.buildings) {
    if (b.status !== 'done') continue;
    const def = BUILDING_DEFS[b.type];
    const sm = seasonMult(s, b.type, season);
    if (def.output?.res === res && b.open) per.push({ v: def.output.perWorker * sm, n: def.slots });
    if (def.passive?.res === res) total += def.passive.perDay * sm;
  }
  per.sort((a, b) => b.v - a.v);
  for (const p of per) {
    const k = Math.min(workers, p.n);
    total += k * p.v;
    workers -= k;
    if (workers <= 0) break;
  }
  return total;
}

/** Storage caps: base sheds plus the storage of every finished building (horrea × fx(horreaCap)). */
export function caps(s: GameState): Res {
  const out = emptyRes();
  for (const r of RESOURCES) out[r] = RESOURCE_DEFS[r].baseCap;
  for (const b of s.buildings) {
    if (b.status !== 'done' || b.type === 'horreum') continue;
    const st = BUILDING_DEFS[b.type].storage;
    if (st) for (const r of RESOURCES) out[r] += st[r] ?? 0;
  }
  out.grain += horreaCap(s);
  return out;
}

/** Grain capacity of finished horrea (safe from rot), × fx(horreaCap). */
export function horreaCap(s: GameState): number {
  let cap = 0;
  for (const b of s.buildings) if (b.status === 'done' && b.type === 'horreum') cap += BUILDING_DEFS.horreum.storage?.grain ?? 0;
  return cap * fx(s, 'horreaCap');
}

/** Daily production: passive, staffed producers (processing reserves inputs per worker), idle forage; writes rates.prod. */
export function produce(s: GameState, ctx: TickContext, rng: Rng): void {
  // STUB(WP-B): water → food → passive → processing order, the water/grain floors, skill XP and forest draw (rng).
  void rng;
  const season = seasonOf(s.day);
  const c = census(s);
  const gain = (r: ResId, src: BuildingId | 'idleForage', v: number): void => {
    if (v <= 0) return;
    s.res[r] += v;
    ctx.rates.prod[r][src] = (ctx.rates.prod[r][src] ?? 0) + v;
  };
  for (const b of s.buildings) {
    if (b.status !== 'done') continue;
    const def = BUILDING_DEFS[b.type];
    const sm = seasonMult(s, b.type, season);
    if (def.passive) gain(def.passive.res, b.type, def.passive.perDay * sm);
    if (!def.output) continue;
    const staffed = c.staffed[b.id] ?? 0;
    let n = 0;
    const inputs = def.inputs;
    for (; n < staffed; n++) {
      if (!inputs) continue;
      if (RESOURCES.some((r) => (inputs[r] ?? 0) > s.res[r])) break;
      for (const r of RESOURCES) {
        const k = inputs[r];
        if (!k) continue;
        s.res[r] -= k;
        ctx.rates.cons[r][b.type] = (ctx.rates.cons[r][b.type] ?? 0) + k;
      }
    }
    gain(def.output.res, b.type, def.output.perWorker * sm * n);
  }
  gain('grain', 'idleForage', c.idle.length * B.economy.IDLE_FORAGE);
}

/** Eating and drinking with hunger/thirst per group and the fed EMA; writes rates.cons. */
export function consume(s: GameState, ctx: TickContext): void {
  // STUB(WP-B): tiered rationing (children first), Watch-band log lines.
  const c = census(s);
  const N = B.needs;
  for (const res of ['grain', 'water'] as const) {
    const need = c.need[res];
    const used = Math.max(0, Math.min(s.res[res], need));
    s.res[res] -= used;
    if (used > 0) ctx.rates.cons[res][res === 'grain' ? 'eating' : 'drinking'] = used;
    const r = need > 0 ? used / need : 1;
    const k = res === 'grain' ? 0 : 1;
    const delta = r >= 1 ? N.FULL[k] : r >= N.HIGH_R ? N.HIGH[k] : r >= N.HOLD ? 0 : N.WORSEN[k] * (1 - r / N.HOLD);
    const q = res === 'grain' ? s.needs.hunger : s.needs.thirst;
    for (let g = 0; g < q.length; g++) q[g] = Math.min(100, Math.max(0, q[g] + delta));
    if (res === 'grain') s.fed += N.FED_ALPHA * (r - s.fed);
  }
}

/** Storage step: spill above caps (STUB: no shed rot, evaporation or forest regrowth). */
export function storage(s: GameState, ctx: TickContext): void {
  const cap = caps(s);
  for (const r of RESOURCES) {
    if (s.res[r] < 0) s.res[r] = 0;
    if (s.res[r] > cap[r]) {
      const spill = s.res[r] - cap[r];
      s.res[r] = cap[r];
      ctx.rates.cons[r].spill = (ctx.rates.cons[r].spill ?? 0) + spill;
    }
  }
  // STUB(WP-B): shed rot (×2 Aestas), evaporation in Aestas, forest regrowth.
}

/** Issues tool kits to eligible buildings without an active kit. */
export function issueTools(s: GameState, ctx: TickContext): void {
  // STUB(WP-B): one kit per eligible building (sites first, then TOOL_ORDER), +20% for TOOL_DAYS.
  void s; void ctx;
}
