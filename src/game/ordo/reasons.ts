// src/game/ordo/reasons.ts — Reason templates: full sentences and ticker fragments (ARCHITECTURE §8.4, DESIGN §10.6). Owner: WP-C.
// Params are plain JSON. Names are resolved here by key: type/for → a work, res → a good, hub, cat, focus, rank (index),
// want (a house need), why/level/state → phrases; anything else is a number. Template syntax: {k} value, {K} capitalised,
// {a:k}/{A:k} with an article, [ … ] an optional part kept only when every {k} inside it resolves.
import type { BuildingId, Reason, ReasonCode } from '../types';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { RESOURCE_DEFS as RESOURCE_DEFS$ } from '../data/resources';
import { HUB_DEFS as HUB_DEFS$ } from '../data/hubs';
import { FOCUS_DEFS as FOCUS_DEFS$ } from '../data/decisions';
import { RANK_DEFS as RANK_DEFS$ } from '../data/ranks';
import { NEED_META as NEED_META$ } from '../data/housing';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const BUILDING_DEFS = BUILDING_DEFS$, RESOURCE_DEFS = RESOURCE_DEFS$, HUB_DEFS = HUB_DEFS$, FOCUS_DEFS = FOCUS_DEFS$,
  RANK_DEFS = RANK_DEFS$, NEED_META = NEED_META$;

/** Works named in Roman-flavoured English: common things in English, the great civic works by their Latin names. */
const WORK: Partial<Record<BuildingId, string>> = {
  ager: 'field', olivetum: 'olive grove', horreum: 'horreum', apotheca: 'apotheca', castellum: 'castellum',
  lacus: 'fountain', taberna: 'row of tabernae', macellum: 'macellum', mansio: 'mansio', lararium: 'shrine',
  templum: 'templum', balneum: 'balneum', thermae: 'thermae', theatrum: 'theatrum',
};
const FOR: Record<string, string> = { petition: 'petition to Rome', plan: 'planned works', renovation: 'renovations', capitolium: 'Capitolium', wish: 'next work' };
const CAT: Record<string, string> = { water: 'the wells', food: 'the fields', materials: 'materials', industry: 'the workshops', services: 'the services', builders: 'the builders' };
const WHY: Record<string, string> = {
  low: 'water is below our reserve', thirst: 'the people are thirsty', prefill: 'filling the cisterns before Aestas',
  hungry: 'the people go hungry', hiems: 'Hiems, and our stores run low', full: 'the stores are full',
  famine: 'our fields cannot feed us', winter: 'Hiems would empty our stores',
  sold: 'Sold', bought: 'Bought', parcae: 'Parcae', arctae: 'Arctae',
};
const STATE: Record<string, string> = { raising: 'Raising: ', staked: 'Staked: ', next: 'Next: ', would: 'The Ordo would raise: ' };

const TEXT: Record<ReasonCode, string> = {
  request: 'Raising the {type} you asked for[: {n} homes lacked {want}].',
  pin: 'Building next, by your order: {a:type}.',
  survivalFood: 'Famine looms: grain lasts {doh} days and every hand in the fields cannot feed us, so {a:type} comes before all else.',
  survivalWater: 'Thirst looms: water lasts {doh} days and our wells cannot keep up, so {a:type} comes before all else.',
  aestasWater: 'Aestas comes in {days} days and our water would fall to {low} days; we keep {keep}, so {a:type} is raised.',
  hiemsStore: 'Hiems comes in {days} days and our stores hold only {hold} days of grain; we keep {keep}, so {a:type} is raised.',
  storageFull: 'Our {res} stores are {pct}% full[ and cannot hold what the {for} needs]: {a:type} gives room.',
  beds: 'Only {free} beds stand free and we keep {keep} for newcomers: {a:type} is laid out.',
  waterAccess: '{n} homes fetch their water from the river: {a:type} will reach {reach} of them.',
  evolve: '{n} homes would grow but lack {want}: {a:type} will give it to {reach} of them.',
  rank: 'Rome expects {a:type} of a {rank}: our next petition names it.',
  materials: 'We lack {qty} {res} for the {for}[, ≈ {eta} days at our pace]: {a:type} will bring it in.',
  luxury: 'The great houses want {res} and our groves press too little: {a:type} is planted.',
  focusPlan: 'The council\'s plan[ for {focus}] calls for {a:type}.',
  beauty: '{A:type} to lift {n} stone houses toward the dignity of a domus.',
  capitolium: 'The Capitolium needs {qty} more {res} to keep rising[, ≈ {eta} days at our pace]: {a:type} will bring it in.',
  needWater: 'Wells drawing {goal} a day for a need of {need}[ — {why}].',
  needFood: 'Hands in the fields for {goal} grain a day against a need of {need}[ — {why}][, and a winter stock ({stock} of {target})].',
  reserveTopup: 'Topping up the grain: {doh} days in store and we keep {keep}[, and a winter stock ({stock} of {target})].',
  requiredService: 'Manning the {n} works our homes cannot do without.',
  builderShare: '{n} builders for the works in hand.',
  monument: '{n} builders, {crew} of them on the Capitolium.',
  pendingInput: '{n} hands on {res}: we need {qty} more for the {for}.',
  winterStock: 'Stockpiling for Hiems ({stock} of {target}).',
  tools: 'Smiths forge tool kits: {kits} in store, we want {goal}.',
  luxuryStaff: 'Olive groves pressing for the great houses ({demand} oil a day).',
  serviceFull: 'Services manned to their full reach.',
  focusSplit: 'Spare hands as the council\'s focus on {focus} directs.',
  leftover: 'The last hands fill open posts[; {idle} stand idle, foraging and helping the builders].',
  priority: 'By your order: {cat} first[ for {days} more days].',
  deficitImport: 'Buying {qty} {res} from {hub}: {why}.',
  luxuryImport: 'Buying {qty} {res} from {hub}: the great houses would run dry in {days} days.',
  wishImport: 'Buying {qty} {res} from {hub} for the {for}[, which would wait {days} days for it].',
  surplusExport: 'Selling {qty} surplus {res} to {hub}.',
  merchantDeal: '{why} {qty} {res} at {price} denarii each with the visiting merchant.',
  emergencyRations: 'Lex de annona: grain would run out in {days} days; rations are cut to {level}.',
  emergencyWater: 'Lex de annona: water would run out in {days} days; the concrete works and baths stop drawing.',
  emergencyHands: 'Lex de annona: our stores hold only {days} days; {n} more hands go to the fields and wells.',
  emergencyImport: 'Lex de annona: {qty} grain bought from {hub}, arriving in {days} days.',
  relief: 'Lex de annona: grain runs out in {days} days and our coin cannot buy more; we ask the Legate for the legion\'s grain.',
  saving: 'Saving {qty} {res} for the {for}[ (≈ {eta} days)].',
  aquae: '{n} great houses draw no running water: {a:type} brings the aqueduct\'s water to {reach} of them.',
  renewal: '{n} homes wait for {want} and no block is free: the Ordo buys out {cottages} homes, rehouses their families and raises {a:type} there.',
};

const SHORT: Record<ReasonCode, string> = {
  request: '{Type} — you asked for it', pin: '{Type} — by your order',
  survivalFood: '{Type} — famine: {doh} d of grain', survivalWater: '{Type} — thirst: {doh} d of water',
  aestasWater: '{Type} — Aestas in {days} d, water would fall to {low} d, we keep {keep}',
  hiemsStore: '{Type} — Hiems in {days} d, our stores hold {hold} d, we keep {keep}',
  storageFull: '{Type} — {res} stores {pct}% full', beds: '{Type} ({free} free beds; we keep {keep})',
  waterAccess: '{Type} — {n} homes lack water', evolve: '{Type} — {n} homes lack {want}',
  rank: '{Type} — the {rank} petition names it', materials: '{Type} — we lack {qty} {res}',
  luxury: '{Type} — the great houses want {res}', focusPlan: '{Type} — the council\'s[ {focus}] plan',
  beauty: '{Type} — beauty for {n} stone houses', capitolium: '{Type} — the Capitolium needs {res}',
  needWater: 'Staffed the wells: water need {need}/day',
  needFood: 'Staffed the fields: grain need {need}/day[ + winter stock ({stock} of {target})]',
  reserveTopup: 'Topping up the grain: {doh} d, we keep {keep}', requiredService: 'Manning {n} works our homes depend on',
  builderShare: '{n} builders on the works', monument: '{crew} builders on the Capitolium',
  pendingInput: '+{n} on {res} for the {for}', winterStock: 'Stockpiling for Hiems ({stock}/{target})',
  tools: 'Forging tool kits ({kits}/{goal})', luxuryStaff: 'Pressing oil ({demand}/day)', serviceFull: 'Services fully manned',
  focusSplit: 'Spare hands to {focus}', leftover: 'Open posts filled[; {idle} idle]', priority: '{Cat} first by your order',
  deficitImport: 'Buying {qty} {res} from {hub}', luxuryImport: 'Buying {qty} {res} from {hub} for the great houses',
  wishImport: 'Buying {qty} {res} from {hub} for the {for}', surplusExport: 'Selling {qty} {res} to {hub}',
  merchantDeal: '{why} {qty} {res} with the merchant', emergencyRations: 'Lex de annona: rations cut to {level}',
  emergencyWater: 'Lex de annona: concrete works and baths paused', emergencyHands: 'Lex de annona: {n} more hands to the fields and wells',
  emergencyImport: 'Lex de annona: {qty} grain from {hub}',
  relief: 'Lex de annona: the Legate\'s relief', saving: 'Saving: {qty} {res}[ (≈ {eta} d)]',
  aquae: '{Type} — {n} great houses want running water', renewal: '{Type} — {cottages} homes bought out for it',
};

/** Sentences for the other side of a flag: a lifted emergency measure, a hand-set labour line. */
const FLIPPED: Partial<Record<ReasonCode, [string, string]>> = {
  emergencyRations: ['Lex de annona: grain is back to {doh} days; full rations are restored.', 'Lex de annona: full rations restored'],
  emergencyWater: ['Lex de annona: water is back to {doh} days; the works draw again.', 'Lex de annona: the works draw water again'],
  emergencyHands: ['Lex de annona: the stores hold {doh} days again; the hands go back to your orders.', 'Lex de annona: the hands back to your orders'],
  priority: ['By your hand: {n} on {cat}.', '{Cat}: {n} by your hand'],
};

/** Sentences for a case of a code its params name: Aestas already upon us (no `days` ahead), a lacking good that the
 *  stores now hold (`covered`: the work still keeps it coming, but "we lack" would contradict the stock beside it). */
const VARIANT: Partial<Record<ReasonCode, { when: (p: Reason['params']) => boolean; text: [string, string] }>> = {
  aestasWater: {
    when: (p) => !(typeof p.days === 'number' && p.days > 0),
    text: ['Aestas is upon us and our water would fall to {low} days; we keep {keep}, so {a:type} is raised.', '{Type} — Aestas: water would fall to {low} d, we keep {keep}'],
  },
  luxuryImport: {
    when: (p) => typeof p.days !== 'number',
    text: ['Buying {qty} {res} from {hub}: without it our stores would fall {short} short of what the great houses draw.', 'Buying {qty} {res} from {hub} for the great houses'],
  },
  luxury: {
    when: (p) => p.store === 1,
    text: ['The great houses need {need} days of {res} in store to outlast the lean season, and our stores hold {hold}: {a:type} gives room.', '{Type} — {res} for the lean season: we hold {hold} d, need {need}'],
  },
  materials: { when: (p) => p.covered === 1, text: ['We have {res} enough for the {for}; {a:type} keeps the supply coming.', '{Type} — keeps the {res} coming'] },
  capitolium: { when: (p) => p.covered === 1, text: ['We have {res} enough for the Capitolium for now; {a:type} keeps the supply coming.', '{Type} — keeps the {res} coming for the Capitolium'] },
};

/** Display name of a work in running text ('house plot', 'horreum', 'shrine', …). */
export function workName(type: BuildingId): string {
  return WORK[type] ?? BUILDING_DEFS[type].name.toLowerCase();
}

/** A work's name with its indefinite article ('a horreum', 'an apotheca'). */
export function aWork(type: BuildingId): string {
  const n = workName(type);
  return `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`;
}

function fmtNum(v: number): string {
  const r = Math.abs(v) < 10 && !Number.isInteger(v) ? Math.round(v * 10) / 10 : Math.round(v);
  return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function resolve(key: string, v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return key === 'rank' ? RANK_DEFS[v]?.name : fmtNum(v);
  switch (key) {
    case 'type': return v in BUILDING_DEFS ? workName(v as BuildingId) : v;
    case 'for': return v in BUILDING_DEFS ? workName(v as BuildingId) : FOR[v] ?? v;
    case 'res': return v in RESOURCE_DEFS ? RESOURCE_DEFS[v as keyof typeof RESOURCE_DEFS].name.toLowerCase() : v;
    case 'hub': return v in HUB_DEFS ? HUB_DEFS[v as keyof typeof HUB_DEFS].name : v;
    case 'cat': return CAT[v] ?? v;
    case 'focus': return v in FOCUS_DEFS ? FOCUS_DEFS[v as keyof typeof FOCUS_DEFS].latin : v;
    case 'want': return v in NEED_META ? NEED_META[v as keyof typeof NEED_META].label.toLowerCase() : v;
    case 'why': case 'level': return WHY[v] || undefined;
    default: return v;
  }
}

const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Fills one template: optional parts drop out when incomplete; a missing required value renders as an ellipsis. */
function fill(t: string, p: Record<string, number | string>): string {
  const one = (seg: string): string | null => {
    let ok = true;
    const out = seg.replace(/\{(?:([aA]):)?(\w+)\}/g, (_m, art: string | undefined, key: string) => {
      const lower = key.charAt(0).toLowerCase() + key.slice(1);
      let v = resolve(lower, p[lower]);
      if (v === undefined) { ok = false; return '…'; }
      if (art) v = `${/^[aeiou]/i.test(v) ? 'an' : 'a'} ${v}`;
      return art === 'A' || key !== lower ? capital(v) : v;
    });
    return ok ? out : null;
  };
  const body = t.replace(/\[([^\]]*)\]/g, (_m, inner: string) => one(inner) ?? '');
  return one(body) ?? body.replace(/\{(?:[aA]:)?\w+\}/g, '…');
}

function template(r: Reason, short: boolean): string {
  const p = r.params;
  const flip = FLIPPED[r.code];
  const flipped = flip !== undefined && (r.code === 'priority' ? p.manual !== undefined : p.level === 'none' || p.paused === 0);
  if (flipped) return flip[short ? 1 : 0];
  const variant = VARIANT[r.code];
  if (variant?.when(p)) return variant.text[short ? 1 : 0];
  return (short ? SHORT : TEXT)[r.code] ?? r.code;
}

/** "1 homes" → "1 home" (the templates count homes in the plural). */
const one = (t: string): string => t.replace(/(^|[^\d.,])1 homes\b/g, '$11 home');

/** Full sentence for tooltips and the Annales. */
export function reasonText(r: Reason): string {
  return one(fill(template(r, false), r.params));
}

/** Ticker fragment (no trailing period); a `state` param prefixes Raising / Staked / Next / The Ordo would raise. */
export function reasonShort(r: Reason): string {
  const st = typeof r.params.state === 'string' ? STATE[r.params.state] ?? '' : '';
  return st + one(fill(template(r, true), r.params));
}
