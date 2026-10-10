// src/game/place.ts — the placement pipeline, roads, paving, reserved blocks, demolition (ARCHITECTURE §8.2). Owner: WP-A.
// canPlace runs the twelve checks of the §8.2 table in order and returns the first failure; validSlots answers the
// same question for every origin at once (masks and prefix sums) and must agree with canPlace. Felling, auto-roads,
// block streets and aqueduct routes live in world/roads.ts; site rules in world/siterules.ts.
import { B as B$ } from './balance';
import { RESOURCES as RESOURCES$ } from './types';
import type { ActionResult, Block, Building, BuildingId, Cost, GameState, Owner, PlaceCheck, PlaceClass, PlaceFail, PlaceOpts, ResId, WorldMap } from './types';
import { getMap as getMap$, idx as idx$, inBounds as inBounds$, tx as tx$, ty as ty$ } from './map';
import { activeRings as activeRings$, halfOrigin as halfOrigin$, isActiveBlock as isActiveBlock$, isFutureBlock as isFutureBlock$, plotOrigin as plotOrigin$ } from './survey';
import { blockOfTile as blockOfTile$, classAt as classAt$, derived as derived$, sizeOf as sizeOf$ } from './derived';
import { dayLayout as dayLayout$, invalidate as invalidate$, layoutEpoch as layoutEpoch$, memo as memo$, touchPeople as touchPeople$ } from './memo';
import { addCost, canAfford, getBuilding, log, missing, nextId, pay, refund, scaleCost } from './state';
import { cancelSite } from './construction';
import { buildingRate } from './economy';
import { seasonOf as seasonOf$ } from './calendar';
import { fx as fx$ } from './fx';
import { siteMultAt } from './site';
import { reasonText as reasonText$ } from './ordo/reasons';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
import { RESOURCE_DEFS as RESOURCE_DEFS$ } from './data/resources';
import { GN as GN$, PrefixSum, anySide as anySide$, rectTiles as rectTiles$ } from './world/grid';
import { aqueductRoute as aqueductRoute$, autoRoad as autoRoad$, blockStreetTiles as blockStreetTiles$, fell as fell$, roadField as roadField$, standingTimber as standingTimber$ } from './world/roads';
import { RULE_REASON as RULE_REASON$, ruleFail as ruleFail$, ruleTester as ruleTester$, terrainFail as terrainFail$, woodDependent as woodDependent$ } from './world/siterules';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, RESOURCES = RESOURCES$, getMap = getMap$, idx = idx$, inBounds = inBounds$, tx = tx$, ty = ty$,
  activeRings = activeRings$, halfOrigin = halfOrigin$, isActiveBlock = isActiveBlock$, isFutureBlock = isFutureBlock$,
  plotOrigin = plotOrigin$, blockOfTile = blockOfTile$, classAt = classAt$, derived = derived$, sizeOf = sizeOf$,
  dayLayout = dayLayout$, invalidate = invalidate$, layoutEpoch = layoutEpoch$, memo = memo$,
  touchPeople = touchPeople$, seasonOf = seasonOf$, fx = fx$, reasonText = reasonText$, BUILDING_DEFS = BUILDING_DEFS$,
  RANK_DEFS = RANK_DEFS$, RESOURCE_DEFS = RESOURCE_DEFS$, GN = GN$, anySide = anySide$, rectTiles = rectTiles$,
  aqueductRoute = aqueductRoute$, autoRoad = autoRoad$, blockStreetTiles = blockStreetTiles$, fell = fell$,
  roadField = roadField$, standingTimber = standingTimber$, RULE_REASON = RULE_REASON$, ruleFail = ruleFail$,
  ruleTester = ruleTester$, terrainFail = terrainFail$, woodDependent = woodDependent$;

const URBAN: readonly PlaceClass[] = ['plot', 'half', 'block'];
const PLOT = B.map.PLOT;
const R = {
  offMap: 'Beyond the surveyed land.',
  groma: 'Reserved by the groma.',
  walls: 'The walls and ditch stay clear.',
  notOnSlot: 'Choose a surveyed plot.',
  masked: 'The surveyors left this block to the fields.',
  plotTaken: 'That plot is taken.',
  territory: 'Too far for our people to walk each day.',
  castrum: 'Inside the castrum only surveyed plots.',
  street: 'The survey keeps this line for a street.',
  road: 'A road runs here.',
  pomerium: 'Inside the pomerium only urban works.',
  aqueduct: 'Reserved for the aqueduct.',
  futureRing: 'Surveyed for the canabae.',
  occupied: 'Something already stands here.',
  noRoad: 'No road can reach it.',
  canabae: 'This land is surveyed for the canabae; the plots stay blocked until you move it.',
  survey: 'The groma forbids it: streets follow the survey.',
} as const;
// check 9 failures in table order: river, crag, sacred ground, iron vein, rock
const TERRAIN_ORDER: readonly string[] = ['The river.', 'Too steep to build.', 'Sacred ground: the gods would not forgive it.',
  'An iron vein: keep it for a mine.', 'Too rocky to build.'];

function fail(code: PlaceFail, reason: string): PlaceCheck {
  return { ok: false, code, reason };
}

/** "a Vicus", "an Oppidum". */
function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

function mergeSorted(base: number[], add: readonly number[]): number[] {
  return [...new Set([...base, ...add])].sort((a, c) => a - c);
}

/** Name of the first rank whose pomerium includes a ring. */
function rankForRing(ring: number): string {
  return (RANK_DEFS.find((r) => r.rings.includes(ring)) ?? RANK_DEFS[RANK_DEFS.length - 1]).name;
}

/** Blocks the Ordo must leave alone: reserved by the player, or holding a player plan or unfinished player site. */
function ordoKeepsOff(s: GameState): Set<number> {
  const sv = getMap(s.seed).survey;
  const out = new Set<number>(s.ordo.reserved);
  for (const b of s.buildings) {
    if (b.owner !== 'player' || b.status === 'done' || !inBounds(b.x, b.y)) continue;
    const blk = sv.blockAt[idx(b.x, b.y)];
    if (blk >= 0) out.add(blk);
  }
  return out;
}

/** What a placement costs: the type's cost, plus the aqueduct route for a castellum, scaled by the path effects. */
export function placementCost(s: GameState, type: BuildingId, routeTiles: number): Cost {
  const def = BUILDING_DEFS[type];
  if (type === 'castellum') return scaleCost(addCost(def.cost, scaleCost(def.perTile?.cost ?? {}, routeTiles)), fx(s, 'castellumCost'));
  if (type === 'lacus') return scaleCost(def.cost, fx(s, 'lacusCost'));
  return { ...def.cost };
}

/** "Need 12 more stone (≈ 4 days at our quarry's pace)" for the first short resource; undefined when affordable. */
function shortfall(s: GameState, cost: Cost): string | undefined {
  const short = missing(s, cost);
  const r = RESOURCES.find((k) => (short[k] ?? 0) > 0);
  if (!r) return undefined;
  const n = Math.ceil(short[r] ?? 0);
  const name = RESOURCE_DEFS[r].name.toLowerCase();
  const pace = productionPace(s, r);
  return pace ? `Need ${n} more ${name} (≈ ${Math.ceil(n / pace.rate)} days at ${pace.label})` : `Need ${n} more ${name}.`;
}

function productionPace(s: GameState, r: ResId): { rate: number; label: string } | null {
  if (r === 'denarii') return s.counters.coinEma > 0 ? { rate: s.counters.coinEma, label: 'our present income' } : null;
  const season = seasonOf(s.day);
  let rate = 0;
  const producers: BuildingId[] = [];
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (b.status !== 'done' || (def.output?.res !== r && def.passive?.res !== r)) continue;
    const v = buildingRate(s, b, season, 'current')[r] ?? 0;
    if (v <= 0) continue;
    rate += v;
    producers.push(b.type);
  }
  if (rate <= 0) return null;
  const label = producers.length === 1 ? `our ${BUILDING_DEFS[producers[0]].name.toLowerCase()}'s pace` : 'our present pace';
  return { rate, label };
}

/** Snaps a hovered tile to the origin of the slot a type would take there (urban: plot/half/block; rural: the tile itself). */
export function snapSlot(s: GameState, type: BuildingId, tile: number): { x: number; y: number } | null {
  if (!Number.isInteger(tile) || tile < 0 || tile >= GN) return null;
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
  const replaceId = opts?.replaceId ?? 0;
  // 1 · the footprint lies on the map
  if (!Number.isInteger(tile) || tile < 0 || tile >= GN) return fail('offMap', R.offMap);
  const map = getMap(s.seed);
  const sv = map.survey;
  const d = derived(s);
  const cls = classAt(s, type, tx(tile), ty(tile));
  const slot = snapSlot(s, type, tile);
  const [w, h] = sizeOf(type, cls);
  if (slot && !inBounds(slot.x + w - 1, slot.y + h - 1)) return fail('offMap', R.offMap);
  // 2 · rank
  if (def.rank > s.rank) return fail('rankLocked', `Rome grants this to ${withArticle(RANK_DEFS[def.rank].name)}.`);
  // 3 · how many may stand
  const replaced = replaceId ? getBuilding(s, replaceId) : undefined;
  const have = (d.all[type] ?? 0) - (replaced?.type === type ? 1 : 0);
  if (def.maxCount !== undefined && have >= def.maxCount) return fail('maxCount', `Only ${def.maxCount} may be raised.`);
  // 4 · the principia and the Capitolium are the groma's
  if (cls === 'fixed') return fail('reserved', R.groma);
  const free = (i: number): boolean => d.buildingAt[i] === 0 || d.buildingAt[i] === replaceId;
  let at: { x: number; y: number };
  let fp: number[];
  let future = false;
  let block: Block | null = null;
  if (URBAN.includes(cls)) {
    // 5 · an urban slot in an active block
    if (!slot) return sv.wall[tile] || sv.fossa[tile] ? fail('castrum', R.walls) : fail('notOnSlot', R.notOnSlot);
    block = blockOfTile(s, idx(slot.x, slot.y));
    if (!block) return fail('notOnSlot', R.notOnSlot);
    if (block.masked) return fail('terrain', R.masked);
    if (!activeRings(s.rank).includes(block.ring)) return fail('notInPomerium', `Outside the pomerium: become ${withArticle(rankForRing(block.ring))} to survey these blocks.`);
    // 6 · not the forum or the Area Capitolina (nor a block the Ordo must leave alone); the plots are free
    if (block.reserved || (owner === 'ordo' && ordoKeepsOff(s).has(block.id))) return fail('reserved', R.groma);
    at = slot;
    fp = rectTiles(at.x, at.y, w, h);
    if (fp.some((i) => !free(i) || d.reservedTile[i] === 1)) return fail('occupied', R.plotTaken);
  } else {
    at = { x: tx(tile), y: ty(tile) };
    if (!inBounds(at.x + w - 1, at.y + h - 1)) return fail('offMap', R.offMap);
    fp = rectTiles(at.x, at.y, w, h);
    const c = sv.castrum;
    const inCastrum = (i: number): boolean => tx(i) >= c.x && ty(i) >= c.y && tx(i) < c.x + c.w && ty(i) < c.y + c.h;
    // 7 · rural land
    if (fp.some((i) => d.territory[i] !== 1)) return fail('outsideTerritory', R.territory);
    if (fp.some(inCastrum)) return fail('castrum', R.castrum);
    if (fp.some((i) => sv.street[i] === 1)) return fail('street', R.street);
    if (fp.some((i) => d.road[i] > 0)) return fail('road', R.road);
    if (fp.some((i) => d.pomerium[i] === 1)) return fail('notInPomerium', R.pomerium);
    if (fp.some((i) => d.reservedTile[i] === 1)) return fail('reserved', R.aqueduct);
    // 8 · the Ordo keeps the future rings clear
    future = fp.some((i) => sv.blockAt[i] >= 0 && isFutureBlock(sv, sv.blocks[sv.blockAt[i]], s.rank));
    if (future && owner === 'ordo') return fail('futureRing', R.futureRing);
    // 9 · terrain
    let worst: { code: PlaceFail; reason: string } | null = null;
    for (const i of fp) {
      const tf = terrainFail(type, map.terrain[i], map.feature[i]);
      if (tf && (!worst || TERRAIN_ORDER.indexOf(tf.reason) < TERRAIN_ORDER.indexOf(worst.reason))) worst = tf;
    }
    if (worst) return fail(worst.code, worst.reason);
    // 10 · nothing stands here
    if (fp.some((i) => !free(i))) return fail('occupied', R.occupied);
  }
  // 11 · the site rule
  const rf = ruleFail(s, type, at.x, at.y, w, h);
  if (rf) return fail(rf.code, rf.reason);
  const route = type === 'castellum' ? aqueductRoute(s, at.x, at.y, w, h) : null;
  if (type === 'castellum' && !route) return fail('noFons', RULE_REASON.noFons);
  // 12 · a road can reach a rural work
  let lines: readonly number[] = [];
  if (cls === 'rural') {
    const road = autoRoad(s, at.x, at.y, w, h);
    if (road === null) return fail('noRoad', R.noRoad);
    lines = road;
  } else if (block) lines = blockStreetTiles(s, block.id);

  const fpWood = standingTimber(s, fp);
  const routeLen = route ? route.tiles.length : 0;
  const cost = placementCost(s, type, routeLen);
  const work = def.work + (def.perTile?.work ?? 0) * routeLen + fpWood * B.economy.WOOD.FELL_WORK;
  const { mult, notes } = siteMultAt(s, type, at.x, at.y);
  const fellAll = fpWood + standingTimber(s, lines) + (route ? standingTimber(s, route.tiles) : 0);
  const out: PlaceCheck = { ok: true, x: at.x, y: at.y, mult, notes, fell: fellAll, cost, work };
  if (route) out.route = route.tiles;
  if (future && owner === 'player') out.warn = R.canabae;
  else if (!opts?.ignoreCost) {
    const warn = shortfall(s, cost);
    if (warn) out.warn = warn;
  }
  return out;
}

/** Every valid origin tile of a type for an owner → site multiplier (memo on type + owner + layout epoch, + day for wood rules). */
export function validSlots(s: GameState, type: BuildingId, owner: Owner): Map<number, number> {
  const key = woodDependent(type) ? dayLayout(s) : layoutEpoch(s);
  return memo(s, `validSlots:${type}:${owner}`, key, () => computeSlots(s, type, owner));
}

function computeSlots(s: GameState, type: BuildingId, owner: Owner): Map<number, number> {
  const out = new Map<number, number>();
  const def = BUILDING_DEFS[type];
  const map = getMap(s.seed);
  const sv = map.survey;
  const d = derived(s);
  if (def.rank > s.rank || def.place.includes('fixed')) return out;
  if (def.maxCount !== undefined && (d.all[type] ?? 0) >= def.maxCount) return out;
  const urban = def.place.find((c) => URBAN.includes(c));
  if (urban) {
    const [w, h] = sizeOf(type, urban);
    const rule = ruleTester(s, type, w, h);
    const keepOff = owner === 'ordo' ? ordoKeepsOff(s) : null;
    const origins = urban === 'block' ? [0] : urban === 'half' ? [0, 1] : [0, 1, 2, 3];
    for (const blk of sv.blocks) {
      if (!isActiveBlock(sv, blk, s.rank) || keepOff?.has(blk.id)) continue;
      for (const k of origins) {
        const o = urban === 'block' ? { x: blk.x, y: blk.y } : urban === 'half' ? halfOrigin(blk, k as 0 | 1) : plotOrigin(blk, k as 0 | 1 | 2 | 3);
        if (rectTiles(o.x, o.y, w, h).some((i) => d.buildingAt[i] !== 0 || d.reservedTile[i] === 1)) continue;
        if (!rule(o.x, o.y) || (type === 'castellum' && !aqueductRoute(s, o.x, o.y, w, h))) continue;
        out.set(idx(o.x, o.y), siteMultAt(s, type, o.x, o.y).mult);
      }
    }
  }
  if (def.place.includes('rural')) {
    const [w, h] = sizeOf(type, 'rural');
    const base = ruralBase(s, owner);
    const terr = terrainMask(map, type);
    const blocked = new Uint8Array(GN);
    for (let i = 0; i < GN; i++) blocked[i] = base[i] | terr[i];
    const ps = new PrefixSum(blocked);
    const rule = ruleTester(s, type, w, h);
    const steps = roadField(s).bfs.steps;
    const reach = (i: number): boolean => steps[i] <= B.map.ROAD_MAX;
    for (let y = 0; y + h <= map.H; y++) {
      for (let x = 0; x + w <= map.W; x++) {
        if (ps.sum(x, y, w, h) > 0 || !rule(x, y) || !anySide(x, y, w, h, reach)) continue;
        out.set(idx(x, y), siteMultAt(s, type, x, y).mult);
      }
    }
  }
  return out;
}

/** Tiles no rural work of `owner` may cover on the current structure (checks 7, 8 and 10), memo on the layout epoch. */
function ruralBase(s: GameState, owner: Owner): Uint8Array {
  return memo(s, `ruralBase:${owner}`, layoutEpoch(s), () => {
    const sv = getMap(s.seed).survey;
    const d = derived(s);
    const c = sv.castrum;
    const m = new Uint8Array(GN);
    for (let i = 0; i < GN; i++) {
      const x = tx(i), y = ty(i);
      const b = sv.blockAt[i];
      m[i] = d.territory[i] !== 1 || (x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h) || sv.street[i] === 1
        || d.road[i] > 0 || d.pomerium[i] === 1 || d.reservedTile[i] === 1 || d.buildingAt[i] !== 0
        || (owner === 'ordo' && b >= 0 && isFutureBlock(sv, sv.blocks[b], s.rank)) ? 1 : 0;
    }
    return m;
  });
}

const terrainMasks = new WeakMap<WorldMap, Map<string, Uint8Array>>();

/** Tiles check 9 forbids to a type on a map (river, crag, sacred ground, and rock/ore unless it digs them). */
function terrainMask(map: WorldMap, type: BuildingId): Uint8Array {
  const kind = type === 'fodina' || type === 'lapicidina' ? type : 'other';
  let byKind = terrainMasks.get(map);
  if (!byKind) { byKind = new Map(); terrainMasks.set(map, byKind); }
  let m = byKind.get(kind);
  if (!m) {
    const probe: BuildingId = kind === 'other' ? 'ager' : kind;
    m = new Uint8Array(GN);
    for (let i = 0; i < GN; i++) m[i] = terrainFail(probe, map.terrain[i], map.feature[i]) ? 1 : 0;
    byKind.set(kind, m);
  }
  return m;
}

/** Places a building: validates, pays (or plans), fells, lays streets or the auto-road, logs, invalidates (ARCHITECTURE §8.2). */
export function placeBuilding(s: GameState, type: BuildingId, tile: number, opts?: PlaceOpts): ActionResult {
  const owner = opts?.owner ?? 'player';
  const chk = canPlace(s, type, tile, opts);
  if (!chk.ok) return { ok: false, code: chk.code, reason: chk.reason };
  const def = BUILDING_DEFS[type];
  const old = opts?.replaceId ? getBuilding(s, opts.replaceId) : undefined;
  if (opts?.replaceId && (!old || old.owner !== 'ordo' || old.status !== 'staked')) return { ok: false, code: 'invalid', reason: 'Only an Ordo stake can be moved.' };
  if (owner === 'ordo' && !opts?.ignoreCost && !canAfford(s, chk.cost)) return { ok: false, code: 'unaffordable', reason: 'The treasury cannot cover it.' };
  const map = getMap(s.seed);
  const cls = classAt(s, type, chk.x, chk.y);
  const [w, h] = sizeOf(type, cls);
  const fp = rectTiles(chk.x, chk.y, w, h);
  const blk = cls === 'rural' ? null : blockOfTile(s, idx(chk.x, chk.y));
  const lines = cls === 'rural' ? autoRoad(s, chk.x, chk.y, w, h) ?? [] : blk ? blockStreetTiles(s, blk.id) : [];
  if (old) {
    refund(s, placementCost(s, old.type, old.route?.length ?? 0), 1);
    s.buildings = s.buildings.filter((b) => b.id !== old.id);
    log(s, 'build', `The Ordo's ${old.type === type ? 'stake' : BUILDING_DEFS[old.type].name.toLowerCase()} is moved; its cost returns to the stores.`, undefined, old.id);
  }
  const affordable = opts?.ignoreCost === true || canAfford(s, chk.cost);
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
  if (type === 'fodina') b.vein = Math.max(0, ...fp.map((i) => map.vein[i]));
  // the land is cleared: timber under the footprint, along the new road and the aqueduct goes to the stores
  fell(s, fp);
  fell(s, lines);
  if (chk.route) fell(s, chk.route);
  const under = new Set(fp);
  if (cls !== 'rural') {                                   // an old road across a newly surveyed plot gives way
    s.roads = s.roads.filter((i) => !under.has(i));
    s.paved = s.paved.filter((i) => !under.has(i));
  }
  s.roads = mergeSorted(s.roads, lines.filter((i) => !under.has(i)));
  s.buildings.push(b);
  const name = def.name.toLowerCase();
  if (owner === 'ordo') {
    const why = opts?.reason ? ` ${reasonText(opts.reason)}` : '';
    log(s, 'ordo', `The Ordo ${status === 'staked' ? 'stakes out' : 'raises'} ${withArticle(name)}.${why}`, ['decided'], id);
  } else if (status === 'plan') log(s, 'build', `${def.name} planned: works begin when the stores allow.`, undefined, id);
  else log(s, 'build', `Works begin on ${withArticle(name)}.`, undefined, id);
  invalidate(s);
  return { ok: true, id };
}

/** Demolishes a finished building (25% refund) or cancels a site; never the principia or the Capitolium. */
export function demolish(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return { ok: false, code: 'notFound', reason: 'Nothing stands there.' };
  if (b.type === 'principia' || b.type === 'capitolium') return { ok: false, code: 'invalid', reason: `The ${BUILDING_DEFS[b.type].latin} cannot be pulled down.` };
  if (b.status !== 'done') return cancelSite(s, id);
  refund(s, placementCost(s, b.type, b.route?.length ?? 0), B.construction.REFUND_DEMOLISH);
  for (const p of s.people) {
    if (p.home === id) { p.home = null; p.homelessSince = s.day; }
    if (p.work === id) p.work = null;
  }
  for (const f of s.families) if (f.home === id) f.home = null;
  s.buildings = s.buildings.filter((x) => x.id !== id);
  log(s, 'build', `${BUILDING_DEFS[b.type].name} pulled down; a quarter of its cost is salvaged.`);
  invalidate(s);
  touchPeople(s);
  return { ok: true };
}

/** Lays dirt roads on the given tiles (free; standing timber goes to the stores); inside the pomerium only on survey lines. */
export function buildRoad(s: GameState, tiles: number[]): ActionResult {
  const map = getMap(s.seed);
  const sv = map.survey;
  const d = derived(s);
  const c = sv.castrum;
  const add: number[] = [];
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= GN) return { ok: false, code: 'offMap', reason: R.offMap };
    if (d.road[i] > 0 || add.includes(i)) continue;
    if (d.buildingAt[i] !== 0) return { ok: false, code: 'occupied', reason: R.occupied };
    const tf = terrainFail('lapicidina', map.terrain[i], map.feature[i]);   // river, crag, sacred ground (rock and ore are fine)
    if (tf && tf.code !== 'terrain') return { ok: false, code: tf.code, reason: tf.reason };
    if (sv.wall[i] || sv.fossa[i]) return { ok: false, code: 'castrum', reason: R.walls };
    const inCastrum = tx(i) >= c.x && ty(i) >= c.y && tx(i) < c.x + c.w && ty(i) < c.y + c.h;
    if ((d.pomerium[i] === 1 || inCastrum) && sv.street[i] !== 1) return { ok: false, code: 'invalid', reason: R.survey };
    add.push(i);
  }
  if (add.length === 0) return { ok: true };
  const timber = fell(s, add);
  s.roads = mergeSorted(s.roads, add);
  log(s, 'build', `A road of ${add.length} ${add.length === 1 ? 'pace' : 'paces'} is laid${timber > 0 ? `; ${Math.round(timber)} timber cleared` : ''}.`);
  invalidate(s);
  return { ok: true };
}

/** Paves built dirt road tiles with stone (B.map.PAVE_STONE each). */
export function pave(s: GameState, tiles: number[]): ActionResult {
  const d = derived(s);
  const add = [...new Set(tiles)].filter((i) => Number.isInteger(i) && i >= 0 && i < GN && d.road[i] === 1).sort((a, c) => a - c);
  if (add.length === 0) return { ok: false, code: 'invalid', reason: 'Only a dirt road can be paved.' };
  const cost: Cost = { stone: add.length * B.map.PAVE_STONE };
  if (!canAfford(s, cost)) return { ok: false, code: 'unaffordable', reason: `Paving needs ${cost.stone} stone.` };
  pay(s, cost);
  s.paved = mergeSorted(s.paved, add);
  log(s, 'build', `${add.length} ${add.length === 1 ? 'pace' : 'paces'} of road paved with silex.`);
  invalidate(s);
  return { ok: true };
}

/** Reserves (or releases) a survey block so the Ordo will not build on it. */
export function toggleReserveBlock(s: GameState, blockId: number): ActionResult {
  const sv = getMap(s.seed).survey;
  const blk = sv.blocks[blockId];
  if (!blk) return { ok: false, code: 'notFound', reason: 'No surveyed block there.' };
  if (blk.reserved) return { ok: false, code: 'reserved', reason: R.groma };
  if (blk.masked) return { ok: false, code: 'terrain', reason: R.masked };
  const r = s.ordo.reserved;
  const on = !r.includes(blockId);
  s.ordo.reserved = on ? mergeSorted(r, [blockId]) : r.filter((x) => x !== blockId);
  log(s, 'info', on ? 'A block is kept free: the Ordo will not build there.' : 'A kept block is released to the Ordo.');
  invalidate(s);
  return { ok: true };
}

/** New road tiles that would connect a rural footprint to the network ([] when it already touches it), or null if none can. */
export function roadPathFor(s: GameState, footprint: number[]): number[] | null {
  if (footprint.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of footprint) {
    x0 = Math.min(x0, tx(i)); y0 = Math.min(y0, ty(i));
    x1 = Math.max(x1, tx(i)); y1 = Math.max(y1, ty(i));
  }
  return autoRoad(s, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Street tiles a block needs (its unbuilt sides plus the connection along survey lines to the network). */
export function streetsForBlock(s: GameState, blockId: number): number[] {
  return blockStreetTiles(s, blockId).slice();
}

/** The aqueduct route from the nearest reachable free spring to a castellum at (x, y), spring first, or null. */
export function routeAqueduct(s: GameState, x: number, y: number): { fons: number; tiles: number[] } | null {
  const [w, h] = sizeOf('castellum', 'plot');
  return aqueductRoute(s, x, y, w, h);
}

/** Ceremonial paving: the castrum's cardo and decumanus with gates and causeways (Oppidum), or the via (Via militaris). */
export function ceremonyPaving(s: GameState, what: 'castrumAxes' | 'via'): void {
  const sv = getMap(s.seed).survey;
  const d = derived(s);
  let tiles: number[];
  if (what === 'via') tiles = sv.via.slice();
  else {
    const cx = sv.ix + (sv.interior.w - 1) / 2;
    const cy = sv.iy + (sv.interior.h - 1) / 2;
    const c = sv.castrum;
    tiles = [];
    for (let x = c.x; x < c.x + c.w; x++) tiles.push(idx(x, cy));
    for (let y = c.y; y < c.y + c.h; y++) tiles.push(idx(cx, y));
  }
  const add = tiles.filter((i) => i >= 0 && i < GN && d.road[i] === 1);
  if (add.length === 0) return;
  s.paved = mergeSorted(s.paved, add);
  invalidate(s);
}
