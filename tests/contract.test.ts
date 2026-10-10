// tests/contract.test.ts — the contract checks of ARCHITECTURE §5 and §10.1 (determinism grep, import rules), id
// uniqueness (§4, §10.3), balance.ts against ARCHITECTURE §7 and DESIGN §18.3/§18.4, and the effect keys (§4, DESIGN §9.3).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B } from '../src/game/balance';
import { ADD_KEYS, EDICTS, MILESTONE_IDS, MUL_KEYS, PATH_OPTIONS, RULES, TIPS } from '../src/game/types';
import type { Effects } from '../src/game/types';
import { BUILDING_DEFS } from '../src/game/data/buildings';
import { EDICT_DEFS, PATH_DEFS, SETTING_DEFS } from '../src/game/data/decisions';
import { RANK_DEFS } from '../src/game/data/ranks';
import { RULE_DEFS } from '../src/game/advisors/engine';
import { GUIDE } from '../src/game/guide';
import { MILESTONES } from '../src/game/objectives';
import { BANDS, COIN_NET, TARGETS } from './autoplayer';
import { INTEGRATED, fresh, run } from './util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAME = join(ROOT, 'src', 'game');
const doc = (name: string): string => readFileSync(join(ROOT, 'docs', name), 'utf8');
/** The text of a document from the line starting with `from` up to the next line starting with `to`. */
function section(text: string, from: string, to: string): string {
  const a = text.indexOf(`\n${from}`), b = text.indexOf(`\n${to}`, a + 1);
  expect(a, `section ${from}`).toBeGreaterThanOrEqual(0);
  return text.slice(a + 1, b < 0 ? undefined : b);
}
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []).sort();
}
const SOURCES = tsFiles(GAME).map((abs) => ({ abs, path: relative(ROOT, abs).split('\\').join('/'), raw: readFileSync(abs, 'utf8') }));

const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^';
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'yield', 'await']);
/** TypeScript source without comments; with `keepStrings` false every string, template and regex literal is blanked too. */
function scan(src: string, keepStrings = false): string {
  let out = '', i = 0, prev = '', depth = 0;
  const holes: number[] = [];   // brace depth of every open `${`
  const n = src.length;
  const emit = (start: number, blank: string): void => { out += keepStrings ? src.slice(start, i) : blank; };
  const template = (): void => {   // scans template text up to the closing backtick or the next `${`
    const start = i;
    while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) i += src[i] === '\\' ? 2 : 1;
    if (src[i] === '`') { i++; emit(start, '``'); } else { i += 2; holes.push(++depth); emit(start, '`${'); }
    prev = '`';
  };
  while (i < n) {
    const c = src[i], d = src[i + 1], start = i;
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++; emit(start, '""'); prev = '"'; continue;
    }
    if (c === '`') { i++; template(); continue; }
    if (c === '/' && (prev === '' || REGEX_AFTER.includes(prev) || REGEX_WORDS.has(/(\w+)\s*$/.exec(out)?.[1] ?? ''))) {
      let cls = false;
      for (i++; i < n && (src[i] !== '/' || cls); i++) {
        if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
      }
      for (i++; /[a-z]/i.test(src[i] ?? ''); i++);
      emit(start, '/r/'); prev = '/'; continue;
    }
    if (c === '{') depth++;
    if (c === '}' && holes.length > 0 && holes[holes.length - 1] === depth) { holes.pop(); depth--; i++; template(); continue; }
    if (c === '}') depth--;
    out += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
const CODE = SOURCES.map((f) => ({ ...f, code: scan(f.raw), text: scan(f.raw, true) }));
function importsOf(text: string): string[] {
  const out: string[] = [];
  for (const re of [/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/gm, /^\s*import\s*(['"])([^'"]+)\1/gm, /\bimport\s*\(\s*(['"])([^'"]+)\1/g]) {
    for (const m of text.matchAll(re)) out.push(m[2]);
  }
  return out;
}

describe('determinism grep and import rules (ARCHITECTURE §5, §10.1, §10.3)', () => {
  it('the scanner drops comments and literals but keeps code', () => {
    const src = "const a = 'Date.now()'; // Math.random\n/* performance */ const b = `x${Date.now() + `${'q'}`}y`; const r = /Date\\//g; const c = d / e / f; return /x/.test(c);";
    const c = scan(src);
    expect(c).not.toMatch(/Math|performance|\bq\b/);
    expect(c.match(/\bDate\b/g)).toEqual(['Date']);
    expect(c).toContain('d / e / f');
    expect(scan(src, true)).toContain("'Date.now()'");
  });
  it('src/game uses no wall clock, ambient randomness, timers, crypto, DOM or for…in', () => {
    const FORBIDDEN: [RegExp, string][] = [
      [/\bMath\s*\.\s*random\b/, 'Math.random'], [/\bDate\b/, 'Date'], [/\bperformance\b/, 'performance'],
      [/\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, 'timers'], [/\bcrypto\b/, 'crypto'],
      [/\b(window|document|navigator|globalThis)\b/, 'DOM / globals'], [/\bfor\s*\(\s*(const|let|var)\s+\w+\s+in\b/, 'for…in'],
    ];
    for (const f of CODE) {
      for (const [re, what] of FORBIDDEN) expect(re.test(f.code), `${f.path} uses ${what}`).toBe(false);
      if (!f.path.endsWith('src/game/save.ts')) expect(/\blocalStorage\b/.test(f.code), `${f.path} touches localStorage`).toBe(false);
    }
  });
  it('src/game imports only src/game; balance.ts and types.ts import nothing; data imports only types.ts', () => {
    let total = 0;
    for (const f of CODE) {
      const specs = importsOf(f.text);
      total += specs.length;
      for (const spec of specs) {
        expect(spec.startsWith('.'), `${f.path} imports the package ${spec}`).toBe(true);
        const target = resolve(dirname(f.abs), spec);
        expect(target.startsWith(GAME), `${f.path} imports ${spec}`).toBe(true);
        if (f.path.includes('/data/')) expect(relative(GAME, target).replace(/\.ts$/, ''), `${f.path} imports ${spec}`).toBe('types');
      }
      if (/src\/game\/(balance|types)\.ts$/.test(f.path)) expect(specs, f.path).toEqual([]);
    }
    expect(total, 'the import scanner found nothing').toBeGreaterThan(CODE.length);
  });
});

describe('ids are unique (ARCHITECTURE §4)', () => {
  it('MulKey and AddKey never share a name (fxBreakdown tells them apart by name)', () => {
    expect(MUL_KEYS.filter((k) => (ADD_KEYS as readonly string[]).includes(k))).toEqual([]);
  });
  it('path options are unique across the decisions; edict options unique within each edict', () => {
    const opts = Object.values(PATH_DEFS).flatMap((d) => d.options.map((o) => o.id));
    expect(new Set(opts).size).toBe(opts.length);
    expect([...opts].sort()).toEqual([...PATH_OPTIONS].sort());
    for (const e of EDICTS) expect(new Set(EDICT_DEFS[e].options.map((o) => o.id)).size, e).toBe(EDICT_DEFS[e].options.length);
  });
  it('RULE_DEFS, GUIDE and MILESTONES hold unique known ids in their frozen order (complete once integrated)', () => {
    const ordered = (ids: string[], all: readonly string[], what: string): void => {
      const at = ids.map((id) => all.indexOf(id));
      expect(at.every((k, j) => k >= 0 && (j === 0 || k > at[j - 1])), `${what}: ${ids.join(' ')}`).toBe(true);
      if (INTEGRATED) expect(ids, what).toEqual([...all]);
    };
    ordered(RULE_DEFS.map((r) => r.id), RULES, 'RULE_DEFS');
    ordered(GUIDE.map((g) => g.id), TIPS, 'GUIDE');
    ordered(MILESTONES.map((m) => m.id), MILESTONE_IDS, 'MILESTONES');
    expect(GUIDE[0]?.id).toBe('welcome');
    for (const g of GUIDE) if (g.after) expect(GUIDE.some((h) => h.id === g.after), `${g.id} after ${g.after}`).toBe(true);
    for (const r of RULE_DEFS) expect(r.id.startsWith(`${r.advisor}.`), r.id).toBe(true);
  });
  it('entities share one id counter: unique across every list, sorted, below nextId', () => {
    const s = run(fresh(9), 400);
    const lists: Record<string, { id: number }[]> = {
      buildings: s.buildings, people: s.people, families: s.families, contracts: s.trade.contracts, caravans: s.trade.caravans,
      offers: s.trade.merchant?.offers ?? [],
    };
    const all: number[] = [];
    for (const [name, list] of Object.entries(lists)) {
      const ids = list.map((x) => x.id);
      if (name !== 'offers') expect(ids.every((v, k) => k === 0 || ids[k - 1] < v), `${name} sorted by id`).toBe(true);
      all.push(...ids);
    }
    expect(new Set(all).size).toBe(all.length);
    expect(Math.max(0, ...all)).toBeLessThan(s.nextId);
  });
});

/** Leaf paths of a plain object (arrays are leaves). */
function leaves(o: unknown, path = ''): [string, unknown][] {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return [[path, o]];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}
const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
/** Keys of ARCHITECTURE §7 whose value balance.ts has moved on purpose (path → reason); DESIGN must say the same. */
const TUNED: Record<string, string> = {};

describe('balance.ts mirrors the contract (ARCHITECTURE §7, DESIGN §18.3)', () => {
  it('every key of the ARCHITECTURE §7 block exists with its value (except documented tuning)', () => {
    const sec = section(doc('ARCHITECTURE.md'), '## 7.', '## 8.');
    const body = sec.slice(sec.indexOf('export const B = ') + 'export const B = '.length, sec.lastIndexOf('} as const;') + 1);
    const spec = new Function(`return (${body});`)() as unknown;
    expect(leaves(spec).length, 'the §7 block did not parse').toBeGreaterThan(150);
    for (const [path, want] of leaves(spec)) {
      expect(at(B, path), `B.${path} missing`).toBeDefined();
      if (!(path in TUNED)) expect(at(B, path), `B.${path}`).toEqual(want);
    }
  });

  it('every item of DESIGN §18.3 equals balance.ts', () => {
    const m = B.map, p = B.people, e = B.economy, h = B.housing, o = B.ordo, a = B.advisors;
    const TABLE: [item: string, got: unknown, want: unknown][] = [
      ['SPEEDS [1,2,5,10]', B.time.SPEEDS, [1, 2, 5, 10]], ['START_DAY 90', B.time.START_DAY, 90], ['OFFLINE_RATE 0.5', B.time.OFFLINE_RATE, 0.5],
      ['OFFLINE_MAX_DAYS 1,825', B.time.OFFLINE_MAX_DAYS, 1825], ['OFFLINE_MIN_MS 60,000', B.time.OFFLINE_MIN_MS, 60_000],
      ['AUTOSAVE_S 20', B.time.AUTOSAVE_S, 20], ['STAKE_DAYS 5', B.construction.STAKE_DAYS, 5], ['EVENT_START 300', B.events.START, 300],
      ['EVENT_CHANCE 1/40', B.events.CHANCE, 1 / 40], ['CHOICE_GAP 200', B.events.CHOICE_GAP, 200], ['HARMFUL_GAP 120', B.events.HARMFUL_GAP, 120],
      ['CHOICE_DAYS 30', B.events.CHOICE_DAYS, 30], ['W 112', m.W, 112], ['H 84', m.H, 84], ['TILE 16', m.TILE, 16], ['PITCH 5', m.PITCH, 5],
      ['CASTRUM 31×21', [m.INTERIOR_W, m.INTERIOR_H], [31, 21]], ['TERRITORY [20,26,34,44,999]', m.TERRITORY, [20, 26, 34, 44, 999]],
      ['rings by rank [0],[0,1],[0,1,2]…', m.RINGS, [[0], [0, 1], [0, 1, 2], [0, 1, 2], [0, 1, 2]]],
      ['NEED child .6 youth .85 adult 1 elder .75', p.NEED, [0.6, 0.85, 1, 0.75]], ['BIRTH 0.20/yr', p.BIRTH_RATE, 0.2],
      ['MARRY 1/400', p.MARRY_P, 1 / 400], ['IMM_RATE [0.012,0.03,0.045,0.06,0.07]', p.IMM_RATE, [0.012, 0.03, 0.045, 0.06, 0.07]],
      ['CEILING [100,260,560,900,1500]', p.CEILING, [100, 260, 560, 900, 1500]], ['POP_CAP 1500', p.POP_CAP, 1500],
      ['SKILL_XP 0.004', p.SKILL_XP, 0.004], ['SKILL_BONUS 0.04', p.SKILL_BONUS, 0.04], ['ELDER_OUT 0.7', p.ELDER_OUT, 0.7],
      ['RETIRE 65', p.RETIRE, 65], ['MULT_CAP 2.5', e.MULT_CAP, 2.5], ['PRODUCTIVITY 0.85 + 0.30·m', [e.PROD_BASE, e.PROD_MORALE], [0.85, 0.3]],
      ['TOOL 1.2 × 120 d', [e.TOOL_MULT, e.TOOL_DAYS], [1.2, 120]], ['IDLE_FORAGE 0.3', e.IDLE_FORAGE, 0.3], ['IDLE_BUILD 0.3', e.IDLE_BUILD, 0.3],
      ['SHED_ROT 0.003 (×2 Aestas)', [e.SHED_ROT, e.ROT_SEASON[1]], [0.003, 2]], ['EVAPORATION 0.002', e.EVAPORATION, 0.002],
      ['HORREUM 4,000', [e.HORREUM, BUILDING_DEFS.horreum.storage?.grain], [4000, 4000]], ['OK_DAYS 15', h.OK_DAYS, 15],
      ['RENOVATE_DAYS 8', h.RENOVATE_DAYS, 8], ['DECLINE_AFTER 20', h.DECLINE_AFTER, 20], ['DROP_AFTER 60', h.DROP_AFTER, 60],
      ['OFFLINE_DECLINE_STOP 55', h.OFFLINE_DECLINE_STOP, 55], ['THROTTLE 1 + houses/8 per 10 d', [h.THROTTLE_PER, h.THROTTLE_WINDOW], [8, 10]],
      ['DESIR_DOMUS 10', h.DESIR_DOMUS, 10], ['BUILD_EVERY 2', o.BUILD_EVERY, 2], ['TRADE_DAY 10/5', [o.TRADE_EVERY, o.TRADE_OFFSET], [10, 5]],
      ['SITES 1 + workforce/40 (max 4)', [o.SITES_PER, o.SITES_MAX], [40, 4]], ['FOOD_CAP .75/.90', [o.FOOD_CAP, o.FOOD_CAP_HUNGRY], [0.75, 0.9]],
      ['BUILDERS_MAX .30', o.BUILDERS_MAX, 0.3], ['CAP_CREW 64', B.construction.CAP_CREW, 64], ['CLEAR ×1.25', a.CLEAR, 1.25],
      ['DOWNGRADE 3 d', a.DOWNGRADE_DAYS, 3], ['MIN_LIFE 3 d', a.MIN_LIFE, 3], ['HUSH 30 d', a.HUSH_DAYS, 30], ['BELL 30 s', a.BELL_S, 30],
    ];
    const items = section(doc('DESIGN.md'), '### 18.3', '### 18.4').split('\n').filter((l) => /^\w+: /.test(l))
      .flatMap((l) => l.replace(/^\w+: /, '').replace(/\.$/, '').split(' · ').map((x) => x.trim()));
    expect(items.length).toBeGreaterThan(40);
    expect(items.filter((x) => !TABLE.some(([item]) => item === x)), 'DESIGN §18.3 items without a check').toEqual([]);
    for (const [item, got, want] of TABLE) {
      expect(items, `"${item}" is no longer in DESIGN §18.3`).toContain(item);
      expect(got, item).toEqual(want);
    }
  });

  it('mirrors equal their registries', () => {
    expect(B.map.TERRITORY).toEqual(RANK_DEFS.map((r) => r.territory));
    expect(B.map.RINGS).toEqual(RANK_DEFS.map((r) => r.rings));
    expect(B.people.IMM_RATE).toEqual(RANK_DEFS.map((r) => r.immRate));
    expect(B.people.CEILING).toEqual(RANK_DEFS.map((r) => r.ceiling));
    expect(B.construction.CAP_WORK).toBe(BUILDING_DEFS.capitolium.work);
    expect(B.forum.DESIR).toEqual(BUILDING_DEFS.principia.desir);
    expect(B.dignitas.FORUM[0]).toBe(BUILDING_DEFS.principia.dignitas);
    expect(B.housing.RENOVATION_SHARE).toBe(SETTING_DEFS.renovation.initial);
    expect(B.economy.TOOL_TARGET).toBe(B.ordo.TOOLS_PER);
    expect(B.ordo.CARGO).toBe(B.trade.CARGO_MAX);
  });

  it('every number is finite, B is never mutated, and whatever asks for a reaction lasts ≥ 25 days (DESIGN §2.3)', () => {
    for (const [path, v] of leaves(B)) {
      for (const x of [v].flat(3)) expect(typeof x === 'number' && Number.isFinite(x), `B.${path}`).toBe(true);
    }
    const before = JSON.stringify(B);
    run(fresh(3), 200);
    expect(JSON.stringify(B)).toBe(before);
    const e = B.events;
    for (const d of [e.CHOICE_DAYS, e.VETERAN_STAY, e.MERCHANT_STAY, B.housing.DECLINE_AFTER + B.housing.DROP_AFTER]) expect(d).toBeGreaterThanOrEqual(e.REACT_MIN);
  });

  it('the bots\' bands, target curve and treasury targets equal DESIGN §18.4', () => {
    const sec = section(doc('DESIGN.md'), '### 18.4', '### 18.5');
    const r = (b: readonly [number, number]): string => `${b[0].toLocaleString('en-US')}–${b[1].toLocaleString('en-US')}`;
    for (const want of [`Vicus ${r(BANDS.vicus)}`, `Oppidum ${r(BANDS.oppidum)}`, `Municipium ${r(BANDS.municipium)}`, `Colonia ${r(BANDS.colonia)}`,
      `victory ${r(BANDS.victory)}`, `Capitolium phase ${r(BANDS.capPhase)}`, `each stage ${r(BANDS.capStage)}`, `pop at victory ${r(BANDS.victoryPop)}`]) {
      expect(sec).toContain(want);
    }
    const rows = sec.split('\n').filter((l) => /^\| [^-|]/.test(l) && /\d+\/\d+\/\d+/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
    expect(rows.map((c) => ({ day: Number(c[2].replace(/,/g, '')), pop: Number(c[4].replace(/,/g, '')), tiers: c[5].split('/').map(Number) })))
      .toEqual(TARGETS.map((t) => ({ day: t.day, pop: t.pop, tiers: [...t.tiers] })));
    const coin = RANK_DEFS.map((d, k) => `${d.name} +${COIN_NET[k][0] === COIN_NET[k][1] ? COIN_NET[k][0] : `${COIN_NET[k][0]}–${COIN_NET[k][1]}`}`);
    for (const c of coin) expect(sec).toContain(c);
  });
});

describe.runIf(INTEGRATED)('effect keys (DESIGN §9.3)', () => {
  it('every MulKey and AddKey is used: whatever a data row or rule sets is read by the simulation', () => {
    const produced = new Set<string>();
    const addFx = (fx: Effects): void => { for (const k of [...Object.keys(fx.mul ?? {}), ...Object.keys(fx.add ?? {})]) produced.add(k); };
    for (const d of Object.values(EDICT_DEFS)) for (const o of d.options) addFx(o.fx);
    for (const d of Object.values(PATH_DEFS)) for (const o of d.options) addFx(o.fx);
    const fxKeys = new Set<string>(Object.values(BUILDING_DEFS).flatMap((b) => b.fxKey ? [b.fxKey] : []));
    for (const k of fxKeys) produced.add(k);
    const code = CODE.filter((f) => !/src\/game\/(types|fx)\.ts$|\/data\//.test(f.path)).map((f) => f.text).join('\n');
    for (const m of code.matchAll(/\b(?:mul|add)\s*:\s*\{([^}]*)\}/g)) for (const k of m[1].matchAll(/(\w+)\s*:/g)) produced.add(k[1]);
    const viaFxKey = /\bfx\s*\([^)]*\bfxKey\b/.test(code);
    const neutral: string[] = [];
    for (const k of [...MUL_KEYS, ...ADD_KEYS]) {
      const read = new RegExp(`['"]${k}['"]`).test(code) || (fxKeys.has(k) && viaFxKey);
      expect(read || produced.has(k), `${k}: neither set nor read anywhere`).toBe(true);
      expect(read, `${k}: set by a data row or rule but never read, so it has no effect`).toBe(true);
      if (!produced.has(k)) neutral.push(k);
    }
    if (neutral.length > 0) console.warn(`effect keys read but never set (always neutral): ${neutral.join(', ')}`);
  });
});
