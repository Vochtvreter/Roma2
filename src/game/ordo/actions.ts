// src/game/ordo/actions.ts — player actions that steer the Ordo (ARCHITECTURE §8.4, §8.7). Owner: WP-C.
// Every action returns an ActionResult with a plain reason, never throws, and logs what it changed.
import { B } from '../balance';
import { LABOR_CATS, ORDO_AREAS, WORK_DUTIES } from '../types';
import type { ActionResult, BuildingId, DutyId, FailCode, GameState, LaborCat, OrdoArea } from '../types';
import { log } from '../state';
import { pushActionFx } from '../memo';
import { createContract } from '../trade';
import { placeBuilding } from '../place';
import { view } from '../sim';
import { BUILDING_DEFS } from '../data/buildings';
import { RANK_DEFS } from '../data/ranks';
import { planLabour } from './labour';
import { homeReach, homeSlot, ordoSlot, wouldRaise } from './build';
import { granted, keepDuties as keep, learnDuty, learned, pendingOffers, setDuty as grant } from './duties';
import { tradeMoves } from './trade';
import { aWork, reasonText } from './reasons';

const OK: ActionResult = { ok: true };
const AREA: Record<OrdoArea, string> = { labour: 'the labour', build: 'the building', trade: 'the trade' };
const CAT_LABEL: Record<LaborCat, string> = { water: 'Water', food: 'Food', materials: 'Materials', industry: 'Industry', services: 'Services', builders: 'Builders' };

function fail(code: FailCode, reason: string): ActionResult {
  return { ok: false, code, reason };
}

/** Whether the Ordo could raise this type: a placeable work, granted to our rank, under its max count, with a slot. */
function raisable(s: GameState, type: BuildingId, code: 'request' | 'pin'): ActionResult {
  const def = BUILDING_DEFS[type];
  if (!def || def.place.includes('fixed')) return fail('invalid', 'The groma reserves that work.');
  if (def.rank > s.rank) return fail('rankLocked', `Rome grants this to a ${RANK_DEFS[def.rank].name}.`);
  if (def.maxCount !== undefined && (view(s).d.all[type] ?? 0) >= def.maxCount) return fail('maxCount', `Only ${def.maxCount} may be raised.`);
  if (ordoSlot(s, type, code) === null) return fail('noSlots', `The surveyors find no place for ${aWork(type)}.`);
  return OK;
}

/** Asks the Ordo to build a type next (max REQUESTS_MAX; needs Ordo construction on). Asked from a house card, the
 *  request carries the home (`house`): the Ordo raises the work where it reaches that home, and says at once when no
 *  free plot does (DESIGN §10.1). */
export function askOrdo(s: GameState, type: BuildingId, house?: number): ActionResult {
  if (!s.ordo.on.build) return fail('ordoOnly', 'Building is in your own hands: place it yourself, or give building back to the Ordo.');
  if (s.ordo.requests.length >= B.ordo.REQUESTS_MAX) return fail('full', `The Ordo already holds ${B.ordo.REQUESTS_MAX} of your requests.`);
  const chk = raisable(s, type, 'request');
  if (!chk.ok) return chk;
  const home = homeSlot(s, view(s), type, house);
  if (home === null) return fail('noSlots', `The surveyors find no free plot ${homeReach(s, type)} for ${aWork(type)}; clearing one would help.`);
  s.ordo.requests.push(home === undefined ? { type, day: s.day } : { type, day: s.day, house: house as number });
  log(s, 'ordo', `The Ordo will raise ${aWork(type)}${home ? ' within reach of that home' : ''} as you ask, within ${B.ordo.ASK_DAYS} days if the stores allow.`);
  return OK;
}

/** Pins a type as the Ordo's next build (null clears the pin): it saves for it and raises it first. */
export function pinBuild(s: GameState, type: BuildingId | null): ActionResult {
  if (type === s.ordo.pin) return OK;
  if (type === null) {
    log(s, 'ordo', `The Ordo no longer saves for ${aWork(s.ordo.pin as BuildingId)}.`);
    s.ordo.pin = null;
    return OK;
  }
  const chk = raisable(s, type, 'pin');
  if (!chk.ok) return chk;
  s.ordo.pin = type;
  log(s, 'ordo', `Build next: the Ordo saves for ${aWork(type)} and raises it before anything else.`);
  return OK;
}

/** Turns an Ordo area (labour, build, trade) on or off; manual labour starts from today's staffing, manual trade takes over
 *  the Ordo's contracts; building on hands the Ordo every kind of work the player has learned, off takes them all back. */
export function setOrdo(s: GameState, area: OrdoArea, on: boolean): ActionResult {
  if (!ORDO_AREAS.includes(area)) return fail('invalid', 'No such part of the council\'s work.');
  if (area === 'build') {
    const kinds = WORK_DUTIES.filter((d) => learned(s, d));
    if (on && kinds.length === 0) return fail('locked', 'Raise a work of your own first: then the Ordo can learn to raise its kind.');
    for (const d of WORK_DUTIES) s.ordo.works[d] = on && kinds.includes(d);
  }
  if (s.ordo.on[area] === on) return OK;
  if (!on && area === 'labour') {
    const c = view(s).c;
    for (const cat of LABOR_CATS) s.ordo.manual[cat] = c.catStaffed[cat];
  }
  let handed = 0;
  if (!on && area === 'trade') for (const c of s.trade.contracts) if (c.owner === 'ordo') { c.owner = 'player'; handed++; }
  s.ordo.on[area] = on;
  const more = handed > 0 ? ` The Ordo hands you its ${handed} contract${handed === 1 ? '' : 's'}.` : '';
  log(s, 'ordo', on ? `The Ordo takes ${AREA[area]} in hand.` : `You take ${AREA[area]} into your own hands.${more}`);
  return OK;
}

/** Sets a manual labour target for a category (manual labour only); clamped to the workforce. */
export function setManualTarget(s: GameState, cat: LaborCat, n: number): ActionResult {
  if (!LABOR_CATS.includes(cat) || !Number.isFinite(n)) return fail('invalid', 'No such kind of work.');
  if (s.ordo.on.labour) return fail('manualOnly', 'The Ordo assigns the labour: take it into your own hands first.');
  s.ordo.manual[cat] = Math.max(0, Math.min(Math.round(n), view(s).c.workforce));
  learnDuty(s, 'labour', pushActionFx);
  return OK;
}

/** Applies the Ordo's current proposal once: labour targets into the manual plan, wish #1 as a player site, or the would-be contract. */
export function applyOnce(s: GameState, area: OrdoArea): ActionResult {
  const v = view(s);
  if (area === 'labour') {
    if (s.ordo.on.labour) return fail('manualOnly', 'The Ordo already assigns the labour.');
    const plan = planLabour(s, v);
    for (const cat of LABOR_CATS) s.ordo.manual[cat] = 0;
    for (const l of plan.lines) s.ordo.manual[l.cat] += l.target;
    log(s, 'ordo', `The Ordo's labour plan, applied by your leave: ${plan.lines.map((l) => `${CAT_LABEL[l.cat]} ${l.target}`).join(' · ')}.`);
    return OK;
  }
  if (area === 'build') {
    const w = wouldRaise(s, v);
    if (!w || w.tile === undefined) return fail('notFound', 'The Ordo has nothing to propose.');
    const r = placeBuilding(s, w.type, w.tile, { owner: 'player', reason: w.reason });
    if (r.ok && r.id !== undefined) pushActionFx({ kind: 'ordoPlaced', id: r.id });
    return r;
  }
  if (area === 'trade') {
    const m = tradeMoves(s, v)[0];
    if (!m) return fail('notFound', 'The Ordo sees no trade worth making.');
    return createContract(s, m.spec, 'player', m.reason);
  }
  return fail('invalid', 'No such part of the council\'s work.');
}

/** Puts a labour category first for `days` days (the priority remedy); replaces an earlier order for the same category. */
export function setLabourPriority(s: GameState, cat: LaborCat, days: number): ActionResult {
  if (!LABOR_CATS.includes(cat) || !Number.isFinite(days) || days < 1) return fail('invalid', 'No such order.');
  const d = Math.min(Math.round(days), B.time.YEAR_DAYS);
  s.ordo.priorities = [...s.ordo.priorities.filter((p) => p.cat !== cat), { cat, until: s.day + d }];
  log(s, 'ordo', reasonText({ code: 'priority', params: { cat, days: d } }));
  return OK;
}

/** Hands a learned duty to the Ordo (`on`), or takes it back (DESIGN §10.2). */
export function setDuty(s: GameState, duty: DutyId, on: boolean): ActionResult {
  return grant(s, duty, on, (area, v) => setOrdo(s, area, v));
}

/** Hands the Ordo every duty learned and not yet held (or those of `only`). */
export function handOverAll(s: GameState, only?: readonly DutyId[]): ActionResult {
  const ds = s.ordo.learned.filter((d) => (!only || only.includes(d)) && !granted(s, d));
  if (ds.length === 0) return fail('notFound', 'The Ordo already holds every duty you have learned.');
  for (const d of ds) setDuty(s, d, true);
  return OK;
}

/** Keeps the duties now offered in the player's own hands (the offer is answered; Edicta can hand them over later). */
export function keepDuties(s: GameState, ds: readonly DutyId[] = pendingOffers(s)): ActionResult {
  return keep(s, ds);
}
