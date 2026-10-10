// src/game/advisors/rules-aquarum.ts — the Curator Aquarum's advisories: rules 7–10 (aquarum.water.runout …
// aquarum.aqueduct) (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B as B$ } from '../balance';
import type { AdvisorRule, AdvisoryEval, Building, BuildingId, GameState, Remedy, Severity, SimView } from '../types';
import { formatRoman as formatRoman$ } from '../calendar';
import { petitionNeeds, settingValue } from '../decisions';
import { seasonMult } from '../economy';
import { distToRect as distToRect$, getMap as getMap$, tx as tx$, ty as ty$ } from '../map';
import { routeAqueduct, validSlots } from '../place';
import { aestasWork } from '../ordo/water';
import { bestSlot } from '../site';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { SETTING_DEFS as SETTING_DEFS$ } from '../data/decisions';
import {
  CLEAR, R, STEP, compass, days, fractionWord, held, houseWants, idleBySkill, int, labourRemedy, lowLadder, namesOf, num, openPosts,
  placeName, runway, serveSlot, serviceFor, three,
} from './util';
import type { CadencedRule } from './util';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, formatRoman = formatRoman$, distToRect = distToRect$, getMap = getMap$,
  tx = tx$, ty = ty$, BUILDING_DEFS = BUILDING_DEFS$, SETTING_DEFS = SETTING_DEFS$;

const AESTAS = 1;
const MUNICIPIUM = 3, COLONIA = 4;
const EPS = 1e-6;
const P = (x: unknown): number => (typeof x === 'number' ? x : 0);

/** Finished, open, staffed works that draw water (concrete works, baths), in id order. */
function waterDraws(s: GameState, v: SimView): Building[] {
  const staffed = v.c.staffed;   // the census once, not a view read per building
  return s.buildings.filter((b) => b.status === 'done' && b.open && (staffed[b.id] ?? 0) > 0
    && (BUILDING_DEFS[b.type].waterDraw !== undefined || BUILDING_DEFS[b.type].inputs?.water !== undefined));
}

// ───────────────────────────── 7 · aquarum.water.runout ─────────────────────────────

const waterRunout: AdvisorRule = {
  id: 'aquarum.water.runout', advisor: 'aquarum',
  evaluate(s, v) {
    const w = v.f.water;
    const r = runway(w.stock, w.net3);
    const sev = r === null ? null : lowLadder(r, R.WATER_RUNOUT, held(s, 'aquarum.water.runout'));
    if (r === null || sev === null) return null;
    return {
      rule: 'aquarum.water.runout', severity: sev, metric: { label: 'Water', value: Math.floor(r), unit: 'days' },
      params: { R: Math.floor(r), prod: w.prod, cons: w.cons, need: w.need, pot: w.maxPotential, fix: w.structural ? 0 : 1 },
    };
  },
  title: (_s, a) => (P(a.params.R) < 1 ? 'Water runs out today.' : `Water runs out in ${days(P(a.params.R))}.`),
  text(s, v, a) {
    const p = a.params;
    const when = `The amphorae run dry on ${formatRoman(s.day + P(p.R))}.`;
    const extra = P(p.cons) - P(p.need) > EPS ? ` The works drink ${num(P(p.cons) - P(p.need))} more.` : '';
    if (p.fix !== 1) {
      return `Even with every hand at the wells we would draw ${num(P(p.pot))} of the ${num(P(p.need))} we drink: we need another well.${extra} ${when}`;
    }
    const idle = idleBySkill(s, v, 'aqua');
    const open = openPosts(v, 'water');
    const who = idle.length > 0 ? `${namesOf(idle)} ${idle.length === 1 ? 'stands' : 'stand'} idle; ` : '';
    const where = open > 0 ? `${open} ${open === 1 ? 'place waits' : 'places wait'} at the wells.` : 'every post at the wells is taken.';
    return `We drink ${num(P(p.need))} a day and draw ${num(P(p.prod))}.${extra} ${who}${where} ${when}`;
  },
  remedies(s, v, a) {
    const p = a.params;
    const work = labourRemedy(s, v, 'water', 'water', P(p.cons) - P(p.prod));
    const well: Remedy = { kind: 'place', building: serviceFor(s, 'water', v.d.castellumActive) === 'lacus' ? 'lacus' : 'puteus' };
    const draw = waterDraws(s, v)[0];
    return three(p.fix === 1 ? work : well, p.fix === 1 ? well : work, draw ? { kind: 'building', op: 'close', id: draw.id } : null);
  },
};

// ───────────────────────────── 8 · aquarum.aestas.forecast ─────────────────────────────

const aestas: AdvisorRule = {
  id: 'aquarum.aestas.forecast', advisor: 'aquarum',
  evaluate(s, v) {
    const w = v.f.water;
    const c = w.crunch;
    if (!c || c.season !== AESTAS || c.startsIn > R.AESTAS_LEAD) return null;
    const low = c.lowestDoh;
    let sev: Severity | null = null;
    if (low <= 0) sev = c.startsIn < R.AESTAS_SOON ? 3 : 2;
    else if (low < R.AESTAS_M * (held(s, 'aquarum.aestas.forecast') ? CLEAR : 1)) sev = 1;
    if (sev === null) return null;
    return {
      rule: 'aquarum.aestas.forecast', severity: sev, metric: { label: 'Aestas low', value: Math.max(0, Math.floor(low)), unit: 'days' },
      params: {
        D: c.startsIn, low: Math.max(0, Math.floor(low)), empty: low <= 0 ? c.emptyDay ?? c.lowestDay : -1,
        need: c.needInStore, daily: w.need, stock: w.stock, cap: w.cap,
      },
    };
  },
  title(_s, a) {
    const p = a.params;
    const head = P(p.D) > 0 ? `Aestas in ${days(P(p.D))}` : 'Aestas is upon us';
    return P(p.empty) >= 0 ? `${head}: we would run dry on ${formatRoman(P(p.empty))}.` : `${head}: our lowest would be ${days(P(p.low))} of water.`;
  },
  text(s, _v, a) {
    const p = a.params;
    return `Cisterns catch ${fractionWord(seasonMult(s, 'cisterna', AESTAS))} of their rain in Aestas and wells draw `
      + `${fractionWord(seasonMult(s, 'puteus', AESTAS))}. We hold ${int(P(p.stock))} amphorae, with room for ${int(P(p.cap))}.`;
  },
  remedies(s, v) {
    const def = SETTING_DEFS.waterReserve;
    const want = Math.min(def.max, settingValue(s, 'waterReserve') + STEP.WATER_RESERVE);
    const reserve: Remedy | null = s.ordo.on.build && want > settingValue(s, 'waterReserve') ? { kind: 'setting', setting: 'waterReserve', value: want } : null;
    // as the Ordo reckons it (ordo/water.ts): a cistern while room is what is short and Aestas is still ahead, else a
    // well; when neither could lift the low (the store enters Aestas short of water), the wells' hands come first
    const w = v.f.water;
    const pick = w.crunch ? aestasWork(s, v, w, w.crunch, settingValue(s, 'waterReserve')) : null;
    const cistern: Remedy = { kind: 'place', building: 'cisterna' }, well: Remedy = { kind: 'place', building: 'puteus' };
    if (pick === 'cisterna') return three(cistern, well, reserve);
    if (pick === 'puteus') return three(well, cistern, reserve);
    return three(labourRemedy(s, v, 'water', 'water', w.cons - w.prod), well, reserve);
  },
};

// ───────────────────────────── 9 · aquarum.access ─────────────────────────────

/** The work that brings water to the dry homes, at the slot serving the most of them (util.serveSlot, as the Ordo
 *  raises it): a fountain once the aqueduct flows, a well where no fountain can reach them; null when neither can. */
function waterWork(s: GameState, v: SimView, dry: readonly number[]): { type: BuildingId; tile: number; k: number } | null {
  const types: BuildingId[] = serviceFor(s, 'water', v.d.castellumActive) === 'lacus' ? ['lacus', 'puteus'] : ['puteus'];
  for (const type of types) {
    const at = serveSlot(s, type, 'player', 'water', dry);
    if (at) return { type, ...at };
  }
  return null;
}

const dryIds = (s: GameState, v: SimView): number[] => houseWants(s, v).filter((w) => w.want === 'water').map((w) => w.id).sort((a, b) => a - b);

const access: CadencedRule = {
  every: B.housing.CHECK_EVERY,   // B, not util: rule objects are built at load time, inside an import cycle
  id: 'aquarum.access', advisor: 'aquarum',
  evaluate(s, v) {
    const all = houseWants(s, v);
    const dry = all.filter((w) => w.want === 'water');
    const min = held(s, 'aquarum.access') ? Math.floor(R.ACCESS_HOUSES / CLEAR) : R.ACCESS_HOUSES;
    if (dry.length < Math.max(1, min)) return null;
    const lapsed = all.some((w) => w.declining && w.lapsed.includes('water'));
    // no well nor fountain can reach them: a quiet Nota (the card is for what can be done), unless a house lapses
    const stuck = !lapsed && waterWork(s, v, dryIds(s, v)) === null;
    return {
      rule: 'aquarum.access', severity: lapsed ? 2 : stuck ? 0 : 1, metric: { label: 'Dry homes', value: dry.length, unit: 'houses' },
      params: { n: dry.length, tile: dry[Math.floor(dry.length / 2)].tile },
    };
  },
  title: (_s, a) => (P(a.params.n) === 1 ? 'A home fetches water from the river.' : `${P(a.params.n)} homes fetch water from the river.`),
  text(s, v, a) {
    const w = waterWork(s, v, dryIds(s, v));
    if (!w) return `They live ${placeName(s, P(a.params.tile))}, and no free plot near them can take a fountain or a well yet.`;
    const what = w.type === 'lacus' ? 'a fountain' : 'a well';
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} ${placeName(s, w.tile)} would reach ${w.k} of them.`;
  },
  remedies(s, v) {
    const w = waterWork(s, v, dryIds(s, v));
    const type = w?.type ?? serviceFor(s, 'water', v.d.castellumActive) ?? 'puteus';
    const place: Remedy | null = w ? { kind: 'place', building: w.type, tile: w.tile } : null;
    return three(place, { kind: 'overlay', overlay: 'aqua', layer: type === 'lacus' ? 'fountain' : 'water' });
  },
};

// ───────────────────────────── 10 · aquarum.aqueduct ─────────────────────────────

/** The spring nearest the castrum: its tile, distance from the walls and direction. */
function spring(s: GameState): { tile: number; dist: number; dir: string } | null {
  const map = getMap(s.seed);
  const c = map.survey.castrum;
  let best: { tile: number; dist: number; dir: string } | null = null;
  for (const f of map.fontes) {
    const d = distToRect(f, c);
    if (!best || d < best.dist) best = { tile: f, dist: d, dir: compass(c.x + (c.w - 1) / 2, c.y + (c.h - 1) / 2, tx(f), ty(f)) };
  }
  return best;
}

/** Words of the petition lines that wait on the aqueduct: the aqueduct itself, or the great baths it feeds. */
const AQUA_WORDS = ['aqueduct', BUILDING_DEFS.castellum.latin, BUILDING_DEFS.thermae.name, BUILDING_DEFS.thermae.latin].map((w) => w.toLowerCase());

/** A petition line (WP-D wording: 'The aqueduct flows', 'Great baths, Theatre staffed (missing: …)') that waits on the aqueduct. */
function onAqueduct(label: string): boolean {
  const l = label.toLowerCase();
  const what = l.includes('missing:') ? l.slice(l.indexOf('missing:')) : l;
  return AQUA_WORDS.some((w) => what.includes(w));
}

/** The great baths are still to be raised but no free block within CASTELLUM_REACH of the flowing castellum can take
 *  them (the Ordo keeps such a block from the castellum's staking on, but the player may have built in it). */
function thermaeBlocked(s: GameState, v: SimView): Building | null {
  if (s.rank < BUILDING_DEFS.thermae.rank || !v.d.castellumActive || s.buildings.some((b) => b.type === 'thermae')) return null;
  if (validSlots(s, 'thermae', 'player').size > 0) return null;
  return s.buildings.find((b) => b.type === 'castellum' && b.status === 'done') ?? null;
}

const aqueduct: AdvisorRule = {
  id: 'aquarum.aqueduct', advisor: 'aquarum',
  evaluate(s, v): AdvisoryEval | null {
    if (s.rank < MUNICIPIUM) return null;
    const pn = s.rank === MUNICIPIUM ? petitionNeeds(s, v) : null;
    const unmet = pn && pn.rank === COLONIA ? pn.needs.filter((n) => !n.met) : [];
    const cas = thermaeBlocked(s, v);
    if (cas) {
      const waits = unmet.some((n) => /great baths|thermae/i.test(n.label));
      return { rule: 'aquarum.aqueduct', severity: waits ? 2 : 1, params: { mode: 'thermae', id: cas.id, tile: cas.y * getMap(s.seed).W + cas.x, reach: B.map.CASTELLUM_REACH, waits: waits ? 1 : 0 } };
    }
    if (v.d.castellumActive || (v.d.all.castellum ?? 0) > 0) return null;
    const f = spring(s);
    if (!f) return null;
    const waits = unmet.length > 0 && unmet.every((n) => onAqueduct(n.label));
    return { rule: 'aquarum.aqueduct', severity: waits ? 2 : 1, params: { dist: f.dist, dir: f.dir, fons: f.tile, waits: waits ? 1 : 0 } };
  },
  title(_s, a) {
    if (a.params.mode === 'thermae') return `No free block within ${int(P(a.params.reach))} paces of the castellum can take the great baths.`;
    return `A spring rises ${int(P(a.params.dist))} paces to the ${a.params.dir}.`;
  },
  text(s, _v, a) {
    if (a.params.mode === 'thermae') {
      const waits = a.params.waits === 1 ? ' Rome will not make us a Colonia until they stand.' : '';
      return `The thermae draw on the aqueduct and must stand within ${int(P(a.params.reach))} paces of the castellum ${placeName(s, P(a.params.tile))}, on a whole block of their own; every block near it is built on.${waits} Clear a block near the castellum and the Ordo raises them there.`;
    }
    const slot = bestSlot(s, 'castellum', { owner: 'player' });
    const route = slot ? routeAqueduct(s, slot.x, slot.y) : null;
    const len = route ? route.tiles.length : P(a.params.dist);
    const flow = BUILDING_DEFS.castellum.passive?.perDay ?? 0;
    const waits = a.params.waits === 1 ? ' Rome will not make us a Colonia until it flows.' : '';
    return `An aqueduct of ~${int(len)} arches would bring ${int(flow)} amphorae a day and fountains to every street.${waits}`;
  },
  remedies: (_s, _v, a) => a.params.mode === 'thermae'
    ? three({ kind: 'building', op: 'center', id: P(a.params.id) }, { kind: 'overlay', overlay: 'aqua', layer: 'fountain' })
    : three({ kind: 'place', building: 'castellum' }, { kind: 'overlay', overlay: 'aqua', layer: 'fountain' }),
};

/** The Curator Aquarum's rules, in RULES order. */
export const AQUARUM_RULES: AdvisorRule[] = [waterRunout, aestas, access, aqueduct];
