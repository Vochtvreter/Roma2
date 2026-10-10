// tests/events.test.ts — pacing, defaults, the veterans, relief, bandits, clamps over 2,000 forced events, festivals (WP-D).
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { EVENTS, RESOURCES } from '../src/game/types';
import type { Building, BuildingId, Caravan, Cost, EventId, GameState, HouseTierId, TickContext } from '../src/game/types';
import { Rng } from '../src/game/rng';
import { nextId } from '../src/game/state';
import { invalidate, touchPeople } from '../src/game/memo';
import { fx, fxAdd } from '../src/game/fx';
import { dayOf, elapsed, nextSeasonStart } from '../src/game/calendar';
import { view } from '../src/game/sim';
import { census } from '../src/game/census';
import { banditCheck, chooseOption, eventsDay, fireEvent, silentOption, triggerRelief } from '../src/game/events';
import { EVENT_DEFS } from '../src/game/events-catalogue';
import { festivalKept, festivalsDay, nextFestival } from '../src/game/events-festivals';
import { tradeDay } from '../src/game/trade';
import { ctx, forceEvent, fresh, noNaN } from './util';

const START = B.time.START_DAY;

function addBuilding(s: GameState, type: BuildingId, extra?: Partial<Building>): Building {
  const id = nextId(s);
  const b: Building = {
    id, type, x: 2 + (id % 30) * 2, y: 2 + Math.floor(id / 30) * 4, owner: 'player', status: 'done', placed: s.day, progress: 1,
    work: 1, paid: true, order: id, open: true, prio: 1, doneDay: s.day, ...extra,
  };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

function addHouse(s: GameState, tier: HouseTierId): Building {
  return addBuilding(s, 'area', { house: { tier, pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
}

function growTo(s: GameState, pop: number): void {
  while (s.people.length < pop) {
    const id = nextId(s);
    s.people.push({ id, prae: 'Gaius', gens: 'Marius', female: false, born: s.day - 30 * 365, family: 1, spouse: null, mother: null, father: null, home: null, work: null, skills: {} });
  }
  touchPeople(s);
}

/** An Oppidum where every event of the catalogue can fire: people, beds, fields (one by the river), insulae, a kiln. */
function richState(seed = 42): GameState {
  const s = fresh(seed);
  s.rank = 2;
  s.decisions.paths = { charter: 'agricolae', path1: 'pagus' };
  for (const r of RESOURCES) s.res[r] = 3000;
  s.res.grain = 20_000;
  growTo(s, 80);
  for (let i = 0; i < 12; i++) addHouse(s, 'casa');
  addHouse(s, 'insula'); addHouse(s, 'insula');
  addBuilding(s, 'ager', { x: 60, y: 60 });
  addBuilding(s, 'ager', { x: 89, y: 50 });            // two tiles from the toy river
  addBuilding(s, 'figlina', { x: 70, y: 70 });
  for (let i = 0; i < 2; i++) addBuilding(s, 'puteus');
  s.morale = 70;
  return s;
}

/** Steps eventsDay alone over `days` (with modifier expiry, as the tick's housekeeping does); reports what fired each day. */
function stepEvents(s: GameState, days: number, offline = false, onDay?: (day: number, fired: EventId[], c: TickContext) => void): void {
  const rng = new Rng(s.rng);
  for (let i = 0; i < days; i++) {
    s.day += 1;
    s.modifiers = s.modifiers.filter((m) => m.until > s.day);
    const c = ctx(offline);
    eventsDay(s, c, rng, view(s));
    onDay?.(s.day, EVENTS.filter((id) => s.eventDays[id] === s.day), c);
  }
  s.rng = rng.state;
}

describe('pacing (real time)', () => {
  it('no event before day 300, ≥ 200 days between cards, ≥ 120 between harmful events, cooldowns kept', () => {
    const s = richState();
    const fired: { id: EventId; day: number }[] = [];
    stepEvents(s, 12_000, false, (day, ids, c) => {
      for (const id of ids) fired.push({ id, day });
      const cards = c.fx.filter((e) => e.kind === 'event').length;
      expect(cards).toBe(ids.filter((id) => EVENT_DEFS[id].kind === 'choice').length);   // fx 'event' = a new card
    });
    expect(fired.length).toBeGreaterThan(15);
    expect(Math.min(...fired.map((f) => f.day - START))).toBeGreaterThanOrEqual(B.events.START);
    const gaps = (list: { day: number }[]): number[] => list.slice(1).map((f, i) => f.day - list[i].day);
    const cards = fired.filter((f) => EVENT_DEFS[f.id].kind === 'choice');
    const harmful = fired.filter((f) => EVENT_DEFS[f.id].harmful);
    expect(cards.length).toBeGreaterThan(5);
    expect(harmful.length).toBeGreaterThan(3);
    expect(Math.min(...gaps(cards))).toBeGreaterThanOrEqual(B.events.CHOICE_GAP);
    expect(Math.min(...gaps(harmful))).toBeGreaterThanOrEqual(B.events.HARMFUL_GAP);
    for (const id of EVENTS) {
      const own = fired.filter((f) => f.id === id);
      if (own.length > 1) expect(Math.min(...gaps(own)), id).toBeGreaterThanOrEqual(EVENT_DEFS[id].cooldown);
    }
    expect(B.events.CHOICE_GAP).toBeGreaterThan(B.events.CHOICE_DAYS);   // so at most one card is ever pending
    expect(noNaN(s)).toEqual([]);
  });

  it('offline: benign instant events only, on half the days; no new cards; a pending card takes its default', () => {
    const s = richState(7);
    s.day = START + B.events.START;
    expect(forceEvent(s, 'legatus')).toBe(true);
    const expires = s.choice!.expires;
    const fired: EventId[] = [];
    stepEvents(s, 6000, true, (_d, ids) => { fired.push(...ids); });
    expect(fired.length).toBeGreaterThan(5);
    for (const id of fired) {
      expect(EVENT_DEFS[id].benign, id).toBe(true);
      expect(EVENT_DEFS[id].kind, id).not.toBe('choice');
    }
    expect(s.choice).toBeNull();
    const line = s.log.find((e) => e.day === expires && e.kind === 'event');
    expect(line?.text).toContain('modest welcome');
    expect(line?.tags).toContain('decided');
  });
});

describe('cards and defaults', () => {
  it('every card defaults to a free, cautious option', () => {
    for (const id of EVENTS) {
      if (EVENT_DEFS[id].kind !== 'choice') continue;
      const s = richState();
      s.day = nextSeasonStart(START, 1) + 5;               // Aestas: drought and blight are in season
      if (id === 'robigo') addBuilding(s, 'ager', { x: 40, y: 70 });
      expect(forceEvent(s, id), id).toBe(true);
      const c = s.choice!;
      expect(c.event).toBe(id);
      expect(c.options[c.defaultIndex].cost, id).toBeUndefined();
      expect(c.expires - c.created).toBe(id === 'mutuum' ? B.events.RELIEF_DAYS : B.events.CHOICE_DAYS);
    }
  });

  it('silence takes the default, or the first affordable option after it (wrapping)', () => {
    const s = fresh();
    s.choice = {
      event: 'legatus', kicker: '', title: 'T', text: '', created: s.day, expires: s.day + 1, defaultIndex: 1,
      options: [{ label: 'a', note: '', key: 'modest' }, { label: 'b', note: '', key: 'banquet', cost: { denarii: 1e9 } }, { label: 'c', note: '', key: 'modest', cost: { denarii: 1e9 } }],
    };
    expect(silentOption(s)).toBe(0);
  });

  it('the player answers; costs are paid and the card closes', () => {
    const s = richState();
    expect(forceEvent(s, 'legatus')).toBe(true);
    const den = s.res.denarii;
    expect(chooseOption(s, 5)).toMatchObject({ ok: false, code: 'invalid' });
    expect(chooseOption(s, 0).ok).toBe(true);
    expect(s.res.denarii).toBe(den - 150);
    expect(s.res.wine).toBe(3000 - 20);
    expect(fxAdd(s, 'fama')).toBe(6);
    expect(fx(s, 'petitionFee')).toBeCloseTo(0.85);
    expect(s.choice).toBeNull();
    expect(chooseOption(s, 0)).toMatchObject({ ok: false, code: 'noChoice' });
  });
});

describe('the veterans at the gate', () => {
  it('2–3 skilled older families camp at the gate; granting land settles them as beds allow', () => {
    const s = richState();
    s.decisions.paths.charter = 'veterani';
    expect(forceEvent(s, 'veterani')).toBe(true);
    const gate = s.gate!;
    expect(gate.families.length).toBeGreaterThanOrEqual(2);
    expect(gate.families.length).toBeLessThanOrEqual(3);
    expect(gate.until).toBe(s.day + B.events.VETERAN_STAY);
    for (const f of gate.families) {
      const head = f.people.find((p) => p.id === f.family.head)!;
      const age = Math.floor((s.day - head.born) / 365);
      expect(age).toBeGreaterThanOrEqual(54);
      expect(age).toBeLessThanOrEqual(62);
      expect(head.vet).toBe(true);
      const best = Math.max(...(['agri', 'fabri', 'silva', 'lapis'] as const).map((k) => head.skills[k] ?? 0));
      expect(best).toBeGreaterThanOrEqual(4);              // 3–4, +1 for Colonia veteranorum
      expect(best).toBeLessThanOrEqual(5);
    }
    const c = s.choice!;
    expect(c.options.map((o) => o.key)).toEqual(['grant', 'craft', 'send']);
    expect(c.defaultIndex).toBe(2);
    expect(c.data?.families).toBe(gate.families.length);
    const pop = s.people.length;
    const den = s.res.denarii;
    const souls = gate.families.reduce((a, f) => a + f.people.length, 0);
    expect(chooseOption(s, 0).ok).toBe(true);
    expect(s.people.length).toBe(pop + souls);
    expect(s.res.denarii).toBe(den - 80 * gate.families.length);
    expect(s.modifiers.find((m) => m.id === 'veterani')?.fx.add?.morale).toBe(Math.min(9, 3 * gate.families.length));
    expect(s.gate).toBeNull();
    expect(s.people.every((p, i) => i === 0 || s.people[i - 1].id < p.id)).toBe(true);
  });

  it('left unanswered, they are sent on to Colonia Augusta (Fama +2 for a year)', () => {
    const s = richState();
    expect(forceEvent(s, 'veterani')).toBe(true);
    const pop = s.people.length;
    stepEvents(s, B.events.VETERAN_STAY);
    expect(s.gate).toBeNull();
    expect(s.choice).toBeNull();
    expect(s.people.length).toBe(pop);
    expect(fxAdd(s, 'fama')).toBe(2);
    expect(s.log.some((e) => e.text.includes('sent on to Colonia Augusta') && e.tags?.includes('decided'))).toBe(true);
  });

  it('never spawns without beds, spirits or grain', () => {
    const s = richState();
    s.morale = 40;
    expect(forceEvent(s, 'veterani')).toBe(false);
  });
});

describe('the Legate\'s relief', () => {
  it('offers 30 days of grain against a debt; offline it is accepted at once; once a year', () => {
    const s = richState();
    s.res.grain = 50;
    const c = ctx(true);
    triggerRelief(s, c, view(s));
    expect(s.choice).toBeNull();
    const car = s.trade.caravans.find((x) => x.kind === 'relief')!;
    const need = census(s).need.grain;
    expect(car.qty).toBe(Math.round(B.emergency.RELIEF_DAYS * need));
    expect(car.arrive).toBe(s.day + B.emergency.RELIEF_ARRIVE);
    expect(s.trade.debt).toBeCloseTo(2 * 2 * car.qty);
    expect(s.log.some((e) => e.tags?.includes('decided') && e.text.includes('relief'))).toBe(true);
    triggerRelief(s, ctx(true), view(s));
    expect(s.trade.caravans.filter((x) => x.kind === 'relief').length).toBe(1);   // cooldown
    s.day = car.arrive;
    const g = s.res.grain;
    tradeDay(s, ctx(), new Rng(1), view(s));
    expect(s.res.grain).toBe(g + car.qty);
  });

  it('online it is a card that makes way for nothing else; Annona publica makes it free once a year', () => {
    const s = richState();
    s.decisions.paths.path3 = 'annonaPublica';
    forceEvent(s, 'legatus');
    triggerRelief(s, ctx(), view(s));
    expect(s.choice?.event).toBe('mutuum');               // the Legate's banquet card took its default
    expect(s.choice?.defaultIndex).toBe(0);
    expect(chooseOption(s, 0).ok).toBe(true);
    expect(s.trade.debt).toBe(0);
    expect(s.ordo.emergency.freeReliefYear).toBeGreaterThan(0);
  });
});

describe('bandits', () => {
  const always = { chance: () => true } as unknown as Rng;
  const caravan = (s: GameState, oneWay: number): Caravan => ({ id: 999, contract: 1, hub: 'narbo', mode: 'import', res: 'timber', qty: 80, value: 300, depart: s.day - 2 * oneWay, arrive: s.day, kind: 'contract' });

  it('rob long roads only, never offline, and respect the harmful gap', () => {
    const s = fresh();
    const short = caravan(s, 6);
    banditCheck(s, ctx(), always, short);
    expect(short.qty).toBe(80);
    const off = caravan(s, 14);
    banditCheck(s, ctx(true), always, off);
    expect(off.qty).toBe(80);
    const long = caravan(s, 14);
    banditCheck(s, ctx(), always, long);
    expect(long.qty).toBeCloseTo(80 * 0.7);
    expect(s.counters.lastHarmfulDay).toBe(s.day);
    const again = caravan(s, 14);
    banditCheck(s, ctx(), always, again);
    expect(again.qty).toBe(80);
  });
});

/** The stock an answer declares (its cost), to separate a chosen price from what the event itself takes. */
function declared(c: Cost | undefined): Cost {
  return c ?? {};
}

describe('clamps (DESIGN §12.1)', () => {
  it('2,000 forced events never take more than 30% of a stock or 5% of the people', () => {
    const rng = new Rng(2024);
    let started = 0;
    let s = richState(11);
    for (let k = 0; k < 2000; k++) {
      if (k % 200 === 0) s = richState(11 + k);
      s.day += rng.int(1, 40);
      for (const r of RESOURCES) s.res[r] = rng.range(0, 5000);
      s.res.grain = rng.range(2000, 30_000);
      if (s.people.length < 70) growTo(s, 80);
      const id = rng.pick(EVENTS);
      const before = { ...s.res };
      const pop = s.people.length;
      if (!forceEvent(s, id)) continue;
      started++;
      let cost: Cost = {};
      if (s.choice) {
        const random = rng.chance(0.5);
        const pick = random ? rng.int(0, s.choice.options.length - 1) : silentOption(s);
        const opt = s.choice.options[pick];
        if (opt.cost && !Object.entries(opt.cost).every(([r, v]) => s.res[r as keyof typeof s.res] >= (v as number))) {
          chooseOption(s, silentOption(s));
        } else {
          cost = declared(opt.cost);
          chooseOption(s, pick);
        }
      }
      for (const r of RESOURCES) {
        const lost = before[r] - s.res[r];
        expect(lost, `${id} took ${r}`).toBeLessThanOrEqual(before[r] * B.events.CLAMP_RES + (cost[r] ?? 0) + 1e-6);
      }
      expect(pop - s.people.length, `${id} deaths`).toBeLessThanOrEqual(Math.floor(pop * B.events.CLAMP_POP));
      s.modifiers = s.modifiers.filter((m) => m.until > s.day);
    }
    expect(started).toBeGreaterThan(600);
    expect(noNaN(s)).toEqual([]);
  });

  it('fire damages one insula or workshop and turns out the overflow', () => {
    const s = richState();
    for (const b of s.buildings) if (b.type === 'figlina') b.status = 'building';
    const ins = s.buildings.filter((b) => b.house?.tier === 'insula');
    for (const p of s.people.slice(0, 24)) p.home = ins[0].id;
    for (const p of s.people.slice(24, 48)) p.home = ins[1].id;
    touchPeople(s);
    expect(forceEvent(s, 'ignis')).toBe(true);
    const hit = ins.find((b) => b.damagedUntil !== undefined)!;
    expect(hit.damagedUntil).toBe(s.day + 30);
    expect(s.people.filter((p) => p.home === hit.id).length).toBeLessThanOrEqual(12);
    expect(s.counters.lastFireDay).toBe(s.day);
  });
});

describe('seasonal events', () => {
  it('Hiems dura foretold in Autumnus sets in on Kal. Dec.', () => {
    const s = richState();
    s.day = nextSeasonStart(START, 2) + 10;               // Autumnus
    const base = fx(s, 'fields');                          // Coloni agrarii: ×1.2
    expect(forceEvent(s, 'frigus')).toBe(true);
    expect(fx(s, 'fields')).toBe(base);
    stepEvents(s, nextSeasonStart(s.day, 3) - s.day);
    expect(fx(s, 'fields')).toBeCloseTo(0.8 * base);
    expect(fx(s, 'wells')).toBeCloseTo(0.85);
    stepEvents(s, 95);
    expect(fx(s, 'fields')).toBe(base);
  });

  it('drought: digging deeper spares the wells, not the cisterns', () => {
    const s = richState();
    s.day = nextSeasonStart(START, 1) + 3;
    expect(forceEvent(s, 'siccitas')).toBe(true);
    expect(fx(s, 'wells')).toBeCloseTo(0.85);
    expect(s.choice!.options[0].cost).toEqual({ stone: 60, denarii: 90 });   // three wells
    expect(chooseOption(s, 0).ok).toBe(true);
    expect(fx(s, 'wells')).toBe(1);
    expect(fx(s, 'rain')).toBeCloseTo(0.3);
  });

  it('the coloni rescue a colony without working hands, once', () => {
    const s = fresh();
    s.people = s.people.filter((p) => s.day - p.born < 12 * 365);
    touchPeople(s);
    stepEvents(s, 1);
    expect(s.eventDays.coloni).toBeDefined();
    expect(census(s).workforce).toBeGreaterThan(0);
    const n = s.people.length;
    s.people = s.people.filter((p) => s.day - p.born < 12 * 365);
    touchPeople(s);
    stepEvents(s, 1);
    expect(s.people.length).toBeLessThan(n);
  });
});

describe('festivals', () => {
  it('Parilia, Floralia, Robigalia and Saturnalia follow the Feriae edict', () => {
    const s = richState();
    s.day = dayOf(800, 4, 21);
    const grain = s.res.grain;
    festivalsDay(s, ctx());
    expect(s.res.grain).toBeCloseTo(grain - 0.5 * s.people.length);
    expect(fxAdd(s, 'morale')).toBe(6);
    expect(s.log.some((e) => e.kind === 'fasti')).toBe(true);
    expect(festivalKept(s, 'floralia')).toBe(false);
    s.decisions.edicts.feriae = 'frequentes';
    expect(festivalKept(s, 'floralia')).toBe(true);
    s.decisions.edicts.feriae = 'nullae';
    expect(festivalKept(s, 'robigalia')).toBe(false);
    expect(festivalKept(s, 'lustrum')).toBe(true);
    s.decisions.edicts.feriae = 'solemnes';
    s.day = dayOf(800, 4, 25);
    festivalsDay(s, ctx());
    expect(s.counters.robigaliaYear).toBe(800);
    s.day = dayOf(800, 12, 17);
    festivalsDay(s, ctx());
    expect(s.counters.festivalsKept.saturnalia).toBe(1);
    expect(fx(s, 'births')).toBeCloseTo(1.2);
    expect(s.modifiers.some((m) => m.id === 'saturnalia.lanterns')).toBe(true);
  });

  it('a feast the stores cannot spare is skipped with a note from the Augur', () => {
    const s = richState();
    s.res.grain = 100;                                   // Saturnalia wants 1 grain a head: more than 30%
    s.day = dayOf(800, 12, 17);
    festivalsDay(s, ctx());
    expect(s.res.grain).toBe(100);
    expect(s.counters.festivalsKept.saturnalia).toBeUndefined();
    expect(s.log.at(-1)?.text).toContain('Saturnalia passes unkept');
  });

  it('the Lustrum every fifth year from AUC DCCCV pays the census windfall', () => {
    const s = richState();
    s.day = dayOf(805, 4, 1);
    const den = s.res.denarii;
    festivalsDay(s, ctx());
    expect(s.res.denarii).toBeCloseTo(den + 0.5 * s.people.length);
    s.day = dayOf(806, 4, 1);
    festivalsDay(s, ctx());
    expect(s.counters.festivalsKept.lustrum).toBe(1);
    s.day = dayOf(800, 4, 22);
    expect(nextFestival(s)?.id).toBe('robigalia');
    expect(elapsed(s)).toBeGreaterThan(0);
  });
});

describe('fireEvent', () => {
  it('starts each event only when its conditions hold', () => {
    const s = fresh();
    s.day = nextSeasonStart(START, 3);                   // Hiems: no seasonal events
    for (const id of ['messis', 'siccitas', 'inundatio', 'frigus', 'robigo', 'ignis', 'pestilentia', 'veterani', 'legatus', 'annonaRomae', 'nuptiae', 'latrones', 'coloni'] as EventId[]) {
      expect(forceEvent(s, id), id).toBe(false);
    }
    expect(forceEvent(s, 'augurium')).toBe(true);
    const v = view(s);
    expect(fireEvent(s, ctx(), new Rng(3), v, 'mercator')).toBe(true);
    expect(s.trade.merchant).not.toBeNull();
    expect(fireEvent(s, ctx(), new Rng(3), v, 'mercator')).toBe(false);
  });
});
