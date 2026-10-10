// src/game/advisors/rules-fabrum.ts — the Praefectus Fabrum's advisories: rules 11–13 (fabrum.labour, fabrum.stalled,
// fabrum.capitolium) (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B as B$ } from '../balance';
import { LABOR_CATS as LABOR_CATS$, RESOURCES as RESOURCES$, TRADE_RES as TRADE_RES$ } from '../types';
import type { AdvisorRule, AdvisoryEval, BuildingId, GameState, LaborCat, Remedy, ResId, SimView, TradeRes } from '../types';
import { toRoman as toRoman$ } from '../calendar';
import { capitoliumFlow } from '../construction';
import { petitionNeeds, settingValue } from '../decisions';
import { validSlots } from '../place';
import { missing } from '../state';
import { getBuilding as getBuilding$ } from '../lookup';
import { BUILDING_DEFS as BUILDING_DEFS$, BUILD_ORDER as BUILD_ORDER$ } from '../data/buildings';
import { SETTING_DEFS as SETTING_DEFS$ } from '../data/decisions';
import {
  CLEAR, R, STEP, aName, bName, buildingPlace, days, held, idleBySkill, importRemedy, int, listJoin, namesOf, num, openPosts, resName, three,
} from './util';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, LABOR_CATS = LABOR_CATS$, RESOURCES = RESOURCES$, TRADE_RES = TRADE_RES$, toRoman = toRoman$,
  BUILDING_DEFS = BUILDING_DEFS$, BUILD_ORDER = BUILD_ORDER$, SETTING_DEFS = SETTING_DEFS$,
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
  return pick ? { type: pick, k: Math.min(Math.max(1, idle), BUILDING_DEFS[pick].slots) } : null;
}

/** A finished, open service with posts and nobody in them. */
function unstaffedService(s: GameState, v: SimView): boolean {
  return s.buildings.some((b) => b.status === 'done' && b.open && BUILDING_DEFS[b.type].service && BUILDING_DEFS[b.type].slots > 0 && (v.c.staffed[b.id] ?? 0) === 0);
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
    const short = v.f.water.net3 < 0 || v.f.grain.net3 < 0 || unstaffedService(s, v);
    if (idle === 0 && slots > 0 && open > (R.OPEN_SHARE * slots) / k && short) {
      return { rule: 'fabrum.labour', severity: 2, metric: { label: 'Hands short', value: open, unit: 'souls' }, params: { mode: 'lack', n: open, cats: cats.join(',') } };
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
      return v.c.pop >= v.c.roll ? 'Every able hand is at work, and Rome\'s roll is full: only a petition opens the gates to more.'
        : 'Every able hand is at work. Houses for newcomers, or gates opened wider, would bring more.';
    }
    const who = namesOf(idleBySkill(s, v, null));
    if (p.manual === 1) return `${who} wait for orders. Assign them, or give labour back to the Ordo.`;
    const sg = suggest(s, v);
    return `${who} forage and help the builders. ${sg ? `${cap1(aName(sg.type))} would employ ${sg.k}.` : 'A new workshop would employ them.'}`;
  },
  remedies(s, v, a) {
    const p = a.params;
    // at Rome's roll newcomers cannot come; below it, house plots help only while beds are what keeps them out
    if (p.mode === 'lack') {
      if (v.c.pop >= v.c.roll) return three({ kind: 'open', tab: 'council', anchor: 'petition' });
      const bedsShort = v.c.freeBeds < settingValue(s, 'spareBeds');
      return three(bedsShort ? { kind: 'place', building: 'area' } : null, { kind: 'edict', edict: 'hospites', option: 'patentes' });
    }
    const sg = suggest(s, v);
    const build: Remedy | null = sg ? { kind: 'place', building: sg.type } : null;
    if (p.manual !== 1) return three(build, { kind: 'open', tab: 'people', anchor: 'labour' });
    let best: LaborCat = 'food', most = 0;
    for (const cat of WORK_CATS) { const o = openPosts(v, cat); if (o > most) { most = o; best = cat; } }
    return three({ kind: 'toggleOrdo', area: 'labour', on: true }, { kind: 'assign', cat: best, n: Math.max(1, Math.min(P(p.n), most)) }, build);
  },
};

// ───────────────────────────── 12 · fabrum.stalled ─────────────────────────────

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
  text(_s, v, a) {
    const p = a.params;
    if (p.lack === 'materials') return 'It stays a plan until the stores cover it; every day of production brings it nearer.';
    return `Our ${v.c.catStaffed.builders} builders work through the queue in order; it stands ${P(p.pos)} of ${P(p.sites)}.`;
  },
  remedies(s, _v, a) {
    const p = a.params;
    const type = p.type as BuildingId;
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

const capitolium: AdvisorRule = {
  id: 'fabrum.capitolium', advisor: 'fabrum',
  evaluate(s) {
    const f = capitoliumFlow(s);
    if (!f) return null;
    const limit = R.CAP_ETA / (held(s, 'fabrum.capitolium') ? CLEAR : 1);
    if (f.eta !== null && f.eta <= limit) return null;
    return {
      rule: 'fabrum.capitolium', severity: 1, metric: f.eta !== null ? { label: 'Next stage', value: Math.ceil(f.eta), unit: 'days' } : undefined,
      params: { stage: f.stage, eta: f.eta === null ? -1 : Math.ceil(f.eta), res: f.bottleneck ?? '', rate: f.rate, need: f.need },
    };
  },
  title(_s, a) {
    const p = a.params;
    const stage = STAGES[Math.min(STAGES.length - 1, P(p.stage))];
    const when = P(p.eta) >= 0 ? `the ${stage} rises in ${days(P(p.eta))}` : `the ${stage} will not rise`;
    if (p.res === 'crew' || p.res === '') return `At this flow ${when}; the crew is the bottleneck (${B.construction.CAP_CREW} fabri at most).`;
    return `At this flow ${when}; ${resName(p.res as ResId)} is the bottleneck (${num(P(p.rate))}/day of ${num(P(p.need))}).`;
  },
  text: (_s, _v, a) => `The Capitolium stands at stage ${toRoman(P(a.params.stage)) || 'nought'} of IV. Its materials are drawn as the work proceeds.`,
  remedies(s, _v, a) {
    const res = a.params.res as ResId | 'crew' | '';
    const magna: Remedy = { kind: 'edict', edict: 'opera', option: 'magna' };
    if (res === 'crew' || res === '') return three(magna, { kind: 'setting', setting: 'builderShare', value: Math.min(SETTING_DEFS.builderShare.max, settingValue(s, 'builderShare') + STEP.BUILDER_SHARE) });
    if (res === 'denarii') return three({ kind: 'edict', edict: 'tributum', option: 'grave' }, magna);
    const prod = PRODUCER[res];
    const trade = (TRADE_RES as readonly string[]).includes(res) ? importRemedy(s, res as TradeRes, B.ordo.CARGO) : null;
    return three(prod ? { kind: 'place', building: prod } : null, trade, magna);
  },
};

/** The Praefectus Fabrum's rules, in RULES order. */
export const FABRUM_RULES: AdvisorRule[] = [labour, stalled, capitolium];
