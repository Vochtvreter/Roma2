// src/game/save.ts — serialise, migrate, sanitise, localStorage, export/import, prefs and Fasti (ARCHITECTURE §11). Owner: WP-D.
// The only module of src/game that touches localStorage; every access is wrapped in try/catch. Wall-clock time
// enters only as `now` (saveGame). Keys are namespaced: every repo of a GitHub user shares one origin.
import { B } from './balance';
import {
  ADVISORS, BUILDER, BUILDINGS, DUTIES, EDICTS, EVENTS, FOCUSES, HOUSE_TIERS, HUBS, LABOR_CATS, MILESTONE_IDS, PATH_DECISIONS, RESOURCES, RULES, SETTINGS,
  PATH_OPTIONS, PRACTICE, SKILLS, SWITCHES, TIPS, TRADE_RES, WORK_DUTIES,
} from './types';
import type { Building, FastiEntry, GameState, PathDecisionId, PathOptionId, Person, Prefs, RankIndex, Speed } from './types';
import { NEVER, newGame } from './state';
import { MILESTONES } from './objectives';
import { LESSONS } from './intro';
import { H, W } from './map';
import { EDICT_DEFS, PATH_DEFS, SETTING_DEFS, SWITCH_DEFS } from './data/decisions';
import { RANK_DEFS } from './data/ranks';
import { buildingShape, personShape, stateShape } from './shapes';

/** Current save format version (written by newGame). 2: the growing town (`urbs`: footfall, the town wall, the razed castrum). */
export const SAVE_VERSION = 2;
/** Namespaced localStorage keys: the save, prefs, Fasti, the tab that owns the save, and when a copy was last exported. */
export const KEYS: {
  save: 'castravaleria.save.v1'; prefs: 'castravaleria.prefs.v1'; fasti: 'castravaleria.fasti.v1';
  owner: 'castravaleria.owner.v1'; exported: 'castravaleria.exported.v1';
} = {
  save: 'castravaleria.save.v1', prefs: 'castravaleria.prefs.v1', fasti: 'castravaleria.fasti.v1',
  owner: 'castravaleria.owner.v1', exported: 'castravaleria.exported.v1',
};
/** Days past START_DAY a save may claim (a corrupt day of 1e12 would otherwise break the calendar for good). */
const DAY_SPAN = 1_000_000;
/** Migrations: MIGRATIONS[n] turns a version-n save into version n + 1 (and sets the new version); `any` is allowed here only. */
export const MIGRATIONS: Record<number, (raw: any) => any> = {
  // 1 → 2: the growing town arrives with no footfall counted yet, no town wall and the castrum standing; `urbs` sits after
  // `wood`, where newGame writes it (the state's key order is its serialised order)
  1: (raw) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) {
      if (k === 'urbs') continue;
      out[k] = raw[k];
      if (k === 'wood') out.urbs = raw.urbs ?? { traffic: {}, moenia: null, razed: null, renewed: NEVER };
    }
    out.urbs ??= { traffic: {}, moenia: null, razed: null, renewed: NEVER };
    out.version = 2;
    return out;
  },
};
/** Preferences of a first visit. */
export const DEFAULT_PREFS: Prefs = { sound: true, volume: 0.7, speed: 1, paused: false, tips: true, slowForNews: true, pauseOnCritical: false };

const EXPORT_PREFIX = 'CV1:';
const B64_CHUNK = 0x8000;                      // bytes per String.fromCharCode call
const NEED_MAX = 100;                          // hunger/thirst scale (DESIGN §8.5)
const SPEED_SET: readonly number[] = [...B.time.SPEEDS, B.time.DEV_SPEED];

type Obj = Record<string, unknown>;
const STATUSES: readonly string[] = ['plan', 'staked', 'building', 'done'];
const PREFS: readonly string[] = ['auto', 'insula', 'domus'];

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finite(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The exact state as JSON (no rounding: save → load → continue equals never saving). */
export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

/** Deep-merges keys missing from `saved` out of `def` (objects only; arrays are kept as saved; null numbers → 0). */
function fillDefaults(saved: Obj, def: Obj): void {
  for (const k of Object.keys(def)) {
    const dv = def[k];
    const sv = saved[k];
    if (sv === undefined) { saved[k] = dv; continue; }
    if (dv === null) continue;                                  // nullable field: keep whatever was saved
    if (isObj(dv)) { if (isObj(sv)) fillDefaults(sv, dv); else saved[k] = dv; continue; }
    if (Array.isArray(dv)) { if (!Array.isArray(sv)) saved[k] = dv; continue; }
    if (typeof dv === 'number') { if (typeof sv !== 'number' || !Number.isFinite(sv)) saved[k] = sv === null ? 0 : dv; continue; }
    if (typeof sv !== typeof dv) saved[k] = dv;
  }
}

/** Entries with a finite numeric id, sorted by id, duplicates dropped (first kept). */
function byId<T extends { id: number }>(arr: unknown, keep: (o: Obj) => boolean = () => true): T[] {
  if (!Array.isArray(arr)) return [];
  const list = arr.filter((o): o is Obj => isObj(o) && typeof o.id === 'number' && Number.isFinite(o.id) && keep(o)) as unknown as T[];
  list.sort((a, b) => a.id - b.id);
  return list.filter((o, i) => i === 0 || list[i - 1].id !== o.id);
}

function sortedTiles(arr: unknown): number[] {
  if (!Array.isArray(arr)) return [];
  const n = W * H;
  const out = arr.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n).sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || out[i - 1] !== v);
}

const finiteRec = (o: Obj, keep: (k: string) => boolean = () => true): void => {
  for (const k of Object.keys(o)) if (!keep(k) || typeof o[k] !== 'number' || !Number.isFinite(o[k])) delete o[k];
};

/** Decisions: known focus, edict options, settings in range, switches, path options. */
function sanitiseDecisions(s: GameState): void {
  const d = s.decisions;
  if (!FOCUSES.includes(d.focus)) d.focus = 'concordia';
  for (const k of Object.keys(d.edicts)) if (!(EDICTS as readonly string[]).includes(k)) delete (d.edicts as Obj)[k];
  for (const e of EDICTS) if (!EDICT_DEFS[e].options.some((o) => o.id === d.edicts[e])) d.edicts[e] = EDICT_DEFS[e].initial;
  finiteRec(d.edictLock as Obj, (k) => (EDICTS as readonly string[]).includes(k));
  for (const k of SETTINGS) {
    const def = SETTING_DEFS[k];
    d.settings[k] = clamp(finite(d.settings[k], def.initial), def.min, def.max);
  }
  for (const k of Object.keys(d.settings)) if (!(SETTINGS as readonly string[]).includes(k)) delete (d.settings as Obj)[k];
  for (const k of SWITCHES) if (typeof d.switches[k] !== 'boolean') d.switches[k] = SWITCH_DEFS[k].initial;
  for (const k of Object.keys(d.paths)) {
    const dec = k as PathDecisionId;
    const ok = (PATH_DECISIONS as readonly string[]).includes(k) && PATH_DEFS[dec].options.some((o) => o.id === d.paths[dec]);
    if (!ok) { delete (d.paths as Obj)[k]; delete (d.pathDays as Obj)[k]; }
  }
  finiteRec(d.pathDays as Obj, (k) => d.paths[k as PathDecisionId] !== undefined);
}

/** Buildings, people and families: known types, finite numbers, sorted ids, no dangling homes, jobs or spouses. */
function sanitiseEntities(s: GameState): void {
  s.buildings = byId<Building>(s.buildings, (o) => (BUILDINGS as readonly unknown[]).includes(o.type)).map(buildingShape);
  for (const b of s.buildings) {
    b.x = Math.round(finite(b.x)); b.y = Math.round(finite(b.y));
    b.progress = clamp(finite(b.progress), 0, 1);
    b.work = Math.max(0, finite(b.work));
    if (!STATUSES.includes(b.status)) b.status = 'done';
    if (b.house && !HOUSE_TIERS.includes(b.house.tier)) b.house.tier = 'tentoria';
    if (b.house && !PREFS.includes(b.house.pref)) b.house.pref = 'auto';
  }
  s.people = byId<Person>(s.people).map(personShape);
  s.families = byId(s.families);
  const bIds = new Set(s.buildings.map((b) => b.id));
  const pIds = new Set(s.people.map((p) => p.id));
  for (const p of s.people) {
    p.born = finite(p.born, s.day);
    if (!isObj(p.skills)) p.skills = {};
    finiteRec(p.skills as Obj, (k) => (SKILLS as readonly string[]).includes(k));
    if (p.home !== null && !bIds.has(p.home)) p.home = null;
    if (p.work !== null && p.work !== BUILDER && !bIds.has(p.work)) p.work = null;
    if (p.spouse !== null && !pIds.has(p.spouse)) p.spouse = null;
  }
  for (const f of s.families) if (f.home !== null && !bIds.has(f.home)) f.home = null;
}

/** Trade: known hubs and goods, finite cargo, market in its clamp, a well-formed merchant. */
function sanitiseTrade(s: GameState): void {
  const t = s.trade;
  const okTrade = (o: Obj): boolean => (HUBS as readonly unknown[]).includes(o.hub) && (TRADE_RES as readonly unknown[]).includes(o.res)
    && typeof o.qty === 'number' && Number.isFinite(o.qty);
  t.contracts = byId(t.contracts, (o) => okTrade(o) && (o.mode === 'export' || o.mode === 'import'));
  for (const c of t.contracts) if (c.status !== 'idle' && c.status !== 'travelling' && c.status !== 'paused') c.status = 'idle';
  t.caravans = byId(t.caravans, (o) => okTrade(o) && typeof o.arrive === 'number' && Number.isFinite(o.arrive) && typeof o.value === 'number' && Number.isFinite(o.value));
  const busy = new Set(t.caravans.map((c) => c.contract));
  for (const c of t.contracts) if (c.status === 'travelling' && !busy.has(c.id)) c.status = 'idle';
  t.hubsTraded = Array.isArray(t.hubsTraded) ? HUBS.filter((h) => t.hubsTraded.includes(h)) : [];
  for (const r of TRADE_RES) t.market[r] = clamp(finite(t.market[r], 1), B.trade.CLAMP[0], B.trade.CLAMP[1]);
  t.debt = Math.max(0, finite(t.debt));
  t.lastMerchant = finite(t.lastMerchant, NEVER);
  const m = t.merchant;
  if (m !== null && (!isObj(m) || typeof m.name !== 'string' || !Number.isFinite(m.until) || !Array.isArray(m.offers))) t.merchant = null;
  else if (m) m.offers = byId(m.offers, (o) => (TRADE_RES as readonly unknown[]).includes(o.res) && Number.isFinite(o.qty) && Number.isFinite(o.price));
}

/** Events: a pending card and a gate party only when well formed; known event days; well-formed modifiers. */
function sanitiseEvents(s: GameState): void {
  const c = s.choice;
  if (c !== null && (!isObj(c) || !EVENTS.includes(c.event) || !Array.isArray(c.options) || c.options.length === 0
    || !c.options.every((o) => isObj(o) && typeof o.label === 'string' && typeof o.key === 'string') || !Number.isFinite(c.expires))) s.choice = null;
  else if (c) c.defaultIndex = clamp(Math.round(finite(c.defaultIndex)), 0, c.options.length - 1);
  const g = s.gate;
  if (g !== null && (!isObj(g) || !Number.isFinite(g.until) || !Array.isArray(g.families)
    || !g.families.every((f) => isObj(f) && isObj(f.family) && Array.isArray(f.people)))) s.gate = null;
  finiteRec(s.eventDays as Obj, (k) => (EVENTS as readonly string[]).includes(k));
  s.modifiers = Array.isArray(s.modifiers)
    ? s.modifiers.filter((m) => isObj(m) && typeof m.id === 'string' && typeof m.label === 'string' && Number.isFinite(m.until) && isObj(m.fx))
    : [];
}

/** The growing town: footfall on real tiles, a well-formed town wall (its tiles in building order, its gates among them),
 *  and days that are numbers or null. */
function sanitiseUrbs(s: GameState): void {
  const u = s.urbs;
  if (!isObj(u.traffic)) u.traffic = {};
  finiteRec(u.traffic as Obj, (k) => { const i = Number(k); return Number.isInteger(i) && i >= 0 && i < W * H; });
  for (const k of Object.keys(u.traffic)) if ((u.traffic as Obj)[k] as number <= 0) delete (u.traffic as Obj)[k];
  const m = u.moenia;
  if (m !== null && (!isObj(m) || !Array.isArray(m.tiles) || !Array.isArray(m.gates))) u.moenia = null;
  else if (m) {
    const seen = new Set<number>();
    m.tiles = m.tiles.filter((i) => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < W * H && !seen.has(i) && (seen.add(i), true));
    m.gates = sortedTiles(m.gates).filter((i) => seen.has(i));
    m.surveyed = finite(m.surveyed, s.day);
    m.work = Math.max(1, finite(m.work, 1));
    m.progress = clamp(finite(m.progress), 0, 1);
    if (!isObj(m.matUsed)) m.matUsed = {};
    finiteRec(m.matUsed as Obj, (k) => (RESOURCES as readonly string[]).includes(k));
    m.done = m.done === null || m.done === undefined ? null : finite(m.done, s.day);
    if (m.tiles.length === 0) u.moenia = null;
  }
  u.razed = u.razed === null || u.razed === undefined ? null : finite(u.razed, s.day);
  if (u.razed !== null && !u.moenia?.done) u.razed = null;   // the castrum comes down only once the town wall stands
  u.renewed = finite(u.renewed, NEVER);
}

/** Repairs a filled-in save in place: ranges, unknown ids, dangling references, sort orders (ARCHITECTURE §11.2 step 5). */
function sanitise(s: GameState): void {
  s.day = clamp(Math.round(finite(s.day, B.time.START_DAY)), B.time.START_DAY, B.time.START_DAY + DAY_SPAN);
  s.rng = Math.round(finite(s.rng)) | 0;
  s.legacy = Math.max(0, Math.round(finite(s.legacy)));
  s.legacyBonus = Math.max(0, finite(s.legacyBonus));
  s.lastSave = finite(s.lastSave);
  s.rank = clamp(Math.round(finite(s.rank)), 0, RANK_DEFS.length - 1) as RankIndex;
  for (const r of RESOURCES) s.res[r] = Math.max(0, finite(s.res[r]));
  s.taxAccrued = Math.max(0, finite(s.taxAccrued));
  s.morale = clamp(finite(s.morale, B.morale.START), B.morale.MIN, B.morale.MAX);
  s.fed = clamp(finite(s.fed), 0, 1);
  for (const q of [s.needs.hunger, s.needs.thirst]) for (let g = 0; g < 4; g++) q[g] = clamp(finite(q[g]), 0, NEED_MAX);
  sanitiseNumbers(s.counters as unknown as Obj);
  sanitiseNumbers(s.stats as unknown as Obj);

  sanitiseDecisions(s);
  sanitiseEntities(s);
  s.roads = sortedTiles(s.roads);
  const roadSet = new Set(s.roads);
  s.paved = sortedTiles(s.paved).filter((i) => roadSet.has(i));
  finiteRec(s.wood as Obj, (k) => Number.isInteger(Number(k)));
  sanitiseTrade(s);
  sanitiseEvents(s);
  sanitiseUrbs(s);

  const o = s.ordo;
  if (o.pin !== null && !BUILDINGS.includes(o.pin)) o.pin = null;
  o.requests = Array.isArray(o.requests) ? o.requests.filter((r) => isObj(r) && BUILDINGS.includes(r.type) && Number.isFinite(r.day)) : [];
  o.reserved = sortedTiles(o.reserved);
  o.priorities = Array.isArray(o.priorities) ? o.priorities.filter((p) => isObj(p) && LABOR_CATS.includes(p.cat) && Number.isFinite(p.until)) : [];
  for (const k of LABOR_CATS) o.manual[k] = Math.max(0, Math.round(finite(o.manual[k])));
  sanitiseNumbers(o.emergency as unknown as Obj);
  o.emergency.hands = o.emergency.hands === true;
  for (const d of WORK_DUTIES) o.works[d] = o.works[d] === true;
  o.learned = DUTIES.filter((d) => o.learned.includes(d));
  o.answered = DUTIES.filter((d) => o.answered.includes(d));

  const g = s.guidance;
  for (const k of Object.keys(g.advisories)) if (!(RULES as readonly string[]).includes(k)) delete (g.advisories as Obj)[k];
  g.muted = g.muted.filter((r) => RULES.includes(r));
  g.tips = g.tips.filter((r) => TIPS.includes(r));
  g.tipDay = clamp(finite(g.tipDay, NEVER), NEVER, s.day);   // a read in the future would hold every tip back
  g.tipAt = clamp(finite(g.tipAt), 0, Math.max(0, finite(s.stats.playMs)));
  const it = g.intro;
  it.lesson = clamp(Math.round(finite(it.lesson, -1)), -1, LESSONS.length - 1);
  it.done = it.done === true;
  delete (it as unknown as Obj).ordoHeld;   // the Ordo's hold of the first lessons is the duties now (ordo/duties.ts)
  it.at = clamp(finite(it.at), 0, Math.max(0, finite(s.stats.playMs)));   // a lesson begun in the future would never end
  it.practice = Array.isArray(it.practice) ? it.practice.filter((p) => PRACTICE.includes(p)) : [];
  g.appointed = g.appointed.filter((a) => ADVISORS.includes(a));
  finiteRec(g.milestoneDays as Obj, (k) => (MILESTONE_IDS as readonly string[]).includes(k));
  g.objective = clamp(Math.round(finite(g.objective)), 0, MILESTONES.length);

  s.log = s.log.filter((e) => isObj(e) && typeof e.text === 'string' && Number.isFinite(e.day)).slice(-B.LOG_CAP);
  let maxId = 0;
  const gatePeople = s.gate ? s.gate.families.flatMap((f) => [f.family, ...f.people]) : [];
  for (const list of [s.buildings, s.people, s.families, s.trade.contracts, s.trade.caravans, s.trade.merchant?.offers ?? [], gatePeople]) {
    for (const x of list) if (x.id > maxId) maxId = x.id;
  }
  s.nextId = Math.max(Math.floor(finite(s.nextId, 1)), maxId + 1);
}

/** The lessons of a colony from before the duties, which had no "Hands to the fields" and a "Roll of souls" after its
 *  works. */
const LESSONS_BEFORE = ['water', 'homes', 'ordo', 'charter', 'advisors', 'speed', 'works', 'people', 'overlays', 'edicts'] as const;

/** A colony from before the duties knew every duty (newGame's defaults) and chose what the Ordo runs by its toggles:
 *  nothing is offered anew. A lesson under way keeps its place in today's list (the roll of souls is taught by the
 *  fields now: it goes on to the maps). */
function beforeDuties(s: GameState): void {
  s.ordo.answered = DUTIES.slice();
  const it = s.guidance.intro;
  const old = typeof it.lesson === 'number' && it.lesson >= 0 ? LESSONS_BEFORE[Math.round(it.lesson)] : undefined;
  if (!old) return;
  it.lesson = LESSONS.findIndex((l) => l.id === (old === 'people' ? 'overlays' : old));
  if (old === 'people') it.done = false;
}

/** Every number found (recursively) in a plain record becomes finite (0 when it was not). */
function sanitiseNumbers(o: Obj): void {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'number' && !Number.isFinite(v)) o[k] = 0;
    else if (isObj(v)) sanitiseNumbers(v);
  }
}

/** Parses, migrates, fills defaults and sanitises a save; null when unusable (ARCHITECTURE §11.2). */
export function deserialize(json: string): GameState | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!isObj(raw) || typeof raw.version !== 'number' || !Number.isFinite(raw.version)) return null;
  if (raw.version > SAVE_VERSION) return null;
  let cur: Obj = raw;
  while ((cur.version as number) < SAVE_VERSION) {
    const m = MIGRATIONS[cur.version as number];
    if (!m) return null;
    const next: unknown = m(cur);
    if (!isObj(next) || typeof next.version !== 'number' || next.version <= (cur.version as number)) return null;
    cur = next;
  }
  if (typeof cur.seed !== 'number' || !Number.isFinite(cur.seed)) return null;
  if (!Array.isArray(cur.people) || !Array.isArray(cur.buildings)) return null;
  if (!cur.buildings.some((b) => isObj(b) && b.type === 'principia')) return null;
  try {
    const before = !isObj(cur.ordo) || !Array.isArray(cur.ordo.learned);   // a colony from before the duties: it held them all
    fillDefaults(cur, newGame({ seed: cur.seed, now: 0 }) as unknown as Obj);
    const s = cur as unknown as GameState;
    if (before) beforeDuties(s);
    sanitise(s);
    return stateShape(s);   // the live state's object shapes (shapes.ts): same keys, same order, same bytes
  } catch {
    return null;
  }
}

/** Writes the save (setting s.lastSave = now first); false when storage is full or blocked. */
export function saveGame(s: GameState, now: number): boolean {
  s.lastSave = now;
  try {
    localStorage.setItem(KEYS.save, serialize(s));
    return true;
  } catch {
    return false;
  }
}

/** Loads and repairs the stored save, or null. */
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEYS.save);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

/** True when a save is stored (readable or not). */
export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEYS.save) !== null;
  } catch {
    return false;
  }
}

/** Marks the tab `sid` as the one playing the stored colony (it enters a game); any other open tab yields. */
export function claimSave(sid: string): void {
  try { localStorage.setItem(KEYS.owner, sid); } catch { /* storage blocked: one tab is all we can know of */ }
}

/** True when the tab `sid` may write the save: it holds the claim, nobody does, or storage cannot be read. */
export function ownsSave(sid: string): boolean {
  try {
    const owner = localStorage.getItem(KEYS.owner);
    return owner === null || owner === sid;
  } catch {
    return true;
  }
}

/** Records that the player copied an export (wall-clock ms), for the keep-a-copy reminder. */
export function markExported(now: number): void {
  try { localStorage.setItem(KEYS.exported, String(now)); } catch { /* storage blocked */ }
}

/** When the player last copied an export (wall-clock ms), 0 when never. */
export function lastExported(): number {
  try { return finite(Number(localStorage.getItem(KEYS.exported) ?? 0)); } catch { return 0; }
}

/** Removes the stored save. */
export function clearSave(): void {
  try { localStorage.removeItem(KEYS.save); } catch { /* storage blocked */ }
}

/** Export text: 'CV1:' + base64 of the UTF-8 JSON. */
export function exportText(s: GameState): string {
  const bytes = new TextEncoder().encode(serialize(s));
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  return EXPORT_PREFIX + btoa(bin);
}

/** Imports the prefixed text, bare base64 or raw JSON; null when it is not a save. */
export function importText(text: string): GameState | null {
  const t = text.trim();
  if (t.length === 0) return null;
  if (t.startsWith('{')) return deserialize(t);
  const b64 = (t.startsWith(EXPORT_PREFIX) ? t.slice(EXPORT_PREFIX.length) : t).replace(/\s+/g, '');
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return deserialize(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Stored preferences merged over the defaults (invalid fields fall back). */
export function loadPrefs(): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(KEYS.prefs);
    const o: unknown = raw ? JSON.parse(raw) : null;
    if (isObj(o)) {
      if (typeof o.sound === 'boolean') p.sound = o.sound;
      if (typeof o.volume === 'number' && Number.isFinite(o.volume)) p.volume = clamp(o.volume, 0, 1);
      if (typeof o.speed === 'number' && SPEED_SET.includes(o.speed)) p.speed = o.speed as Speed;
      if (typeof o.paused === 'boolean') p.paused = o.paused;
      if (typeof o.tips === 'boolean') p.tips = o.tips;
      if (typeof o.slowForNews === 'boolean') p.slowForNews = o.slowForNews;
      if (typeof o.pauseOnCritical === 'boolean') p.pauseOnCritical = o.pauseOnCritical;
    }
  } catch { /* storage blocked or corrupt: defaults */ }
  return p;
}

/** Stores the preferences. */
export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(KEYS.prefs, JSON.stringify(p)); } catch { /* storage blocked */ }
}

function fastiOk(e: unknown): e is FastiEntry {
  if (!isObj(e) || typeof e.name !== 'string') return false;
  const nums = [e.seed, e.legacy, e.founded, e.peakPop, e.playMs];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (e.dedicated !== null && !(typeof e.dedicated === 'number' && Number.isFinite(e.dedicated))) return false;
  return Array.isArray(e.paths) && e.paths.every((p) => (PATH_OPTIONS as readonly unknown[]).includes(p));
}

/** The Fasti (dedicated colonies), newest first; malformed entries are skipped. */
export function loadFasti(): FastiEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.fasti);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(fastiOk).slice(0, B.ui.FASTI_MAX);
  } catch {
    return [];
  }
}

/** Adds a dedicated colony to the Fasti (newest first, at most FASTI_MAX). */
export function addFasti(e: FastiEntry): void {
  const list = [e, ...loadFasti()].slice(0, B.ui.FASTI_MAX);
  try { localStorage.setItem(KEYS.fasti, JSON.stringify(list)); } catch { /* storage blocked */ }
}

/** The Fasti line of a colony: `founded` and `dedicated` are game days (format with formatAuc(aucYear(day))). */
export function fastiEntry(s: GameState): FastiEntry {
  const paths: PathOptionId[] = [];
  for (const d of PATH_DECISIONS) { const o = s.decisions.paths[d]; if (o) paths.push(o); }
  return {
    name: s.name, seed: s.seed, legacy: s.legacy, founded: B.time.START_DAY,
    dedicated: s.stats.victoryDay, peakPop: s.stats.peakPop, paths, playMs: s.stats.playMs,
  };
}
