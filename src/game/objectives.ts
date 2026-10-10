// src/game/objectives.ts — Res Gestae milestones, their unlocks and the counters behind them (ARCHITECTURE §8.5,
// DESIGN §9.4). Owner: WP-D.
// One goal at a time: `guidance.objective` indexes MILESTONES; checkObjectives loops so several can complete in one
// tick (offline). Every milestone unlocks something (UnlockRef) and adds +1 Deeds dignitas (civic.ts reads
// milestoneDays). The post-victory goals follow the Capitolium in the same list.
import { B as B$ } from './balance';
import { HOUSE_TIERS as HOUSE_TIERS$ } from './types';
import type { Census, GameState, MilestoneDef, MilestoneId, SimView, TickContext, UnlockRef } from './types';
import { census } from './census';
import { derived as derived$ } from './derived';
import { portion } from './economy';
import { nextSeasonStart as nextSeasonStart$, toRoman as toRoman$ } from './calendar';
import { log } from './state';
import { EDICT_DEFS as EDICT_DEFS$, SETTING_DEFS as SETTING_DEFS$, SWITCH_DEFS as SWITCH_DEFS$ } from './data/decisions';
import { TIER_DEFS as TIER_DEFS$ } from './data/housing';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, HOUSE_TIERS = HOUSE_TIERS$, derived = derived$, nextSeasonStart = nextSeasonStart$, toRoman = toRoman$,
  EDICT_DEFS = EDICT_DEFS$, SETTING_DEFS = SETTING_DEFS$, SWITCH_DEFS = SWITCH_DEFS$, TIER_DEFS = TIER_DEFS$;

const P = B.progress;
/** The first Hiems is over on the first Kal. Mart. after the founding (Kal. Mart. AUC DCCCI). */
export const FIRST_HIEMS_OVER = nextSeasonStart(B.time.START_DAY, 0);

/** Finished houses whose tier level is at least `level`. */
export function housesAtLeast(c: Census, level: number): number {
  let n = 0;
  for (const t of HOUSE_TIERS) if (TIER_DEFS[t].level >= level) n += c.byTier[t];
  return n;
}

const doneCount = (s: GameState, type: 'horreum' | 'templum'): number => derived(s).counts[type] ?? 0;
const flag = (b: boolean): [number, number] => [b ? 1 : 0, 1];
const upTo = (cur: number, goal: number): [number, number] => [Math.min(cur, goal), goal];
const pop = (s: GameState, goal: number): [number, number] => upTo(s.people.length, goal);

/** Buildings raised since the founding (any owner but the start, finished). */
function raised(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) if (b.owner !== 'start' && b.status === 'done') n++;
  return n;
}

function m(id: MilestoneId, text: string, hint: string, progress: (s: GameState) => [number, number], unlocks: UnlockRef[], postVictory?: boolean): MilestoneDef {
  const def: MilestoneDef = { id, text, hint, progress, unlocks };
  if (postVictory) def.postVictory = true;
  return def;
}

/** The 24 milestones in order (DESIGN §9.4): 20 to the Capitolium, then 4 post-victory goals. */
export const MILESTONES: MilestoneDef[] = [
  m('firstWork', 'Raise your first building', 'Place a work from Aedificia, or let the Ordo raise one.', (s) => upTo(raised(s), 1),
    [{ kind: 'setting', id: 'spareBeds' }, { kind: 'tool', id: 'pin' }, { kind: 'overlay', id: 'domus' }]),
  m('charter', 'Proclaim the Lex coloniae', 'Choose the founding law in Edicta. It is permanent.', (s) => flag(s.decisions.paths.charter !== undefined),
    [{ kind: 'section', id: 'focus' }]),
  m('fed30', 'Thirty days without hunger', 'Keep every mouth on full rations with grain to spare.', (s) => upTo(s.counters.fedStreak, P.FED_DAYS),
    [{ kind: 'edict', id: 'rationes' }, { kind: 'setting', id: 'grainReserve' }]),
  m('horreum', 'Raise a Horreum', 'A granary keeps grain for months; the open sheds rot.', (s) => upTo(doneCount(s, 'horreum'), 1),
    [{ kind: 'edict', id: 'tributum' }]),
  m('hiems', 'Weather the first Hiems', 'Fields give a third in Hiems: fill the horrea in Autumnus.',
    (s) => upTo(Math.max(0, s.day - B.time.START_DAY), FIRST_HIEMS_OVER - B.time.START_DAY),
    [{ kind: 'edict', id: 'opera' }, { kind: 'setting', id: 'builderShare' }, { kind: 'switch', id: 'emergency' }]),
  m('pop50', 'Fifty souls', 'Newcomers need free beds, full stores and good spirits.', (s) => pop(s, P.POP.pop50),
    [{ kind: 'edict', id: 'hospites' }]),
  m('stabilitas', 'Stabilitas', `Hold grain ≥ ${P.STAB.GRAIN} days, water ≥ ${P.STAB.WATER} days and spirits ≥ ${P.STAB.MORALE} for ${P.STAB.DAYS} days.`,
    (s) => upTo(s.counters.stabStreak, P.STAB.DAYS), [{ kind: 'setting', id: 'waterReserve' }]),
  m('vicus', 'Become a Vicus', 'Meet every line of the petition in Edicta and choose a path.', (s) => flag(s.rank >= 1),
    [{ kind: 'edict', id: 'horae' }, { kind: 'setting', id: 'tradeReserve' }, { kind: 'section', id: 'manual' }]),
  m('caravan', 'A caravan returns', 'Send a contract from Commercium, or let the Ordo trade.', (s) => upTo(s.counters.caravansReturned, 1),
    [{ kind: 'edict', id: 'nundinae' }]),
  m('tegulae', 'Ten tiled roofs', 'Casae need a shrine and a market within reach to take tiles.', (s) => upTo(housesAtLeast(census(s), 2), P.TEGULAE),
    [{ kind: 'edict', id: 'feriae' }, { kind: 'setting', id: 'renovation' }]),
  m('pop150', '150 souls', 'Lay out plots: Rome sends families only to free beds.', (s) => pop(s, P.POP.pop150),
    [{ kind: 'edict', id: 'silvae' }, { kind: 'setting', id: 'treasuryFloor' }]),
  m('oppidum', 'Become an Oppidum', 'Tiled homes, shrines and markets, and caravans to two markets.', (s) => flag(s.rank >= 2),
    [{ kind: 'edict', id: 'aquae' }, { kind: 'tool', id: 'reserve' }]),
  m('templum', 'Raise a Templum', 'A temple beside the forum shines brightest.', (s) => upTo(doneCount(s, 'templum'), 1),
    [{ kind: 'overlay', id: 'desir' }, { kind: 'tool', id: 'pave' }]),
  m('fork', 'The first insula or domus', 'Stone houses with baths, a market hall and oil become insulae or domus.', (s) => upTo(housesAtLeast(census(s), 4), 1),
    [{ kind: 'cosmetic', id: 'gildedStandards', label: 'Gilded standards at the principia' }]),
  m('iron60', 'Smelt 60 iron', 'A mine on the vein feeds the bloomery.', (s) => upTo(s.counters.ironMade, P.IRON),
    [{ kind: 'cosmetic', id: 'bronzeStatues', label: 'Bronze statues in the forum' }]),
  m('municipium', 'Become a Municipium', 'Stone homes, temple, market hall and baths, and smelted iron.', (s) => flag(s.rank >= 3),
    [{ kind: 'cosmetic', id: 'fountainLayer', label: 'Fountain layer in the Aqua overlay' }]),
  m('aqua', 'Water flows from the hills', 'Place a castellum: the arches find their way from the spring.', (s) => flag(derived(s).castellumActive),
    [{ kind: 'cosmetic', id: 'minimapFountains', label: 'Fountains sparkle on the minimap' }]),
  m('pop500', '500 souls', 'Insulae house many hands.', (s) => pop(s, P.POP.pop500),
    [{ kind: 'cosmetic', id: 'laurelCrest', label: 'A laurel on the crest' }]),
  m('colonia', 'Become a Colonia', 'The aqueduct, the great baths, the theatre and trade with five markets.', (s) => flag(s.rank >= 4),
    [{ kind: 'cosmetic', id: 'capitoliumWorks', label: 'The Capitolium works' }]),
  m('capitolium', 'Dedicate the Capitolium', 'Sixty-four fabri at most; keep stone, concrete, tiles and iron flowing.', (s) => flag(s.victory),
    [{ kind: 'victory' }]),
  m('pop1200', '1,200 souls', 'A city of Rome in all but name.', (s) => pop(s, P.POP.pop1200),
    [{ kind: 'cosmetic', id: 'purpleBanners', label: 'Purple banners on the walls' }], true),
  m('allT3', 'Every house of stone', 'Raise every home to a domus parva or better.', (s) => {
    const c = census(s);
    return c.houses > 0 ? [housesAtLeast(c, 3), c.houses] : [0, 1];
  }, [{ kind: 'cosmetic', id: 'gildedQuadriga', label: 'A gilded quadriga over the forum' }], true),
  m('sixHubs', 'Trade with all six markets', 'Complete a contract with every hub.', (s) => upTo(s.trade.hubsTraded.length, P.HUBS_ALL),
    [{ kind: 'cosmetic', id: 'triumphalGarlands', label: 'Triumphal garlands on the gates' }], true),
  m('saturnalia10', 'Ten Saturnalia kept', 'Keep the feasts: Feriae Solemnes or Frequentes.', (s) => upTo(s.counters.festivalsKept.saturnalia ?? 0, P.SATURNALIA),
    [{ kind: 'cosmetic', id: 'festalLanterns', label: 'Festal lanterns over the forum' }], true),
];

const TOOL_LABEL = { pin: 'Build next', road: 'Road tool', pave: 'Paving brush', reserve: 'Reserve-block tool', demolish: 'Demolish' } as const;
const OVERLAY_LABEL = { none: 'No overlay', aqua: 'Aqua overlay', domus: 'Domus overlay', officia: 'Officia overlay', desir: 'Dignitas loci overlay', terra: 'Terra overlay' } as const;
const SECTION_LABEL = { focus: 'Council focus', edicts: 'Edicts', settings: 'Council settings', switches: 'Council switches', manual: 'Who decides the details?', story: 'Your story' } as const;

/** Display label of an unlock ("Hospites edict", "Grain reserve setting", "Paving brush", …). */
export function unlockLabel(ref: UnlockRef): string {
  switch (ref.kind) {
    case 'edict': return `${EDICT_DEFS[ref.id].latin} edict`;
    case 'setting': return `${SETTING_DEFS[ref.id].name} setting`;
    case 'switch': return `${SWITCH_DEFS[ref.id].name} switch`;
    case 'tool': return TOOL_LABEL[ref.id];
    case 'overlay': return OVERLAY_LABEL[ref.id];
    case 'section': return SECTION_LABEL[ref.id];
    case 'cosmetic': return ref.label;
    case 'victory': return 'Victory and a Legacy';
  }
}

/** Index of a milestone in MILESTONES. */
export function milestoneIndex(id: MilestoneId): number {
  return MILESTONES.findIndex((x) => x.id === id);
}

/** The milestone that unlocks `ref` (matched by kind and id), or null when nothing gates it. */
export function milestoneUnlocking(ref: UnlockRef): MilestoneDef | null {
  const key = (r: UnlockRef): string => (r.kind === 'victory' ? 'victory' : `${r.kind}:${r.id}`);
  const k = key(ref);
  return MILESTONES.find((x) => x.unlocks.some((u) => key(u) === k)) ?? null;
}

/** Completes the current milestone(s) while their progress is met (loops); logs, fx milestone. */
export function checkObjectives(s: GameState, ctx: TickContext): void {
  for (;;) {
    const cur = currentMilestone(s);
    if (!cur) return;
    const [have, goal] = cur.progress(s);
    if (have < goal) return;
    const n = milestoneIndex(cur.id);
    s.guidance.milestoneDays[cur.id] = s.day;
    s.guidance.objective = n + 1;
    const unlocks = cur.unlocks.map(unlockLabel);
    const what = unlocks.length > 0 ? ` Unlocked: ${unlocks.join(', ')}.` : '';
    log(s, 'milestone', `Res Gestae ${toRoman(n + 1)}: ${cur.text}.${what}`, ['highlight']);
    ctx.fx.push({ kind: 'milestone', id: cur.id });
  }
}

/** The milestone currently pursued, or null when all are done. */
export function currentMilestone(s: GameState): MilestoneDef | null {
  return MILESTONES[s.guidance.objective] ?? null;
}

/** True when a milestone has been achieved. */
export function milestoneDone(s: GameState, id: MilestoneId): boolean {
  return s.guidance.milestoneDays[id] !== undefined;
}

/** Grain and water in days on hand (Infinity when nobody needs them). */
export function daysOnHand(s: GameState, c: Census): { grain: number; water: number } {
  const d = (stock: number, need: number): number => (need > 0 ? stock / need : Infinity);
  return { grain: d(s.res.grain, c.need.grain), water: d(s.res.water, c.need.water) };
}

/**
 * Daily counters behind milestones and petitions. fedStreak: every group sated (hunger within the first band), full
 * portions and grain left after the meal. stabStreak: grain ≥ 30 days, water ≥ 10 days and spirits ≥ 55.
 */
export function updateCounters(s: GameState, v: SimView): void {
  const sated = s.needs.hunger.every((h) => h <= B.needs.BAND[0]);
  const fed = sated && s.res.grain > 0 && portion(s) >= B.economy.PORTIONS.plenae;
  s.counters.fedStreak = fed ? s.counters.fedStreak + 1 : 0;
  const doh = daysOnHand(s, v.c);
  const stab = doh.grain >= P.STAB.GRAIN && doh.water >= P.STAB.WATER && s.morale >= P.STAB.MORALE;
  s.counters.stabStreak = stab ? s.counters.stabStreak + 1 : 0;
}
