// tests/save.test.ts — round trip, sanitiser fixtures, migrations, export/import, prefs, Fasti, offline = N ticks (WP-D).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { BUILDER } from '../src/game/types';
import type { Building, GameState } from '../src/game/types';
import { nextId } from '../src/game/state';
import { invalidate } from '../src/game/memo';
import { newCtx, tick } from '../src/game/sim';
import {
  DEFAULT_PREFS, KEYS, MIGRATIONS, SAVE_VERSION, addFasti, clearSave, deserialize, exportText, fastiEntry, hasSave, importText, loadFasti,
  loadGame, loadPrefs, saveGame, savePrefs, serialize,
} from '../src/game/save';
import { describeAway, offlineDays, offlineRun, simulateOffline } from '../src/game/offline';
import { forceEvent, fresh, noNaN, run } from './util';

type Raw = ReturnType<typeof JSON.parse>;   // a parsed save, before sanitising

/** An in-memory localStorage (optionally one that refuses writes). */
function installStorage(refuse = false): Map<string, string> {
  const m = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { if (refuse) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  return m;
}

afterEach(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });

function raw(s: GameState): Raw {
  return JSON.parse(serialize(s)) as Raw;
}

function addBuilding(s: GameState, type: Building['type'], extra?: Partial<Building>): Building {
  const id = nextId(s);
  const b: Building = { id, type, x: 2 + id * 2, y: 2, owner: 'player', status: 'done', placed: s.day, progress: 1, work: 1, paid: true, order: id, open: true, prio: 1, ...extra };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

describe('round trip', () => {
  it('save → load → continue equals never saving', () => {
    const a = run(fresh(5), 120);
    const half = run(fresh(5), 60);
    const b = deserialize(serialize(half))!;
    expect(b).toEqual(half);
    run(b, 60);
    expect(serialize(b)).toBe(serialize(a));
  });

  it('keeps cards, the gate party, caravans and modifiers exactly', () => {
    const s = fresh();
    s.rank = 1;
    s.morale = 70;
    s.res.grain = 5000;
    for (let i = 0; i < 3; i++) addBuilding(s, 'area', { house: { tier: 'casa', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
    for (let i = 0; i < 10; i++) s.people.push({ id: nextId(s), prae: 'Gaius', gens: 'Marius', female: false, born: s.day - 30 * 365, family: 1, spouse: null, mother: null, father: null, home: null, work: null, skills: {} });
    invalidate(s);
    expect(forceEvent(s, 'veterani')).toBe(true);
    expect(forceEvent(s, 'augurium')).toBe(true);
    s.trade.caravans.push({ id: nextId(s), contract: null, hub: 'durii', mode: 'import', res: 'stone', qty: 40, value: 170.5, depart: s.day, arrive: s.day + 9, kind: 'emergency' });
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
    expect(noNaN(back!)).toEqual([]);
  });
});

describe('sanitiser', () => {
  it('turns NaN and ±Infinity into finite numbers (0, then clamped to range)', () => {
    const s = fresh();
    s.res.grain = Number.NaN;
    s.res.water = Number.POSITIVE_INFINITY;
    s.morale = Number.NaN;
    s.counters.coinEma = Number.NaN;
    s.stats.playMs = Number.NEGATIVE_INFINITY;
    s.needs.hunger[1] = Number.NaN;
    s.trade.market.grain = Number.NaN;
    s.decisions.settings.grainReserve = Number.NaN;
    s.people[0].born = Number.NaN;
    const r = raw(s);
    r.ordo.emergency.lastImport = 'yesterday';
    const back = deserialize(JSON.stringify(r))!;
    expect(back).not.toBeNull();
    expect(noNaN(back)).toEqual([]);
    expect(back.res.grain).toBe(0);
    expect(back.res.water).toBe(0);
    expect(back.morale).toBe(0);                                   // ARCHITECTURE §11.2: non-finite → 0, then clamped
    expect(back.counters.coinEma).toBe(0);
    expect(back.trade.market.grain).toBe(B.trade.CLAMP[0]);
    expect(back.decisions.settings.grainReserve).toBe(10);
    expect(Number.isFinite(back.ordo.emergency.lastImport)).toBe(true);
  });

  it('drops unknown ids and resets unknown options; dangling references become null', () => {
    const s = fresh();
    const r = raw(s);
    const ghostId = 9999;
    r.buildings.push({ ...r.buildings[1], id: ghostId, type: 'colosseum' });
    r.people[0].work = ghostId;
    r.people[1].home = ghostId;
    r.people[2].spouse = 4242;
    r.decisions.focus = 'war';
    r.decisions.edicts.rationes = 'bogus';
    r.decisions.edicts.ludi = 'magni';
    r.decisions.paths = { charter: 'barbarians', path9: 'x', path1: 'pagus' };
    r.decisions.settings.spareBeds = 9999;
    r.trade.contracts = [{ id: 5000, hub: 'londinium', mode: 'export', res: 'timber', qty: 10, repeat: false, owner: 'player', status: 'idle', trips: 0, created: 90 }];
    r.trade.hubsTraded = ['durii', 'atlantis'];
    r.guidance.advisories = { 'nobody.rule': { rule: 'nobody.rule' } };
    r.guidance.muted = ['annonae.famine', 'x.y'];
    r.guidance.tips = ['welcome', 'nope'];
    r.guidance.milestoneDays = { firstWork: 100, glory: 5 };
    r.guidance.objective = 99;
    r.eventDays = { augurium: 400, dragon: 3 };
    r.choice = { event: 'dragon', options: [] };
    r.ordo.pin = 'pyramid';
    r.ordo.requests = [{ type: 'lararium', day: 95 }, { type: 'pyramid', day: 95 }];
    const back = deserialize(JSON.stringify(r))!;
    expect(back.buildings.some((b) => b.id === ghostId)).toBe(false);
    expect(back.people[0].work).toBeNull();
    expect(back.people[1].home).toBeNull();
    expect(back.people[2].spouse).toBeNull();
    expect(back.decisions.focus).toBe('concordia');
    expect(back.decisions.edicts.rationes).toBe('plenae');
    expect('ludi' in back.decisions.edicts).toBe(false);
    expect(back.decisions.paths).toEqual({ path1: 'pagus' });
    expect(back.decisions.settings.spareBeds).toBe(40);
    expect(back.trade.contracts).toEqual([]);
    expect(back.trade.hubsTraded).toEqual(['durii']);
    expect(back.guidance.advisories).toEqual({});
    expect(back.guidance.muted).toEqual(['annonae.famine']);
    expect(back.guidance.tips).toEqual(['welcome']);
    expect(back.guidance.milestoneDays).toEqual({ firstWork: 100 });
    expect(back.guidance.objective).toBe(24);
    expect(back.eventDays).toEqual({ augurium: 400 });
    expect(back.choice).toBeNull();
    expect(back.ordo.pin).toBeNull();
    expect(back.ordo.requests).toEqual([{ type: 'lararium', day: 95 }]);
    expect(noNaN(back)).toEqual([]);
  });

  it('fills missing keys from a new game and re-sorts lists', () => {
    const s = run(fresh(3), 10);
    const r = raw(s);
    delete r.counters;
    delete r.decisions.settings.spareBeds;
    delete r.trade.market;
    delete r.guidance.objective;
    delete r.eventDays;
    r.people.reverse();
    r.buildings.push(r.buildings[0]);
    r.roads = [...r.roads].reverse().concat(r.roads.slice(0, 3));
    const back = deserialize(JSON.stringify(r))!;
    expect(back).not.toBeNull();
    expect(back.counters.fedStreak).toBe(0);
    expect(back.decisions.settings.spareBeds).toBe(8);
    expect(back.trade.market.grain).toBe(1);
    expect(back.guidance.objective).toBe(0);
    expect(back.eventDays).toEqual({});
    const ids = (a: { id: number }[]): number[] => a.map((x) => x.id);
    expect(ids(back.people)).toEqual(ids(s.people));
    expect(ids(back.buildings)).toEqual(ids(s.buildings));
    expect(back.roads).toEqual(s.roads);
    expect(back.nextId).toBe(s.nextId);
  });

  it('rejects what cannot be a save', () => {
    const s = fresh();
    const r = raw(s);
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('[1,2,3]')).toBeNull();
    expect(deserialize(JSON.stringify({ ...r, version: undefined }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...r, version: SAVE_VERSION + 1 }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...r, seed: 'forty-two' }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...r, people: 'many' }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...r, buildings: r.buildings.filter((b: Raw) => b.type !== 'principia') }))).toBeNull();
  });

  it('runs the migration chain from older versions', () => {
    const s = fresh();
    const r = raw(s);
    r.version = 0;
    r.oldName = r.name;
    delete r.name;
    expect(deserialize(JSON.stringify(r))).toBeNull();              // no migration for v0 → unusable
    MIGRATIONS[0] = (o: Raw) => { const { oldName, ...rest } = o; return { ...rest, name: oldName, version: 1 }; };
    try {
      const back = deserialize(JSON.stringify(r))!;
      expect(back.version).toBe(SAVE_VERSION);
      expect(back.name).toBe(s.name);
      expect(back).toEqual(s);
    } finally {
      delete MIGRATIONS[0];
    }
  });
});

describe('export and import', () => {
  it('CV1 + base64 of UTF-8 JSON; also bare base64 or raw JSON', () => {
    const s = run(fresh(9), 20);
    s.name = 'Aquae Ñumantinae · Αἰών';
    const text = exportText(s);
    expect(text.startsWith('CV1:')).toBe(true);
    expect(importText(text)).toEqual(s);
    expect(importText(`  ${text.slice(4).replace(/(.{60})/g, '$1\n')}  `)).toEqual(s);
    expect(importText(serialize(s))).toEqual(s);
    expect(importText('CV1:@@@')).toBeNull();
    expect(importText('')).toBeNull();
    expect(importText('hello world')).toBeNull();
  });
});

describe('localStorage', () => {
  beforeEach(() => { installStorage(); });

  it('uses the namespaced keys; saves with the wall clock; loads; clears', () => {
    expect(KEYS).toEqual({ save: 'castravaleria.save.v1', prefs: 'castravaleria.prefs.v1', fasti: 'castravaleria.fasti.v1' });
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
    const s = run(fresh(), 5);
    expect(saveGame(s, 123_456)).toBe(true);
    expect(s.lastSave).toBe(123_456);
    expect(hasSave()).toBe(true);
    expect(localStorage.getItem('castravaleria.save.v1')).toBe(serialize(s));
    expect(loadGame()).toEqual(s);
    clearSave();
    expect(hasSave()).toBe(false);
  });

  it('a refused write returns false; a missing storage never throws', () => {
    installStorage(true);
    expect(saveGame(fresh(), 1)).toBe(false);
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(loadFasti()).toEqual([]);
    expect(() => { savePrefs(DEFAULT_PREFS); addFasti(fastiEntry(fresh())); clearSave(); }).not.toThrow();
  });

  it('prefs merge over the defaults; invalid fields fall back', () => {
    expect(DEFAULT_PREFS).toEqual({ sound: true, volume: 0.7, speed: 1, tips: true, slowForNews: true, pauseOnCritical: false });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    savePrefs({ ...DEFAULT_PREFS, sound: false, speed: 5 });
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, sound: false, speed: 5 });
    localStorage.setItem(KEYS.prefs, JSON.stringify({ volume: 7, speed: 3, tips: 'yes', pauseOnCritical: true }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, volume: 1, pauseOnCritical: true });
    localStorage.setItem(KEYS.prefs, '{broken');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('the Fasti keep the newest 50 well-formed entries', () => {
    const s = fresh();
    s.decisions.paths = { charter: 'veterani', path1: 'pagus' };
    s.stats.victoryDay = 14_000;
    s.stats.peakPop = 1050;
    const e = fastiEntry(s);
    expect(e).toEqual({ name: 'Castra Valeria', seed: 42, legacy: 0, founded: B.time.START_DAY, dedicated: 14_000, peakPop: 1050, paths: ['veterani', 'pagus'], playMs: 0 });
    for (let i = 0; i < 55; i++) addFasti({ ...e, seed: i });
    const list = loadFasti();
    expect(list.length).toBe(B.ui.FASTI_MAX);
    expect(list[0].seed).toBe(54);
    localStorage.setItem(KEYS.fasti, JSON.stringify([e, { name: 3 }, { ...e, paths: ['dragons'] }, { ...e, dedicated: null }]));
    expect(loadFasti()).toEqual([e, { ...e, dedicated: null }]);
  });
});

describe('offline catch-up', () => {
  it('0.5 days a second, capped at 1,825; nothing under a minute', () => {
    expect(offlineDays(200_000)).toBe(100);
    expect(offlineDays(24 * 3600 * 1000)).toBe(B.time.OFFLINE_MAX_DAYS);
    expect(offlineRun(fresh(), 59_999)).toBeNull();
    expect(offlineRun(fresh(), 60_000)!.days).toBe(30);
    expect(simulateOffline(fresh(), 1000)).toBeNull();
  });

  it('offlineRun = N real ticks with ctx.offline (sliced or at once)', () => {
    const a = fresh(12);
    const b = fresh(12);
    const c = fresh(12);
    const rep = simulateOffline(a, 200_000)!;
    for (let i = 0; i < 100; i++) tick(b, newCtx(true));
    expect(serialize(a)).toBe(serialize(b));
    expect(rep.days).toBe(100);
    const r = offlineRun(c, 200_000)!;
    let steps = 0;
    while (!r.step(B.time.SLICE_DAYS)) steps++;
    expect(steps).toBe(9);
    expect(r.progress()).toBe(1);
    expect(serialize(c)).toBe(serialize(a));
  });

  it('fills the Litterae Ordinis: snapshots, decided in your name, highlights, lowest point, awaiting', () => {
    const s = fresh(4);
    s.rank = 1;
    s.morale = 70;
    addBuilding(s, 'lararium');                                  // Res Gestae I completes while away
    for (let i = 0; i < 3; i++) addBuilding(s, 'area', { house: { tier: 'casa', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
    for (let i = 0; i < 10; i++) s.people.push({ id: nextId(s), prae: 'Gaius', gens: 'Marius', female: false, born: s.day - 30 * 365, family: 1, spouse: null, mother: null, father: null, home: null, work: null, skills: {} });
    invalidate(s);
    expect(forceEvent(s, 'legatus')).toBe(true);
    const rep = simulateOffline(s, 200_000)!;
    expect(rep.awayMs).toBe(200_000);
    expect(rep.daysPlanned).toBe(100);
    expect(rep.days).toBe(100);
    expect(rep.before.day).toBe(B.time.START_DAY);
    expect(rep.after.day).toBe(B.time.START_DAY + 100);
    expect(rep.before.pop).toBe(34);
    expect(rep.decided.some((t) => t.includes('modest welcome'))).toBe(true);
    expect(rep.highlights.some((e) => e.text.startsWith('Res Gestae I:'))).toBe(true);
    expect(Number.isFinite(rep.lowest.grain.doh)).toBe(true);
    expect(rep.lowest.water.day).toBeGreaterThanOrEqual(B.time.START_DAY);
    expect(rep.awaiting.petition).toBeNull();
    expect(Array.isArray(rep.awaiting.advisories)).toBe(true);
    const text = describeAway(rep);
    expect(text.heading).toContain('100 days');
    expect(text.heading).toContain('3 min 20 s');
    expect(text.city).toContain('Souls 34 →');
    expect(text.stores).toContain('Coin');
    expect(text.decided).toEqual(rep.decided);
    expect(text.lowest).toMatch(/fell to \d+ days|never ran short/);
  });

  it('stops early on victory and reports the days actually simulated', () => {
    const s = fresh();
    const id = nextId(s);
    s.buildings.push({ id, type: 'capitolium', x: 47, y: 29, owner: 'player', status: 'building', placed: s.day, progress: 0.99, work: 10, paid: true, order: id, open: true, prio: 1, matUsed: {} });
    s.people.find((p) => p.work === null && s.day - p.born > 20 * 365)!.work = BUILDER;
    for (const r of ['stone', 'concrete', 'tiles', 'iron', 'denarii'] as const) s.res[r] += 5000;   // the last 1% draws its materials pro rata
    invalidate(s);
    const r = offlineRun(s, 3_600_000)!;
    expect(r.step(r.days)).toBe(true);
    const rep = r.report();
    expect(s.victory).toBe(true);
    expect(rep.days).toBeLessThan(rep.daysPlanned);
    expect(rep.after.day).toBe(B.time.START_DAY + rep.days);
  });
});
