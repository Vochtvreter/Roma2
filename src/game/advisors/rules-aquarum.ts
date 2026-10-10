// src/game/advisors/rules-aquarum.ts — the Curator Aquarum's advisories: rules 7–10 (aquarum.water.runout …
// aquarum.aqueduct) (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import type { AdvisorRule, Building, GameState, Remedy, Severity, SimView } from '../types';
import { formatRoman } from '../calendar';
import { previewCoverage } from '../coverage';
import { petitionNeeds, settingValue } from '../decisions';
import { seasonMult } from '../economy';
import { distToRect, getMap, tx, ty } from '../map';
import { routeAqueduct } from '../place';
import { bestSlot } from '../site';
import { BUILDING_DEFS } from '../data/buildings';
import { SETTING_DEFS } from '../data/decisions';
import {
  CLEAR, HOUSE_CADENCE, R, STEP, compass, days, fractionWord, held, houseWants, idleBySkill, int, labourRemedy, lowLadder, namesOf, num, openPosts,
  placeName, runway, serviceFor, three,
} from './util';
import type { CadencedRule } from './util';

const AESTAS = 1;
const MUNICIPIUM = 3, COLONIA = 4;
const EPS = 1e-6;
const P = (x: unknown): number => (typeof x === 'number' ? x : 0);

/** Finished, open, staffed works that draw water (concrete works, baths), in id order. */
function waterDraws(s: GameState, v: SimView): Building[] {
  return s.buildings.filter((b) => b.status === 'done' && b.open && (v.c.staffed[b.id] ?? 0) > 0
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
  remedies(s) {
    const def = SETTING_DEFS.waterReserve;
    const want = Math.min(def.max, settingValue(s, 'waterReserve') + STEP.WATER_RESERVE);
    const reserve: Remedy | null = s.ordo.on.build && want > settingValue(s, 'waterReserve') ? { kind: 'setting', setting: 'waterReserve', value: want } : null;
    return three({ kind: 'place', building: 'cisterna' }, { kind: 'place', building: 'puteus' }, reserve);
  },
};

// ───────────────────────────── 9 · aquarum.access ─────────────────────────────

const access: CadencedRule = {
  every: HOUSE_CADENCE,
  id: 'aquarum.access', advisor: 'aquarum',
  evaluate(s, v) {
    const all = houseWants(s, v);
    const dry = all.filter((w) => w.want === 'water');
    const min = held(s, 'aquarum.access') ? Math.floor(R.ACCESS_HOUSES / CLEAR) : R.ACCESS_HOUSES;
    if (dry.length < Math.max(1, min)) return null;
    const lapsed = all.some((w) => w.declining && w.lapsed.includes('water'));
    return {
      rule: 'aquarum.access', severity: lapsed ? 2 : 1, metric: { label: 'Dry homes', value: dry.length, unit: 'houses' },
      params: { n: dry.length, tile: dry[Math.floor(dry.length / 2)].tile },
    };
  },
  title: (_s, a) => `${P(a.params.n)} homes fetch water from the river.`,
  text(s, v, a) {
    const type = serviceFor(s, 'water', v.d.castellumActive) ?? 'puteus';
    const what = type === 'lacus' ? 'a fountain' : 'a well';
    const slot = bestSlot(s, type, { owner: 'player', purpose: 'waterAccess' });
    if (!slot) return `They live ${placeName(s, P(a.params.tile))}, and no plot near them can take ${what} yet.`;
    const dry = new Set(houseWants(s, v).filter((w) => w.want === 'water').map((w) => w.id));
    const k = previewCoverage(s, type, slot.x, slot.y).reduce((n, c) => n + c.houses.filter((h) => dry.has(h)).length, 0);
    if (k > 0) return `${what.charAt(0).toUpperCase()}${what.slice(1)} ${placeName(s, slot.tile)} would reach ${k} of them.`;
    return `They live ${placeName(s, P(a.params.tile))}; ${what} within ${BUILDING_DEFS[type].service?.[0].radius ?? 0} steps of their doors would serve them.`;
  },
  remedies(s, v) {
    const type = serviceFor(s, 'water', v.d.castellumActive) ?? 'puteus';
    const slot = bestSlot(s, type, { owner: 'player', purpose: 'waterAccess' });
    const place: Remedy = slot ? { kind: 'place', building: type, tile: slot.tile } : { kind: 'place', building: type };
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

const aqueduct: AdvisorRule = {
  id: 'aquarum.aqueduct', advisor: 'aquarum',
  evaluate(s, v) {
    if (s.rank < MUNICIPIUM || v.d.castellumActive || (v.d.all.castellum ?? 0) > 0) return null;
    const f = spring(s);
    if (!f) return null;
    const pn = s.rank === MUNICIPIUM ? petitionNeeds(s, v) : null;
    const unmet = pn && pn.rank === COLONIA ? pn.needs.filter((n) => !n.met) : [];
    const waits = unmet.length > 0 && unmet.every((n) => /aqu|castell|thermae/i.test(n.label));
    return { rule: 'aquarum.aqueduct', severity: waits ? 2 : 1, params: { dist: f.dist, dir: f.dir, fons: f.tile, waits: waits ? 1 : 0 } };
  },
  title: (_s, a) => `A spring rises ${int(P(a.params.dist))} paces to the ${a.params.dir}.`,
  text(s, _v, a) {
    const slot = bestSlot(s, 'castellum', { owner: 'player' });
    const route = slot ? routeAqueduct(s, slot.x, slot.y) : null;
    const len = route ? route.tiles.length : P(a.params.dist);
    const flow = BUILDING_DEFS.castellum.passive?.perDay ?? 0;
    const waits = a.params.waits === 1 ? ' Rome will not make us a Colonia until it flows.' : '';
    return `An aqueduct of ~${int(len)} arches would bring ${int(flow)} amphorae a day and fountains to every street.${waits}`;
  },
  remedies: () => three({ kind: 'place', building: 'castellum' }, { kind: 'overlay', overlay: 'aqua', layer: 'fountain' }),
};

/** The Curator Aquarum's rules, in RULES order. */
export const AQUARUM_RULES: AdvisorRule[] = [waterRunout, aestas, access, aqueduct];
