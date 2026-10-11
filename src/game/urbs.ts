// src/game/urbs.ts — the growing town (DESIGN §3.9). Owner: urbs.
// A frontier colony did not keep the plan it was founded on. Its people wore the roads they walked into highways (the
// monthly footfall census); it outgrew its camp, walled the whole town in stone and razed the castrum's rampart, so the
// old camp became the inner city and its wall line new house plots; and its council renewed a quarter now and then (a
// well the fountains had made needless filled in, a block of cottages bought out for the temple the homes waited for,
// its families rehoused). Everything here is deterministic and keyed on the state alone, like the rest of the sim.
import { B } from './balance';
import { F, RESOURCES, T } from './types';
import type { ActionResult, Building, BuildingId, Cost, GameState, NeedId, Person, Reason, ResId, SimView, TickContext } from './types';
import { getMap, idx } from './map';
import { classAt, derived, footprintOf, sizeOf } from './derived';
import { WALL_RING, isActiveBlock, isRazed } from './survey';
import { invalidate, pushActionFx, touchPeople } from './memo';
import { log } from './state';
import { getBuilding } from './lookup';
import { houseBeds, peopleIndex } from './census';
import { houseDesir, houseHas, previewCovered, previewDesir } from './coverage';
import { rehouseGroups } from './people';
import { savingFor, treasuryFloor } from './ordo/saving';
import { settingValue } from './decisions';
import { granted, walkMask } from './ordo/duties';
import { placeName } from './advisors/util';
import { view } from './sim';
import { TIER_DEFS } from './data/housing';
import { BUILDING_DEFS } from './data/buildings';
import { feminine } from './data/names';
import { GH, GN, GW, sideTiles } from './world/grid';

const U = B.urbs;
const TR = U.TRAFFIC;
const M = U.MOENIA;
const EPS = 1e-9;

// ───────────────────────────── footfall ─────────────────────────────

/** Footfall of a road tile: walkers a day, the monthly average of the census. */
export function footfall(s: GameState, i: number): number {
  return s.urbs.traffic[i] ?? 0;
}

/** How worn a road is by its footfall: 0 a grassy track, 1 a track, 2 a road, 3 a highway (B.urbs.TRAFFIC.WEAR). */
export function wearOf(v: number): 0 | 1 | 2 | 3 {
  const w = TR.WEAR;
  return v < w[0] ? 0 : v < w[1] ? 1 : v < w[2] ? 2 : 3;
}

/** Road tiles beside a work's footprint. */
function roadSides(s: GameState, b: Building, road: Uint8Array): number[] {
  const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
  return sideTiles(b.x, b.y, w, h).filter((i) => road[i] > 0);
}

// Scratch for the census's breadth-first walks (reused; a stamp marks the tiles each walk reached).
const stamp = new Int32Array(GN);
const dist = new Int32Array(GN);
const prev = new Int32Array(GN);
const queue = new Int32Array(GN);
let gen = 0;

/** The month's footfall census (on the Kalends): every worker walks from home to work along the roads (the shortest
 *  way), every household runs its errands to the forum, and carts come and go on the via. Each road tile keeps the
 *  monthly average of the walkers it carried (ALPHA of this month's count). */
export function countFootfall(s: GameState): void {
  const d = derived(s), road = d.road;
  const flow = new Float64Array(GN);
  const ix = peopleIndex(s);
  const sides = new Map<number, number[]>();
  const sidesOf = (b: Building): number[] => {
    let out = sides.get(b.id);
    if (!out) { out = roadSides(s, b, road); sides.set(b.id, out); }
    return out;
  };
  // commutes: one walk outward from each staffed work, then each of its workers follows it back from home
  for (const b of s.buildings) {
    const workers = ix.byWork.get(b.id);
    if (!workers || workers.length === 0) continue;
    const src = roadSides(s, b, road);
    if (src.length === 0) continue;
    const g = ++gen;
    let head = 0, tail = 0;
    for (const t of src) if (stamp[t] !== g) { stamp[t] = g; dist[t] = 0; prev[t] = -1; queue[tail++] = t; }
    while (head < tail) {
      const i = queue[head++];
      const nd = dist[i] + 1;
      if (nd > TR.MAX_STEPS) continue;
      const x = i % GW;
      const visit = (j: number): void => {
        if (road[j] === 0 || stamp[j] === g) return;
        stamp[j] = g; dist[j] = nd; prev[j] = i; queue[tail++] = j;
      };
      if (i >= GW) visit(i - GW);
      if (x < GW - 1) visit(i + 1);
      if (i < GN - GW) visit(i + GW);
      if (x > 0) visit(i - 1);
    }
    for (const p of workers) {
      const h = p.home !== null ? getBuilding(s, p.home) : undefined;
      if (!h) continue;
      let best = -1;
      for (const t of sidesOf(h)) if (stamp[t] === g && (best < 0 || dist[t] < dist[best] || (dist[t] === dist[best] && t < best))) best = t;
      for (let t = best; t >= 0; t = prev[t]) flow[t] += 1;
    }
  }
  // errands: each household down the roads to the forum (its steps fall by one each tile)
  const steps = d.stepsToForum;
  for (const id of d.houses) {
    const n = ix.byHome.get(id)?.length ?? 0;
    const h = n > 0 ? getBuilding(s, id) : undefined;
    if (!h) continue;
    let t = -1;
    for (const x of sidesOf(h)) if (steps[x] >= 0 && (t < 0 || steps[x] < steps[t] || (steps[x] === steps[t] && x < t))) t = x;
    const add = n * TR.FORUM;
    while (t >= 0) {
      flow[t] += add;
      if (steps[t] <= 0) break;
      const want = steps[t] - 1, x = t % GW;
      t = t >= GW && steps[t - GW] === want ? t - GW : x < GW - 1 && steps[t + 1] === want ? t + 1
        : t < GN - GW && steps[t + GW] === want ? t + GW : x > 0 && steps[t - 1] === want ? t - 1 : -1;
    }
  }
  // carts on the via, more as Rome's roads bring more trade
  const carts = TR.VIA[0] + TR.VIA[1] * s.rank;
  for (const i of getMap(s.seed).survey.via) if (road[i] > 0) flow[i] += carts;
  // the monthly average
  const old = s.urbs.traffic;
  const keys = new Set<number>();
  for (const k of Object.keys(old)) keys.add(Number(k));
  for (let i = 0; i < GN; i++) if (flow[i] > 0) keys.add(i);
  const out: Record<number, number> = {};
  for (const i of [...keys].sort((a, c) => a - c)) {
    if (road[i] === 0) continue;
    const v = Math.round(((old[i] ?? 0) * (1 - TR.ALPHA) + flow[i] * TR.ALPHA) * 100) / 100;
    if (v >= TR.MIN) out[i] = v;
  }
  s.urbs.traffic = out;
}

/** Dirt streets of the pomerium by footfall, busiest first (ties: nearer the forum, then the lowest tile). */
export function busiestDirt(s: GameState, n: number): number[] {
  const d = derived(s);
  return s.roads.filter((i) => d.road[i] === 1 && d.pomerium[i] === 1 && d.stepsToForum[i] >= 0)
    .sort((a, b) => footfall(s, b) - footfall(s, a) || d.stepsToForum[a] - d.stepsToForum[b] || a - b).slice(0, n);
}

// ───────────────────────────── the town wall ─────────────────────────────

/** Homes inside the camp (ring 0) and beyond its walls (rings 1–2). */
export function homesInOut(s: GameState): { inner: number; outer: number } {
  const sv = getMap(s.seed).survey;
  let inner = 0, outer = 0;
  for (const id of derived(s).houses) {
    const b = getBuilding(s, id);
    const bid = b ? sv.blockAt[idx(b.x, b.y)] : -1;
    if (bid < 0) continue;
    const ring = sv.blocks[bid].ring;
    if (ring === 0) inner++;
    else if (ring === 1 || ring === 2) outer++;
  }
  return { inner, outer };
}

/** Whether the Ordo walls the town (DESIGN §3.9): a Colonia (Rome's charter brings a colony its walls) whose homes
 *  beyond the camp's walls outnumber the camp's by B.urbs.MOENIA.OUTER, and no town wall yet. The player may lay one
 *  out earlier, from Municipium. */
export function moeniaDue(s: GameState): boolean {
  if (s.urbs.moenia !== null || s.rank < M.ORDO_RANK) return false;
  const { inner, outer } = homesInOut(s);
  return outer >= M.OUTER * Math.max(1, inner);
}

/** Diamond angle of (dx, dy) in [0, 4): a monotone stand-in for atan2 in exact arithmetic (no transcendental). */
function diamond(dx: number, dy: number): number {
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy || 1) : 1 - dx / (-dx + dy);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}

/** The town wall's line (DESIGN §3.9): the ring of tiles around the pomerium, B.urbs.MOENIA.LINE tiles out from the
 *  castrum interior (one past the outer ring's street), that goes round every work standing on it (a farm on the line
 *  is taken inside), round sacred ground and along the roads that run beside it, so that a road meets the wall only
 *  where it crosses it: there the wall has a gate. River and crag need no wall, nor the aqueduct's arches. A postern
 *  stands where the castrum's edge lines and its axes meet the wall, so every side of the town has a way out. Tiles in
 *  building order: from the Porta Praetoria round the town. */
export function surveyLine(s: GameState): { tiles: number[]; gates: number[] } | null {
  const map = getMap(s.seed), sv = map.survey, d = derived(s);
  const I = sv.interior, L = M.LINE;
  const inside = new Uint8Array(GN);
  for (let y = Math.max(0, I.y - L + 1); y <= Math.min(GH - 1, I.y + I.h + L - 2); y++)
    for (let x = Math.max(0, I.x - L + 1); x <= Math.min(GW - 1, I.x + I.w + L - 2); x++) inside[y * GW + x] = 1;
  const ringOf = (): { list: number[]; on: Uint8Array } => {
    const on = new Uint8Array(GN);
    const list: number[] = [];
    for (let i = 0; i < GN; i++) {
      if (inside[i]) continue;
      const x = i % GW, y = (i - x) / GW;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < GW && ny < GH && inside[ny * GW + nx]) near = true;
      }
      if (near) { on[i] = 1; list.push(i); }
    }
    return { list, on };
  };
  // land the wall would close in (between the town and a work taken inside) is inside: only the outer edge is walled
  const fillHoles = (): void => {
    const out = new Uint8Array(GN);
    const q: number[] = [];
    for (let i = 0; i < GN; i++) {
      const x = i % GW, y = (i - x) / GW;
      if ((x === 0 || y === 0 || x === GW - 1 || y === GH - 1) && !inside[i]) { out[i] = 1; q.push(i); }
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % GW;
      const go = (j: number): void => { if (!inside[j] && !out[j]) { out[j] = 1; q.push(j); } };
      if (i >= GW) go(i - GW);
      if (x < GW - 1) go(i + 1);
      if (i < GN - GW) go(i + GW);
      if (x > 0) go(i - 1);
    }
    for (let i = 0; i < GN; i++) if (!out[i]) inside[i] = 1;
  };
  const n4 = (i: number, pred: (j: number) => boolean): boolean => {
    const x = i % GW;
    return (i >= GW && pred(i - GW)) || (x < GW - 1 && pred(i + 1)) || (i < GN - GW && pred(i + GW)) || (x > 0 && pred(i - 1));
  };
  for (let pass = 0; pass < M.PASSES; pass++) {
    fillHoles();
    const { list, on } = ringOf();
    let changed = false;
    for (const i of list) {
      if (inside[i]) continue;
      const id = d.buildingAt[i];
      const f = map.feature[i];
      if (id !== 0) {
        const b = getBuilding(s, id);
        for (const t of b ? footprintOf(b, s) : [i]) if (!inside[t]) { inside[t] = 1; changed = true; }
      } else if (f === F.lucus || f === F.ruins || f === F.fons) {
        inside[i] = 1; changed = true;
      } else if (d.road[i] > 0) {
        const fromIn = n4(i, (j) => inside[j] === 1 && d.road[j] > 0);
        const toOut = n4(i, (j) => inside[j] === 0 && on[j] === 0 && d.road[j] > 0);
        if (!(fromIn && toOut)) { inside[i] = 1; changed = true; }   // runs along the line or ends on it: the wall goes round
      }
    }
    if (!changed) break;
  }
  fillHoles();
  const { list } = ringOf();
  const wallable = (i: number): boolean => map.terrain[i] !== T.river && map.terrain[i] !== T.crag && d.reservedTile[i] !== 1;
  const tiles = list.filter(wallable);
  if (tiles.length < 4 * L) return null;
  const set = new Set(tiles);
  const gates = new Set<number>(tiles.filter((i) => d.road[i] > 0));
  // posterns: the first wall tile outward from the pomerium on the castrum's edge lines and axes
  const scan = (x: number, y: number, dx: number, dy: number): void => {
    for (; x >= 0 && y >= 0 && x < GW && y < GH; x += dx, y += dy) {
      const i = y * GW + x;
      if (inside[i]) continue;
      if (set.has(i)) gates.add(i);
      return;
    }
  };
  for (const x of [I.x, I.x + (I.w - 1) / 2, I.x + I.w - 1]) { scan(x, I.y, 0, -1); scan(x, I.y + I.h - 1, 0, 1); }
  for (const y of [I.y, I.y + (I.h - 1) / 2, I.y + I.h - 1]) { scan(I.x, y, -1, 0); scan(I.x + I.w - 1, y, 1, 0); }
  // building order: from the via's side, sweeping round
  const cx = I.x + (I.w - 1) / 2, cy = I.y + (I.h - 1) / 2;
  const a0 = sv.viaDir === 'E' ? 0 : 2;
  const at = (i: number): number => (diamond(i % GW - cx, Math.floor(i / GW) - cy) - a0 + 4) % 4;
  tiles.sort((p, q) => at(p) - at(q) || p - q);
  return { tiles, gates: [...gates].sort((p, q) => p - q) };
}

/** Surveys the town wall (DESIGN §3.9): the line is laid and kept, and the builders take it up with what work they spare.
 *  The Ordo does it once the town has outgrown its camp (moeniaDue); the player may from Municipium. */
export function surveyWalls(s: GameState, by: 'player' | 'ordo', fx?: (e: { kind: 'walls'; stage: 'surveyed' }) => void): ActionResult {
  if (s.urbs.moenia) return { ok: false, code: 'chosen', reason: 'The town wall is already laid out.' };
  if (s.rank < M.RANK) return { ok: false, code: 'locked', reason: 'Rome lets a Municipium wall the whole town.' };
  if (by === 'ordo' && !moeniaDue(s)) return { ok: false, code: 'notReady', reason: 'The town has not yet outgrown its camp.' };
  const line = surveyLine(s);
  if (!line) return { ok: false, code: 'invalid', reason: 'The groma finds no line for a wall.' };
  s.urbs.moenia = { tiles: line.tiles, gates: line.gates, surveyed: s.day, work: line.tiles.length * M.WORK, progress: 0, matUsed: {}, done: null };
  const who = by === 'ordo' ? 'The Ordo has the groma lay out' : 'You have the groma lay out';
  log(s, by === 'ordo' ? 'ordo' : 'build', `${who} a town wall round the whole town: ${line.tiles.length} paces of stone and ${line.gates.length} gates. `
    + 'The builders raise it with the work they spare; when it stands, the old camp\'s rampart comes down.', ['highlight']);
  (fx ?? pushActionFx)({ kind: 'walls', stage: 'surveyed' });
  invalidate(s);
  return { ok: true };
}

/** The player lays out the town wall (from Municipium; the Ordo waits until the town has outgrown its camp). */
export function commissionWalls(s: GameState): ActionResult {
  return surveyWalls(s, 'player');
}

/** The town wall in hand (surveyed, not finished) and its stone and coin there to raise it a day: the labour plan
 *  staffs its crew only then (a wall waiting for stone keeps no idle builders). */
export function wallsRising(s: GameState): boolean {
  const mo = s.urbs.moenia;
  if (mo === null || mo.done !== null) return false;
  const keep = savingFor(s, view(s))?.cost ?? {};
  const per = perWork();
  for (const r of RESOURCES) {
    const k = per[r] ?? 0;
    if (k > 0 && s.res[r] - (keep[r] ?? 0) - (r === 'denarii' ? treasuryFloor(s) : 0) < k * M.CREW) return false;
  }
  return true;
}

/** Stone and coin per unit of the wall's work. */
function perWork(): Partial<Record<ResId, number>> {
  const out: Partial<Record<ResId, number>> = {};
  for (const r of Object.keys(M.MAT) as ResId[]) out[r] = (M.MAT[r as keyof typeof M.MAT] ?? 0) / M.WORK;
  return out;
}

/** The day's work on the town wall (constructionDay, after the works queue and before the Capitolium): at most CREW
 *  builders' worth of the work they spare, as far as the stone and coin above the Ordo's saving target (and coin above
 *  the treasury floor) allow. Returns the work it took; finishing the wall razes the castrum. */
export function wallsDay(s: GameState, ctx: TickContext, spare: number, perBuilder: number): number {
  const mo = s.urbs.moenia;
  if (!mo || mo.done !== null || !(spare > EPS)) return 0;
  let work = Math.min(spare, M.CREW * Math.max(perBuilder, B.economy.IDLE_BUILD), mo.work * (1 - mo.progress));
  const per = perWork();
  const keep = savingFor(s, view(s))?.cost ?? {};
  for (const r of RESOURCES) {
    const k = per[r] ?? 0;
    if (k <= 0) continue;
    const avail = Math.max(0, s.res[r] - (keep[r] ?? 0) - (r === 'denarii' ? treasuryFloor(s) : 0));
    work = Math.min(work, avail / k);
  }
  if (!(work > EPS)) return 0;
  const used: Cost = mo.matUsed;
  for (const r of RESOURCES) {
    const k = work * (per[r] ?? 0);
    if (k <= 0) continue;
    s.res[r] = Math.max(0, s.res[r] - k);
    used[r] = (used[r] ?? 0) + k;
    ctx.rates.cons[r].construction = (ctx.rates.cons[r].construction ?? 0) + k;
  }
  mo.progress = Math.min(1, mo.progress + work / mo.work);
  if (mo.progress >= 1 - EPS) finishWalls(s, ctx);
  return work;
}

/** The wall is finished and the castrum razed: its rampart torn down (salvage to the stores), its ditch filled, and the
 *  pitch lines across them laid as streets, so the inner city opens on the outer one at every survey line; the old wall
 *  line becomes 24 blocks of house plots (ring 3 joins the pomerium). */
function finishWalls(s: GameState, ctx: TickContext): void {
  const mo = s.urbs.moenia;
  if (!mo) return;
  mo.progress = 1;
  mo.done = s.day;
  const sv = getMap(s.seed).survey;
  let wall = 0;
  for (let i = 0; i < GN; i++) if (sv.wall[i] === 1) wall++;
  const stone = s.rank >= 2;
  const salvage = wall * M.SALVAGE;
  if (stone) s.res.stone += salvage; else s.res.timber += salvage;
  s.urbs.razed = s.day;
  const d = derived(s);
  const lines: number[] = [];
  for (let i = 0; i < GN; i++) if (sv.street[i] === 1 && sv.streetRing[i] === WALL_RING && d.road[i] === 0 && d.buildingAt[i] === 0) lines.push(i);
  s.roads = [...new Set([...s.roads, ...lines])].sort((a, c) => a - c);
  ctx.fx.push({ kind: 'walls', stage: 'raised' });
  log(s, 'build', `The town wall stands: ${mo.tiles.length} paces of stone and ${mo.gates.length} gates ring the whole town. The old camp's `
    + `${stone ? 'murus' : 'vallum'} is torn down (${Math.round(salvage)} ${stone ? 'stone' : 'timber'} salvaged) and its fossa filled: the camp `
    + 'becomes the inner city, its wall line new house plots, and streets cross where the ditch was.', ['highlight']);
  invalidate(s);
}

/** Holds a work duty, or governs every duty today (away, with Govern while away on). */
function holds(s: GameState, d: 'water' | 'services' | 'plan'): boolean {
  return walkMask(s) === 'all' || granted(s, d);
}

// ───────────────────────────── renewal ─────────────────────────────

/** A well the fountains have made needless (DESIGN §3.9): every home it waters a fountain reaches, and no home beside it
 *  would fall within WELL_MARGIN of its tier's desirability for want of it. */
export function wellNeedless(s: GameState, b: Building): boolean {
  for (const p of previewCovered(s, 'puteus', b.x, b.y)) for (const id of p.houses) if (!houseHas(s, id, 'fountain')) return false;
  const delta = new Map<number, number>();
  for (const e of previewDesir(s, 'puteus', b.x, b.y)) delta.set(e.tile, e.v);
  if (delta.size === 0) return true;
  const at = derived(s).buildingAt;
  const seen = new Set<number>([b.id]);
  for (const tile of delta.keys()) {
    const id = at[tile];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const h = getBuilding(s, id);
    if (!h?.house) continue;
    const min = TIER_DEFS[h.house.renovating?.to ?? h.house.tier].desirMin;
    if (min === null) continue;
    const fp = footprintOf(h, s);
    let lose = 0;
    for (const i of fp) lose += delta.get(i) ?? 0;
    if (houseDesir(s, id) - lose / Math.max(1, fp.length) < min + U.RENEW.WELL_MARGIN) return false;
  }
  return true;
}

/** On the Kalends, once the aqueduct flows and water is plentiful all year: the Ordo fills in one old well on a house plot
 *  that the fountains have made needless (its own or the founders', never the player's, nor one it raised for the water
 *  supply in a drought or before Aestas), freeing the plot for a home. */
function renewWells(s: GameState, ctx: TickContext, v: SimView): void {
  if (!v.d.castellumActive || !holds(s, 'water')) return;
  const reserve = settingValue(s, 'waterReserve'), crunch = v.f.water.crunch;
  if (v.f.water.doh < reserve || (crunch && crunch.lowestDoh < reserve)) return;   // not while water is, or will be, short
  for (const b of s.buildings) {
    if (b.type !== 'puteus' || b.status !== 'done' || b.owner === 'player') continue;
    if (s.day - (b.doneDay ?? b.placed) < U.RENEW.WELL_AGE) continue;
    if (b.reason?.code === 'aestasWater' || b.reason?.code === 'survivalWater') continue;   // raised for the supply, not the street
    if (classAt(s, 'puteus', b.x, b.y) !== 'plot' || !wellNeedless(s, b)) continue;
    const place = placeName(s, idx(b.x, b.y));
    const tiles = footprintOf(b, s);
    for (const p of peopleIndex(s).byWork.get(b.id) ?? []) p.work = null;
    s.buildings = s.buildings.filter((x) => x.id !== b.id);
    s.urbs.renewed = s.day;
    log(s, 'ordo', `The Ordo fills in the old well ${place}: the fountains water that street now, and the plot is free for a home.`, undefined);
    ctx.fx.push({ kind: 'renewed', tiles });
    invalidate(s);
    touchPeople(s);
    return;
  }
}

/** The coverage layers that answer a block service's need. */
const BLOCK_LAYER: Partial<Record<NeedId, string>> = { temple: 'temple', baths: 'baths', macellum: 'macellum' };

/** A block of humble cottages the Ordo could buy out for a block service no free block can bring to the houses waiting
 *  for it (DESIGN §3.9): an active block, not kept by the player, whose plots hold only the Ordo's or the founders' homes
 *  of tier ≤ COTTAGE_LEVEL (none renovating) and nothing else, from which the service would reach at least EVOLVE_MIN_BLOCK
 *  of the waiting houses, and whose families the colony's other homes can take (SPARE beds kept). The most houses
 *  reached, then the fewest souls moved, then the lowest tile. Null when none, or within GAP days of the last renewal. */
export function cottageBlock(s: GameState, type: BuildingId, need: NeedId, waiting: readonly number[], skip?: (blockId: number) => boolean):
  { block: number; tile: number; houses: number[]; souls: number; reach: number } | null {
  const layer = BLOCK_LAYER[need];
  if (!layer || !BUILDING_DEFS[type].place.includes('block') || s.day - s.urbs.renewed < U.RENEW.GAP || waiting.length === 0) return null;
  const sv = getMap(s.seed).survey, d = derived(s), ix = peopleIndex(s);
  const razed = isRazed(s);
  const want = new Set(waiting);
  let freeBeds = 0;
  for (const id of d.houses) { const b = getBuilding(s, id); if (b) freeBeds += Math.max(0, houseBeds(s, b) - (ix.byHome.get(id)?.length ?? 0)); }
  let best: { block: number; tile: number; houses: number[]; souls: number; reach: number } | null = null;
  for (const blk of sv.blocks) {
    if (!isActiveBlock(sv, blk, s.rank, razed) || s.ordo.reserved.includes(blk.id) || skip?.(blk.id)) continue;
    const ids = new Set<number>();
    let ok = true;
    for (let y = blk.y; ok && y < blk.y + 4; y++) for (let x = blk.x; x < blk.x + 4; x++) {
      const i = idx(x, y), id = d.buildingAt[i];
      if (d.reservedTile[i]) { ok = false; break; }
      if (!id) continue;
      const b = getBuilding(s, id);
      const h = b?.house;
      if (!b || !h || b.type !== 'area' || b.status !== 'done' || b.owner === 'player' || h.renovating || TIER_DEFS[h.tier].level > U.RENEW.COTTAGE_LEVEL) { ok = false; break; }
      ids.add(id);
    }
    if (!ok || ids.size === 0) continue;
    let souls = 0, beds = 0;
    for (const id of ids) {
      const b = getBuilding(s, id) as Building;
      const n = ix.byHome.get(id)?.length ?? 0;
      souls += n;
      beds += Math.max(0, houseBeds(s, b) - n);
    }
    if (freeBeds - beds < souls + U.RENEW.SPARE) continue;
    let reach = 0;
    for (const p of previewCovered(s, type, blk.x, blk.y)) if (p.layer === layer) for (const h of p.houses) if (want.has(h) && !ids.has(h)) reach++;
    if (reach < B.ordo.EVOLVE_MIN_BLOCK) continue;
    const tile = idx(blk.x, blk.y);
    if (!best || reach > best.reach || (reach === best.reach && (souls < best.souls || (souls === best.souls && tile < best.tile)))) {
      best = { block: blk.id, tile, houses: [...ids].sort((a, c) => a - c), souls, reach };
    }
  }
  return best;
}

/** Buys out the cottages of a block (cottageBlock): their families are rehoused in the colony's other homes, household by
 *  household, and the plots cleared for the work the Ordo raises there. False (nothing changed) when a cottage is gone or
 *  changed since the block was chosen, or the beds are no longer there. */
export function buyOut(s: GameState, houseIds: readonly number[], forType: BuildingId, fx?: (e: { kind: 'renewed'; tiles: number[] }) => void): boolean {
  const houses = houseIds.map((id) => getBuilding(s, id));
  if (houses.some((b) => !b?.house || b.owner === 'player' || TIER_DEFS[b.house.tier].level > U.RENEW.COTTAGE_LEVEL || b.house.renovating)) return false;
  const ix = peopleIndex(s);
  const movers: Person[] = [];
  for (const id of houseIds) movers.push(...(ix.byHome.get(id) ?? []));
  let free = 0;
  const gone = new Set(houseIds);
  for (const id of derived(s).houses) {
    if (gone.has(id)) continue;
    const b = getBuilding(s, id);
    if (b) free += Math.max(0, houseBeds(s, b) - (ix.byHome.get(id)?.length ?? 0));
  }
  if (free < movers.length) return false;
  const byFam = new Map<number, Person[]>();
  for (const p of movers) { const g = byFam.get(p.family); if (g) g.push(p); else byFam.set(p.family, [p]); }
  const gentes = [...new Set([...byFam.keys()].sort((a, c) => a - c).map((f) => s.families.find((x) => x.id === f)?.gens).filter((g): g is string => !!g))];
  const humble = (houses as Building[]).every((b) => TIER_DEFS[(b.house as NonNullable<Building['house']>).tier].level <= 1);
  const tiles: number[] = [];
  for (const b of houses as Building[]) tiles.push(...footprintOf(b, s));
  const first = houses[0] as Building;
  const place = placeName(s, idx(first.x, first.y));
  for (const p of movers) { p.home = null; p.homelessSince = s.day; }
  for (const f of s.families) if (f.home !== null && gone.has(f.home)) f.home = null;
  s.buildings = s.buildings.filter((b) => !gone.has(b.id));
  invalidate(s);
  touchPeople(s);
  rehouseGroups(s, [...byFam.keys()].sort((a, c) => a - c).map((f) => byFam.get(f) as Person[]));
  s.urbs.renewed = s.day;
  const names = gentes.length === 0 ? 'their families' : gentes.length === 1 ? `the gens ${feminine(gentes[0])}`
    : gentes.length <= 3 ? `the ${gentes.slice(0, -1).map(feminine).join(', ')} and ${feminine(gentes[gentes.length - 1])} families`
    : `${byFam.size} families`;
  const n = houseIds.length, what = humble ? (n === 1 ? 'cottage' : 'cottages') : (n === 1 ? 'home' : 'homes');
  log(s, 'ordo', `To make room for ${/^[aeiou]/i.test(BUILDING_DEFS[forType].name) ? 'an' : 'a'} ${BUILDING_DEFS[forType].name.toLowerCase()} ${place}, `
    + `the Ordo buys out ${n} ${what} and rehouses ${names} (${movers.length} souls) in the town's other homes.`);
  (fx ?? pushActionFx)({ kind: 'renewed', tiles });
  return true;
}

// ───────────────────────────── the day ─────────────────────────────

/** The growing town's day (sim step 5, after the homes): on the Kalends the footfall census and a well the fountains made
 *  needless; on the Ordo's build days, a town wall once the town has outgrown its camp (the plan duty). */
export function urbsDay(s: GameState, ctx: TickContext, v: SimView, kalends: boolean): void {
  if (kalends) {
    countFootfall(s);
    renewWells(s, ctx, v);
  }
  if (s.day % B.ordo.BUILD_EVERY === 0 && holds(s, 'plan') && moeniaDue(s)) surveyWalls(s, 'ordo', (e) => ctx.fx.push(e));
}

/** The reason a renewal wish names (ordo/build.ts). */
export function renewalReason(type: BuildingId, need: NeedId, waiting: number, cottages: number, reach: number): Reason {
  return { code: 'renewal', params: { type, n: waiting, want: need, cottages, reach } };
}
