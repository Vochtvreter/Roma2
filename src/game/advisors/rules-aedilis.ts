// src/game/advisors/rules-aedilis.ts — the Aedilis's advisories: rules 17–20 (aedilis.evolve … aedilis.morale)
// (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B as B$ } from '../balance';
import { HOUSE_TIERS as HOUSE_TIERS$, NEEDS as NEEDS$ } from '../types';
import type { AdvisorRule, AdvisoryEval, BuildingId, GameState, HouseTierId, NeedId, Remedy, SimView } from '../types';
import { moraleTarget } from '../civic';
import { renownFactor } from '../people';
import { sectionRevealed } from '../reveal';
import { edictOption, petitionNeeds, settingValue } from '../decisions';
import { getBuilding as getBuilding$ } from '../lookup';
import { RANK_DEFS as RANK_DEFS$ } from '../data/ranks';
import { BUILDING_DEFS } from '../data/buildings';
import { SETTING_DEFS as SETTING_DEFS$ } from '../data/decisions';
import { TIER_DEFS as TIER_DEFS$ } from '../data/housing';
import {
  CLEAR, R, STEP, aName, bestFood, fractionWord, held, houseWants, importRemedy, inDays, int, lowLadder, needRemedy, needWord, placeName, rankWord, liftSlot, serveSlot,
  serviceFor, three, tierWord,
} from './util';
import type { CadencedRule, HouseWant } from './util';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, HOUSE_TIERS = HOUSE_TIERS$, NEEDS = NEEDS$, RANK_DEFS = RANK_DEFS$, SETTING_DEFS = SETTING_DEFS$,
  TIER_DEFS = TIER_DEFS$,
  getBuilding = getBuilding$;

const P = (x: unknown): number => (typeof x === 'number' ? x : 0);
const COVERED: readonly NeedId[] = ['water', 'religion', 'market', 'temple', 'baths', 'macellum'];
/** Works in the plural, for "Rome grants temples to an Oppidum". */
const PLURAL_WORK: Partial<Record<BuildingId, string>> = { templum: 'temples', balneum: 'bathhouses', macellum: 'market halls', thermae: 'great baths', lacus: 'fountains' };
/** Needs a work placed near the houses answers (a garden lifts a street): a group no free slot can serve is stuck. */
const SERVED: readonly NeedId[] = [...COVERED, 'desirability'];

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

/** The works that answer a coverage need, the first choice first: a fountain or else a well (a lacus must stand near
 *  the castellum), the great baths or else a balneum (the thermae must stand near it too). */
function serviceChoices(s: GameState, v: SimView, need: NeedId): BuildingId[] {
  const first = serviceFor(s, need, v.d.castellumActive);
  if (!first) return [];
  if (first === 'lacus') return ['lacus', 'puteus'];
  if (first === 'thermae') return ['thermae', 'balneum'];
  return [first];
}

/** Remedy for a need: the answering building at the slot that serves most of `ids` (coverage needs: util.serveSlot, the
 *  same reckoning the Ordo raises a request by), or needRemedy. `remedy` is null when no free slot of any answering work
 *  reaches one of the houses (another one would stand idle: the Domus overlay shows them), and oil points to a caravan
 *  while a grove is still being raised or growing. */
function serveRemedy(s: GameState, v: SimView, need: NeedId, ids: ReadonlySet<number>): { remedy: Remedy | null; slot: number | null; k: number; type: BuildingId | null } {
  if (need === 'oil' && s.buildings.some((b) => b.type === 'olivetum' && (b.status !== 'done' || (b.youngUntil ?? 0) > s.day))) {
    return { remedy: importRemedy(s, 'oil', B.ordo.CARGO), slot: null, k: 0, type: null };
  }
  const types = serviceChoices(s, v, need);
  const list = [...ids].sort((a, b) => a - b);
  if (need === 'desirability') {
    // a garden where it lifts these houses (the Ordo's own gardens lift the stone houses toward a domus)
    const at = liftSlot(s, 'player', list);
    return at ? { remedy: { kind: 'place', building: 'hortus', tile: at.tile }, slot: at.tile, k: at.k, type: 'hortus' } : { remedy: null, slot: null, k: 0, type: 'hortus' };
  }
  if (types.length === 0 || !COVERED.includes(need)) return { remedy: needRemedy(s, v, need), slot: null, k: 0, type: types[0] ?? null };
  if (types.every((t) => BUILDING_DEFS[t].rank > s.rank)) return { remedy: null, slot: null, k: 0, type: types[0] };   // not yet granted
  for (const type of types) {
    const at = serveSlot(s, type, 'player', need, list);
    if (at) return { remedy: { kind: 'place', building: type, tile: at.tile }, slot: at.tile, k: at.k, type };
  }
  return { remedy: null, slot: null, k: 0, type: types[0] };
}

// ───────────────────────────── 17 · aedilis.evolve ─────────────────────────────

const evolve: CadencedRule = {
  every: B.housing.CHECK_EVERY,   // B, not util: rule objects are built at load time, inside an import cycle
  id: 'aedilis.evolve', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    const by = oneShort(s, v);
    const min = held(s, 'aedilis.evolve') ? Math.floor(R.EVOLVE_HOUSES / CLEAR) : R.EVOLVE_HOUSES;
    // the largest group a work can still serve; when no free slot of any answering work reaches one of them, the
    // largest group stays on the tablets as a quiet Nota — the card is for what can be done (DESIGN §11.1 rule 9)
    const groups = NEEDS.map((n) => ({ need: n, list: by.get(n) ?? [] })).filter((g) => g.list.length >= Math.max(1, min))
      .sort((a, b) => b.list.length - a.list.length || NEEDS.indexOf(a.need) - NEEDS.indexOf(b.need));
    if (groups.length === 0) return null;
    const open = groups.find((g) => !SERVED.includes(g.need) || serveRemedy(s, v, g.need, new Set(g.list.map((w) => w.id))).remedy !== null);
    const { need, list } = open ?? groups[0];
    const pn = petitionNeeds(s, v);
    const dep = pn !== null && pn.rank !== null && pn.needs.some((n) => !n.met && /home|house|insula|domus|tier|T[0-4]/i.test(n.label));   // WP-D: 'Homes of …', 'Insulae and domus'
    return {
      rule: 'aedilis.evolve', severity: !open ? 0 : dep ? 2 : 1, metric: { label: 'Waiting', value: list.length, unit: 'houses' },
      params: {
        n: list.length, need, tile: list[Math.floor(list.length / 2)].tile, stuck: open ? 0 : 1,
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
    if (need === 'desirability') {
      if (!r.remedy) return 'No free plot near their doors can take a garden: they keep their roofs until a temple, a fountain or a cleared plot lifts their street.';
      const by = r.k > 0 ? `would let ${r.k} of them grow` : 'would lift their street (one may not be enough)';
      return `Gardens, temples and fountains raise a street; shops, workshops and insulae lower it. A garden ${placeName(s, P(r.slot))} ${by}.`;
    }
    if (!r.remedy && r.type && COVERED.includes(need) && BUILDING_DEFS[r.type].rank > s.rank) {
      return `Rome grants ${PLURAL_WORK[r.type] ?? `${aName(r.type)}s`} to ${rankWord(BUILDING_DEFS[r.type].rank)}: they rise once one stands near them.`;
    }
    if (!r.remedy && r.type && COVERED.includes(need)) {
      const where = BUILDING_DEFS[r.type].place.includes('block') ? 'block' : 'plot';
      return `No free ${where} within reach of their doors can take ${aName(r.type)}, nor will the Ordo raise one where it would not serve them: they keep their roofs until a ${where} near them is cleared.`;
    }
    if (r.remedy?.kind !== 'place') return 'The Domus overlay shows what each house still wants.';
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
  every: B.housing.CHECK_EVERY,   // B, not util: rule objects are built at load time, inside an import cycle
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
    return `${P(p.free)} ${P(p.free) === 1 ? 'bed stands' : 'beds stand'} empty in our ${P(p.houses)} ${P(p.houses) === 1 ? 'home' : 'homes'}. Two more house plots would take ${2 * plot} newcomers.${roofless}`;
  },
  remedies(s, _v, a) {
    if (a.params.mode === 'roll') return three({ kind: 'open', tab: 'council', anchor: 'petition' });
    const def = SETTING_DEFS.spareBeds;
    const more = Math.min(def.max, settingValue(s, 'spareBeds') + STEP.SPARE_BEDS);
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
    // under the Lex de annona's emergency cut the edict changes nothing until the cut lifts: more grain lifts it
    if (s.ordo.emergency.rations !== 'none') return { kind: 'place', building: bestFood(s) };
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
// ───────────────────────────── 20b · aedilis.favour ─────────────────────────────
// Rome sends colonists faster to a splendid town (DESIGN §6.6): gardens and paved streets, the works the Ordo leaves to
// the player. While the gates are open and the favour is low, the Aedilis says what would draw them, and how much.

const favour: AdvisorRule = {
  id: 'aedilis.favour', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    if (v.c.pop >= v.c.roll) return null;                 // the roll, not the favour, keeps them out
    const f = renownFactor(s);
    if (f >= R.FAVOUR_LOW * (held(s, 'aedilis.favour') ? CLEAR : 1)) return null;
    return { rule: 'aedilis.favour', severity: 1, metric: { label: 'Favour', value: Math.round(f * 100), unit: 'pct' }, params: { f } };
  },
  title(_s, a) {
    return `Colonists come slowly: Rome's favour stands at ×${(Math.floor(P(a.params.f) * 10) / 10).toFixed(1)}.`;
  },
  text() {
    return `Rome sends settlers faster to a splendid town, up to ×${B.people.RENOWN.MAX}. Gardens and paved streets among the homes draw them; the Ordo raises neither unless you set the Urbs focus, and then it plants gardens on free plots among the homes.`;
  },
  remedies(s) {
    return three({ kind: 'place', building: 'hortus' }, sectionRevealed(s, 'focus') && s.decisions.focus !== 'urbs' ? { kind: 'focus', focus: 'urbs' } : null);
  },
};

export const AEDILIS_RULES: AdvisorRule[] = [evolve, declining, beds, morale, favour];
