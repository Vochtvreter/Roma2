// src/game/advisors/rules-aedilis.ts — the Aedilis's advisories: rules 17–20 (aedilis.evolve … aedilis.morale)
// (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B as B$ } from '../balance';
import { HOUSE_TIERS as HOUSE_TIERS$, NEEDS as NEEDS$ } from '../types';
import type { AdvisorRule, AdvisoryEval, Building, BuildingId, GameState, HouseTierId, NeedId, Remedy, SimView } from '../types';
import { moraleTarget } from '../civic';
import { favourPaces, renownFactor, splendour } from '../people';
import { sectionRevealed, toolRevealed } from '../reveal';
import { derived } from '../derived';
import { arrivalOutlook, favourTimes, limiterLine, paceWords } from '../settlers';
import { edictOption, petitionNeeds, settingValue } from '../decisions';
import { getBuilding as getBuilding$ } from '../lookup';
import { idx } from '../map';
import { RANK_DEFS as RANK_DEFS$ } from '../data/ranks';
import { BUILDING_DEFS } from '../data/buildings';
import { SETTING_DEFS as SETTING_DEFS$ } from '../data/decisions';
import { TIER_DEFS as TIER_DEFS$ } from '../data/housing';
import { houseBeds, peopleIndex } from '../census';
import {
  CLEAR, R, STEP, aName, bestFood, clearSite, fractionWord, held, houseWants, importRemedy, inDays, int, lowLadder, needRemedy, needWord, placeName, rankWord, liftSlot,
  risingReach, serveSlot, serviceFor, three, tierWord, worksWord,
} from './util';
import type { CadencedRule, ClearSite, ClearWhy, HouseWant } from './util';
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

/** The houses that wait on exactly one next-tier need, grouped by that need; water is the Curator's (aquarum.access). A
 *  house a work of its need still rising will reach waits for that work (util.risingReach): it is left out, so the
 *  advice never asks for a second temple, nor a block cleared for one, for the homes the first will serve. */
function oneShort(s: GameState, v: SimView): Map<NeedId, HouseWant[]> {
  const by = new Map<NeedId, HouseWant[]>();
  const rising = new Map<NeedId, ReadonlyMap<number, number>>();   // per need, asked once
  for (const w of houseWants(s, v)) {
    if (!w.next || w.unmet.length !== 1 || w.unmet[0] === 'water') continue;
    const need = w.unmet[0];
    let reach = rising.get(need);
    if (!reach) { reach = risingReach(s, need); rising.set(need, reach); }
    if (!reach.has(w.id)) by.set(need, [...(by.get(need) ?? []), w]);
  }
  return by;
}

/** The work still rising that will reach the most of the houses waiting on `need` alone (ties: the first placed), or
 *  null: what the advice shows once the player has placed the work it asked for, until the homes it reaches rise. */
function risingWork(s: GameState, v: SimView, need: NeedId): Building | null {
  const reach = risingReach(s, need);
  if (reach.size === 0) return null;
  const n = new Map<number, number>();
  for (const w of houseWants(s, v)) {
    const id = w.next && w.unmet.length === 1 && w.unmet[0] === need ? reach.get(w.id) : undefined;
    if (id !== undefined) n.set(id, (n.get(id) ?? 0) + 1);
  }
  let best: number | null = null, top = 0;
  for (const [id, k] of n) if (k > top || (k === top && best !== null && id < best)) { best = id; top = k; }
  return best === null ? null : getBuilding(s, best) ?? null;
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

/** What serveRemedy found: the remedy (null when nothing can serve the houses), its slot, the houses it lets rise, the
 *  work; for a block service no free block can bring them, the block to clear, or why none is offered (`rising`: a block
 *  would be, but a work of that kind still rises elsewhere — `up`, its id). */
interface Served { remedy: Remedy | null; slot: number | null; k: number; type: BuildingId | null; clear?: ClearSite; why?: ClearWhy | 'rising'; up?: number }

/** Remedy for a need: the answering building at the slot that serves most of `ids` (coverage needs: util.serveSlot, the
 *  same reckoning the Ordo raises a request by), or needRemedy. When no free slot of any answering work reaches one of
 *  the houses, a block service offers the block to clear for it (util.clearSite: the most of them served for the least
 *  pulled down) — one at a time: not while a work of that kind still rises (checkClear refuses it too); else `remedy`
 *  is null (another one would stand idle: the Domus overlay shows them) and `why` says what kept the blocks near them.
 *  Oil points to a caravan while a grove is still being raised or growing. */
function serveRemedy(s: GameState, v: SimView, need: NeedId, ids: ReadonlySet<number>): Served {
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
  // no free site reaches them: a block to clear for the first work that has one (the great baths before a balneum), but
  // never while one of that kind still rises: the homes it will reach are not counted here (oneShort), and a block
  // pulled down for the others waits until it stands
  let why: ClearWhy = 'far', up: Building | undefined;
  for (const type of types) {
    const c = clearSite(s, type, need, list);
    const rising = c.site ? s.buildings.find((b) => b.type === type && b.status !== 'done') : undefined;
    if (c.site && !rising) return { remedy: { kind: 'clear', building: type, tile: c.site.tile, ids: c.site.ids }, slot: c.site.tile, k: c.site.k, type, clear: c.site };
    if (rising) { up ??= rising; continue; }
    if (c.why === 'gain' || (c.why === 'works' && why === 'far')) why = c.why;
  }
  if (up) return { remedy: null, slot: null, k: 0, type: up.type, why: 'rising', up: up.id };
  return { remedy: null, slot: null, k: 0, type: types[0], why };
}

/** The souls of a block to clear in words: where they go, and whether the town has the beds for them. */
function movers(s: GameState, v: SimView, c: ClearSite): string {
  if (c.souls === 0) return '';
  const byHome = peopleIndex(s).byHome;
  let own = 0;                                         // the free beds on the block itself go with it
  for (const id of c.ids) {
    const b = getBuilding(s, id);
    if (b?.house) own += Math.max(0, houseBeds(s, b) - (byHome.get(id)?.length ?? 0));
  }
  const spare = Math.max(0, v.c.freeBeds - own);
  const who = c.souls === 1 ? 'The one soul who lives there' : `The ${c.souls} souls who live there`;
  if (spare >= c.souls) return ` ${who} ${c.souls === 1 ? 'finds a bed' : 'find beds'} in the town's other homes.`;
  return ` ${who} would find only ${spare} free ${spare === 1 ? 'bed' : 'beds'} in the town's other homes.`;
}

// ───────────────────────────── 17 · aedilis.evolve ─────────────────────────────

const evolve: CadencedRule = {
  every: B.housing.CHECK_EVERY,   // B, not util: rule objects are built at load time, inside an import cycle
  id: 'aedilis.evolve', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    const by = oneShort(s, v);
    const min = held(s, 'aedilis.evolve') ? Math.floor(R.EVOLVE_HOUSES / CLEAR) : R.EVOLVE_HOUSES;
    // the largest group a work can still serve; when neither a free slot of any answering work nor a block to clear
    // reaches one of them, the largest group stays on the tablets as a quiet Nota — the card is for what can be done
    // (DESIGN §11.1 rule 9)
    const groups = NEEDS.map((n) => ({ need: n, list: by.get(n) ?? [] })).filter((g) => g.list.length >= Math.max(1, min))
      .sort((a, b) => b.list.length - a.list.length || NEEDS.indexOf(a.need) - NEEDS.indexOf(b.need));
    if (groups.length === 0) return null;
    // a group a free site can serve first, then one a cleared block can (it costs what stands there); each group's
    // remedy is weighed once, and only as far as the search goes
    const rems = new Map<number, Remedy | null | undefined>();
    const rem = (i: number): Remedy | null | undefined => {
      const g = groups[i];
      if (!rems.has(i)) rems.set(i, SERVED.includes(g.need) ? serveRemedy(s, v, g.need, new Set(g.list.map((w) => w.id))).remedy : undefined);
      return rems.get(i);
    };
    const k = groups.findIndex((_, i) => { const r = rem(i); return r !== null && r?.kind !== 'clear'; });
    const open = groups[k >= 0 ? k : groups.findIndex((_, i) => rem(i) !== null)];
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
    // the work it asked for is placed: until the next check lets the advice go, it says what they wait for
    const up = ids.size === 0 ? risingWork(s, v, need) : null;
    if (up) return `${cap1(aName(up.type))} rises ${placeName(s, idx(up.x, up.y))}: they grow once it stands.`;
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
    if (r.remedy?.kind === 'clear' && r.clear) {
      const c = r.clear, what = aName(r.remedy.building);
      return `No free block within reach of their doors can take ${what}. Clear the block ${placeName(s, c.tile)} (${worksWord(s, c.ids)}) and ${what} there would let ${c.k} of them grow.${movers(s, v, c)}`;
    }
    if (!r.remedy && r.type && COVERED.includes(need)) {
      const where = BUILDING_DEFS[r.type].place.includes('block') ? 'block' : 'plot';
      const head = `No free ${where} within reach of their doors can take ${aName(r.type)}, nor will the Ordo raise one where it would not serve them`;
      if (where === 'plot') return `${head}: they keep their roofs until a ${where} near them is cleared.`;
      // why no block is offered for clearing (DESIGN §11.1 rule 7)
      const b = r.why === 'rising' && r.up !== undefined ? getBuilding(s, r.up) : undefined;
      if (b) return `${head}. ${cap1(aName(b.type))} already rises ${placeName(s, idx(b.x, b.y))}: once it stands, a block near them can be cleared for another.`;
      if (r.why === 'gain') return `${head}, and no block near them is worth clearing: each would let too few of them rise for the homes and works it pulls down.`;
      if (r.why === 'works') return `${head}: the blocks near them hold what must stand (a granary, a warehouse, a civic work, or the shrine, shop or well they need), or are blocks you keep free.`;
      return `${head}, and no block of the town that could take one lies within reach of them.`;
    }
    if (r.remedy?.kind !== 'place') return 'The Domus overlay shows what each house still wants.';
    const what = cap1(aName(r.remedy.building));
    if (r.slot !== null && r.k > 0) return `${what} ${placeName(s, r.slot)} would let ${r.k} of them grow.`;
    return `${what} within reach of their doors would let them grow.`;
  },
  remedies(s, v, a) {
    const need = a.params.need as NeedId;
    const ids = new Set((oneShort(s, v).get(need) ?? []).map((w) => w.id));
    const up = ids.size === 0 ? risingWork(s, v, need) : null;
    if (up) return three({ kind: 'building', op: 'center', id: up.id }, { kind: 'overlay', overlay: 'domus' });
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

// ───────────────────────────── 20b · aedilis.favour ─────────────────────────────
// Rome sends colonists faster to a splendid town (DESIGN §6.6): gardens and paved streets, the works the Ordo leaves to
// the player. While the gates are open and the favour is low, the Aedilis gives the pace, names what holds the settlers
// back most (settlers.ts: a shut gate, spirits, grain, water, the favour or the edicts) and what would draw them faster:
// a garden, the Pave brush where paving would raise the favour, the Urbs focus.

/** The dirt road paces whose paving Rome marks that would lift the favour furthest (all of them, or as many as reach
 *  ×MAX), and the favour then; k 0 when the brush is not yet ours or nothing is left to pave. */
function paved(s: GameState, f: number): { k: number; to: number } {
  const R = B.people.RENOWN;
  if (!toolRevealed(s, 'pave') || f >= R.MAX) return { k: 0, to: f };
  const homes = Math.max(1, derived(s).houses.length), per = (R.K * B.dignitas.ROADS) / homes;   // the favour a pace adds
  const k = Math.min(favourPaces(s), Math.ceil((R.MAX - (1 + (R.K * splendour(s)) / homes)) / per - 1e-9));
  return { k: Math.max(0, k), to: Math.min(R.MAX, 1 + (R.K * splendour(s)) / homes + per * Math.max(0, k)) };
}

const favour: AdvisorRule = {
  id: 'aedilis.favour', advisor: 'aedilis',
  evaluate(s, v): AdvisoryEval | null {
    if (v.c.pop >= v.c.roll) return null;                 // the roll, not the favour, keeps them out
    const f = renownFactor(s);
    if (f >= R.FAVOUR_LOW * (held(s, 'aedilis.favour') ? CLEAR : 1)) return null;
    return { rule: 'aedilis.favour', severity: 1, metric: { label: 'Favour', value: Math.round(f * 100), unit: 'pct' }, params: { f } };
  },
  title(s) {
    const a = arrivalOutlook(s);
    return a.every === null ? 'No colonists come: Rome draws none to us at this pace.' : `Colonists come slowly: ${paceWords(a)}.`;
  },
  text(s) {
    const a = arrivalOutlook(s);
    const f = renownFactor(s);
    const first = a.shut === null && a.limiter?.id === 'favour' ? '' : `${limiterLine(s, a)} `;
    const stands = first ? `Rome's favour stands at ${favourTimes(f)} of ×${B.people.RENOWN.MAX} as well` : `Rome's favour stands at ${favourTimes(f)} of ×${B.people.RENOWN.MAX}`;
    const p = paved(s, f);
    const pave = p.k > 0 && p.to > f + 0.05 ? ` Paving ${int(p.k)} ${p.k === 1 ? 'pace' : 'paces'} of our dirt roads (${int(p.k * B.map.PAVE_STONE)} stone) would raise it to ${favourTimes(p.to)}.` : '';
    return `${first}${stands}: gardens and paved streets among the homes draw settlers faster; the Ordo raises neither unless you set the Urbs focus, and then it plants gardens on free plots among the homes.${pave}`;
  },
  remedies(s) {
    const f = renownFactor(s);
    const pave = paved(s, f).k > 0 ? { kind: 'tool' as const, tool: 'pave' as const } : null;
    return three({ kind: 'place', building: 'hortus' }, pave, sectionRevealed(s, 'focus') && s.decisions.focus !== 'urbs' ? { kind: 'focus', focus: 'urbs' } : null);
  },
};

/** The Aedilis's rules, in RULES order. */
export const AEDILIS_RULES: AdvisorRule[] = [evolve, declining, beds, morale, favour];
