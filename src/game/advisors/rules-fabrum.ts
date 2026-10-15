// src/game/advisors/rules-fabrum.ts — the Praefectus Fabrum's advisories: rules 11–13 (fabrum.labour, fabrum.stalled,
// fabrum.capitolium) (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B as B$ } from '../balance';
import { LABOR_CATS as LABOR_CATS$, RESOURCES as RESOURCES$, TRADE_RES as TRADE_RES$ } from '../types';
import type { AdvisorRule, AdvisoryEval, Building, BuildingId, GameState, LaborCat, Remedy, ResId, SimView, TradeRes } from '../types';
import { toRoman as toRoman$ } from '../calendar';
import { capitoliumFlow, storeWords } from '../construction';
import type { CapitoliumFlow } from '../construction';
import { edictOption, petitionNeeds, settingValue } from '../decisions';
import { validSlots } from '../place';
import { missing } from '../state';
import { newWishes } from '../ordo/build';
import { waterIdle } from '../hints';
import { reasonText } from '../ordo/reasons';
import { getBuilding as getBuilding$ } from '../lookup';
import { BUILDING_DEFS as BUILDING_DEFS$, BUILD_ORDER as BUILD_ORDER$, slotsOf as slotsOf$ } from '../data/buildings';
import { SETTING_DEFS as SETTING_DEFS$ } from '../data/decisions';
import {
  CLEAR, R, STEP, aName, bName, buildingPlace, days, held, idleBySkill, importRemedy, int, listJoin, namesOf, num, openPosts, resName, runway, three,
} from './util';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, LABOR_CATS = LABOR_CATS$, RESOURCES = RESOURCES$, TRADE_RES = TRADE_RES$, toRoman = toRoman$,
  BUILDING_DEFS = BUILDING_DEFS$, BUILD_ORDER = BUILD_ORDER$, slotsOf = slotsOf$, SETTING_DEFS = SETTING_DEFS$,
  getBuilding = getBuilding$;

const P = (x: unknown): number => (typeof x === 'number' ? x : 0);
const WORK_CATS = LABOR_CATS.filter((c) => c !== 'builders');
const CAT_PLACE: Record<LaborCat, string> = {
  water: 'at the wells', food: 'in the fields', materials: 'in the camps and quarries', industry: 'at the kilns and forges',
  services: 'in the shops and shrines', builders: 'on the works',
};
const STAGES = ['Podium', 'Cella', 'Columnae', 'Fastigium'] as const;
const PRODUCER: Partial<Record<ResId, BuildingId>> = { timber: 'lignarius', stone: 'lapicidina', tiles: 'figlina', concrete: 'caementarium', ore: 'fodina', iron: 'officina' };

function cap1(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/** "4 in the fields, 2 at the wells" from 'food:4,water:2'. */
function catWords(code: unknown): string {
  if (typeof code !== 'string' || code === '') return '';
  return listJoin(code.split(',').map((x) => { const [c, n] = x.split(':'); return `${n} ${CAT_PLACE[c as LaborCat] ?? c}`; }));
}

// ───────────────────────────── 11 · fabrum.labour ─────────────────────────────

/** A producer type that would put idle hands to use: unlocked, with posts, its good the scarcest against its store. */
function suggest(s: GameState, v: SimView): { type: BuildingId; k: number } | null {
  const idle = v.c.idle.length;
  const ok = BUILD_ORDER.filter((t) => {
    const d = BUILDING_DEFS[t];
    return d.rank <= s.rank && d.slots > 0 && d.output && d.labor !== 'services' && (d.maxCount === undefined || (v.d.all[t] ?? 0) < d.maxCount);
  });
  const fill = (t: BuildingId): number => { const r = BUILDING_DEFS[t].output?.res ?? 'grain'; return s.res[r] / Math.max(1, v.c.caps[r]); };
  const sorted = ok.sort((a, b) => fill(a) - fill(b) || BUILD_ORDER.indexOf(a) - BUILD_ORDER.indexOf(b));
  const pick = sorted.slice(0, 4).find((t) => validSlots(s, t, 'player').size > 0) ?? sorted[0];
  return pick ? { type: pick, k: Math.min(Math.max(1, idle), slotsOf(pick, s.rank)) } : null;
}

/** What the open posts leave short: water or grain running out by their runway, as the essentials rules judge it (a
 *  negative 3-day net with months in store is no shortage) while posts at the wells or in the fields stand open, or a
 *  service nobody mans; null when nothing is (wells all manned and still short want a well, not hands). */
function shortOf(s: GameState, v: SimView, k: number): 'water' | 'food' | 'services' | null {
  const low = (e: { stock: number; net3: number }, t: readonly number[]): boolean => { const r = runway(e.stock, e.net3); return r !== null && r < t[2] * k; };
  if (low(v.f.water, R.WATER_RUNOUT) && openPosts(v, 'water') > 0) return 'water';
  if (low(v.f.grain, R.GRAIN_RUNOUT) && openPosts(v, 'food') > 0) return 'food';
  return unstaffedService(s, v) ? 'services' : null;
}

/** A finished, open service with posts and nobody in them. */
function unstaffedService(s: GameState, v: SimView): boolean {
  const staffed = v.c.staffed;   // the census once, not a view read per building
  return s.buildings.some((b) => b.status === 'done' && b.open && BUILDING_DEFS[b.type].service && BUILDING_DEFS[b.type].slots > 0 && (staffed[b.id] ?? 0) === 0);
}

const labour: AdvisorRule = {
  id: 'fabrum.labour', advisor: 'fabrum',
  evaluate(s, v): AdvisoryEval | null {
    const c = v.c;
    const k = held(s, 'fabrum.labour') ? CLEAR : 1;
    let open = 0, slots = 0;
    const cats: string[] = [];
    for (const cat of WORK_CATS) {
      const o = openPosts(v, cat);
      slots += c.catSlots[cat];
      open += o;
      if (o > 0) cats.push(`${cat}:${o}`);
    }
    const idle = c.idle.length;
    const why = idle === 0 && slots > 0 && open > (R.OPEN_SHARE * slots) / k ? shortOf(s, v, k) : null;
    if (why) {
      return { rule: 'fabrum.labour', severity: 2, metric: { label: 'Hands short', value: open, unit: 'souls' }, params: { mode: 'lack', n: open, cats: cats.join(','), why } };
    }
    const manual = !s.ordo.on.labour;
    if (idle >= Math.max(R.IDLE_MIN, R.IDLE_SHARE * c.workforce) / k && (manual ? open > 0 : open === 0)) {
      return {
        rule: 'fabrum.labour', severity: 1, metric: { label: 'Idle', value: idle, unit: 'souls' },
        params: { mode: 'idle', n: idle, open, cats: cats.join(','), manual: manual ? 1 : 0, holdDays: R.IDLE_DAYS },
      };
    }
    return null;
  },
  title(_s, a) {
    const p = a.params;
    if (p.mode === 'lack') return `We lack ${P(p.n)} hands: ${catWords(p.cats)}.`;
    return p.manual === 1 ? `${P(p.n)} hands idle while ${P(p.open)} posts stand empty.` : `${P(p.n)} hands idle and no work for them.`;
  },
  text(s, v, a) {
    const p = a.params;
    if (p.mode === 'lack') {
      const short = lackWhy(v, p.why);
      return v.c.pop >= v.c.roll ? `Every able hand is at work${short}, and Rome's roll is full: only a petition opens the gates to more.`
        : `Every able hand is at work${short}. Houses for newcomers, or gates opened wider, would bring more.`;
    }
    const who = namesOf(idleBySkill(s, v, null));
    if (p.manual === 1) return `${who} wait for orders. Assign them, or give labour back to the Ordo.`;
    const sg = suggest(s, v);
    return `${who} forage and help the builders. ${sg ? `${cap1(aName(sg.type))} would employ ${sg.k}.` : 'A new workshop would employ them.'}`;
  },
  remedies(s, v, a) {
    const p = a.params;
    // the short work's hands first (the Ordo's priority, or the labour table when labour is in your hands); then more
    // hands: at Rome's roll only a petition; below it house plots while beds keep newcomers out, and wider gates
    if (p.mode === 'lack') {
      const cat: LaborCat = p.why === 'water' || p.why === 'food' ? p.why : 'services';
      const first: Remedy = s.ordo.on.labour ? { kind: 'priority', cat, days: B.ordo.PRIORITY_DAYS } : { kind: 'open', tab: 'people', anchor: 'labour' };
      if (v.c.pop >= v.c.roll) return three(first, { kind: 'open', tab: 'council', anchor: 'petition' });
      const bedsShort = v.c.freeBeds < settingValue(s, 'spareBeds');
      return three(first, bedsShort ? { kind: 'place', building: 'area' } : null, { kind: 'edict', edict: 'hospites', option: 'patentes' });
    }
    const sg = suggest(s, v);
    const build: Remedy | null = sg ? { kind: 'place', building: sg.type } : null;
    if (p.manual !== 1) return three(build, { kind: 'open', tab: 'people', anchor: 'labour' });
    let best: LaborCat = 'food', most = 0;
    for (const cat of WORK_CATS) { const o = openPosts(v, cat); if (o > most) { most = o; best = cat; } }
    return three({ kind: 'toggleOrdo', area: 'labour', on: true }, { kind: 'assign', cat: best, n: Math.max(1, Math.min(P(p.n), most)) }, build);
  },
};

/** ", and water lasts 9 days at this rate" — what the open posts leave short (render time, live numbers). */
function lackWhy(v: SimView, why: unknown): string {
  if (why === 'water' || why === 'food') {
    const e = why === 'water' ? v.f.water : v.f.grain;
    const r = runway(e.stock, e.net3);
    return r === null ? '' : `, and ${why === 'water' ? 'water' : 'grain'} lasts ${days(Math.floor(r))} at this rate`;
  }
  return why === 'services' ? ', and a work our homes need stands unmanned' : '';
}

// ───────────────────────────── 12 · fabrum.stalled ─────────────────────────────

/** The works that would make what a waiting plan lacks, staffed but idle for want of water (hints.waterIdle), or null:
 *  the stalled site's real cause, which no day of production brings nearer. */
function idleMaker(s: GameState, v: SimView, type: BuildingId): { b: Building; why: string; remedies: Remedy[] } | null {
  const m = missing(s, BUILDING_DEFS[type].cost);
  for (const r of RESOURCES) {
    const t = (m[r] ?? 0) > 0 ? PRODUCER[r] : undefined;
    if (!t) continue;
    for (const b of s.buildings) {
      const w = b.type === t ? waterIdle(s, v, b) : null;
      if (w) return { b, ...w };
    }
  }
  return null;
}

/** "40 stone and 10 tiles" for what a cost still lacks. */
function lackWords(s: GameState, type: BuildingId): string {
  const m = missing(s, BUILDING_DEFS[type].cost);
  const parts: string[] = [];
  for (const r of RESOURCES) if ((m[r] ?? 0) > 0) parts.push(`${int(Math.ceil(m[r] ?? 0))} ${resName(r)}`);
  return parts.length > 0 ? listJoin(parts) : 'materials';
}

const stalled: AdvisorRule = {
  id: 'fabrum.stalled', advisor: 'fabrum',
  evaluate(s, v) {
    let worst: { id: number; type: BuildingId; d: number; lack: 'materials' | 'builders' } | null = null;
    for (const id of v.d.sites) {
      const b = getBuilding(s, id);
      if (!b || b.type === 'capitolium') continue;
      const d = s.day - b.placed - (b.owner === 'ordo' ? B.construction.STAKE_DAYS : 0);
      if (d <= R.STALLED[0]) continue;
      const lack = b.status === 'plan' ? 'materials' : b.status === 'building' && (b.progress <= 0 || v.c.catStaffed.builders === 0) ? 'builders' : null;
      if (lack && (!worst || d > worst.d)) worst = { id, type: b.type, d, lack };
    }
    if (!worst) return null;
    const def = BUILDING_DEFS[worst.type];
    const pn = worst.d > R.STALLED[1] ? null : petitionNeeds(s, v);
    const named = (l: string): boolean => l.toLowerCase().includes(def.name.toLowerCase()) || l.toLowerCase().includes(def.latin.toLowerCase());
    const needed = pn !== null && pn.needs.some((n) => !n.met && named(n.label));
    return {
      rule: 'fabrum.stalled', severity: worst.d > R.STALLED[1] || needed ? 2 : 1, metric: { label: 'Waiting', value: worst.d, unit: 'days' },
      params: { id: worst.id, type: worst.type, d: worst.d, lack: worst.lack, pos: v.d.sites.indexOf(worst.id) + 1, sites: v.d.sites.length },
    };
  },
  title(s, a) {
    const p = a.params;
    const type = p.type as BuildingId;
    const lack = p.lack === 'materials' ? lackWords(s, type) : 'builders';
    return `The ${bName(type)} ${buildingPlace(s, P(p.id))} has waited ${days(P(p.d))} for ${lack}.`;
  },
  text(s, v, a) {
    const p = a.params;
    if (p.lack === 'materials') {
      const idle = idleMaker(s, v, p.type as BuildingId);
      if (!idle) return 'It stays a plan until the stores cover it; every day of production brings it nearer.';
      const name = bName(idle.b.type);
      return `It stays a plan until the stores cover it, and our ${name} ${buildingPlace(s, idle.b.id)} ${/s$/.test(name) ? 'stand' : 'stands'} idle: ${idle.why}`;
    }
    return `Our ${v.c.catStaffed.builders} builders work through the queue in order; it stands ${P(p.pos)} of ${P(p.sites)}.`;
  },
  remedies(s, v, a) {
    const p = a.params;
    const type = p.type as BuildingId;
    // a plan waiting on goods its works cannot make for want of water: what lets them work
    const idle = p.lack === 'materials' ? idleMaker(s, v, type) : null;
    if (idle) return idle.remedies;
    const share = SETTING_DEFS.builderShare;
    const more = Math.min(share.max, Math.round((settingValue(s, 'builderShare') + STEP.BUILDER_SHARE) * 100) / 100);
    const lacking = TRADE_RES.find((r) => (missing(s, BUILDING_DEFS[type].cost)[r] ?? 0) > 0) as TradeRes | undefined;
    return three(
      { kind: 'building', op: 'prioritise', id: P(p.id) },
      p.lack === 'builders' && more > settingValue(s, 'builderShare') ? { kind: 'setting', setting: 'builderShare', value: more } : null,
      lacking ? importRemedy(s, lacking, missing(s, BUILDING_DEFS[type].cost)[lacking] ?? B.ordo.CARGO) : null,
    );
  },
};

// ───────────────────────────── 13 · fabrum.capitolium ─────────────────────────────
// What really holds the Capitolium back (construction.capitoliumFlow): its crew, at most CAP_CREW fabri, or a material
// its works cannot make for want of an input (concrete works without water). Only levers not yet in force are offered:
// more builders only while fewer than CAP_CREW work on it (the builder share never adds to its crew), Opera Magna only
// while the crew binds. With no lever left (the full crew under Opera Magna) the Fabrum keeps silent: it rises as fast
// as it can.

const isTrade = (r: string): r is TradeRes => (TRADE_RES as readonly string[]).includes(r);

/** The levers on the Capitolium's bottleneck that are not yet in force (DESIGN §11.6 row 13). */
function capitoliumLevers(s: GameState, v: SimView, p: AdvisoryEval['params']): Remedy[] {
  const res = typeof p.res === 'string' ? p.res : '';
  const magna: Remedy | null = edictOption(s, 'opera') === 'magna' ? null : { kind: 'edict', edict: 'opera', option: 'magna' };
  if (res === 'crew' || res === '') {
    if (P(p.full) === 1) return three(magna);   // more builders would have nothing to do on it
    const cap = Math.max(1, Math.floor(v.c.workforce * B.ordo.BUILDERS_MAX));
    const first = s.ordo.priorities.some((x) => x.cat === 'builders' && x.until > s.day) || v.c.catStaffed.builders >= cap;
    const hands: Remedy | null = !s.ordo.on.labour ? { kind: 'assign', cat: 'builders', n: Math.max(1, B.construction.CAP_CREW - P(p.crew)) }
      : first ? null : { kind: 'priority', cat: 'builders', days: B.ordo.PRIORITY_DAYS };
    return three(hands, magna);
  }
  if (res === 'denarii') return three(edictOption(s, 'tributum') === 'grave' ? null : { kind: 'edict', edict: 'tributum', option: 'grave' });
  const input = typeof p.short === 'string' && p.short !== '' ? p.short as ResId : null;
  const place = (r: ResId): Remedy | null => (PRODUCER[r] ? { kind: 'place', building: PRODUCER[r] as BuildingId } : null);
  // water for the works: Operibus prius lets them draw below the water reserve (not through the Lex de annona's pause)
  const works: Remedy | null = edictOption(s, 'aquae') === 'operibus' || s.ordo.emergency.waterPause ? null : { kind: 'edict', edict: 'aquae', option: 'operibus' };
  const fix: (Remedy | null)[] = input === 'water'
    ? [works, { kind: 'place', building: 'puteus' }]
    : input ? [place(input), isTrade(input) ? importRemedy(s, input, B.ordo.CARGO) : null]
    : [place(res as ResId)];
  return three(...fix, isTrade(res) ? importRemedy(s, res, B.ordo.CARGO) : null);
}

const capitolium: AdvisorRule = {
  id: 'fabrum.capitolium', advisor: 'fabrum',
  evaluate(s, v) {
    const f = capitoliumFlow(s);
    if (!f) return null;
    const limit = R.CAP_ETA / (held(s, 'fabrum.capitolium') ? CLEAR : 1);
    if (f.eta !== null && f.eta <= limit) return null;
    const params = {
      stage: f.stage, eta: f.eta === null ? -1 : Math.ceil(f.eta), res: f.bottleneck ?? '', supply: f.supply, demand: f.demand,
      crew: f.crew, full: f.crew >= B.construction.CAP_CREW ? 1 : 0, stock: f.stock, held: f.held, heldFor: f.heldFor ?? '', inflow: f.inflow,
      short: f.starved?.input ?? '', works: f.starved?.works ?? '', share: f.starved?.share ?? 1,
    };
    if (capitoliumLevers(s, v, params).length === 0) return null;   // nothing left to pull: it rises as fast as it can
    return { rule: 'fabrum.capitolium', severity: 1, metric: f.eta !== null ? { label: 'Next stage', value: Math.ceil(f.eta), unit: 'days' } : undefined, params };
  },
  title(_s, a) {
    const p = a.params;
    const stage = STAGES[Math.min(STAGES.length - 1, P(p.stage))];
    const when = P(p.eta) >= 0 ? `the ${stage} rises in ${days(P(p.eta))}` : `the ${stage} will not rise`;
    const cap = B.construction.CAP_CREW;
    if (p.res === 'crew' || p.res === '') {
      return P(p.full) === 1 ? `At this flow ${when}; the crew is at its maximum (${cap} fabri, the most that can work on it).`
        : `At this flow ${when}; the crew is the bottleneck (${int(P(p.crew))} of the ${cap} fabri who could work on it).`;
    }
    const flow = `${P(p.inflow) < 0 ? '−' : '+'}${num(Math.abs(P(p.inflow)))}/day of ${num(P(p.demand))}`;
    const hf = typeof p.heldFor === 'string' ? p.heldFor : '';   // what the Ordo keeps the stock back for (storeWords)
    const heldFor = hf === 'petition' || hf === 'floor' || hf in BUILDING_DEFS ? hf as CapitoliumFlow['heldFor'] : null;
    return `At this flow ${when}; it waits for ${resName(p.res as ResId)}: ${storeWords({ stock: P(p.stock), held: P(p.held), heldFor })}, ${flow}.`;
  },
  text(_s, _v, a) {
    const p = a.params;
    const stage = `The Capitolium stands at stage ${toRoman(P(p.stage)) || 'nought'} of IV.`;
    if (typeof p.short === 'string' && p.short !== '' && typeof p.works === 'string' && p.works in BUILDING_DEFS) {
      const def = BUILDING_DEFS[p.works as BuildingId];
      return `The ${def.latin} (${def.name.toLowerCase()}) gets ${P(p.share) < 0.05 ? 'no' : 'too little'} ${resName(p.short as ResId)}, so the temple waits for its ${resName(p.res as ResId)}. ${stage}`;
    }
    if (p.res === 'crew' || p.res === '') return `${stage} ${P(p.full) === 1 ? 'More builders would only stand by.' : 'Every builder on it raises it faster.'}`;
    return `${stage} Its materials are drawn as the work proceeds.`;
  },
  remedies(s, v, a) {
    const r = capitoliumLevers(s, v, a.params);
    return r.length > 0 ? r : three({ kind: 'open', tab: 'build' });   // a lever pulled while the counsel fades: the works row says the rest
  },
};

// ───────────────────────────── 13b · fabrum.agenda ─────────────────────────────
// The Ordo raises a growth work only every GROWTH_EVERY days (DESIGN §10.3): when its next one waits on that pace, the
// Praefectus Fabrum names it, why, and when, so the player may raise it now. A colony left to the Ordo still grows, but
// slowly; this is how the advisors point the way to growing faster.

const agenda: AdvisorRule = {
  id: 'fabrum.agenda', advisor: 'fabrum',
  evaluate(s, v) {
    if (!s.ordo.on.build) return null;
    // (not a work the Ordo raises where it clears its own gardens: no placement by hand can take that slot)
    const w = newWishes(s, v, 3).find((x) => x.state === 'paced' && x.tile !== undefined && x.reason.params.gardens === undefined);
    if (!w) return null;
    return {
      rule: 'fabrum.agenda', severity: 1, metric: { label: 'In', value: w.eta ?? 1, unit: 'days' },
      params: { type: w.type, tile: w.tile ?? 0, wait: w.eta ?? 1, why: reasonText(w.reason) },
    };
  },
  title(_s, a) {
    const p = a.params;
    return `The Ordo will raise ${aName(p.type as BuildingId)} in ${days(P(p.wait))}.`;
  },
  text(_s, _v, a) {
    const why = typeof a.params.why === 'string' ? a.params.why : '';
    return `${why ? `${cap1(why.replace(/\.$/, ''))}. ` : ''}The council raises one such work at a time; raise it yourself and it starts today.`;
  },
  remedies(_s, _v, a) {
    const p = a.params;
    return three({ kind: 'place', building: p.type as BuildingId, tile: P(p.tile) }, null, null);
  },
};

/** The Praefectus Fabrum's rules, in RULES order. */
export const FABRUM_RULES: AdvisorRule[] = [labour, stalled, capitolium, agenda];
