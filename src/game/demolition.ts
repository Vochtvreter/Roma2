// src/game/demolition.ts — pulling works down by the armful (an area of the map, the council's gardens of a block), what
// that would cost the town before the second click, and a short undo (DESIGN §5.3). Owner: WP-A.
// place.ts demolish stays the one-work action (the inspector's button); demolishMany pulls down a set at once with the
// same refunds (a finished work a quarter of its cost, a site as construction.ts cancelSite would) and one Annales line.
// demolitionImpact only reads: the homes and residents lost, the workers put out, what comes back, and the homes left
// standing that would no longer meet a need of their own tier (a well's water, a garden's desirability) and so decline
// (§7.3), from the same coverage and desirability the houses read, on a copy of the state without those works.
// Undo: the last demolishMany is kept beside the state in memory (a WeakMap, never saved: a reload ends it) for
// B.construction.UNDO_DAYS days. undoDemolition raises those works again as they stood, takes the salvage back, and
// puts back whoever is still without the home or the work it took; it refuses when anything now stands on that ground,
// a work of a one-only type was raised again meanwhile, or the salvage is spent. The ticks never read the record, so
// the colony runs the same with or without it.
import { B } from './balance';
import { NEEDS, RESOURCES } from './types';
import type { ActionResult, Building, BuildingId, Cost, GameState, NeedId } from './types';
import { idx } from './map';
import { blockOfTile, derived, footprintOf } from './derived';
import { invalidate, touchPeople } from './memo';
import { addCost, canAfford, log, pay, refund, scaleCost } from './state';
import { getBuilding, getPerson } from './lookup';
import { peopleIndex } from './census';
import { unmetNeeds } from './housing';
import { placementCost } from './place';
import { BUILDING_DEFS } from './data/buildings';
import { RESOURCE_DEFS } from './data/resources';

/** What pulling down a set of works would do (read before the second click). */
export interface DemolitionImpact {
  ids: number[];                                 // the works that would come down, in id order
  spared: BuildingId[];                          // picked works that can never be pulled down (the principia, the Capitolium)
  homes: number; people: number;                 // houses among them and the people who live there
  workers: number;                               // people who work there
  sites: number;                                 // unfinished works among them (cancelled: §5.3 refunds)
  losing: { need: NeedId; homes: number }[];     // homes left standing that would no longer meet a need of their tier
  refund: Cost;                                  // what comes back to the stores
  frac: number | null;                           // the share of the cost that comes back, when every work returns the same
}

/** The last demolition, as it stood: the works, who lived and worked in them, and the salvage paid out. */
interface Razed {
  day: number;
  works: Building[];
  homes: { id: number; home: number }[];
  jobs: { id: number; work: number }[];
  families: { id: number; home: number }[];
  refund: Cost;
}
const razed = new WeakMap<GameState, Razed>();

/** Whether a work can be pulled down at all: never the principia or the Capitolium (§5.3). */
export function demolishable(b: Pick<Building, 'type'>): boolean {
  return b.type !== 'principia' && b.type !== 'capitolium';
}

/** A finished work returns REFUND_DEMOLISH of its cost; a paid site all of it within FULL_REFUND_DAYS of placing and
 *  before any work, else REFUND_CANCEL; an unpaid plan nothing (construction.ts cancelSite). */
function salvage(s: GameState, b: Building): { cost: Cost; frac: number } {
  const C = B.construction;
  if (b.status !== 'done' && !b.paid) return { cost: {}, frac: 0 };
  const cost = placementCost(s, b.type, b.route?.length ?? 0);
  if (b.status === 'done') return { cost, frac: C.REFUND_DEMOLISH };
  return { cost, frac: s.day - b.placed <= C.FULL_REFUND_DAYS && b.progress <= 0 ? 1 : C.REFUND_CANCEL };
}

/** The existing works among `ids`, each once, in id order. */
function picked(s: GameState, ids: readonly number[]): Building[] {
  return [...new Set(ids)].sort((a, c) => a - c).map((id) => getBuilding(s, id)).filter((b): b is Building => !!b);
}

function isHome(b: Building): boolean {
  return b.type === 'area' && b.status === 'done' && !!b.house;
}

/** What pulling down `ids` would do. `needs: false` leaves out the homes that would lose a need (the what-if over the
 *  whole town's coverage): the cheap count a sweep shows while it is dragged. */
export function demolitionImpact(s: GameState, ids: readonly number[], opts?: { needs?: boolean }): DemolitionImpact {
  const pick = picked(s, ids);
  const down = pick.filter(demolishable);
  const ix = peopleIndex(s);
  let refundCost: Cost = {}, frac: number | null | undefined;
  let homes = 0, people = 0, workers = 0, sites = 0;
  for (const b of down) {
    const sv = salvage(s, b);
    refundCost = addCost(refundCost, scaleCost(sv.cost, sv.frac));
    frac = frac === undefined || frac === sv.frac ? sv.frac : null;
    if (isHome(b)) { homes++; people += ix.byHome.get(b.id)?.length ?? 0; }
    workers += ix.byWork.get(b.id)?.length ?? 0;
    if (b.status !== 'done') sites++;
  }
  return {
    ids: down.map((b) => b.id), spared: pick.filter((b) => !demolishable(b)).map((b) => b.type),
    homes, people, workers, sites,
    losing: opts?.needs === false || down.length === 0 ? [] : losses(s, new Set(down.map((b) => b.id))),
    refund: refundCost, frac: frac ?? null,
  };
}

/** The homes left standing that meet a need of their own tier now and would not once `gone` came down, per need. */
function losses(s: GameState, gone: ReadonlySet<number>): { need: NeedId; homes: number }[] {
  // a copy without those works (never written): its coverage and desirability are worked out afresh (memo.ts keys
  // every cache on the state object)
  const after: GameState = { ...s, buildings: s.buildings.filter((b) => !gone.has(b.id)) };
  const n = new Map<NeedId, number>();
  for (const id of derived(s).houses) {
    const b = gone.has(id) ? undefined : getBuilding(s, id);
    if (!b?.house) continue;
    const before = unmetNeeds(s, b, b.house.tier);
    for (const need of unmetNeeds(after, b, b.house.tier)) if (!before.includes(need)) n.set(need, (n.get(need) ?? 0) + 1);
  }
  return [...n].sort((a, c) => NEEDS.indexOf(a[0]) - NEEDS.indexOf(c[0])).map(([need, homes]) => ({ need, homes }));
}

/** "4 denarii", "1 timber": a cost in whole units, RESOURCES order (amounts under half a unit left out). */
export function costWords(c: Cost): string[] {
  const out: string[] = [];
  for (const r of RESOURCES) {
    const v = Math.round(c[r] ?? 0);
    if (v > 0) out.push(`${v} ${RESOURCE_DEFS[r].name.toLowerCase()}`);
  }
  return out;
}

/** Pulls down a set of works at once (the demolish tool's area, or one work): refunds as §5.3, residents and workers
 *  put out, one Annales line; the principia and the Capitolium among them stay. Kept for undoDemolition. */
export function demolishMany(s: GameState, ids: readonly number[]): ActionResult {
  return pullDown(s, ids, null);
}

/** The council's gardens in a survey block (the Ordo's horti, finished or not), in id order. */
export function councilGardens(s: GameState, blockId: number): number[] {
  return s.buildings.filter((b) => b.type === 'hortus' && b.owner === 'ordo' && blockOfTile(s, idx(b.x, b.y))?.id === blockId).map((b) => b.id);
}

/** Clears every garden the council laid in a block (refunds as §5.3); the player's own gardens stay. */
export function clearGardens(s: GameState, blockId: number): ActionResult {
  const ids = councilGardens(s, blockId);
  if (ids.length === 0) return { ok: false, code: 'notFound', reason: 'The council has laid no garden in this block.' };
  return pullDown(s, ids, 'gardens');
}

function pullDown(s: GameState, ids: readonly number[], what: 'gardens' | null): ActionResult {
  const pick = picked(s, ids);
  if (pick.length === 0) return { ok: false, code: 'notFound', reason: 'Nothing stands there.' };
  const down = pick.filter(demolishable);
  if (down.length === 0) return { ok: false, code: 'invalid', reason: `The ${BUILDING_DEFS[pick[0].type].latin} cannot be pulled down.` };
  const gone = new Set(down.map((b) => b.id));
  const rec: Razed = { day: s.day, works: down.map((b) => structuredClone(b)), homes: [], jobs: [], families: [], refund: {} };
  for (const b of down) {
    const sv = salvage(s, b);
    rec.refund = addCost(rec.refund, scaleCost(sv.cost, sv.frac));
  }
  for (const p of s.people) {
    if (p.home !== null && gone.has(p.home)) { rec.homes.push({ id: p.id, home: p.home }); p.home = null; p.homelessSince = s.day; }
    if (p.work !== null && gone.has(p.work)) { rec.jobs.push({ id: p.id, work: p.work }); p.work = null; }
  }
  for (const f of s.families) if (f.home !== null && gone.has(f.home)) { rec.families.push({ id: f.id, home: f.home }); f.home = null; }
  refund(s, rec.refund, 1);
  s.buildings = s.buildings.filter((b) => !gone.has(b.id));
  razed.set(s, rec);
  const back = costWords(rec.refund);
  const salvaged = back.length ? `; ${back.join(' and ')} salvaged` : '';
  const b0 = down[0], homes = down.filter(isHome).length;
  if (what === 'gardens') log(s, 'build', `The council's ${down.length === 1 ? 'garden' : `${down.length} gardens`} in the block ${down.length === 1 ? 'is' : 'are'} cleared${salvaged}.`);
  else if (down.length === 1 && b0.status === 'done') log(s, 'build', `${BUILDING_DEFS[b0.type].name} pulled down; a quarter of its cost is salvaged.`);
  else if (down.length === 1) log(s, 'build', `Works on the ${BUILDING_DEFS[b0.type].name.toLowerCase()} are abandoned${salvaged}.`);
  else log(s, 'build', `${down.length} works pulled down${homes ? ` (${homes} ${homes === 1 ? 'home' : 'homes'})` : ''}${salvaged}.`);
  invalidate(s);
  touchPeople(s);
  return { ok: true };
}

/** The last demolition (demolishMany, clearGardens) while it can still be undone: its works and the last day; null when
 *  there is none or its UNDO_DAYS have passed. */
export function undoable(s: GameState): { works: number; until: number } | null {
  const r = razed.get(s);
  if (!r || s.day - r.day > B.construction.UNDO_DAYS) return null;
  return { works: r.works.length, until: r.day + B.construction.UNDO_DAYS };
}

/** Raises the works of the last demolition again as they stood (within UNDO_DAYS): the salvage goes back to the ground,
 *  and whoever is still without the home or the work it took has it again. */
export function undoDemolition(s: GameState): ActionResult {
  const r = razed.get(s);
  if (!r) return { ok: false, code: 'notFound', reason: 'There is no demolition to undo.' };
  if (s.day - r.day > B.construction.UNDO_DAYS) {
    razed.delete(s);
    return { ok: false, code: 'window', reason: `Too late: a demolition can be undone for ${B.construction.UNDO_DAYS} days.` };
  }
  const d = derived(s);
  const types = new Map<BuildingId, number>();
  for (const b of r.works) {
    const route = b.route ?? [];
    if (footprintOf(b, s).some((i) => d.buildingAt[i] !== 0 || d.road[i] > 0) || route.some((i) => d.buildingAt[i] !== 0)) {
      return { ok: false, code: 'occupied', reason: 'Too late: something new stands where they stood.' };
    }
    types.set(b.type, (types.get(b.type) ?? 0) + 1);
  }
  for (const [t, n] of types) {
    const max = BUILDING_DEFS[t].maxCount;
    if (max !== undefined && (d.all[t] ?? 0) + n > max) return { ok: false, code: 'maxCount', reason: `Too late: another ${BUILDING_DEFS[t].name.toLowerCase()} stands now.` };
  }
  if (!canAfford(s, r.refund)) return { ok: false, code: 'unaffordable', reason: `Too late: the salvage (${costWords(r.refund).join(', ')}) is spent.` };
  pay(s, r.refund);
  s.buildings = [...s.buildings, ...r.works].sort((a, c) => a.id - c.id);   // the id-sorted list (lookup.ts)
  for (const f of r.families) {
    const fam = s.families.find((x) => x.id === f.id);
    if (fam && fam.home === null) fam.home = f.home;
  }
  for (const x of r.homes) {
    const p = getPerson(s, x.id);
    if (!p || p.home !== null) continue;
    const fam = s.families.find((f) => f.id === p.family);
    if (fam && fam.home !== null && fam.home !== x.home) continue;   // the family found beds elsewhere meanwhile: all of it stays there
    p.home = x.home;
    delete p.homelessSince;
  }
  for (const x of r.jobs) {
    const p = getPerson(s, x.id);
    if (p && p.work === null) p.work = x.work;
  }
  razed.delete(s);
  const n = r.works.length;
  log(s, 'build', `The demolition is undone: ${n === 1 ? 'the work stands' : `${n} works stand`} again and the salvage goes back.`);
  invalidate(s);
  touchPeople(s);
  return { ok: true };
}
