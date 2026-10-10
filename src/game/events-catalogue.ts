// src/game/events-catalogue.ts — the 16 events of DESIGN §12.2: weights, conditions, cards and their resolutions.
// Owner: WP-D (split from events.ts; the pacing framework and the public API live there).
// Every card's default is its cautious option and costs nothing. Losses are clamped: no event takes more than
// CLAMP_RES of a stock or kills more than CLAMP_POP of the people (DESIGN §12.1). Option costs are the player's own
// choice and are shown on the card.
import { B as B$ } from './balance';
import type {
  Building, ChoiceOption, Cost, EventId, Family, GameState, Modifier, PendingChoice, Person, SimView, SkillId, TickContext,
} from './types';
import type { Rng } from './rng';
import { aucYear as aucYear$, formatRoman as formatRoman$, nextSeasonStart as nextSeasonStart$, seasonOf as seasonOf$ } from './calendar';
import { fx as fx$ } from './fx';
import { touchPeople as touchPeople$ } from './memo';
import { getPerson, log, nextId } from './state';
import { coverage, houseHas } from './coverage';
import { footprintOf as footprintOf$, roadNeighbors as roadNeighbors$ } from './derived';
import { getMap as getMap$ } from './map';
import { siteMult } from './site';
import { FEVER_VOW, evictOverflow, makeFamily, personName, settleFamily } from './people';
import { careShare } from './civic';
import { daysOnHand } from './objectives';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { GENTES_IMMIGRANT as GENTES_IMMIGRANT$, GENTES_VETERAN as GENTES_VETERAN$ } from './data/names';
import { TRADE_BASE as TRADE_BASE$ } from './data/hubs';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, aucYear = aucYear$, formatRoman = formatRoman$, nextSeasonStart = nextSeasonStart$, seasonOf = seasonOf$,
  fx = fx$, touchPeople = touchPeople$, footprintOf = footprintOf$, roadNeighbors = roadNeighbors$, getMap = getMap$,
  BUILDING_DEFS = BUILDING_DEFS$, GENTES_IMMIGRANT = GENTES_IMMIGRANT$, GENTES_VETERAN = GENTES_VETERAN$,
  TRADE_BASE = TRADE_BASE$;

const E = B.events;
const EV = B.events;                             // the catalogue's tunables (DESIGN §12.2)
const VET_SKILLS: readonly SkillId[] = ['agri', 'fabri', 'silva', 'lapis'];
const WORKSHOPS = ['figlina', 'officina', 'fabrica'] as const;
const SEASON = { ver: 0, aestas: 1, autumnus: 2, hiems: 3 } as const;

/** What an event step may use: the stream, a tick context for fx and rates, the live view, and whether nobody chose. */
export interface EvCtx { rng: Rng; tc: TickContext; v: SimView; auto: boolean }

/** One catalogue row. `weight` returns 0 when the event's conditions fail. */
export interface EventDef {
  id: EventId;
  kind: 'choice' | 'instant' | 'special';
  benign: boolean;
  harmful: boolean;
  cooldown: number;
  roll: boolean;                                                // drawn by the daily random roll
  weight(s: GameState, v: SimView): number;
  start(s: GameState, ev: EvCtx): boolean;                      // fire now (a card, or the instant effect)
  resolve?(s: GameState, key: string, ev: EvCtx, card: PendingChoice): string | null;   // an answer; returns the log line
}

// ───────────────────────────── shared helpers ─────────────────────────────

/** Adds (or replaces, by id) a timed modifier. */
export function addModifier(s: GameState, m: Modifier): void {
  s.modifiers = s.modifiers.filter((x) => x.id !== m.id);
  s.modifiers.push(m);
}

function mod(s: GameState, id: string, label: string, days: number, effects: Modifier['fx'], source: Modifier['source'], benign: boolean): void {
  addModifier(s, { id, label, until: s.day + days, fx: effects, benign, source });
}

function insertById<T extends { id: number }>(arr: T[], item: T): void {
  let k = arr.length;
  while (k > 0 && arr[k - 1].id > item.id) k--;
  arr.splice(k, 0, item);
}

/** Houses a household (as beds allow); with `homelessOk` it joins homeless when no house has room. */
export function admitFamily(s: GameState, tc: TickContext, fam: { family: Family; people: Person[] }, homelessOk: boolean): boolean {
  if (settleFamily(s, tc, fam)) return true;
  if (!homelessOk) return false;
  fam.family.home = null;
  insertById(s.families, fam.family);
  for (const p of fam.people) {
    p.home = null;
    p.homelessSince = s.day;
    p.arrived = s.day;
    insertById(s.people, p);
  }
  s.stats.immigrants += fam.people.length;
  tc.fx.push({ kind: 'arrive', family: fam.family.id, n: fam.people.length, home: null });
  touchPeople(s);
  return true;
}

function card(s: GameState, ev: EventId, kicker: string, title: string, text: string, options: ChoiceOption[], defaultIndex: number, days: number = E.CHOICE_DAYS, data?: Record<string, number | string>): void {
  const c: PendingChoice = { event: ev, kicker, title, text, options, defaultIndex, created: s.day, expires: s.day + days };
  if (data) c.data = data;
  s.choice = c;
}

const done = (s: GameState, type: Building['type']): Building[] => s.buildings.filter((b) => b.type === type && b.status === 'done');
const season = (s: GameState): number => seasonOf(s.day);

function nearWater(s: GameState, b: Building): boolean {
  if (b.house) return houseHas(s, b.id, 'water') || houseHas(s, b.id, 'fountain');
  const cov = coverage(s);
  return roadNeighbors(s, b).some((t) => cov.layers.water[t] === 1 || cov.layers.fountain[t] === 1);
}

function riversideFields(s: GameState): Building[] {
  const map = getMap(s.seed);
  return done(s, 'ager').filter((b) => footprintOf(b, s).some((i) => map.riverDist[i] <= EV.FLOOD.RIVER));
}

function insulae(s: GameState): Building[] {
  return s.buildings.filter((b) => b.status === 'done' && b.house?.tier === 'insula');
}

function workshops(s: GameState): Building[] {
  return s.buildings.filter((b) => b.status === 'done' && (WORKSHOPS as readonly string[]).includes(b.type));
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// ───────────────────────────── the veterans at the gate (the flagship event) ─────────────────────────────

function headOf(fam: { family: Family; people: Person[] }): Person | undefined {
  return fam.people.find((p) => p.id === fam.family.head);
}

function bestSkill(p: Person | undefined): { skill: SkillId | null; level: number } {
  let best: { skill: SkillId | null; level: number } = { skill: null, level: 0 };
  if (!p) return best;
  for (const k of VET_SKILLS) {
    const lv = p.skills[k] ?? 0;
    if (lv > best.level) best = { skill: k, level: lv };
  }
  return best;
}

const veterani: EventDef = {
  id: 'veterani', kind: 'choice', benign: false, harmful: false, cooldown: 365, roll: true,
  weight: (s, v) => {
    const c = v.c;
    const ok = c.pop >= EV.VET.POP && c.pop < c.roll && s.morale >= B.morale.VETERANS_MIN
      && daysOnHand(s, c).grain >= EV.VET.GRAIN_DOH && c.freeBeds >= EV.VET.BEDS && !s.gate;
    return ok ? fx(s, 'veterans') : 0;
  },
  start: (s, ev) => {
    const inUse = new Set(s.families.map((f) => f.gens));
    let pool = GENTES_VETERAN.filter((g) => !inUse.has(g));
    if (pool.length < EV.VET.FAMILIES[1]) pool = GENTES_VETERAN.slice();
    const n = ev.rng.int(EV.VET.FAMILIES[0], EV.VET.FAMILIES[1]);
    const families: { family: Family; people: Person[] }[] = [];
    for (let k = 0; k < n; k++) {
      const fam = makeFamily(s, ev.rng, 'veteran', pool);      // head 54–62 with a trade, wife 50–58, 0–2 children (WP-B)
      pool = pool.filter((g) => g !== fam.family.gens);
      if (pool.length === 0) pool = GENTES_VETERAN.slice();
      families.push(fam);
    }
    s.gate = { families, until: s.day + E.VETERAN_STAY };
    const souls = families.reduce((a, f) => a + f.people.length, 0);
    const heads = families.map((f) => {
      const h = headOf(f);
      const b = bestSkill(h);
      return h ? `${personName(h)}${b.skill ? ` (${b.skill} ${b.level})` : ''}` : f.family.gens;
    });
    const craft = families.slice().sort((a, b) => bestSkill(headOf(b)).level - bestSkill(headOf(a)).level)[0];
    const free = ev.v.c.freeBeds;
    card(s, 'veterani', 'NVNTIVS · VETERANI AD PORTAM', 'Veterans at the gate',
      `${plural(n, 'family', 'families')} of veterans, ${souls} souls, camp in tents before the Porta Praetoria: ${heads.join(', ')}. `
      + `Their service is done; they ask for land. We have ${plural(free, 'free bed', 'free beds')}.`,
      [
        { label: 'Grant land (missio agraria)', note: `All who find beds join; spirits +${EV.VET.MORALE_PER} a family.`, key: 'grant', cost: { denarii: EV.VET.GRANT * n } },
        { label: 'Take only the craftsmen', note: `The ${craft.family.gens.replace(/us$/, 'i')} join, free; spirits +${EV.VET.MORALE_PER}.`, key: 'craft' },
        { label: 'Send them on to Colonia Augusta', note: `None join; Fama +${EV.VET.FAMA} dignitas for a year.`, key: 'send' },
      ], 2, E.VETERAN_STAY, { families: n, souls, freeBeds: free });
    log(s, 'event', `${plural(n, 'family', 'families')} of veterans (${souls} souls) camp at the Porta Praetoria.`, ['highlight']);
    return true;
  },
  resolve: (s, key, ev) => {
    const party = s.gate?.families ?? [];
    s.gate = null;
    const title = `Veterans at the gate (${plural(party.length, 'family', 'families')})`;
    if (key === 'grant') {
      let joined = 0;
      for (const fam of party) if (admitFamily(s, ev.tc, fam, false)) joined++;
      s.res.denarii += EV.VET.GRANT * (party.length - joined);        // pay only for the land granted
      if (joined > 0) mod(s, 'veterani', 'Veterans welcomed', EV.VET.MORALE_DAYS, { add: { morale: Math.min(EV.VET.MORALE_MAX, EV.VET.MORALE_PER * joined) } }, 'veterani', true);
      return `${title}: land granted to ${joined}${joined < party.length ? `; ${party.length - joined} found no beds and moved on` : ''}.`;
    }
    if (key === 'craft') {
      const best = party.slice().sort((a, b) => bestSkill(headOf(b)).level - bestSkill(headOf(a)).level)[0];
      if (best && admitFamily(s, ev.tc, best, false)) {
        mod(s, 'veterani', 'Veterans welcomed', EV.VET.MORALE_DAYS, { add: { morale: EV.VET.MORALE_PER } }, 'veterani', true);
        return `${title}: the ${best.family.gens.replace(/us$/, 'i')} stay; the others move on.`;
      }
      return `${title}: no beds for the craftsmen; all move on.`;
    }
    mod(s, 'veterani.fama', 'Fama: the veterans speak well of us', EV.VET.FAMA_DAYS, { add: { fama: EV.VET.FAMA } }, 'veterani', true);
    return `${title}: sent on to Colonia Augusta.`;
  },
};

// ───────────────────────────── choice cards ─────────────────────────────

const legatus: EventDef = {
  id: 'legatus', kind: 'choice', benign: false, harmful: false, cooldown: 1095, roll: true,
  weight: (s) => (s.rank >= EV.LEGATUS.RANK ? 0.4 : 0),
  start: (s) => {
    const cost: Cost = s.res.wine >= EV.LEGATUS.WINE
      ? { denarii: EV.LEGATUS.DEN, wine: EV.LEGATUS.WINE } : { denarii: EV.LEGATUS.DEN + EV.LEGATUS.NO_WINE };
    card(s, 'legatus', 'NVNTIVS · LEGATVS AVGVSTI', 'The Legate of Augustus',
      `The emperor's legate rides up the via toward the frontier and will rest a night at ${s.name}. A banquet would be remembered in his letters to Rome.`,
      [
        { label: 'Host a banquet', note: `Fama +${EV.LEGATUS.FAMA} dignitas for five years; the next petition fee ×${EV.LEGATUS.FEE}.`, key: 'banquet', cost },
        { label: 'A modest welcome', note: 'Bread, water and a clean bed: nothing gained, nothing spent.', key: 'modest' },
      ], 1);
    return true;
  },
  resolve: (s, key) => {
    if (key !== 'banquet') return 'The Legate: a modest welcome, and he rides on at dawn.';
    mod(s, 'legatus.fama', 'Fama: the Legate\'s banquet', EV.FIVE_YEARS, { add: { fama: EV.LEGATUS.FAMA } }, 'legatus', true);
    addModifier(s, { id: 'legatus.fee', label: 'The Legate\'s good word: petition fee ×0.85', until: s.day + 100 * B.time.YEAR_DAYS, fx: { mul: { petitionFee: EV.LEGATUS.FEE } }, benign: true, source: 'legatus' });
    return 'The Legate: a banquet in the principia; he will speak for us in Rome.';
  },
};

const mutuum: EventDef = {
  id: 'mutuum', kind: 'choice', benign: true, harmful: false, cooldown: 0, roll: false,
  weight: (s) => (s.choice?.event === 'mutuum' ? 0 : 1),
  start: (s, ev) => {
    const qty = Math.max(1, Math.round(B.emergency.RELIEF_DAYS * ev.v.c.need.grain));
    const free = s.decisions.paths.path3 === 'annonaPublica' && s.ordo.emergency.freeReliefYear !== aucYear(s.day);
    const debt = free ? 0 : B.emergency.RELIEF_PRICE * TRADE_BASE.grain * qty;
    card(s, 'mutuum', 'NVNTIVS · MVTVVM', 'The Legate\'s relief',
      `The legion's granaries can spare ${qty} modii, ${B.emergency.RELIEF_DAYS} days of bread, here in ${B.emergency.RELIEF_ARRIVE} days. `
      + (free ? 'Under the Annona publica, this year\'s relief is a gift.' : `Rome will want ${Math.round(debt)} denarii, taken from a quarter of each Kalends tax.`),
      [
        { label: 'Accept the legion\'s grain', note: free ? 'Free this year (Annona publica).' : `A debt of ${Math.round(debt)} denarii.`, key: 'accept' },
        { label: 'Refuse', note: 'We shift for ourselves.', key: 'refuse' },
      ], 0, E.RELIEF_DAYS, { qty, debt, free: free ? 1 : 0 });
    s.ordo.emergency.lastRelief = s.day;
    return true;
  },
  resolve: (s, key, _ev, c) => {
    if (key !== 'accept') return 'The Legate\'s relief: refused.';
    const qty = Number(c.data?.qty ?? 0);
    const debt = Number(c.data?.debt ?? 0);
    if (Number(c.data?.free ?? 0) === 1) s.ordo.emergency.freeReliefYear = aucYear(s.day);
    s.trade.debt += debt;
    s.trade.caravans.push({ id: nextId(s), contract: null, hub: 'augusta', mode: 'import', res: 'grain', qty, value: debt,
      depart: s.day, arrive: s.day + B.emergency.RELIEF_ARRIVE, kind: 'relief' });
    return `The Legate's relief: ${qty} grain due ${formatRoman(s.day + B.emergency.RELIEF_ARRIVE)}${debt > 0 ? `, a debt of ${Math.round(debt)} denarii` : ', a gift'}.`;
  },
};

const pestilentia: EventDef = {
  id: 'pestilentia', kind: 'choice', benign: false, harmful: true, cooldown: 365, roll: true,
  weight: (s, v) => {
    if (s.people.length < EV.PEST.POP) return 0;
    const houses = v.d.houses;
    const n = Math.max(1, houses.length);
    const ins = insulae(s).length / n;
    const wet = houses.filter((id) => houseHas(s, id, 'water') || houseHas(s, id, 'fountain')).length / n;
    const w = EV.PEST.BASE + ins + (1 - wet) + (season(s) === SEASON.aestas ? EV.PEST.AESTAS : 0);
    return 0.6 * w * fx(s, 'disease') * (1 - EV.PEST.CARE * careShare(s));
  },
  start: (s) => {
    card(s, 'pestilentia', 'NVNTIVS · PESTILENTIA', 'Fever in the town',
      'A fever runs through the houses; the old and the young burn first. The physicians say perhaps one in twenty will fall sick.',
      [
        { label: 'Vow a shrine to Apollo Medicus', note: 'Half the deaths; spirits +3.', key: 'vow', cost: { denarii: EV.PEST.VOW } },
        { label: 'Isolate the sick outside the walls', note: 'Half as many fall sick; spirits −4.', key: 'isolate' },
      ], 1);
    return true;
  },
  resolve: (s, key, ev) => {
    // Who falls sick is decided now; the sick die over the following DAYS through people.ts (one death path, halved
    // while the FEVER_VOW modifier stands), so the morale term and the Annales see each death on its day.
    const vow = key === 'vow';
    const share = ev.rng.range(EV.PEST.SICK[0], EV.PEST.SICK[1]) * (vow ? 1 : EV.PEST.ISOLATE);
    const ids = ev.rng.shuffle(s.people.map((p) => p.id)).slice(0, Math.max(1, Math.round(s.people.length * share)));
    ids.sort((a, b) => a - b);
    for (const id of ids) {
      const p = getPerson(s, id);
      if (p) p.sickUntil = s.day + EV.PEST.DAYS;
    }
    touchPeople(s);
    mod(s, vow ? FEVER_VOW : 'pestilentia', vow ? 'A vow to Apollo Medicus: fever deaths halved' : 'The sick outside the walls', EV.DUR,
      { add: { morale: vow ? EV.PEST.VOW_MORALE : EV.PEST.ISOLATE_MORALE } }, 'pestilentia', vow);
    return `Fever: ${vow ? 'a shrine vowed to Apollo Medicus' : 'the sick isolated outside the walls'}. ${ids.length} fell sick.`;
  },
};

/** The field with the best site (ties by lowest id). */
function bestField(s: GameState): Building | null {
  let best: Building | null = null, bm = -Infinity;
  for (const b of done(s, 'ager')) {
    const m = siteMult(s, b);
    if (m > bm) { best = b; bm = m; }
  }
  return best;
}

function burnField(s: GameState): string {
  const f = bestField(s);
  if (!f) return 'no field to burn';
  f.idleUntil = s.day + EV.ROBIGO.IDLE;
  f.bonus = EV.ROBIGO.BONUS;
  f.bonusUntil = f.idleUntil + EV.ROBIGO.BONUS_DAYS;
  mod(s, 'robigo', 'Robigo: a field lies burned', EV.ROBIGO.IDLE, {}, 'robigo', false);
  return `the best field burned; it lies idle until ${formatRoman(f.idleUntil)}, then yields +10%`;
}

const robigo: EventDef = {
  id: 'robigo', kind: 'choice', benign: false, harmful: true, cooldown: 365, roll: true,
  weight: (s) => {
    if (season(s) > SEASON.aestas || done(s, 'ager').length < EV.ROBIGO.FIELDS) return 0;
    return 0.7 * fx(s, 'blight');                         // ×0.5 while the Robigalia's blessing stands (festivals)
  },
  start: (s) => {
    card(s, 'robigo', 'NVNTIVS · ROBIGO', 'Rust in the wheat',
      'Red rust spreads in the best of our fields. Burn it now, or ask Robigus to spare it.',
      [
        { label: 'Sacrifice to Robigus', note: `${Math.round(EV.ROBIGO.AVERT * 100)}% the blight passes; otherwise the field is burned.`, key: 'sacrifice', cost: { denarii: EV.ROBIGO.SACRIFICE } },
        { label: 'Burn the blighted field', note: 'The best field idles 30 days, then yields +10% for 60 days.', key: 'burn' },
      ], 1);
    return true;
  },
  resolve: (s, key, ev) => {
    if (key === 'sacrifice' && ev.rng.chance(EV.ROBIGO.AVERT)) return 'Robigo: Robigus accepts the red dog; the blight passes.';
    return `Robigo: ${key === 'sacrifice' ? 'the god was not moved; ' : ''}${burnField(s)}.`;
  },
};

const siccitas: EventDef = {
  id: 'siccitas', kind: 'choice', benign: false, harmful: true, cooldown: 730, roll: true,
  weight: (s) => (season(s) === SEASON.aestas ? 0.6 : 0),
  start: (s) => {
    const wells = done(s, 'puteus').length;
    mod(s, 'siccitas', 'Siccitas: cisterns ×0.3, wells ×0.85', EV.SICC.DAYS, { mul: { rain: EV.SICC.RAIN, wells: EV.SICC.WELLS } }, 'siccitas', false);
    card(s, 'siccitas', 'NVNTIVS · SICCITAS', 'Drought',
      `No rain for weeks: the cisterns catch almost nothing and the wells sink. It will last ${EV.SICC.DAYS} days.`,
      [
        { label: 'Dig the wells deeper', note: 'The wells draw as before; the cisterns still suffer.', key: 'dig',
          cost: { stone: EV.SICC.STONE * wells, denarii: Math.min(EV.SICC.DEN_MAX, EV.SICC.DEN * wells) } },
        { label: 'Ration the wells', note: `Water need ×${EV.SICC.WATER} for ${EV.SICC.DAYS} days; spirits −6.`, key: 'ration' },
      ], 1, E.CHOICE_DAYS, { wells });
    return true;
  },
  resolve: (s, key) => {
    const drought = s.modifiers.find((m) => m.id === 'siccitas');
    if (key === 'dig') {
      if (drought) addModifier(s, { ...drought, label: 'Siccitas: cisterns ×0.3', fx: { mul: { rain: EV.SICC.RAIN } } });
      return 'Drought: the wells were dug deeper.';
    }
    mod(s, 'siccitas.ration', 'Wells rationed', EV.SICC.DAYS, { mul: { waterUse: EV.SICC.WATER }, add: { morale: EV.SICC.MORALE } }, 'siccitas', false);
    return 'Drought: the wells are rationed.';
  },
};

const annonaRomae: EventDef = {
  id: 'annonaRomae', kind: 'choice', benign: false, harmful: false, cooldown: 730, roll: true,
  weight: (s, v) => (s.rank >= EV.ROMA.RANK && daysOnHand(s, v.c).grain >= EV.ROMA.DOH ? 0.4 : 0),
  start: (s) => {
    const { BIG, SMALL } = EV.ROMA;
    card(s, 'annonaRomae', 'NVNTIVS · ANNONA ROMAE', 'Rome asks for grain',
      'The prefect of the grain supply writes: the city is hungry and the fleet is late. Will the colonies send what they can spare?',
      [
        { label: `Ship ${BIG.grain} grain`, note: `+${BIG.den} denarii; Fama +${BIG.fama} for five years.`, key: 'big', cost: { grain: BIG.grain }, gain: { denarii: BIG.den } },
        { label: `Ship ${SMALL.grain} grain`, note: `+${SMALL.den} denarii; Fama +${SMALL.fama} for five years.`, key: 'small', cost: { grain: SMALL.grain }, gain: { denarii: SMALL.den } },
        { label: 'Plead poor harvests', note: 'Nothing sent, nothing paid.', key: 'plead' },
      ], 2);
    return true;
  },
  resolve: (s, key) => {
    if (key === 'plead') return 'Rome asked for grain: we pleaded poor harvests.';
    const o = key === 'big' ? EV.ROMA.BIG : EV.ROMA.SMALL;
    mod(s, 'annonaRomae', 'Fama: grain for Rome', EV.FIVE_YEARS, { add: { fama: o.fama } }, 'annonaRomae', true);
    return `Rome asked for grain: we shipped ${o.grain} modii for ${o.den} denarii.`;
  },
};

// ───────────────────────────── instant events ─────────────────────────────

const ignis: EventDef = {
  id: 'ignis', kind: 'instant', benign: false, harmful: true, cooldown: 365, roll: true,
  weight: (s) => 0.3 * Math.min(EV.IGNIS.MAX, insulae(s).length / 5 + workshops(s).length / 4),
  start: (s, ev) => {
    const items = [...insulae(s), ...workshops(s)].sort((a, b) => a.id - b.id)
      .map((b) => ({ w: (b.house ? EV.IGNIS.INSULA : EV.IGNIS.WORKSHOP) * (nearWater(s, b) ? EV.IGNIS.WET : 1), v: b }));
    const b = ev.rng.weighted(items);
    if (!b) return false;
    const wet = nearWater(s, b);
    b.damagedUntil = s.day + (wet ? EV.IGNIS.WATER_DAYS : EV.IGNIS.DAYS);
    s.counters.lastFireDay = s.day;
    const out = b.house ? evictOverflow(s, b.id) : 0;     // half the beds while damaged (census)
    ev.tc.fx.push({ kind: 'fire', id: b.id });
    const name = b.house ? 'an insula' : `the ${BUILDING_DEFS[b.type].name.toLowerCase()}`;
    mod(s, `ignis.${b.id}`, `Ignis: ${name} damaged`, b.damagedUntil - s.day, {}, 'ignis', false);
    log(s, 'bad', `Fire! ${name.charAt(0).toUpperCase()}${name.slice(1)} burns; repairs until ${formatRoman(b.damagedUntil)}${wet ? ' (the wells saved the worst)' : ''}${out > 0 ? `; ${out} people lose their beds` : ''}.`, ['highlight'], b.id);
    return true;
  },
};

const inundatio: EventDef = {
  id: 'inundatio', kind: 'instant', benign: false, harmful: true, cooldown: 730, roll: true,
  weight: (s) => (season(s) === SEASON.ver && riversideFields(s).length > 0 ? 0.5 : 0),
  start: (s) => {
    const fields = riversideFields(s);
    if (fields.length === 0) return false;
    for (const f of fields) {
      f.idleUntil = s.day + EV.FLOOD.IDLE;
      f.bonus = EV.FLOOD.BONUS;
      f.bonusUntil = f.idleUntil + EV.FLOOD.BONUS_DAYS;
    }
    mod(s, 'inundatio', 'Inundatio: riverside fields under water', EV.FLOOD.IDLE, {}, 'inundatio', false);
    mod(s, 'inundatio.silt', 'Silt: riverside fields +15%', EV.FLOOD.IDLE + EV.FLOOD.BONUS_DAYS, {}, 'inundatio', true);
    log(s, 'bad', `The river floods ${plural(fields.length, 'field', 'fields')}; they lie idle ${EV.FLOOD.IDLE} days, then the silt will feed them a year.`, ['highlight']);
    return true;
  },
};

const frigus: EventDef = {
  id: 'frigus', kind: 'instant', benign: false, harmful: true, cooldown: 365, roll: true,
  weight: (s) => (season(s) === SEASON.autumnus ? 0.5 : 0),
  start: (s) => {
    const dec = nextSeasonStart(s.day, SEASON.hiems);
    log(s, 'event', `The Augur watches the geese fly south early: a hard Hiems is coming. From ${formatRoman(dec)} fields ×0.8 and wells ×0.85.`, ['highlight']);
    return true;
  },
};

/** On Kal. Dec.: a Hiems dura foretold in the Autumnus just ended sets in until Kal. Mart. */
export function applyFrigus(s: GameState): void {
  if (seasonOf(s.day) !== SEASON.hiems || seasonOf(s.day - 1) !== SEASON.autumnus) return;
  const fired = s.eventDays.frigus;
  if (fired === undefined || s.day - fired > 92) return;
  const until = nextSeasonStart(s.day);
  addModifier(s, { id: 'frigus', label: 'Hiems dura: fields ×0.8, wells ×0.85', until, fx: { mul: { fields: EV.FRIGUS.FIELDS, wells: EV.FRIGUS.WELLS } }, benign: false, source: 'frigus' });
}

const nuptiae: EventDef = {
  id: 'nuptiae', kind: 'instant', benign: true, harmful: false, cooldown: 365, roll: true,
  weight: (s) => (s.people.length >= EV.NUPTIAE.POP ? 0.6 : 0),
  start: (s, ev) => {
    const gentes = [...new Set(s.families.map((f) => f.gens))].sort();
    const a = gentes.length > 0 ? ev.rng.pick(gentes) : 'Valerius';
    const rest = gentes.filter((g) => g !== a);
    const b = rest.length > 0 ? ev.rng.pick(rest) : a;
    mod(s, 'nuptiae', 'A great wedding', EV.DUR, { add: { morale: EV.NUPTIAE.MORALE } }, 'nuptiae', true);
    mod(s, 'nuptiae.births', 'Wedding season: births ×1.2', EV.NUPTIAE.BIRTH_DAYS, { mul: { births: EV.NUPTIAE.BIRTHS } }, 'nuptiae', true);
    log(s, 'good', `A great wedding joins the houses of the ${a.replace(/us$/, 'i')} and the ${b.replace(/us$/, 'i')}; the whole town feasts.`, ['highlight']);
    return true;
  },
};

const augurium: EventDef = {
  id: 'augurium', kind: 'instant', benign: true, harmful: false, cooldown: 180, roll: true,
  weight: () => 0.5,
  start: (s) => {
    mod(s, 'augurium', 'Eagles fly on the right', EV.DUR, { add: { morale: EV.AUGURIUM.MORALE } }, 'augurium', true);
    log(s, 'good', 'Eagles fly on the right: the Augur declares the omens favourable.', ['highlight']);
    return true;
  },
};

const messis: EventDef = {
  id: 'messis', kind: 'instant', benign: true, harmful: false, cooldown: 365, roll: true,
  weight: (s) => (season(s) === SEASON.aestas && done(s, 'ager').length > 0 ? 0.6 : 0),
  start: (s) => {
    mod(s, 'messis', 'A bountiful season: fields ×1.25', EV.DUR, { mul: { fields: EV.MESSIS.FIELDS } }, 'messis', true);
    log(s, 'good', 'The ears hang heavy: a bountiful season in the fields (+25% for a month).', ['highlight']);
    return true;
  },
};

const coloni: EventDef = {
  id: 'coloni', kind: 'special', benign: true, harmful: false, cooldown: 0, roll: false,
  weight: (s, v) => (v.c.workforce === 0 && s.eventDays.coloni === undefined ? 1 : 0),
  start: (s, ev) => {
    let souls = 0;
    for (let k = 0; k < EV.COLONI.FAMILIES; k++) {
      const fam = makeFamily(s, ev.rng, 'couple', GENTES_IMMIGRANT);
      admitFamily(s, ev.tc, fam, true);
      souls += fam.people.length;
    }
    log(s, 'event', `No hands are left to work. The legion sends coloni: ${souls} souls arrive along the via.`, ['highlight']);
    return true;
  },
};

const latrones: EventDef = {
  id: 'latrones', kind: 'special', benign: false, harmful: true, cooldown: 0, roll: false,
  weight: () => 0,                                             // only on the road: events.banditCheck
  start: () => false,
};

const mercator: EventDef = {
  id: 'mercator', kind: 'special', benign: true, harmful: false, cooldown: 0, roll: false,
  weight: (s) => (s.trade.merchant ? 0 : 1),                    // the daily visit roll lives in trade.ts
  start: () => false,                                          // events.fireEvent hands it to trade.spawnMerchant
};

/** The catalogue (DESIGN §12.2), keyed by id. */
export const EVENT_DEFS: Record<EventId, EventDef> = {
  veterani, legatus, mutuum, pestilentia, robigo, siccitas, annonaRomae, ignis, inundatio, frigus, latrones, nuptiae, augurium, messis, mercator, coloni,
};
