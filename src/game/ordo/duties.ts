// src/game/ordo/duties.ts — the council's duties (DESIGN §10.2): a new colony is run by hand. Each duty (staffing, the
// water works, the food and granaries, house plots, services, materials, Rome's works and the focus plan, trade) stays
// the player's until they have done it themselves once: then it is learned, and theirs to hand to the Ordo or keep. The
// Ordo raises only the works of the duties it holds (the wish walk is masked: it neither raises nor saves for the rest),
// save two nets that keep "nothing is lost while you are away": under the Lex de annona it still raises a famine's field
// or a drought's well, and while the player is away with Govern while away on it governs every duty in their name.
// Colonies from before the duties, and the bots, hold every duty learned and handed over as before.
import type { ActionResult, BuildingId, DutyId, FxEvent, GameState, Reason, WorkDuty } from '../types';
import { DUTIES, WORK_DUTIES } from '../types';
import { log } from '../state';
import { switchOn } from '../decisions';

/** A duty in words: its Latin and English names, what the Ordo does with it, and how the player learns it. */
export interface DutyDef { latin: string; name: string; does: string; learn: string; done: string }

export const DUTY_DEFS: Record<DutyId, DutyDef> = {
  labour: { latin: 'Operae', name: 'Staffing', does: 'who works where, every day', learn: 'Set the hands of a trade yourself in Populus.',
    done: 'You have set the colony\'s hands yourself.' },
  water: { latin: 'Aquae', name: 'Water works', does: 'wells and cisterns for the dry season and for homes without water',
    learn: 'Raise a well, a cistern or a fountain yourself.', done: 'You have raised water works with your own hand.' },
  food: { latin: 'Annona', name: 'Food and granaries', does: 'fields, hunters and granaries against Hiems',
    learn: 'Raise fields, a hunting lodge, a forage camp or a granary yourself.', done: 'You have raised food works with your own hand.' },
  homes: { latin: 'Domus', name: 'House plots', does: 'house plots when beds run short', learn: 'Lay out a house plot yourself.',
    done: 'You have laid out house plots with your own hand.' },
  services: { latin: 'Officia', name: 'Services', does: 'the shrines, shops and baths that homes wait for',
    learn: 'Raise a shrine, a shop row, a temple, a market hall or baths yourself.', done: 'You have raised a service with your own hand.' },
  materials: { latin: 'Materia', name: 'Materials', does: 'lumber camps, quarries, workshops and warehouses for what the works lack',
    learn: 'Raise a lumber camp, a quarry, a workshop or a warehouse yourself.', done: 'You have raised a materials work with your own hand.' },
  plan: { latin: 'Consilium', name: 'Rome\'s works and the plan', does: 'the works a petition names, oil and wine, and the focus plan',
    learn: 'Carry a petition to Rome.', done: 'You have carried a petition to Rome.' },
  trade: { latin: 'Negotia', name: 'Trade', does: 'contracts with the markets and deals with merchants',
    learn: 'Sign a contract or strike a merchant\'s deal yourself.', done: 'You have traded with your own hand.' },
};

/** The duty a work raised by hand teaches. */
const WORK_DUTY: Partial<Record<BuildingId, WorkDuty>> = {
  puteus: 'water', cisterna: 'water', lacus: 'water',
  ager: 'food', venatio: 'food', pabulatio: 'food', horreum: 'food',
  area: 'homes',
  lararium: 'services', taberna: 'services', templum: 'services', macellum: 'services', balneum: 'services', thermae: 'services',
  lignarius: 'materials', lapicidina: 'materials', fodina: 'materials', figlina: 'materials', caementarium: 'materials',
  officina: 'materials', fabrica: 'materials', apotheca: 'materials',
};

/** The duty a work belongs to (null: none teaches or divides it). */
export function workDuty(type: BuildingId): WorkDuty | null {
  return WORK_DUTY[type] ?? null;
}

/** The duty under which the Ordo raises a wish (null: the player's own order, a request or the pin). */
export function wishDuty(r: Reason): WorkDuty | null {
  switch (r.code) {
    case 'survivalWater': case 'aestasWater': case 'waterAccess': case 'aquae': return 'water';
    case 'survivalFood': case 'hiemsStore': return 'food';
    case 'storageFull': return r.params.res === 'grain' ? 'food' : r.params.res === 'water' ? 'water' : 'materials';
    case 'beds': return 'homes';
    case 'evolve': case 'renewal': return 'services';
    case 'materials': case 'capitolium': return 'materials';
    case 'rank': case 'luxury': case 'focusPlan': case 'beauty': return 'plan';
    default: return null;
  }
}

/** Whether the Ordo holds a duty: labour and trade are their areas; a kind of work needs building on and that kind. */
export function granted(s: GameState, d: DutyId): boolean {
  if (d === 'labour' || d === 'trade') return s.ordo.on[d];
  return s.ordo.on.build && s.ordo.works[d];
}

export function learned(s: GameState, d: DutyId): boolean {
  return s.ordo.learned.includes(d);
}

/** Learns a duty (once): logged, and told by a toast (`fx` queues the event: the tick's or an action's). */
export function learnDuty(s: GameState, d: DutyId, fx?: (e: FxEvent) => void): void {
  if (learned(s, d)) return;
  s.ordo.learned = DUTIES.filter((x) => x === d || s.ordo.learned.includes(x));
  log(s, 'good', `${DUTY_DEFS[d].done} ${DUTY_DEFS[d].name}: the Ordo can take it up for you now.`);
  fx?.({ kind: 'learned', duty: d });
}

/** Every duty learned at once ("I know the camp"). */
export function learnAll(s: GameState): void {
  s.ordo.learned = DUTIES.slice();
}

/** The day's check (end of the tick): the player's finished works teach their duties, a granted petition the plan. */
export function dutiesDay(s: GameState, fx?: (e: FxEvent) => void): void {
  governing.delete(s);
  if (s.ordo.learned.length === DUTIES.length) return;
  for (const b of s.buildings) {
    if (b.owner !== 'player' || b.status !== 'done' || b.reason?.code === 'request' || b.reason?.code === 'pin') continue;
    const d = WORK_DUTY[b.type];
    if (d && !learned(s, d)) learnDuty(s, d, fx);
  }
  if (s.rank > 0) learnDuty(s, 'plan', fx);
}

// ── the wish walk's mask ──

/** The colonies whose council sits while the player is away with Govern while away on (set by the council's session,
 *  cleared at the end of the tick): the Ordo then governs every duty in the player's name. */
const governing = new WeakSet<GameState>();

/** The council sits offline with Govern while away on: every duty is the Ordo's today. */
export function governAway(s: GameState, on: boolean): void {
  if (on) governing.add(s); else governing.delete(s);
}

/** Which wishes the Ordo may raise and save for today: 'all', or a key naming the duties it holds and whether the Lex de
 *  annona lets it raise a survival work (the wish walk's memo key part). */
export function walkMask(s: GameState): string {
  if (governing.has(s)) return 'all';
  let key = '';
  for (const d of WORK_DUTIES) key += granted(s, d) ? '1' : '0';
  if (key === '111111') return 'all';
  return `${key}${switchOn(s, 'emergency') ? 'e' : ''}`;
}

/** Whether a wish passes the mask: its duty is held, or it is the player's order, or (Lex de annona) it keeps us alive. */
export function maskAllows(mask: string, r: Reason, survival: boolean): boolean {
  if (mask === 'all') return true;
  const d = wishDuty(r);
  if (d === null) return true;
  if (survival && mask.endsWith('e')) return true;
  return mask[WORK_DUTIES.indexOf(d)] === '1';
}

// ── the player's orders ──

const OK: ActionResult = { ok: true };

/** Hands a learned duty to the Ordo, or takes it back (`on` false). Staffing and trade are their Ordo areas. */
export function setDuty(s: GameState, d: DutyId, on: boolean, setArea: (area: 'labour' | 'trade', on: boolean) => ActionResult): ActionResult {
  if (!(DUTIES as readonly string[]).includes(d)) return { ok: false, code: 'invalid', reason: 'No such duty.' };
  if (on && !learned(s, d)) return { ok: false, code: 'locked', reason: `${DUTY_DEFS[d].learn} Then the Ordo can take it up.` };
  if (!s.ordo.answered.includes(d)) s.ordo.answered = DUTIES.filter((x) => x === d || s.ordo.answered.includes(x));
  if (d === 'labour' || d === 'trade') return setArea(d, on);
  if (granted(s, d) === on) return OK;
  s.ordo.works[d] = on;
  s.ordo.on.build = WORK_DUTIES.some((w) => s.ordo.works[w]);
  log(s, 'ordo', on ? `The Ordo takes up ${DUTY_DEFS[d].name.toLowerCase()}: ${DUTY_DEFS[d].does}.` : `You take ${DUTY_DEFS[d].name.toLowerCase()} back into your own hands.`);
  return OK;
}

/** The player keeps learned duties for now: the offer is answered, and comes again only from Edicta. */
export function keepDuties(s: GameState, ds: readonly DutyId[]): ActionResult {
  s.ordo.answered = DUTIES.filter((x) => ds.includes(x) || s.ordo.answered.includes(x));
  return OK;
}

/** Learned duties the Ordo does not hold and the player has not yet answered: what the counsel offers. */
export function pendingOffers(s: GameState): DutyId[] {
  return s.ordo.learned.filter((d) => !granted(s, d) && !s.ordo.answered.includes(d));
}
