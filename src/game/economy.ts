// src/game/economy.ts — the one formula module: production, consumption, storage (ARCHITECTURE §8.3, DESIGN §8). Owner: WP-B.
// The tick, the forecast, the Ordo and the tooltips all read these functions. Stocks are floats: nothing here floors.
import { B } from './balance';
import { RESOURCES } from './types';
import type {
  Building, BuildingId, Census, Essential, GameState, MulKey, Person, Quad, Res, ResId, SeasonIndex, SkillId, TickContext,
} from './types';
import type { Rng } from './rng';
import { census, peopleIndex, stageOf } from './census';
import { seasonOf } from './calendar';
import { fx, fxAdd, fxSources } from './fx';
import { emptyRes, log } from './state';
import { censusEpoch, memo, structEpoch } from './memo';
import { siteMult } from './site';
import { gainSkill } from './people';
import { worksQueue } from './construction';
import { edictOption, settingValue } from './decisions';
import { derived, sizeOf, classAt } from './derived';
import { getMap, inBounds, idx, W } from './map';
import { BUILDING_DEFS, TOOL_ORDER } from './data/buildings';
import { RESOURCE_DEFS } from './data/resources';

const E = B.economy;
const HIEMS: SeasonIndex = 3;
const AQUAE_CONCRETE = B.economy.OPERIBUS_CONCRETE;   // Aquae: Operibus prius, concrete ×1.05 (data note 3)
const GROUPS = 4;
const RATION_TIERS: readonly (readonly number[])[] = [[0], [1, 2], [3]];   // children, then youths + adults, then elders
const NEED_KIND = { grain: 0, water: 1 } as const;

// ───────────────────────────── multipliers ─────────────────────────────

/** Grain portion: the Rationes edict, overridden by emergency rations (the lower wins). */
export function portion(s: GameState): number {
  const P = E.PORTIONS as Readonly<Record<string, number>>;
  let p = P[s.decisions.edicts.rationes] ?? E.PORTIONS.plenae;
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

/** Productivity from morale: 0.85 + 0.30 × morale/100. */
export function productivity(s: GameState): number {
  return E.PROD_BASE + (E.PROD_MORALE * s.morale) / 100;
}

/** Legacy output factor: 1 + 0.10 × legacy level + legacy bonus. */
export function legacyMult(s: GameState): number {
  return 1 + E.LEGACY * s.legacy + s.legacyBonus;
}

/** Factor outside the capped product: 0 while idle or damaged, × UNPAID when upkeep is unpaid, × young grove. */
export function activeFactor(s: GameState, b: Building): number {
  if (b.status !== 'done') return 0;
  if ((b.idleUntil ?? 0) > s.day || (b.damagedUntil ?? 0) > s.day) return 0;
  let f = b.unpaid ? E.UNPAID : 1;
  if ((b.youngUntil ?? 0) > s.day) f *= B.site.OLIVE_YOUNG;
  return f;
}

/** Per-call multipliers shared by every building: fx lookups hoisted out of the per-building loops. */
interface Factors { base: number; mul(k: MulKey): number; concrete: number }
// fx() re-validates its cache on every call; its source list is rebuilt (new identity) exactly when any effect changes,
// so values looked up once per source list stay correct. The factors themselves are kept while the sources, the morale,
// the legacy and the Aquae edict stand (buildingRate asks for them once per building, many times a day).
interface FactorCache extends Factors { src: unknown; morale: number; legacy: number; bonus: number; aquae: string }
const factorMemo = new WeakMap<GameState, FactorCache>();

function factors(s: GameState): Factors {
  const src = fxSources(s);
  const aquae = edictOption(s, 'aquae');
  const c = factorMemo.get(s);
  if (c && c.src === src && c.morale === s.morale && c.legacy === s.legacy && c.bonus === s.legacyBonus && c.aquae === aquae) return c;
  const m = c && c.src === src ? (c as FactorCache & { m: Map<MulKey, number> }).m : new Map<MulKey, number>();
  const mul = (k: MulKey): number => {
    let v = m.get(k);
    if (v === undefined) { v = fx(s, k); m.set(k, v); }
    return v;
  };
  const f = { src, morale: s.morale, legacy: s.legacy, bonus: s.legacyBonus, aquae, m, mul,
    base: productivity(s) * mul('labour') * legacyMult(s), concrete: aquae === 'operibus' ? AQUAE_CONCRETE : 1 };
  factorMemo.set(s, f);
  return f;
}

/** The building's part of the capped product: site × tool × productivity × fx(key) × fx(labour) × legacy × bonus. */
function cappedBase(s: GameState, b: Building, f: Factors): number {
  const def = BUILDING_DEFS[b.type];
  let m = siteMult(s, b) * f.base;
  if (def.fxKey) m *= f.mul(def.fxKey);
  if ((b.toolUntil ?? 0) > s.day) m *= E.TOOL_MULT;
  if (b.bonus !== undefined && (b.bonusUntil ?? 0) > s.day) m *= 1 + b.bonus;
  if (b.type === 'caementarium') m *= f.concrete;
  return m;
}

function skillMult(p: Person | null, skill: SkillId | null): number {
  return 1 + B.people.SKILL_BONUS * (p && skill ? p.skills[skill] ?? 0 : 0);
}

function elderMult(s: GameState, p: Person | null): number {
  return p && stageOf(p, s.day) === 3 ? B.people.ELDER_OUT : 1;
}

/** The capped per-worker multiplier: min(MULT_CAP, site × skill × tool × productivity × fx × legacy). */
export function workerMult(s: GameState, b: Building, p: Person): number {
  return Math.min(E.MULT_CAP, cappedBase(s, b, factors(s)) * skillMult(p, BUILDING_DEFS[b.type].skill));
}

/** One worker's output per day at a building in a season (DESIGN §8.1): base × season × elder × unpaid × capped part. */
export function workerOutput(s: GameState, b: Building, p: Person, season: SeasonIndex): number {
  const out = BUILDING_DEFS[b.type].output;
  if (!out) return 0;
  return out.perWorker * seasonMult(s, b.type, season) * activeFactor(s, b) * elderMult(s, p) * workerMult(s, b, p);
}

/** Output of one worker given the building's precomputed parts (null person = an unskilled adult). */
function outputWith(s: GameState, b: Building, p: Person | null, base: number, outside: number): number {
  const def = BUILDING_DEFS[b.type];
  if (!def.output) return 0;
  return def.output.perWorker * outside * elderMult(s, p) * Math.min(E.MULT_CAP, base * skillMult(p, def.skill));
}

/** Passive output per day (cisterna rain, castellum flow): perDay × season × fx(key) × active factor. */
function passiveRate(s: GameState, b: Building, season: SeasonIndex, f: Factors): number {
  const def = BUILDING_DEFS[b.type];
  if (!def.passive) return 0;
  return def.passive.perDay * seasonMult(s, b.type, season) * (def.fxKey ? f.mul(def.fxKey) : 1) * activeFactor(s, b);
}

/** True when a staffed service (or a slotless one) is working today. */
function serviceActive(s: GameState, b: Building): boolean {
  const def = BUILDING_DEFS[b.type];
  if (b.status !== 'done' || activeFactor(s, b) <= 0) return false;
  return def.slots === 0 || (b.open && (peopleIndex(s).byWork.get(b.id)?.length ?? 0) > 0);
}

/** The Lex de annona water pause idles the concrete works and the baths. */
function waterPaused(s: GameState, b: Building): boolean {
  return s.ordo.emergency.waterPause && (b.type === 'caementarium' || BUILDING_DEFS[b.type].waterDraw !== undefined);
}

/** Net resources per day of a building (inputs negative); 'full' = every slot at its current average worker. */
export function buildingRate(s: GameState, b: Building, season: SeasonIndex, mode: 'current' | 'full'): Partial<Res> {
  const out: Partial<Res> = {};
  const def = BUILDING_DEFS[b.type];
  if (b.status !== 'done' || (!def.output && !def.passive && !def.waterDraw)) return out;
  const add = (r: ResId, v: number): void => { if (v !== 0) out[r] = (out[r] ?? 0) + v; };
  const f = factors(s);
  const outside = activeFactor(s, b) * seasonMult(s, b.type, season);
  if (def.output && b.open && !waterPaused(s, b)) {
    const base = cappedBase(s, b, f);
    const workers = peopleIndex(s).byWork.get(b.id) ?? [];
    let total = 0;
    let n = workers.length;
    for (const p of workers) total += outputWith(s, b, p, base, outside);
    if (mode === 'full') {
      const per = n > 0 ? total / n : outputWith(s, b, null, base, outside);
      n = def.slots;
      total = per * n;
    }
    add(def.output.res, total);
    if (def.inputs && outside > 0) for (const r of RESOURCES) add(r, -(def.inputs[r] ?? 0) * n);
  }
  add(def.passive?.res ?? 'water', passiveRate(s, b, season, f));
  if (def.waterDraw && !waterPaused(s, b) && (mode === 'full' || serviceActive(s, b))) add('water', -def.waterDraw);
  return out;
}

interface Producers { slots: { type: BuildingId; id: number; n: number; per: number }[]; passive: { type: BuildingId; per: number }[] }

/** Producers of an essential with their season-free per-worker output (current average worker, else an unskilled one). */
function producers(s: GameState, res: Essential): Producers {
  return memo(s, `producers:${res}`, `${censusEpoch(s)}|${s.day}|${s.morale}`, () => {
    const out: Producers = { slots: [], passive: [] };
    const ix = peopleIndex(s);
    const f = factors(s);
    for (const b of s.buildings) {
      if (b.status !== 'done') continue;
      const def = BUILDING_DEFS[b.type];
      const act = activeFactor(s, b);
      if (def.passive?.res === res) out.passive.push({ type: b.type, per: def.passive.perDay * (def.fxKey ? f.mul(def.fxKey) : 1) * act });
      if (def.output?.res !== res || !b.open || def.slots <= 0 || act <= 0 || waterPaused(s, b)) continue;
      const base = cappedBase(s, b, f);
      const workers = ix.byWork.get(b.id) ?? [];
      let per = 0;
      for (const p of workers) per += outputWith(s, b, p, base, act);
      per = workers.length > 0 ? per / workers.length : outputWith(s, b, null, base, act);
      if (per > 0) out.slots.push({ type: b.type, id: b.id, n: def.slots, per });
    }
    return out;
  });
}

/** Best assignment of the workforce to existing producers of an essential (food cap applied) plus passive output. */
export function maxPotential(s: GameState, res: Essential, season: SeasonIndex): number {
  const c = census(s);
  const table = producers(s, res);
  let workers = res === 'grain' ? Math.floor(c.workforce * B.ordo.FOOD_CAP) : c.workforce;
  let total = 0;
  for (const p of table.passive) total += p.per * seasonMult(s, p.type, season);
  const per = table.slots.map((p) => ({ v: p.per * seasonMult(s, p.type, season), n: p.n, id: p.id }));
  per.sort((a, b) => b.v - a.v || a.id - b.id);
  for (const p of per) {
    if (workers <= 0) break;
    const k = Math.min(workers, p.n);
    total += k * p.v;
    workers -= k;
  }
  return total;
}

// ───────────────────────────── storage caps ─────────────────────────────

/** Storage caps: base sheds plus the storage of every finished building (horrea × fx(horreaCap)). */
export function caps(s: GameState): Res {
  return memo(s, 'caps', `${structEpoch(s)}|${fx(s, 'horreaCap')}`, () => {
    const out = emptyRes();
    for (const r of RESOURCES) out[r] = RESOURCE_DEFS[r].baseCap;
    for (const b of s.buildings) {
      if (b.status !== 'done' || b.type === 'horreum') continue;
      const st = BUILDING_DEFS[b.type].storage;
      if (st) for (const r of RESOURCES) out[r] += st[r] ?? 0;
    }
    out.grain += horreaCap(s);
    return out;
  });
}

/** Grain capacity of finished horrea (safe from rot), × fx(horreaCap). */
export function horreaCap(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) if (b.status === 'done' && b.type === 'horreum') n++;
  return n * (BUILDING_DEFS.horreum.storage?.grain ?? 0) * fx(s, 'horreaCap');
}

// ───────────────────────────── woods (DESIGN §8.7) ─────────────────────────────

interface Woods { catchment: Map<number, number[]>; union: Uint8Array }

/** Forest catchments of finished lumber camps: tiles within CATCHMENT of the footprint, nearest first (memo on structEpoch). */
function woods(s: GameState): Woods {
  return memo(s, 'woods', structEpoch(s), () => {
    const map = getMap(s.seed);
    const der = derived(s);
    const catchment = new Map<number, number[]>();
    const union = new Uint8Array(map.W * map.H);
    const R = E.WOOD.CATCHMENT;
    for (const b of s.buildings) {
      if (b.type !== 'lignarius' || b.status !== 'done') continue;
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      const cand: { i: number; d: number }[] = [];
      for (let y = b.y - R; y < b.y + h + R; y++) {
        for (let x = b.x - R; x < b.x + w + R; x++) {
          if (!inBounds(x, y)) continue;
          const i = idx(x, y);
          if (map.woodMax[i] <= 0 || der.buildingAt[i] !== 0 || der.road[i] > 0) continue;   // felled for works and roads
          const d = Math.max(b.x - x, 0, x - (b.x + w - 1), b.y - y, y - (b.y + h - 1));
          cand.push({ i, d });
          union[i] = 1;
        }
      }
      cand.sort((a, c) => a.d - c.d || a.i - c.i);
      catchment.set(b.id, cand.map((c) => c.i));
    }
    return { catchment, union };
  });
}

function woodOf(s: GameState, i: number, max: number): number {
  const v = s.wood[i];
  return v !== undefined ? v : max;
}

/** Draws up to `want` timber from a camp's catchment: mature tiles (≥ MATURE of max) nearest first, then the rest. */
function drawWood(s: GameState, b: Building, want: number): number {
  const tiles = woods(s).catchment.get(b.id);
  if (!tiles || want <= 0) return 0;
  const max = getMap(s.seed).woodMax;
  let got = 0;
  for (let pass = 0; pass < 2 && got < want; pass++) {
    for (const i of tiles) {
      if (got >= want) break;
      const cur = woodOf(s, i, max[i]);
      if (cur <= 0 || (pass === 0) !== (cur >= max[i] * E.WOOD.MATURE)) continue;
      const take = Math.min(cur, want - got);
      s.wood[i] = cur - take;
      got += take;
    }
  }
  return got;
}

function regrowWoods(s: GameState, season: SeasonIndex): void {
  const map = getMap(s.seed);
  const d = derived(s);
  const { union } = woods(s);
  const seasonF = season === HIEMS ? E.WOOD.HIEMS : 1;
  const replant = E.WOOD.REPLANT * fx(s, 'regrow');
  const standing = (i: number): boolean => map.woodMax[i] > 0 && woodOf(s, i, map.woodMax[i]) >= map.woodMax[i] * E.WOOD.STUMP;
  const tiles = Object.keys(s.wood).map(Number).sort((a, c) => a - c);   // sparse diff: read as numbers, iterate sorted
  for (const i of tiles) {
    const max = map.woodMax[i];
    if (max <= 0) { delete s.wood[i]; continue; }
    if (d.buildingAt[i] !== 0 || d.road[i] > 0) continue;   // felled for a building or a road: no regrowth
    let rate = 0;
    if (union[i]) rate = replant;
    else {
      const x = i % W, y = (i - x) / W;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) if ((dx || dy) && inBounds(x + dx, y + dy) && standing(idx(x + dx, y + dy))) near = true;
      }
      if (near) rate = E.WOOD.NATURAL;
    }
    if (rate <= 0) continue;
    const v = (s.wood[i] ?? max) + rate * seasonF * max;
    if (v >= max) delete s.wood[i];
    else s.wood[i] = v;
  }
}

// ───────────────────────────── the daily economy ─────────────────────────────

type Phase = 'water' | 'food' | 'extract' | 'process';

function phaseOf(b: Building): Phase | null {
  const def = BUILDING_DEFS[b.type];
  if (!def.output) return null;
  if (def.inputs) return 'process';
  if (def.output.res === 'water') return 'water';
  if (def.labor === 'food') return 'food';
  return 'extract';
}

/** Stock industry may draw: start-of-day stock above the reserve floors (Aquae edict decides the water floor). */
function industryPool(s: GameState, start: Res, c: Census, industryWater: number): Res {
  const pool = { ...start };
  pool.grain = Math.max(0, start.grain - settingValue(s, 'grainReserve') * c.need.grain);
  const opt = edictOption(s, 'aquae');
  if (opt === 'populo') pool.water = Math.max(0, start.water - settingValue(s, 'waterReserve') * c.need.water);
  else if (opt === 'aequa' && start.water < industryWater + c.need.water && industryWater > 0) {
    pool.water = (start.water * industryWater) / (industryWater + c.need.water);
  }
  return pool;
}

/** Daily production: water → food → passive → extraction → processing (per-worker reservations against the start-of-day
 *  stock and the reserve floors) → baths → idle forage; skill XP; forest draw; writes rates.prod / rates.cons. */
export function produce(s: GameState, ctx: TickContext, rng: Rng): void {
  void rng;   // production draws no randomness
  const season = seasonOf(s.day);
  const c = census(s);
  const ix = peopleIndex(s);
  const f = factors(s);
  const start: Res = { ...s.res };
  const gain = (r: ResId, src: BuildingId | 'idleForage', v: number): void => {
    if (v <= 0) return;
    s.res[r] += v;
    ctx.rates.prod[r][src] = (ctx.rates.prod[r][src] ?? 0) + v;
  };
  const draw = (r: ResId, src: BuildingId, v: number): void => {
    if (v <= 0) return;
    s.res[r] = Math.max(0, s.res[r] - v);
    ctx.rates.cons[r][src] = (ctx.rates.cons[r][src] ?? 0) + v;
  };
  const phases: Record<Phase, Building[]> = { water: [], food: [], extract: [], process: [] };
  const passive: Building[] = [];
  const baths: Building[] = [];
  let industryWater = 0;
  for (const b of s.buildings) {
    if (b.status !== 'done') continue;
    const def = BUILDING_DEFS[b.type];
    const ph = phaseOf(b);
    if (ph) phases[ph].push(b);
    if (def.passive) passive.push(b);
    if (def.waterDraw && serviceActive(s, b) && !waterPaused(s, b)) { baths.push(b); industryWater += def.waterDraw; }
    if (ph === 'process' && !waterPaused(s, b)) industryWater += (def.inputs?.water ?? 0) * (ix.byWork.get(b.id)?.length ?? 0);
  }

  const worked = (b: Building, p: Person, frac: number): void => {
    const sk = BUILDING_DEFS[b.type].skill;
    if (sk && frac > 0) gainSkill(p, sk, B.people.SKILL_XP * frac);
  };
  const runStaffed = (b: Building, perWorkerFrac: (p: Person) => number): number => {
    const workers = b.open ? ix.byWork.get(b.id) ?? [] : [];
    const outside = activeFactor(s, b) * seasonMult(s, b.type, season);
    if (workers.length === 0 || outside <= 0 || waterPaused(s, b)) return 0;
    const base = cappedBase(s, b, f);
    let total = 0;
    for (const p of workers) {
      const frac = perWorkerFrac(p);
      if (frac <= 0) continue;
      total += frac * outputWith(s, b, p, base, outside);
      worked(b, p, frac);
    }
    return total;
  };

  for (const ph of ['water', 'food'] as const) {
    for (const b of phases[ph]) gain(BUILDING_DEFS[b.type].output!.res, b.type, runStaffed(b, () => 1));
  }
  for (const b of passive) gain(BUILDING_DEFS[b.type].passive!.res, b.type, passiveRate(s, b, season, f));
  for (const b of phases.extract) {
    const out = BUILDING_DEFS[b.type].output!;
    let v = runStaffed(b, () => 1);
    if (b.type === 'lignarius') v = drawWood(s, b, v);
    gain(out.res, b.type, v);
  }
  // processing: each worker reserves its inputs against the start-of-day pool (fractional when short)
  const pool = industryPool(s, start, c, industryWater);
  for (const b of phases.process) {
    const def = BUILDING_DEFS[b.type];
    const inputs = def.inputs ?? {};
    const v = runStaffed(b, () => {
      let frac = 1;
      for (const r of RESOURCES) { const k = inputs[r] ?? 0; if (k > 0) frac = Math.min(frac, pool[r] / k); }
      frac = Math.max(0, frac);
      for (const r of RESOURCES) {
        const k = (inputs[r] ?? 0) * frac;
        if (k > 0) { pool[r] -= k; draw(r, b.type, k); }
      }
      return frac;
    });
    gain(def.output!.res, b.type, v);
    if (def.output!.res === 'iron') s.counters.ironMade += v;
    if (def.output!.res === 'tiles') s.counters.tilesMade += v;
  }
  for (const b of baths) {
    const want = BUILDING_DEFS[b.type].waterDraw ?? 0;
    const take = Math.min(want, Math.max(0, pool.water), s.res.water);
    pool.water -= take;
    if (take > 0) {
      s.res.water -= take;
      ctx.rates.cons.water.baths = (ctx.rates.cons.water.baths ?? 0) + take;
    }
  }
  gain('grain', 'idleForage', c.idle.length * E.IDLE_FORAGE);
}

// ───────────────────────────── consumption (DESIGN §8.4–8.5) ─────────────────────────────

/** Today's ration ratio per stage group (1 = full), written by consume and read later in the same tick. */
export interface Rations { day: number; grain: Quad; water: Quad }
const rations = new WeakMap<GameState, Rations>();

/** The ration ratios of the last consume() on this state (full rations before the first tick). */
export function lastRations(s: GameState): Rations {
  return rations.get(s) ?? { day: s.day, grain: [1, 1, 1, 1], water: [1, 1, 1, 1] };
}

/** Population-weighted mean ration ratio of an essential today. */
export function meanRation(s: GameState, res: Essential): number {
  const c = census(s);
  const q = lastRations(s)[res];
  const need = c.groupNeed[res];
  let num = 0, den = 0;
  for (let g = 0; g < GROUPS; g++) { num += need[g] * q[g]; den += need[g]; }
  return den > 0 ? num / den : 1;
}

/** Hunger/thirst band 0..3 (Sated, Peckish, Hungry, Starving). */
export function needBand(v: number): number {
  const b = B.needs.BAND;
  return v <= b[0] ? 0 : v <= b[1] ? 1 : v <= b[2] ? 2 : 3;
}

const GROUP_NAMES = ['the children', 'the youths', 'the adults', 'the elders'];
const BAND_NAMES = [['sated', 'peckish', 'hungry', 'starving'], ['hydrated', 'thirsty', 'parched', 'dehydrated']];

/** Eating and drinking: tiered rationing (children → youths and adults → elders), hunger/thirst per group, fed EMA. */
export function consume(s: GameState, ctx: TickContext): void {
  const c = census(s);
  const N = B.needs;
  const out: Rations = { day: s.day, grain: [1, 1, 1, 1], water: [1, 1, 1, 1] };
  for (const res of ['grain', 'water'] as const) {
    const need = c.groupNeed[res];
    const r = out[res];
    let stock = Math.max(0, s.res[res]);
    for (const tier of RATION_TIERS) {
      let t = 0;
      for (const g of tier) t += need[g];
      if (t <= 0) continue;
      const share = Math.min(1, stock / t);
      for (const g of tier) r[g] = share;
      stock -= t * share;
    }
    const used = Math.max(0, s.res[res]) - stock;
    s.res[res] = Math.max(0, stock);
    if (used > 0) ctx.rates.cons[res][res === 'grain' ? 'eating' : 'drinking'] = used;
    const k = NEED_KIND[res];
    const q = res === 'grain' ? s.needs.hunger : s.needs.thirst;
    for (let g = 0; g < GROUPS; g++) {
      const ratio = r[g];
      const delta = ratio >= 1 ? N.FULL[k] : ratio >= N.HIGH_R ? N.HIGH[k] : ratio >= N.HOLD ? 0 : N.WORSEN[k] * (1 - ratio / N.HOLD);
      const before = needBand(q[g]);
      q[g] = Math.min(100, Math.max(0, q[g] + delta));
      const after = needBand(q[g]);
      if (after > before && after >= 2 && c.byStage[g] > 0) {
        log(s, 'bad', `Watch: ${GROUP_NAMES[g]} are ${BAND_NAMES[k][after]}.`, after >= 3 ? ['highlight'] : undefined);
      }
    }
    if (res === 'grain') {
      let num = 0, den = 0;
      for (let g = 0; g < GROUPS; g++) { num += need[g] * r[g]; den += need[g]; }
      s.fed += N.FED_ALPHA * ((den > 0 ? num / den : 1) - s.fed);
    }
  }
  rations.set(s, out);
}

// ───────────────────────────── storage (DESIGN §8.6) ─────────────────────────────

function spillLogged(s: GameState, text: string): boolean {
  for (let k = s.log.length - 1; k >= 0; k--) {
    const e = s.log[k];
    if (e.day <= s.day - E.SPILL_LOG_DAYS) return false;
    if (e.text === text) return true;
  }
  return false;
}

/** Storage step: spill above caps, shed rot (×2 Aestas), evaporation in Aestas, forest regrowth. */
export function storage(s: GameState, ctx: TickContext): void {
  const cap = caps(s);
  const season = seasonOf(s.day);
  for (const r of RESOURCES) {
    if (!(s.res[r] > 0)) s.res[r] = 0;
    if (s.res[r] > cap[r]) {
      const spill = s.res[r] - cap[r];
      s.res[r] = cap[r];
      ctx.rates.cons[r].spill = (ctx.rates.cons[r].spill ?? 0) + spill;
      const text = `The stores are full: ${RESOURCE_DEFS[r].name.toLowerCase()} spills to waste.`;
      if (!spillLogged(s, text)) log(s, 'info', text);
    }
  }
  const shed = Math.max(0, s.res.grain - horreaCap(s));
  const rot = shed * E.SHED_ROT * E.ROT_SEASON[season];
  if (rot > 0) {
    s.res.grain -= rot;
    ctx.rates.cons.grain.rot = (ctx.rates.cons.grain.rot ?? 0) + rot;
  }
  const evap = s.res.water * E.EVAPORATION * E.EVAP_SEASON[season];
  if (evap > 0) {
    s.res.water -= evap;
    ctx.rates.cons.water.evaporation = (ctx.rates.cons.water.evaporation ?? 0) + evap;
  }
  regrowWoods(s, season);
}

// ───────────────────────────── tool kits (DESIGN §5.3) ─────────────────────────────

/** Issues one tool kit per eligible building without an active kit: construction sites first, then TOOL_ORDER. */
export function issueTools(s: GameState, ctx: TickContext): void {
  if (s.res.tools < 1) return;
  const days = Math.round(E.TOOL_DAYS * fx(s, 'toolDays'));
  const ix = peopleIndex(s);
  const give = (b: Building, src: BuildingId | 'construction'): boolean => {
    if (s.res.tools < 1) return false;
    s.res.tools -= 1;
    b.toolUntil = s.day + days;
    ctx.rates.cons.tools[src] = (ctx.rates.cons.tools[src] ?? 0) + 1;
    return true;
  };
  for (const b of worksQueue(s)) {
    if (b.status !== 'building' || (b.toolUntil ?? 0) > s.day) continue;
    if (!give(b, 'construction')) return;
  }
  for (const type of TOOL_ORDER) {
    for (const b of s.buildings) {
      if (b.type !== type || b.status !== 'done' || (b.toolUntil ?? 0) > s.day) continue;
      if ((ix.byWork.get(b.id)?.length ?? 0) === 0) continue;
      if (!give(b, b.type)) return;
    }
  }
}
