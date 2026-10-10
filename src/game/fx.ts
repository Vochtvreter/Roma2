// src/game/fx.ts — the typed effect bus (ARCHITECTURE §8.1, DESIGN §9.3).
// Sources: chosen path options, the current option of every edict, active timed modifiers. Focus contributes
// nothing; legacy and emergency portions are applied by economy.ts, not here.
// Memoised per state on paths + edicts + active modifiers (compared field by field, no string building).
import { ADD_KEYS, EDICTS, MUL_KEYS, PATH_DECISIONS } from './types';
import type { AddKey, EdictId, Effects, GameState, Modifier, MulKey, PathDecisionId } from './types';
import { EDICT_DEFS, PATH_DEFS } from './data/decisions';

/** One effect source with its display label. */
export interface FxSource { label: string; fx: Effects }

interface FxCache {
  day: number;
  edicts: Partial<Record<EdictId, string>>;
  paths: Partial<Record<PathDecisionId, string>>;
  mods: Modifier[];
  untils: number[];
  fxs: Effects[];
  sources: FxSource[];
  mul: Record<MulKey, number>;
  add: Record<AddKey, number>;
}

const cache = new WeakMap<GameState, FxCache>();
const MUL_SET: ReadonlySet<string> = new Set<string>(MUL_KEYS);

// valid() runs on every fx read (thousands a day), so the edicts and paths are compared field by field with literal names:
// a loop over the id lists reads with a computed key, about ten times slower. Each list below must name every id (the
// `satisfies` checks make a missing or unknown id a type error, and the module refuses to load if a list falls short).
const EDICT_FIELDS = { rationes: 1, tributum: 1, opera: 1, hospites: 1, horae: 1, nundinae: 1, feriae: 1, silvae: 1, aquae: 1 } satisfies Record<EdictId, 1>;
const PATH_FIELDS = { charter: 1, path1: 1, path2: 1, path3: 1, path4: 1 } satisfies Record<PathDecisionId, 1>;
if (Object.keys(EDICT_FIELDS).length !== EDICTS.length || Object.keys(PATH_FIELDS).length !== PATH_DECISIONS.length) {
  throw new Error('fx.ts: the edict and path field lists must name every id');
}

function sameEdicts(a: Partial<Record<EdictId, string>>, b: Partial<Record<EdictId, string>>): boolean {
  return a.rationes === b.rationes && a.tributum === b.tributum && a.opera === b.opera && a.hospites === b.hospites
    && a.horae === b.horae && a.nundinae === b.nundinae && a.feriae === b.feriae && a.silvae === b.silvae && a.aquae === b.aquae;
}

function samePaths(a: Partial<Record<PathDecisionId, string>>, b: Partial<Record<PathDecisionId, string>>): boolean {
  return a.charter === b.charter && a.path1 === b.path1 && a.path2 === b.path2 && a.path3 === b.path3 && a.path4 === b.path4;
}

function valid(s: GameState, c: FxCache): boolean {
  if (c.day !== s.day) return false;
  if (!sameEdicts(s.decisions.edicts, c.edicts) || !samePaths(s.decisions.paths, c.paths)) return false;
  const mods = s.modifiers;
  if (mods.length !== c.mods.length) return false;
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (m !== c.mods[i] || m.until !== c.untils[i] || m.fx !== c.fxs[i]) return false;
  }
  return true;
}

function build(s: GameState): FxCache {
  const sources: FxSource[] = [];
  for (const d of PATH_DECISIONS) {
    const chosen = s.decisions.paths[d];
    if (!chosen) continue;
    const opt = PATH_DEFS[d]?.options.find((o) => o.id === chosen);
    if (opt) sources.push({ label: opt.name, fx: opt.fx });
  }
  for (const e of EDICTS) {
    const def = EDICT_DEFS[e];
    const opt = def?.options.find((o) => o.id === s.decisions.edicts[e]);
    if (def && opt) sources.push({ label: `${def.name}: ${opt.name}`, fx: opt.fx });
  }
  for (const m of s.modifiers) if (m.until > s.day) sources.push({ label: m.label, fx: m.fx });

  const mul = {} as Record<MulKey, number>;
  for (const k of MUL_KEYS) mul[k] = 1;
  const add = {} as Record<AddKey, number>;
  for (const k of ADD_KEYS) add[k] = 0;
  for (const src of sources) {
    const sm = src.fx.mul;
    if (sm) for (const k of MUL_KEYS) { const v = sm[k]; if (v !== undefined) mul[k] *= v; }
    const sa = src.fx.add;
    if (sa) for (const k of ADD_KEYS) { const v = sa[k]; if (v !== undefined) add[k] += v; }
  }
  return {
    day: s.day,
    edicts: copyFields(s.decisions.edicts, EDICTS),
    paths: copyFields(s.decisions.paths, PATH_DECISIONS),
    mods: s.modifiers.slice(),
    untils: s.modifiers.map((m) => m.until),
    fxs: s.modifiers.map((m) => m.fx),
    sources, mul, add,
  };
}

/** The listed fields of a record (absent ones stay absent, so a later comparison reads undefined on both sides). */
function copyFields<K extends string>(o: Partial<Record<K, string>>, ids: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of ids) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function get(s: GameState): FxCache {
  let c = cache.get(s);
  if (!c || !valid(s, c)) {
    c = build(s);
    cache.set(s, c);
  }
  return c;
}

/** Product of every active source's multiplier for `key` (default 1). */
export function fx(s: GameState, key: MulKey): number {
  return get(s).mul[key];
}

/** Sum of every active source's addend for `key` (default 0). */
export function fxAdd(s: GameState, key: AddKey): number {
  return get(s).add[key];
}

/** The active sources: chosen path options, current edict options, active modifiers (read-only). */
export function fxSources(s: GameState): { label: string; fx: Effects }[] {
  return get(s).sources;
}

/** Every source that sets `key`, with its own factor (multiplier keys) or addend (additive keys). */
export function fxBreakdown(s: GameState, key: MulKey | AddKey): { label: string; value: number }[] {
  const isMul = MUL_SET.has(key);
  const out: { label: string; value: number }[] = [];
  for (const src of get(s).sources) {
    const v = isMul ? src.fx.mul?.[key as MulKey] : src.fx.add?.[key as AddKey];
    if (v !== undefined) out.push({ label: src.label, value: v });
  }
  return out;
}
