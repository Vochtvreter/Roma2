// tests/save.test.ts — round trip, sanitiser fixtures, migrations, export/import, prefs, Fasti, offline = N ticks (WP-D).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { BUILDER } from '../src/game/types';
import type { Building, GameState } from '../src/game/types';
import { nextId } from '../src/game/state';
import { invalidate } from '../src/game/memo';
import { newCtx, tick } from '../src/game/sim';
import {
  DEFAULT_PREFS, KEYS, MIGRATIONS, SAVE_VERSION, addFasti, claimSave, clearSave, deserialize, exportText, fastiEntry, hasSave, importText,
  lastExported, loadBackup, loadFasti, loadGame, loadPrefs, markExported, ownsSave, rawSave, replaceSave, saveGame, savePrefs, serialize,
} from '../src/game/save';
import { replaceQuestion } from '../src/ui/title';
import {
  AWAY_CAP_MS, awayRule, awayUnusedMs, capLine, decidedLines, describeAway, keepDecided, offlineDays, offlineRun, readyLine, simulateOffline, stalledLine,
  wonWhileAway,
} from '../src/game/offline';
import type { Decided } from '../src/game/offline';
import type { LogEntry, LogKind } from '../src/game/types';
import { petitionNeeds } from '../src/game/decisions';
import { activeAdvisories } from '../src/game/advisors/engine';
import { view } from '../src/game/sim';
import { play } from './autoplayer';
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
  it('bounds the day: a corrupt ±1e12 loads as a playable colony instead of breaking the calendar (R55)', () => {
    for (const day of [1e12, -1e12, 1e300]) {
      const r = raw(fresh(7));
      r.day = day;
      const back = deserialize(JSON.stringify(r))!;
      expect(back).not.toBeNull();
      expect(back.day).toBeGreaterThanOrEqual(B.time.START_DAY);
      expect(back.day).toBeLessThanOrEqual(B.time.START_DAY + 1_000_000);
      expect(() => run(back, 3)).not.toThrow();
    }
    const ok = run(fresh(7), 40);
    expect(deserialize(serialize(ok))!.day).toBe(ok.day);   // a real day is kept as it is
  });

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

  it('keeps the home a house card\'s request carries, and drops one that is no building id', () => {
    const r = raw(fresh());
    r.ordo.requests = [{ type: 'lararium', day: 95, house: 7 }, { type: 'taberna', day: 96, house: 'x' }, { type: 'templum', day: 97, house: 2.5 }];
    const back = deserialize(JSON.stringify(r))!;
    expect(back.ordo.requests).toEqual([{ type: 'lararium', day: 95, house: 7 }, { type: 'taberna', day: 96 }, { type: 'templum', day: 97 }]);
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

  it('migrates a version-1 save (before the growing town): `urbs` arrives after `wood`, the castrum standing', () => {
    const s = run(fresh(7), 30);
    const r = raw(s);
    delete r.urbs;
    r.version = 1;
    const back = deserialize(JSON.stringify(r))!;
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.urbs).toEqual({ traffic: {}, moenia: null, razed: null, renewed: s.urbs.renewed });
    expect(Object.keys(back)).toEqual(Object.keys(s));
    expect(serialize({ ...back, urbs: s.urbs })).toBe(serialize(s));
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
    expect(KEYS).toEqual({
      save: 'castravaleria.save.v1', prefs: 'castravaleria.prefs.v1', fasti: 'castravaleria.fasti.v1',
      owner: 'castravaleria.owner.v1', exported: 'castravaleria.exported.v1', backup: 'castravaleria.backup.v1',
    });
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

  it('one tab owns the save: the last to claim it; nobody claimed or storage blocked = owned (R02)', () => {
    expect(ownsSave('a')).toBe(true);                     // nobody has claimed it yet
    claimSave('a');
    expect(localStorage.getItem(KEYS.owner)).toBe('a');
    expect(ownsSave('a')).toBe(true);
    claimSave('b');                                       // a second tab enters a game
    expect(ownsSave('a')).toBe(false);
    expect(ownsSave('b')).toBe(true);
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(ownsSave('a')).toBe(true);                     // no storage: no other tab can be known, nor save
    expect(() => claimSave('a')).not.toThrow();
  });

  it('remembers when a copy was last exported (R54)', () => {
    expect(lastExported()).toBe(0);
    markExported(1_700_000_000_000);
    expect(lastExported()).toBe(1_700_000_000_000);
    localStorage.setItem(KEYS.exported, 'soon');
    expect(lastExported()).toBe(0);
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(lastExported()).toBe(0);
    expect(() => markExported(1)).not.toThrow();
  });

  it('prefs merge over the defaults; invalid fields fall back', () => {
    expect(DEFAULT_PREFS).toEqual({ sound: true, volume: 0.7, speed: 1, paused: false, tips: true, slowForNews: true, pauseOnCritical: false });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    savePrefs({ ...DEFAULT_PREFS, sound: false, speed: 5 });
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, sound: false, speed: 5 });
    localStorage.setItem(KEYS.prefs, JSON.stringify({ volume: 7, speed: 3, tips: 'yes', pauseOnCritical: true, paused: 'yes' }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, volume: 1, pauseOnCritical: true });
    localStorage.setItem(KEYS.prefs, '{broken');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('the player\'s pause is kept with the last speed, so a reload comes back paused (DESIGN §2.1)', () => {
    savePrefs({ ...DEFAULT_PREFS, speed: 10, paused: true });
    expect(loadPrefs()).toMatchObject({ speed: 10, paused: true });
    savePrefs({ ...DEFAULT_PREFS, speed: 10, paused: false });
    expect(loadPrefs()).toMatchObject({ speed: 10, paused: false });
    localStorage.setItem(KEYS.prefs, JSON.stringify({ speed: 5 }));   // prefs stored before the pause was kept: running
    expect(loadPrefs()).toMatchObject({ speed: 5, paused: false });
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

describe('the previous colony (the backup slot): a new colony never erases the save at once', () => {
  const DAY = 86_400_000;
  const T0 = 1_700_000_000_000;
  let m: Map<string, string>;
  beforeEach(() => { m = installStorage(); });

  it('the first save over a stored colony keeps that one, readable, for PREVIOUS_DAYS real days', () => {
    const old = run(fresh(7), 30);
    old.name = 'Vicus Vetus';
    saveGame(old, T0 - DAY);
    const stored = rawSave();
    const next = fresh(8);
    expect(replaceSave(next, T0)).toBe(true);
    expect(loadGame()).toEqual(next);                                   // the new colony is the save now
    const back = loadBackup(T0);
    expect(back).toEqual({ raw: stored, days: B.ui.PREVIOUS_DAYS });  // the old one, exactly as it was stored
    expect(deserialize(back!.raw)).toEqual(old);
    expect(loadBackup(T0 + (B.ui.PREVIOUS_DAYS - 0.5) * DAY)!.days).toBe(1);
    expect(loadBackup(T0 + B.ui.PREVIOUS_DAYS * DAY)).toBeNull();        // kept for a while, then dropped
    expect(m.has(KEYS.backup)).toBe(false);
    expect(loadGame()).toEqual(next);
  });

  it('a restore is the same replacement: the two colonies change places', () => {
    const a = fresh(7); a.name = 'Prima';
    const b = fresh(8); b.name = 'Secunda';
    saveGame(a, T0);
    replaceSave(b, T0 + 1000);                                           // Secunda founded over Prima
    replaceSave(deserialize(loadBackup(T0 + 2000)!.raw)!, T0 + 2000);    // Restore the previous colony
    expect(loadGame()!.name).toBe('Prima');
    expect(deserialize(loadBackup(T0 + 2000)!.raw)!.name).toBe('Secunda');
  });

  it('nothing stored: nothing to keep; an unreadable save is kept as it was', () => {
    expect(replaceSave(fresh(), T0)).toBe(true);
    expect(loadBackup(T0)).toBeNull();
    localStorage.setItem(KEYS.save, '{"version": 99}');                 // a newer version's save
    replaceSave(fresh(), T0);
    expect(loadBackup(T0)!.raw).toBe('{"version": 99}');
  });

  it('a refused save changes nothing; a backup that does not fit leaves the new save in place', () => {
    const a = fresh(7);
    saveGame(a, T0);
    const stored = rawSave();
    const refusing = installStorage(true);
    refusing.set(KEYS.save, stored!);
    expect(replaceSave(fresh(8), T0)).toBe(false);
    expect(refusing.get(KEYS.save)).toBe(stored);
    expect(refusing.has(KEYS.backup)).toBe(false);
    const full = installStorage();
    full.set(KEYS.save, stored!);
    const ls = globalThis.localStorage as unknown as { setItem: (k: string, v: string) => void };
    const set = ls.setItem;
    ls.setItem = (k, v) => { if (k === KEYS.backup) throw new Error('QuotaExceededError'); set(k, v); };
    const b = fresh(8);
    expect(replaceSave(b, T0)).toBe(true);
    expect(loadGame()).toEqual(b);
    expect(loadBackup(T0)).toBeNull();
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(rawSave()).toBeNull();
    expect(loadBackup(T0)).toBeNull();
    expect(replaceSave(fresh(), T0)).toBe(false);
  });

  it('a backup that does not fit leaves no previous colony, never the one before it in its place', () => {
    const a = fresh(7); a.name = 'Prima';
    const b = fresh(8); b.name = 'Secunda';
    const c = fresh(9); c.name = 'Tertia';
    saveGame(a, T0);
    replaceSave(b, T0 + DAY);                                            // Secunda founded over Prima: Prima is kept
    expect(deserialize(loadBackup(T0 + DAY)!.raw)!.name).toBe('Prima');
    const ls = globalThis.localStorage as unknown as { setItem: (k: string, v: string) => void };
    const set = ls.setItem;
    ls.setItem = (k, v) => { if (k === KEYS.backup) throw new Error('QuotaExceededError'); set(k, v); };
    expect(replaceSave(c, T0 + 2 * DAY)).toBe(true);                     // Tertia imported over Secunda, which does not fit
    expect(loadGame()!.name).toBe('Tertia');
    expect(loadBackup(T0 + 2 * DAY)).toBeNull();                         // the title offers no Prima as "the previous colony"
    expect(m.has(KEYS.backup)).toBe(false);
  });

  it('a malformed backup slot is dropped', () => {
    for (const v of ['no stamp', '\n{}', 'soon\n{}']) {
      m.set(KEYS.backup, v);
      expect(loadBackup(T0)).toBeNull();
      expect(m.has(KEYS.backup)).toBe(false);
    }
  });

  it('the title asks by name before a stored colony is replaced', () => {
    const s = fresh();
    s.rank = 1;
    expect(replaceQuestion(s)).toBe(`Replace Castra Valeria — Vicus, ${s.people.length} souls?`);
    expect(replaceQuestion(null)).toBe('Replace the save that cannot be read?');
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
    // R01: the catch-up's fx are thrown away, so the app replays the dedication from the report
    expect(wonWhileAway(s, rep)).toBe(true);
    expect(s.stats.victoryDay).toBe(rep.after.day);
    const later = simulateOffline(s, 200_000);   // a later absence of the same (dedicated) colony does not replay it
    expect(later && wonWhileAway(s, later)).toBe(false);
    expect(wonWhileAway(fresh(), simulateOffline(fresh(), 200_000)!)).toBe(false);
  });

  it('decided in your name: repeats fold with a count; over 12 lines the oldest routine line goes first (R18)', () => {
    const e = (kind: LogKind, text: string): LogEntry => ({ day: 0, kind, text, tags: ['decided'] });
    const list: Decided[] = [];
    keepDecided(list, e('emergency', 'Emergency rations: 30 days of grain.'));
    for (let i = 0; i < 40; i++) keepDecided(list, e('trade', `Selling ${80 + i} surplus grain to Massilia.`));
    for (let i = 0; i < 14; i++) keepDecided(list, e('ordo', `The Ordo raises work number ${'IVXLCDM'[i % 7]}${'abcdefghijklmn'[i]}.`));
    keepDecided(list, e('event', 'The Ordo gives the travellers a modest welcome.'));
    const lines = decidedLines(list);
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe('Emergency rations: 30 days of grain.');           // survival decisions outlast routine work
    expect(lines).toContain('The Ordo gives the travellers a modest welcome.');
    expect(lines.some((t) => t.startsWith('Selling'))).toBe(false);           // the oldest routine group was given up first
    expect(lines.filter((t) => t.startsWith('The Ordo raises'))).toHaveLength(10);
    expect(lines.at(-2)).toBe('The Ordo raises work number Mn.');              // the newest routine lines are kept
    const few: Decided[] = [];
    for (let i = 0; i < 3; i++) keepDecided(few, e('trade', `Selling ${80 + i} surplus grain to Massilia.`));
    expect(decidedLines(few)).toEqual(['Selling 82 surplus grain to Massilia. (×3)']);
    const full: Decided[] = [];
    for (let i = 0; i < 13; i++) keepDecided(full, e('event', `Event ${'abcdefghijklm'[i]}.`));
    expect(decidedLines(full)[0]).toBe('Event b.');                             // only events left: the oldest goes
  });

  it('awaiting you: the ready petition is listed once, never again as the Augur\'s advisory (R17)', () => {
    const r = play(1, 'active', { days: 1500, stop: (x) => { const pn = petitionNeeds(x, view(x)); return !!pn && pn.ready && pn.rank !== null; } });
    const s = r.s;
    expect(petitionNeeds(s, view(s))?.ready).toBe(true);
    const rep = simulateOffline(s, 60_000)!;
    expect(rep.awaiting.petition).not.toBeNull();
    expect(activeAdvisories(s, { forCard: true }).some((a) => a.rule === 'augur.petition')).toBe(true);
    expect(rep.awaiting.advisories).not.toContain('augur.petition');
    // F9: how long it has waited, from the day the Augur raised it (petitions are never made in your name)
    const since = s.guidance.advisories['augur.petition']!.since;
    expect(rep.awaiting.readySince).toBe(since);
    expect(since).toBeLessThanOrEqual(rep.after.day);
    expect(rep.awaiting.stalled).toBeNull();
    const n = rep.after.day - since;
    expect(readyLine(rep)).toMatch(new RegExp(`^Rome would hear our petition for \\w+: ready since .+ AUC [IVXLCDM]+, ${n} days?\\.$`));
    expect(readyLine({ ...rep, awaiting: { ...rep.awaiting, readySince: null } })).toMatch(/^Rome would hear our petition for \w+\.$/);
  });

  it('states the cap in real time, and in the letter when an absence ran past it (F9)', () => {
    expect(AWAY_CAP_MS).toBe((B.time.OFFLINE_MAX_DAYS / B.time.OFFLINE_RATE) * 1000);
    expect(awayRule()).toBe('Time away passes at half speed: each minute you are gone is 30 days in the colony, up to 5 years. '
      + 'That takes 61 minutes; time away beyond it is not counted.');
    const rep = simulateOffline(fresh(3), 200_000)!;
    expect(awayUnusedMs(rep)).toBe(0);
    expect(describeAway(rep).cap).toBeNull();
    const eight = 8 * 3600 * 1000;   // an 8-hour absence runs the same five years as one of 61 minutes
    expect(offlineDays(eight)).toBe(offlineDays(AWAY_CAP_MS));
    const capped = { ...rep, awayMs: eight, daysPlanned: B.time.OFFLINE_MAX_DAYS, days: B.time.OFFLINE_MAX_DAYS };
    expect(awayUnusedMs(capped)).toBe(eight - AWAY_CAP_MS);
    expect(describeAway(capped).cap).toBe('The colony ran 5 years, the most it runs without you; 6 h 59 min of your absence went uncounted.');
    expect(capLine({ ...capped, days: 900 })).toBeNull();                         // a dedication stopped the clock first
    expect(capLine({ ...capped, awayMs: AWAY_CAP_MS + 30_000 })).toBeNull();      // under a minute past the cap: nothing to say
  });

  it('the progress line: the next rank\'s checklist and the Capitolium, before → after (F9)', () => {
    const rep = simulateOffline(fresh(42), 60_000)!;
    expect(rep.before.petition).toEqual({ rank: 1, met: 0, of: 6 });             // the charter's line counts while it waits
    expect(rep.after.petition).toEqual({ rank: 1, met: 1, of: 6 });              // the horreum is raised
    expect(rep.before.capitolium).toBeNull();
    expect(describeAway(rep).progress).toBe('Vicus petition: 0 → 1 of 6 met');
    expect(rep.awaiting.stalled).toBeNull();                                     // works raised: not stalled
    const s = fresh();
    const id = nextId(s);
    s.buildings.push({ id, type: 'capitolium', x: 47, y: 29, owner: 'player', status: 'building', placed: s.day, progress: 0.99, work: 10, paid: true, order: id, open: true, prio: 1, matUsed: {} });
    s.people.find((p) => p.work === null && s.day - p.born > 20 * 365)!.work = BUILDER;
    for (const r of ['stone', 'concrete', 'tiles', 'iron', 'denarii'] as const) s.res[r] += 5000;
    invalidate(s);
    const won = simulateOffline(s, 200_000)!;
    expect(won.before.capitolium).toBe(0.99);
    expect(won.after.capitolium).toBe(1);
    expect(describeAway(won).progress).toContain('Capitolium 99% → 100%');
  });

  it('nothing moved: Awaiting you leads with what holds the next rank (F9)', () => {
    const s = fresh(42);
    s.decisions.switches.governAway = false;                                     // the Ordo holds no duty: nothing is raised
    s.buildings = s.buildings.filter((b) => b.status === 'done');
    s.res.timber = 0;                                                            // and no home is renovated
    invalidate(s);
    const rep = simulateOffline(s, 60_000)!;
    expect(rep.after.pop).toBe(rep.before.pop);
    expect(rep.after.built).toBe(rep.before.built);
    expect(rep.awaiting.petition).toBeNull();
    expect(rep.awaiting.stalled).toEqual({ rank: 1, lacking: ['Lex coloniae proclaimed', 'Souls: 24 / 50', expect.stringMatching(/^First Hiems weathered/)] });
    expect(stalledLine(rep)).toMatch(/^Stalled: nothing moved toward Vicus\. Still lacking: Lex coloniae proclaimed · Souls 24 \/ 50 · First Hiems weathered \(.+\)\.$/);
    expect(describeAway(rep).progress).toBe('Vicus petition: 0 → 0 of 6 met');
    const cap = { ...rep, after: { ...rep.after, capitolium: 0.344 }, awaiting: { ...rep.awaiting, stalled: { rank: null, lacking: [] } } };
    expect(stalledLine(cap)).toBe('Stalled: the Capitolium did not rise past 34%.');
  });

  it('the lowest point ends in one full stop after a Roman date (R48)', () => {
    const rep = simulateOffline(fresh(3), 200_000)!;
    rep.lowest.grain = { doh: 12, day: B.time.START_DAY + 5 };
    expect(describeAway(rep).lowest).toMatch(/[^.]\.$/);
  });
});
