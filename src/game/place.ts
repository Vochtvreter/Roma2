// src/game/place.ts — the placement pipeline, roads, paving, reserved blocks, demolition (ARCHITECTURE §8.2). Owner: WP-A.
// SCAFFOLD: canPlace runs checks 1–10 of the §8.2 table (site rules, auto-roads and the aqueduct route are STUBs);
// placeBuilding pays and creates the site (plan / staked / building) with mult 1; no felling, no auto-road.
import { B } from './balance';
import { F, RESOURCES, T } from './types';
import type { ActionResult, Building, BuildingId, Cost, GameState, Owner, PlaceCheck, PlaceClass, PlaceFail, PlaceOpts } from './types';
import { getMap, H, W, idx, inBounds, tx, ty } from './map';
import { activeRings, blockStreets, halfOrigin, isActiveBlock, plotOrigin } from './survey';
import { blockOfTile, classAt, derived, sizeOf } from './derived';
import { invalidate, memo, structEpoch, touchPeople } from './memo';
import { canAfford, getBuilding, log, missing, nextId, pay, refund } from './state';
import { cancelSite } from './construction';
import { BUILDING_DEFS } from './data/buildings';
import { RANK_DEFS } from './data/ranks';
import { RESOURCE_DEFS } from './data/resources';

const URBAN: readonly PlaceClass[] = ['plot', 'half', 'block'];
const PLOT = B.map.PLOT;

function fail(code: PlaceFail, reason: string): PlaceCheck {
  return { ok: false, code, reason };
}

function rectTiles(x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let ty0 = y; ty0 < y + h; ty0++) for (let tx0 = x; tx0 < x + w; tx0++) out.push(idx(tx0, ty0));
  return out;
}

function inCastrum(s: GameState, i: number): boolean {
  const c = getMap(s.seed).survey.castrum;
  const x = tx(i), y = ty(i);
  return x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h;
}

/** Name of the first rank whose pomerium includes a ring. */
function rankForRing(ring: number): string {
  return (RANK_DEFS.find((r) => r.rings.includes(ring)) ?? RANK_DEFS[RANK_DEFS.length - 1]).name;
}

/** Snaps a hovered tile to the origin of the slot a type would take there (urban: plot/half/block; rural: the tile itself). */
export function snapSlot(s: GameState, type: BuildingId, tile: number): { x: number; y: number } | null {
  if (tile < 0 || tile >= W * H) return null;
  const x = tx(tile), y = ty(tile);
  const cls = classAt(s, type, x, y);
  if (cls === 'fixed') return null;
  if (cls === 'rural') return { x, y };
  const blk = blockOfTile(s, tile);
  if (!blk) return null;
  if (cls === 'block') return { x: blk.x, y: blk.y };
  const py = y - blk.y >= PLOT ? 1 : 0;
  const px = x - blk.x >= PLOT ? 1 : 0;
  if (cls === 'half') return halfOrigin(blk, py);
  return plotOrigin(blk, (py * 2 + px) as 0 | 1 | 2 | 3);
}

/** Validates a placement (ARCHITECTURE §8.2 table, first failure wins) and prices it. */
export function canPlace(s: GameState, type: BuildingId, tile: number, opts?: PlaceOpts): PlaceCheck {
  const def = BUILDING_DEFS[type];
  const owner = opts?.owner ?? 'player';
  const replace = opts?.replaceId ?? 0;
  const map = getMap(s.seed);
  const sv = map.survey;
  const d = derived(s);
  // 1 · on the map
  if (tile < 0 || tile >= W * H) return fail('offMap', 'Beyond the surveyed land.');
  const slot = snapSlot(s, type, tile);
  const cls = classAt(s, type, tx(tile), ty(tile));
  const [w, h] = sizeOf(type, cls);
  if (slot && (!inBounds(slot.x, slot.y) || !inBounds(slot.x + w - 1, slot.y + h - 1))) return fail('offMap', 'Beyond the surveyed land.');
  // 2 · rank
  if (def.rank > s.rank) return fail('rankLocked', `Rome grants this to a ${RANK_DEFS[def.rank].name}.`);
  // 3 · max count
  const replaced = replace ? getBuilding(s, replace) : undefined;
  const have = (d.all[type] ?? 0) - (replaced?.type === type ? 1 : 0);
  if (def.maxCount !== undefined && have >= def.maxCount) return fail('maxCount', `Only ${def.maxCount} may be raised.`);
  // 4 · fixed works
  if (cls === 'fixed') return fail('reserved', 'Reserved by the groma.');
  const free = (i: number): boolean => d.buildingAt[i] === 0 || d.buildingAt[i] === replace;
  if (URBAN.includes(cls)) {
    // 5 · urban slot in an active block
    if (!slot) return sv.wall[tile] || sv.fossa[tile] ? fail('castrum', 'The walls and ditch stay clear.') : fail('notOnSlot', 'Choose a surveyed plot.');
    const blk = blockOfTile(s, idx(slot.x, slot.y));
    if (!blk) return fail('notOnSlot', 'Choose a surveyed plot.');
    if (!activeRings(s.rank).includes(blk.ring)) return fail('notInPomerium', `Outside the pomerium: become a ${rankForRing(blk.ring)} to survey these blocks.`);
    if (blk.masked) return fail('terrain', 'The surveyors left this block to the fields.');
    // 6 · not forum/capitolium, plots free
    if (blk.reserved) return fail('reserved', 'Reserved by the groma.');
    if (rectTiles(slot.x, slot.y, w, h).some((i) => !free(i))) return fail('occupied', 'That plot is taken.');
  } else {
    if (!slot) return fail('offMap', 'Beyond the surveyed land.');
    const fp = rectTiles(slot.x, slot.y, w, h);
    // 7 · rural land
    if (fp.some((i) => !d.territory[i])) return fail('outsideTerritory', 'Too far for our people to walk each day.');
    if (fp.some((i) => inCastrum(s, i))) return fail('castrum', 'Inside the castrum only surveyed plots.');
    if (fp.some((i) => sv.street[i] === 1)) return fail('street', 'The survey keeps this line for a street.');
    if (fp.some((i) => d.road[i] > 0)) return fail('road', 'A road runs here.');
    if (fp.some((i) => d.pomerium[i] === 1)) return fail('notInPomerium', 'Inside the pomerium only urban works.');
    if (fp.some((i) => d.reservedTile[i] === 1)) return fail('reserved', 'Reserved for the aqueduct.');
    // 8 · the Ordo keeps future rings clear
    const futureBlock = (i: number): boolean => {
      const b = sv.blockAt[i] >= 0 ? sv.blocks[sv.blockAt[i]] : null;
      return b !== null && !b.masked && b.reserved === null && !isActiveBlock(sv, b, s.rank);
    };
    if (owner === 'ordo' && fp.some(futureBlock)) return fail('futureRing', 'Surveyed for the canabae.');
    // 9 · terrain
    if (fp.some((i) => map.terrain[i] === T.river)) return fail('water', 'The river.');
    if (fp.some((i) => map.terrain[i] === T.crag)) return fail('crag', 'Too steep to build.');
    if (fp.some((i) => map.feature[i] === F.lucus || map.feature[i] === F.ruins)) return fail('sacred', 'Sacred ground: the gods would not forgive it.');
    const digger = type === 'lapicidina' || type === 'fodina';
    if (!digger && fp.some((i) => map.feature[i] === F.ore)) return fail('terrain', 'An iron vein: keep it for a mine.');
    if (!digger && fp.some((i) => map.terrain[i] === T.rock)) return fail('terrain', 'Too rocky to build.');
    // 10 · free
    if (fp.some((i) => !free(i))) return fail('occupied', 'Something already stands here.');
    // 11 · site rule — STUB(WP-A): DESIGN §5.1 site rules (fertile, woods, rocky, clay, ore, via, castellum, fons)
    // 12 · auto-road — STUB(WP-A): roadPathFor must find a road (noRoad)
  }
  const at = slot as { x: number; y: number };
  const cost: Cost = { ...def.cost };
  const out: PlaceCheck = { ok: true, x: at.x, y: at.y, mult: 1, notes: [], fell: 0, cost, work: def.work };
  if (!opts?.ignoreCost && !canAfford(s, cost)) {
    const short = missing(s, cost);
    const r = RESOURCES.find((k) => (short[k] ?? 0) > 0);
    if (r) out.warn = `Need ${Math.ceil(short[r] ?? 0)} more ${RESOURCE_DEFS[r].name.toLowerCase()}.`;
  }
  return out;
}

/** Every valid origin tile of a type for an owner → site multiplier (memo on type + owner + structEpoch). */
export function validSlots(s: GameState, type: BuildingId, owner: Owner): Map<number, number> {
  return memo(s, `validSlots:${type}:${owner}`, structEpoch(s), () => {
    const out = new Map<number, number>();
    const def = BUILDING_DEFS[type];
    const sv = getMap(s.seed).survey;
    const urban = def.place.find((c) => URBAN.includes(c));
    const tryAt = (tile: number): void => {
      const chk = canPlace(s, type, tile, { owner, ignoreCost: true });
      if (chk.ok) out.set(idx(chk.x, chk.y), chk.mult);
    };
    if (urban) {
      for (const blk of sv.blocks) {
        if (!isActiveBlock(sv, blk, s.rank)) continue;
        if (urban === 'block') tryAt(idx(blk.x, blk.y));
        else if (urban === 'half') for (const k of [0, 1] as const) { const o = halfOrigin(blk, k); tryAt(idx(o.x, o.y)); }
        else for (const k of [0, 1, 2, 3] as const) { const o = plotOrigin(blk, k); tryAt(idx(o.x, o.y)); }
      }
    }
    if (def.place.includes('rural')) {
      const d = derived(s);
      for (let i = 0; i < W * H; i++) if (d.territory[i] && classAt(s, type, tx(i), ty(i)) === 'rural') tryAt(i);
    }
    return out;
  });
}

/** Places a building: validates, pays (or plans), creates the site, logs, invalidates (ARCHITECTURE §8.2). */
export function placeBuilding(s: GameState, type: BuildingId, tile: number, opts?: PlaceOpts): ActionResult {
  const owner = opts?.owner ?? 'player';
  const chk = canPlace(s, type, tile, opts);
  if (!chk.ok) return { ok: false, code: chk.code, reason: chk.reason };
  const affordable = opts?.ignoreCost === true || canAfford(s, chk.cost);
  if (!affordable && owner === 'ordo') return { ok: false, code: 'unaffordable', reason: 'The treasury cannot cover it.' };
  if (opts?.replaceId) {
    const old = getBuilding(s, opts.replaceId);
    if (old && old.owner === 'ordo' && old.status === 'staked') {
      refund(s, BUILDING_DEFS[old.type].cost, 1);   // STUB(WP-A): refund the stake's actual paid cost (route, fx)
      s.buildings = s.buildings.filter((b) => b.id !== old.id);
    }
  }
  if (affordable && !opts?.ignoreCost) pay(s, chk.cost);
  const id = nextId(s);
  const status: Building['status'] = !affordable ? 'plan' : owner === 'ordo' && !opts?.noStake ? 'staked' : 'building';
  const b: Building = {
    id, type, x: chk.x, y: chk.y, owner, status, placed: s.day, progress: 0, work: chk.work,
    paid: affordable, order: id, open: true, prio: 1,
  };
  if (opts?.reason) b.reason = opts.reason;
  if (chk.notes.length > 0) b.notes = chk.notes;
  if (chk.route) b.route = chk.route;
  s.buildings.push(b);
  // STUB(WP-A): felling under rural footprints, streets (urban) and the auto-road (rural).
  const name = BUILDING_DEFS[type].name;
  if (owner === 'ordo') log(s, 'ordo', `The Ordo stakes out a ${name.toLowerCase()}.`, undefined, id);
  else if (status === 'plan') log(s, 'build', `${name} planned: it will begin when the stores allow.`, undefined, id);
  else log(s, 'build', `Works begin on a ${name.toLowerCase()}.`, undefined, id);
  invalidate(s);
  return { ok: true, id };
}

/** Demolishes a finished building (25% refund) or cancels a site; never the principia or the Capitolium. */
export function demolish(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return { ok: false, code: 'notFound', reason: 'Nothing stands there.' };
  if (b.type === 'principia' || b.type === 'capitolium') return { ok: false, code: 'invalid', reason: 'The groma forbids it.' };
  if (b.status !== 'done') return cancelSite(s, id);
  refund(s, BUILDING_DEFS[b.type].cost, B.construction.REFUND_DEMOLISH);
  for (const p of s.people) {
    if (p.home === id) { p.home = null; p.homelessSince = s.day; }
    if (p.work === id) p.work = null;
  }
  for (const f of s.families) if (f.home === id) f.home = null;
  s.buildings = s.buildings.filter((x) => x.id !== id);
  log(s, 'build', `${BUILDING_DEFS[b.type].name} pulled down.`);
  invalidate(s);
  touchPeople(s);
  return { ok: true };
}

function mergeSorted(base: number[], add: number[]): number[] {
  return [...new Set([...base, ...add])].sort((a, c) => a - c);
}

/** Lays dirt roads on the given tiles (free); inside the pomerium only on survey lines. */
export function buildRoad(s: GameState, tiles: number[]): ActionResult {
  const map = getMap(s.seed);
  const d = derived(s);
  const add: number[] = [];
  for (const i of tiles) {
    if (i < 0 || i >= W * H) return { ok: false, code: 'offMap', reason: 'Beyond the surveyed land.' };
    if (d.road[i] > 0) continue;
    if (d.buildingAt[i] !== 0) return { ok: false, code: 'occupied', reason: 'Something already stands here.' };
    if (map.terrain[i] === T.river) return { ok: false, code: 'water', reason: 'The river.' };
    if (map.terrain[i] === T.crag) return { ok: false, code: 'crag', reason: 'Too steep to build.' };
    if ((d.pomerium[i] || inCastrum(s, i)) && map.survey.street[i] !== 1) {
      return { ok: false, code: 'invalid', reason: 'The groma forbids it: streets follow the survey.' };
    }
    add.push(i);
  }
  if (add.length === 0) return { ok: true };
  s.roads = mergeSorted(s.roads, add);
  log(s, 'build', `A road of ${add.length} paces is laid.`);
  invalidate(s);
  return { ok: true };
}

/** Paves built road tiles with stone (B.map.PAVE_STONE each). */
export function pave(s: GameState, tiles: number[]): ActionResult {
  const d = derived(s);
  const add = [...new Set(tiles)].filter((i) => i >= 0 && i < W * H && d.road[i] === 1);
  if (add.length === 0) return { ok: false, code: 'invalid', reason: 'Only a dirt road can be paved.' };
  const cost: Cost = { stone: add.length * B.map.PAVE_STONE };
  if (!canAfford(s, cost)) return { ok: false, code: 'unaffordable', reason: `Paving needs ${cost.stone} stone.` };
  pay(s, cost);
  s.paved = mergeSorted(s.paved, add);
  log(s, 'build', `${add.length} paces of road are paved with silex.`);
  invalidate(s);
  return { ok: true };
}

/** Reserves (or releases) a survey block so the Ordo will not build on it. */
export function toggleReserveBlock(s: GameState, blockId: number): ActionResult {
  const sv = getMap(s.seed).survey;
  const blk = sv.blocks[blockId];
  if (!blk) return { ok: false, code: 'notFound', reason: 'No surveyed block there.' };
  if (blk.reserved || blk.masked) return { ok: false, code: 'reserved', reason: 'Reserved by the groma.' };
  const r = s.ordo.reserved;
  s.ordo.reserved = r.includes(blockId) ? r.filter((x) => x !== blockId) : mergeSorted(r, [blockId]);
  invalidate(s);
  return { ok: true };
}

/** New road tiles that would connect a rural footprint to the network, or null if none can. */
export function roadPathFor(s: GameState, footprint: number[]): number[] | null {
  // STUB(WP-A): Dijkstra ≤ ROAD_MAX from a non-corner ring tile (DESIGN §3.7); the scaffold assumes it connects.
  void s; void footprint;
  return [];
}

/** Survey street tiles around a block that are not yet roads. */
export function streetsForBlock(s: GameState, blockId: number): number[] {
  const sv = getMap(s.seed).survey;
  const blk = sv.blocks[blockId];
  if (!blk) return [];
  const road = derived(s).road;
  return blockStreets(sv, blk).filter((i) => road[i] === 0).sort((a, c) => a - c);
}

/** The aqueduct route from the nearest reachable spring to a castellum at (x, y), or null. */
export function routeAqueduct(s: GameState, x: number, y: number): { fons: number; tiles: number[] } | null {
  // STUB(WP-A): A* over DESIGN §3.8 step costs, ≤ AQUEDUCT_MAX tiles.
  void s; void x; void y;
  return null;
}

/** Ceremonial paving: the castrum's cardo and decumanus (Oppidum) or the via (Via militaris). */
export function ceremonyPaving(s: GameState, what: 'castrumAxes' | 'via'): void {
  const sv = getMap(s.seed).survey;
  const d = derived(s);
  let tiles: number[];
  if (what === 'via') tiles = sv.via.slice();
  else {
    const cx = sv.ix + (sv.interior.w - 1) / 2;
    const cy = sv.iy + (sv.interior.h - 1) / 2;
    tiles = [];
    for (let x = sv.interior.x; x < sv.interior.x + sv.interior.w; x++) tiles.push(idx(x, cy));
    for (let y = sv.interior.y; y < sv.interior.y + sv.interior.h; y++) tiles.push(idx(cx, y));
  }
  const add = tiles.filter((i) => i >= 0 && i < W * H && d.road[i] > 0);
  if (add.length === 0) return;
  s.paved = mergeSorted(s.paved, add);
  invalidate(s);
}
