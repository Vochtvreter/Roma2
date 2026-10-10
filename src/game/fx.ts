// src/game/fx.ts — the typed effect bus (ARCHITECTURE §8.1, DESIGN §9.3).
// Sources: chosen path options, the current option of every edict, active timed modifiers. Focus contributes
// nothing; legacy and emergency portions are applied by economy.ts, not here.
// Memoised per state on paths + edicts + active modifiers (compared field by field, no string building).
import { ADD_KEYS, EDICTS, MUL_KEYS, PATH_DECISIONS } from './types';
import type { AddKey, Effects, GameState, Modifier, MulKey } from './types';
import { EDICT_DEFS, PATH_DEFS } from './data/decisions';

/** One effect source with its display label. */
export interface FxSource { label: string; fx: Effects }

interface FxCache {
  day: number;
  edicts: string[];
  paths: (string | undefined)[];
  mods: Modifier[];
  untils: number[];
  fxs: Effects[];
  sources: FxSource[];
  mul: Record<MulKey, number>;
  add: Record<AddKey, number>;
}

const cache = new WeakMap<GameState, FxCache>();
const MUL_SET: ReadonlySet<string> = new Set<string>(MUL_KEYS);

function valid(s: GameState, c: FxCache): boolean {
  if (c.day !== s.day) return false;
  const ed = s.decisions.edicts;
  for (let i = 0; i < EDICTS.length; i++) if (ed[EDICTS[i]] !== c.edicts[i]) return false;
  const pa = s.decisions.paths;
  for (let i = 0; i < PATH_DECISIONS.length; i++) if (pa[PATH_DECISIONS[i]] !== c.paths[i]) return false;
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
    edicts: EDICTS.map((e) => s.decisions.edicts[e]),
    paths: PATH_DECISIONS.map((d) => s.decisions.paths[d]),
    mods: s.modifiers.slice(),
    untils: s.modifiers.map((m) => m.until),
    fxs: s.modifiers.map((m) => m.fx),
    sources, mul, add,
  };
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
