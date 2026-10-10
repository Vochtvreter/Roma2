// src/game/advisors/rules-aedilis.ts — the Aedilis's advisories: rules 17–20 (aedilis.evolve … aedilis.morale)
// (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B } from '../balance';
import { HOUSE_TIERS, NEEDS } from '../types';
import type { AdvisorRule, AdvisoryEval, GameState, HouseTierId, NeedId, Remedy, SimView } from '../types';
import { moraleTarget } from '../civic';
import { previewCoverage } from '../coverage';
import { edictOption, petitionNeeds, settingValue } from '../decisions';
import { bestSlot } from '../site';
import { getBuilding } from '../state';
import { RANK_DEFS } from '../data/ranks';
import { SETTING_DEFS } from '../data/decisions';
import { TIER_DEFS } from '../data/housing';
import {
  CLEAR, HOUSE_CADENCE, R, aName, fractionWord, held, houseWants, inDays, int, lowLadder, needRemedy, needWord, placeName, rankWord, serviceFor, three, tierWord,
} from './util';
import type { CadencedRule, HouseWant } from './util';

const P = (x: unknown): number => (typeof x === 'number' ? x : 0);
const COVERED: readonly NeedId[] = ['water', 'religion', 'market', 'temple', 'baths', 'macellum'];

function cap1(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/** The most common value (ties: the earliest in `order`). */
function mode<T>(xs: readonly T[], order: readonly T[]): T {
  let best = xs[0], top = 0;
  for (const o of order) {
    const n = xs.filter((x) => x === o).length;
    if (n > top) { top = n; best = o; }
  }
  return best;
}

/** The houses that wait on exactly one next-tier need, grouped by that need; water is the Curator's (aquarum.access). */
function oneShort(s: GameState, v: SimView): Map<NeedId, HouseWant[]> {
  const by = new Map<NeedId, HouseWant[]>();
  for (const w of houseWants(s, v)) if (w.next && w.unmet.length === 1 && w.unmet[0] !== 'water') by.set(w.unmet[0], [...(by.get(w.unmet[0]) ?? []), w]);
  return by;
}

/** Remedy for a need: the answering building at the slot that serves most of `ids` (coverage needs), or needRemedy. */
function serveRemedy(s: GameState, v: SimView, need: NeedId, ids: ReadonlySet<number>): { remedy: Remedy; slot: number | null; k: number } {
  const type = serviceFor(s, need, v.d.castellumActive);
  if (!type || !COVERED.includes(need)) return { remedy: needRemedy(s, v, need), slot: null, k: 0 };
  const slot = bestSlot(s, type, { owner: 'player', purpose: 'evolve' });
  if (!slot) return { remedy: { kind: 'place', building: type }, slot: null, k: 0 };
  const k = previewCoverage(s, type, slot.x, slot.y).reduce((n, c) => n + c.houses.filter((h) => ids.has(h)).length, 0);
  return { remedy: { kind: 'place', building: type, tile: slot.tile }, slot: slot.tile, k };
}

// ───────────────────────────── 17 · aedilis.evolve ─────────────────────────────

const evolve: CadencedRule = {
  every: HOUSE_CADENCE,
  id: 'aedilis.evolve', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    const by = oneShort(s, v);
    let need: NeedId | null = null, list: HouseWant[] = [];
    for (const n of NEEDS) { const l = by.get(n) ?? []; if (l.length > list.length) { need = n; list = l; } }
    const min = held(s, 'aedilis.evolve') ? Math.floor(R.EVOLVE_HOUSES / CLEAR) : R.EVOLVE_HOUSES;
    if (!need || list.length < min) return null;
    const pn = petitionNeeds(s, v);
    const dep = pn !== null && pn.rank !== null && pn.needs.some((n) => !n.met && /house|tier|T[0-4]/i.test(n.label));
    return {
      rule: 'aedilis.evolve', severity: dep ? 2 : 1, metric: { label: 'Waiting', value: list.length, unit: 'houses' },
      params: {
        n: list.length, need, tile: list[Math.floor(list.length / 2)].tile,
        tier: mode(list.map((w) => w.tier), HOUSE_TIERS), next: mode(list.map((w) => w.next as HouseTierId), HOUSE_TIERS),
      },
    };
  },
  title(s, a) {
    const p = a.params;
    const n = P(p.n);
    return `${n} ${tierWord(p.tier as HouseTierId, n)} ${placeName(s, P(p.tile))} would become ${tierWord(p.next as HouseTierId)} but lack ${needWord(p.need as NeedId)}.`;
  },
  text(s, v, a) {
    const need = a.params.need as NeedId;
    const ids = new Set((oneShort(s, v).get(need) ?? []).map((w) => w.id));
    const r = serveRemedy(s, v, need, ids);
    if (need === 'rank') return `Only a charter from Rome lets them rise: petition for ${rankWord(Math.min(RANK_DEFS.length - 1, s.rank + 1))}.`;
    if (need === 'wine') return 'Wine comes only by caravan, from the markets that sell it.';
    if (need === 'desirability') return 'Gardens, temples and fountains raise a street; shops, workshops and insulae lower it.';
    if (r.remedy.kind !== 'place') return 'The Domus overlay shows what each house still wants.';
    const what = cap1(aName(r.remedy.building));
    if (r.slot !== null && r.k > 0) return `${what} ${placeName(s, r.slot)} would let ${r.k} of them grow.`;
    return `${what} within reach of their doors would let them grow.`;
  },
  remedies(s, v, a) {
    const need = a.params.need as NeedId;
    const ids = new Set((oneShort(s, v).get(need) ?? []).map((w) => w.id));
    return three(serveRemedy(s, v, need, ids).remedy, { kind: 'overlay', overlay: 'domus' });
  },
};

// ───────────────────────────── 18 · aedilis.declining ─────────────────────────────

const declining: CadencedRule = {
  every: HOUSE_CADENCE,
  id: 'aedilis.declining', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    const all = houseWants(s, v);
    const dec = all.filter((w) => w.declining);
    if (dec.length === 0) return null;
    const lapsed = dec.flatMap((w) => w.lapsed);
    const first = Math.min(...dec.map((w) => B.housing.DROP_AFTER - (getBuilding(s, w.id)?.house?.declineDays ?? 0)));
    return {
      rule: 'aedilis.declining', severity: dec.length >= R.DECLINING_P * all.length ? 3 : 2, metric: { label: 'Declining', value: dec.length, unit: 'houses' },
      params: { n: dec.length, need: lapsed.length > 0 ? mode(lapsed, NEEDS) : '', d: Math.max(0, first) },
    };
  },
  title(_s, a) {
    const p = a.params;
    const what = P(p.n) === 1 ? 'A home is declining' : `${P(p.n)} homes are declining`;
    return p.need ? `${what}: ${needWord(p.need as NeedId)} lapsed.` : `${what}.`;
  },
  text(_s, _v, a) {
    const p = a.params;
    const back = p.need ? ` Restore ${needWord(p.need as NeedId)} for ${B.housing.RECOVER_DAYS} days and they recover.` : '';
    return `The first falls back a tier ${inDays(P(p.d))}; a declining house pays half its taxes.${back}`;
  },
  remedies(s, v, a) {
    const need = a.params.need as NeedId | '';
    return three(need ? needRemedy(s, v, need) : null, { kind: 'overlay', overlay: 'domus' });
  },
};

// ───────────────────────────── 19 · aedilis.beds ─────────────────────────────

const beds: AdvisorRule = {
  id: 'aedilis.beds', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    const c = v.c;
    const recent = s.day - s.counters.lastArrivalBlocked <= R.BEDS_WINDOW || s.day - s.counters.lastBirthBlocked <= R.BEDS_WINDOW;
    const tight = c.freeBeds < R.BEDS_FREE * (held(s, 'aedilis.beds') ? CLEAR : 1);
    const a = c.homeless > 0 ? 2 : tight && recent ? 1 : null;
    const full = c.pop >= c.roll;
    if (a === null && !full) return null;
    return {
      rule: 'aedilis.beds', severity: a ?? 1,
      metric: a !== null ? { label: 'Free beds', value: c.freeBeds, unit: 'souls' } : { label: 'Roll', value: c.pop, unit: 'souls' },
      params: { mode: a !== null ? 'beds' : 'roll', homeless: c.homeless, free: c.freeBeds, houses: c.houses, pop: c.pop, roll: c.roll },
    };
  },
  title(_s, a) {
    const p = a.params;
    if (p.mode === 'roll') return `Rome's roll is full (${int(P(p.pop))}/${int(P(p.roll))} souls).`;
    if (P(p.homeless) > 0) return `No free beds: ${P(p.homeless)} ${P(p.homeless) === 1 ? 'soul sleeps' : 'souls sleep'} under the stars.`;
    return 'No free beds: newcomers turn back at the gate.';
  },
  text(s, _v, a) {
    const p = a.params;
    if (p.mode === 'roll') {
      return s.rank < RANK_DEFS.length - 1 ? `Petition for ${RANK_DEFS[s.rank + 1].name} to open the gates to new colonists.` : 'Rome will enrol no more.';
    }
    const plot = TIER_DEFS.tentoria.beds;
    const roofless = P(p.homeless) > 0 ? ` The roofless leave after ${B.people.HOMELESS_LEAVE} days.` : '';
    return `${P(p.free)} ${P(p.free) === 1 ? 'bed stands' : 'beds stand'} empty in our ${P(p.houses)} homes. Two more house plots would take ${2 * plot} newcomers.${roofless}`;
  },
  remedies(s, _v, a) {
    if (a.params.mode === 'roll') return three({ kind: 'open', tab: 'council', anchor: 'petition' });
    const def = SETTING_DEFS.spareBeds;
    const more = Math.min(def.max, settingValue(s, 'spareBeds') + 4);
    return three({ kind: 'place', building: 'area' }, more > settingValue(s, 'spareBeds') ? { kind: 'setting', setting: 'spareBeds', value: more } : null);
  },
};

// ───────────────────────────── 20 · aedilis.morale ─────────────────────────────

/** "steady", "uneasy"… from B.morale.LABELS. */
function spirits(m: number): string {
  const [high, steady, uneasy] = B.morale.LABELS;
  return m >= high ? 'high' : m >= steady ? 'steady' : m >= uneasy ? 'uneasy' : 'despondent';
}

/** The remedy that answers a morale term, by its label (WP-B wording; unmatched terms have none). */
function termRemedy(s: GameState, label: string): Remedy | null {
  const l = label.toLowerCase();
  if (/ration|portion/.test(l)) {
    const cur = edictOption(s, 'rationes');
    return cur === 'parcae' ? { kind: 'edict', edict: 'rationes', option: 'plenae' } : cur === 'plenae' ? { kind: 'edict', edict: 'rationes', option: 'largae' } : null;
  }
  if (/tax|tribut/.test(l)) return edictOption(s, 'tributum') === 'leve' ? null : { kind: 'edict', edict: 'tributum', option: 'leve' };
  if (/relig|shrine|temple|gods/.test(l)) return { kind: 'place', building: 'lararium' };
  if (/homeless|roof/.test(l)) return { kind: 'place', building: 'area' };
  if (/declin/.test(l)) return { kind: 'overlay', overlay: 'domus' };
  if (/hour|labour|toil/.test(l)) return { kind: 'edict', edict: 'horae', option: 'otium' };
  return null;
}

const morale: AdvisorRule = {
  id: 'aedilis.morale', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    const m = s.morale;
    const t = moraleTarget(s, v);
    const [mon, cave, peric] = R.MORALE;
    const level = lowLadder(m, [peric, cave, mon], held(s, 'aedilis.morale'));
    const falling = B.morale.ALPHA * (m - t.value) > R.MORALE_FALL;
    if (level === null && !falling) return null;
    const neg = t.terms.filter((x) => x.value < 0).sort((a, b) => a.value - b.value).slice(0, 2).map((x) => x.label);
    return {
      rule: 'aedilis.morale', severity: level ?? 1, metric: { label: 'Spirits', value: Math.round(m), unit: 'pct' },
      params: { m: Math.round(m), target: Math.round(t.value), t1: neg[0] ?? '', t2: neg[1] ?? '', falling: level === null ? 1 : 0, holdDays: level === null ? R.MORALE_FALL_DAYS : 0 },
    };
  },
  title(_s, a) {
    const p = a.params;
    const terms = [p.t1, p.t2].filter(Boolean).map((x) => String(x).toLowerCase()).join(', ');
    const head = p.falling === 1 ? `Spirits are falling (${P(p.m)}, toward ${P(p.target)})` : `Spirits are ${spirits(P(p.m))} (${P(p.m)})`;
    return terms ? `${head}: ${terms}.` : `${head}.`;
  },
  text(_s, _v, a) {
    const m = P(a.params.m);
    const pct = Math.round(100 * (B.economy.PROD_BASE + (B.economy.PROD_MORALE * m) / 100));
    const leave = m < B.people.EMIGRATE_MORALE ? ', and families begin to leave' : '';
    return `Each day spirits move ${fractionWord(B.morale.ALPHA)} of the way toward ${P(a.params.target)}. At ${m} every hand yields ${pct}% of its usual work${leave}.`;
  },
  remedies(s, _v, a) {
    const picks = [a.params.t1, a.params.t2].map((l) => (l ? termRemedy(s, String(l)) : null));
    const all: (Remedy | null)[] = [...picks, { kind: 'edict', edict: 'feriae', option: 'frequentes' }, { kind: 'place', building: 'lararium' }];
    const seen = new Set<string>();
    return three(...all.filter((r) => { if (!r) return false; const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }));
  },
};

/** The Aedilis's rules, in RULES order. */
export const AEDILIS_RULES: AdvisorRule[] = [evolve, declining, beds, morale];
