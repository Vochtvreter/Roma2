// src/game/save.ts — serialise, migrate, sanitise, localStorage, export/import, prefs and Fasti (ARCHITECTURE §11). Owner: WP-D.
// The only module of src/game that touches localStorage; every access is wrapped in try/catch. Wall-clock time
// enters only as `now` (saveGame). Keys are namespaced: every repo of a GitHub user shares one origin.
import { B } from './balance';
import { ADVISORS, BUILDER, BUILDINGS, EDICTS, FOCUSES, HUBS, PATH_DECISIONS, RESOURCES, RULES, SETTINGS, SWITCHES, TIPS, TRADE_RES } from './types';
import type { FastiEntry, GameState, PathDecisionId, Prefs, RankIndex, Speed } from './types';
import { newGame } from './state';
import { H, W } from './map';
import { EDICT_DEFS, PATH_DEFS, SETTING_DEFS, SWITCH_DEFS } from './data/decisions';
import { RANK_DEFS } from './data/ranks';

/** Current save format version (written by newGame). */
export const SAVE_VERSION = 1;
/** Namespaced localStorage keys. */
export const KEYS: { save: 'castravaleria.save.v1'; prefs: 'castravaleria.prefs.v1'; fasti: 'castravaleria.fasti.v1' } = {
  save: 'castravaleria.save.v1', prefs: 'castravaleria.prefs.v1', fasti: 'castravaleria.fasti.v1',
};
/** Migrations: MIGRATIONS[n] turns a version-n save into version n + 1 (and sets the new version); `any` is allowed here only. */
export const MIGRATIONS: Record<number, (raw: any) => any> = {};
/** Preferences of a first visit. */
export const DEFAULT_PREFS: Prefs = { sound: true, volume: 0.7, speed: 1, tips: true, slowForNews: true, pauseOnCritical: false };

const EXPORT_PREFIX = 'CV1:';
const B64_CHUNK = 0x8000;                      // bytes per String.fromCharCode call
const NEED_MAX = 100;                          // hunger/thirst scale (DESIGN §8.5)
const SPEED_SET: readonly number[] = [...B.time.SPEEDS, B.time.DEV_SPEED];

type Obj = Record<string, unknown>;

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

/** Repairs a filled-in save in place: ranges, unknown ids, dangling references, sort orders (ARCHITECTURE §11.2 step 5). */
function sanitise(s: GameState): void {
  s.rank = clamp(Math.round(finite(s.rank)), 0, RANK_DEFS.length - 1) as RankIndex;
  for (const r of RESOURCES) s.res[r] = Math.max(0, finite(s.res[r]));
  s.taxAccrued = Math.max(0, finite(s.taxAccrued));
  s.morale = clamp(finite(s.morale, B.morale.START), B.morale.MIN, B.morale.MAX);
  s.fed = clamp(finite(s.fed), 0, 1);
  for (const q of [s.needs.hunger, s.needs.thirst]) for (let g = 0; g < 4; g++) q[g] = clamp(finite(q[g]), 0, NEED_MAX);

  const d = s.decisions;
  if (!FOCUSES.includes(d.focus)) d.focus = 'concordia';
  for (const k of Object.keys(d.edicts)) if (!(EDICTS as readonly string[]).includes(k)) delete (d.edicts as Obj)[k];
  for (const e of EDICTS) if (!EDICT_DEFS[e].options.some((o) => o.id === d.edicts[e])) d.edicts[e] = EDICT_DEFS[e].initial;
  for (const k of Object.keys(d.edictLock)) {
    const v = (d.edictLock as Obj)[k];
    if (!(EDICTS as readonly string[]).includes(k) || typeof v !== 'number' || !Number.isFinite(v)) delete (d.edictLock as Obj)[k];
  }
  for (const k of SETTINGS) {
    const def = SETTING_DEFS[k];
    d.settings[k] = clamp(finite(d.settings[k], def.initial), def.min, def.max);
  }
  for (const k of SWITCHES) if (typeof d.switches[k] !== 'boolean') d.switches[k] = SWITCH_DEFS[k].initial;
  for (const k of Object.keys(d.paths)) {
    const dec = k as PathDecisionId;
    const ok = (PATH_DECISIONS as readonly string[]).includes(k) && PATH_DEFS[dec].options.some((o) => o.id === d.paths[dec]);
    if (!ok) { delete (d.paths as Obj)[k]; delete (d.pathDays as Obj)[k]; }
  }

  s.buildings = byId(s.buildings, (o) => (BUILDINGS as readonly unknown[]).includes(o.type));
  s.people = byId(s.people);
  s.families = byId(s.families);
  const bIds = new Set(s.buildings.map((b) => b.id));
  const pIds = new Set(s.people.map((p) => p.id));
  for (const p of s.people) {
    if (p.home !== null && !bIds.has(p.home)) p.home = null;
    if (p.work !== null && p.work !== BUILDER && !bIds.has(p.work)) p.work = null;
    if (p.spouse !== null && !pIds.has(p.spouse)) p.spouse = null;
  }
  for (const f of s.families) if (f.home !== null && !bIds.has(f.home)) f.home = null;

  s.roads = sortedTiles(s.roads);
  const roadSet = new Set(s.roads);
  s.paved = sortedTiles(s.paved).filter((i) => roadSet.has(i));
  for (const k of Object.keys(s.wood)) {
    const v = (s.wood as Obj)[k];
    if (!Number.isInteger(Number(k)) || typeof v !== 'number' || !Number.isFinite(v)) delete (s.wood as Obj)[k];
  }

  const t = s.trade;
  const okTrade = (o: Obj): boolean => (HUBS as readonly unknown[]).includes(o.hub) && (TRADE_RES as readonly unknown[]).includes(o.res);
  t.contracts = byId(t.contracts, okTrade);
  t.caravans = byId(t.caravans, okTrade);
  t.hubsTraded = Array.isArray(t.hubsTraded) ? t.hubsTraded.filter((h) => HUBS.includes(h)) : [];
  for (const r of TRADE_RES) t.market[r] = clamp(finite(t.market[r], 1), B.trade.CLAMP[0], B.trade.CLAMP[1]);

  const g = s.guidance;
  for (const k of Object.keys(g.advisories)) if (!(RULES as readonly string[]).includes(k)) delete (g.advisories as Obj)[k];
  g.muted = g.muted.filter((r) => RULES.includes(r));
  g.tips = g.tips.filter((r) => TIPS.includes(r));
  g.appointed = g.appointed.filter((a) => ADVISORS.includes(a));

  s.log = s.log.filter((e) => isObj(e) && typeof e.text === 'string').slice(-B.LOG_CAP);
  let maxId = 0;
  for (const list of [s.buildings, s.people, s.families, t.contracts, t.caravans, t.merchant?.offers ?? []]) {
    for (const o of list) if (o.id > maxId) maxId = o.id;
  }
  s.nextId = Math.max(Math.floor(finite(s.nextId, 1)), maxId + 1);
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
    fillDefaults(cur, newGame({ seed: cur.seed, now: 0 }) as unknown as Obj);
    const s = cur as unknown as GameState;
    sanitise(s);
    return s;
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

/** The Fasti (dedicated colonies), newest first. */
export function loadFasti(): FastiEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.fasti);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is FastiEntry => isObj(e) && typeof e.name === 'string' && typeof e.seed === 'number').slice(0, B.ui.FASTI_MAX);
  } catch {
    return [];
  }
}

/** Adds a dedicated colony to the Fasti (newest first, at most FASTI_MAX). */
export function addFasti(e: FastiEntry): void {
  const list = [e, ...loadFasti()].slice(0, B.ui.FASTI_MAX);
  try { localStorage.setItem(KEYS.fasti, JSON.stringify(list)); } catch { /* storage blocked */ }
}
