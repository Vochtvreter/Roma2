// tests/autoplayer.ts — the five balance bots (actions only) and the recorder that plays them (ARCHITECTURE §14.2 WP-J,
// DESIGN §1.4, §18.4–18.5). Bots act between ticks exactly as a player would: through src/game/actions.ts and
// advisors/remedies.applyRemedy. Policy thresholds below are the bots' own judgement, not game balance.
import { B } from '../src/game/balance';
import { EDICTS, ORDO_AREAS, PATH_DECISIONS, RULES, TABS } from '../src/game/types';
import type { BuildingId, EdictId, GameState, PathDecisionId, PathOptionId, RankIndex, SimView, TabId, TipId } from '../src/game/types';
import * as act from '../src/game/actions';
import { petitionNeeds, settingValue } from '../src/game/decisions';
import { activeAdvisories, renderAdvisory } from '../src/game/advisors/engine';
import { applyRemedy } from '../src/game/advisors/remedies';
import { reserved } from '../src/game/ordo/saving';
import { newWishes } from '../src/game/ordo/build';
import { nextTip } from '../src/game/guide';
import { tabRevealed } from '../src/game/reveal';
import { dignitas } from '../src/game/civic';
import { capitoliumStage } from '../src/game/construction';
import { canPlace, validSlots } from '../src/game/place';
import { bestSlot } from '../src/game/site';
import { canAfford } from '../src/game/state';
import { serialize } from '../src/game/save';
import { newCtx, tick, view } from '../src/game/sim';
import { elapsed, seasonOf } from '../src/game/calendar';
import { PATH_DEFS } from '../src/game/data/decisions';
import { RANK_DEFS } from '../src/game/data/ranks';
import { fresh, noNaN } from './util';

/** The five bots of DESIGN §18.5. */
export type BotKind = 'decision' | 'undecided' | 'follower' | 'builder' | 'active' | 'neglect';
/** The balance seeds (DESIGN §18.4); BAL_SEEDS=1,2 overrides. */
export const SEEDS: readonly number[] = process.env.BAL_SEEDS ? process.env.BAL_SEEDS.split(',').map(Number) : [1, 2, 3, 42, 1337];
/** DESIGN §18.4 pacing bands (elapsed days; pop at victory). */
export const BANDS = {
  vicus: [420, 780], oppidum: [2100, 3400], municipium: [5000, 7600], colonia: [8800, 14000], victory: [11000, 17500],
  capPhase: [1800, 3000], capStage: [350, 900], victoryPop: [700, 1500],
} as const;
/** The idle floor (DESIGN §18.4): the Ordo alone reaches each rank this many times later than the attentive player. */
export const ORDO_RATIO = [2.2, 3.6] as const;
/** The band of each rank by index (Castra has none). */
export const RANK_BANDS = [null, BANDS.vicus, BANDS.oppidum, BANDS.municipium, BANDS.colonia] as const;
/** DESIGN §18.4 target curve: elapsed day, population, houses T0/T1/T2/T3/T4i/T4d. */
export const TARGETS: readonly { day: number; pop: number; tiers: readonly number[] }[] = [
  [0, 24, 6, 0, 0, 0, 0, 0], [120, 28, 0, 6, 0, 0, 0, 0], [330, 35, 0, 6, 0, 0, 0, 0], [570, 48, 0, 7, 0, 0, 0, 0],
  [1500, 104, 0, 0, 11, 0, 0, 0], [2850, 180, 0, 3, 16, 0, 0, 0], [4500, 266, 1, 3, 12, 6, 1, 0], [7020, 407, 1, 3, 12, 7, 8, 1],
  [9000, 573, 1, 3, 12, 6, 13, 1], [10110, 695, 1, 3, 12, 10, 17, 1], [11460, 944, 1, 4, 13, 10, 18, 1],
].map(([day, pop, ...tiers]) => ({ day, pop, tiers }));
/** DESIGN §18.4 treasury net per rank (den/day, [low, high]). */
export const COIN_NET: readonly (readonly [number, number])[] = [[3, 3], [6, 10], [12, 25], [30, 50], [40, 80]];

const FOLLOW_EVERY = 10;      // advisor-follower: remedy 0 of the top advisory every 10 days (DESIGN §11.5)
const BUILD_EVERY = 5;        // builder: places the Aedilis/Fabrum build remedies every 5 days (DESIGN §18.5)
const ACTIVE_GARDENS = 1;        // the attentive player: a garden for every house, from the camp on (Rome's favour, §6.6)
const PLOTS_KEPT = 6;            // …but never on the last free house plots: gardens and homes share the plots
const GARDENS_PER_HOUSE = 2;     // builder: from Vicus on, two gardens for every house (beautification, DESIGN §10.3)
const TIP_READ_DAYS = 3;      // a tip stays on the card this long before the bot clicks "Understood"
const CHARTER_LATE = 60;      // proclaim the charter by this elapsed day even if its tip never showed
const FULL_SUMMER = 0.9;      // Largae when the sheds are this full in Aestas
const DIGNITAS_NEAR = 0.85;   // Feriae Frequentes when dignitas is this close to the next threshold
const BOOM_SITES = 3, TIMBER_LOW = 0.3;   // Silvae Caedua: a building boom short of timber
const FAMINE_RUNWAY = 30;     // Rationes Parcae in Hiems when grain runs out within this many days

/** The fixed path table of a seed: option (slot + k) mod 3 for the k-th decision, so the five seeds use every option. */
export function pathTable(seed: number): Record<PathDecisionId, PathOptionId> {
  const at = [1, 2, 3, 42, 1337].indexOf(seed);
  const slot = at >= 0 ? at : Math.abs(seed);
  const t = {} as Record<PathDecisionId, PathOptionId>;
  PATH_DECISIONS.forEach((d, k) => { t[d] = PATH_DEFS[d].options[(slot + k) % PATH_DEFS[d].options.length].id; });
  return t;
}

/** The edict options the "Situational use" column of DESIGN §10.9 advises in the current state. */
export function edictAdvice(s: GameState, v: SimView, pn = petitionNeeds(s, v)): Record<EdictId, string> {
  const f = v.f, c = v.c, season = seasonOf(s.day);
  const hiemsShort = f.grain.crunch !== null && f.grain.crunch.lowestDoh <= 0;
  const famine = hiemsShort || (f.grain.runout !== null && f.grain.runout - s.day < FAMINE_RUNWAY);
  const unrest = s.morale < B.morale.LABELS[1];
  const unfinished = (t: BuildingId): boolean => s.buildings.some((b) => b.type === t && b.status !== 'done');
  const capitolium = unfinished('capitolium');
  const dig = pn?.rank != null ? dignitas(s).value / Math.max(1, RANK_DEFS[pn.rank].dignitas) : 0;
  const sites = s.buildings.filter((b) => b.status !== 'done' && b.type !== 'capitolium').length;
  const paths = s.decisions.paths;
  return {
    rationes: season === 3 && famine ? 'parcae' : season === 1 && s.res.grain >= FULL_SUMMER * f.grain.cap && !hiemsShort ? 'largae' : 'plenae',
    tributum: unrest ? 'leve' : capitolium ? 'grave' : 'iustum',
    opera: capitolium || unfinished('castellum') || (unfinished('horreum') && (season === 1 || season === 2)) ? 'magna' : 'solita',
    hospites: season === 2 && hiemsShort ? 'clausi' : c.freeBeds >= settingValue(s, 'spareBeds') && c.pop < c.roll ? 'patentes' : 'cauti',
    horae: unrest ? 'otium' : pn?.ready && !pn.affordable ? 'longae' : 'solitae',
    nundinae: paths.charter === 'mercatores' || paths.path2 === 'viaMilitaris' ? 'frequentes' : 'solitae',
    feriae: unrest || (dig >= DIGNITAS_NEAR && dig < 1) ? 'frequentes' : 'solemnes',
    silvae: sites >= BOOM_SITES && s.res.timber < TIMBER_LOW * c.caps.timber ? 'caedua' : 'renovata',
    aquae: v.d.castellumActive ? 'operibus' : 'populo',
  };
}

/** A bot: `step` runs once per day before the tick and acts only through the action API. */
export interface Bot { readonly kind: BotKind; readonly picks: Record<PathDecisionId, PathOptionId>; step(s: GameState): void }

/** Builds a bot of one kind for one seed (the path table comes from the seed). */
export function makeBot(kind: BotKind, seed: number): Bot {
  const picks = pathTable(seed);
  const tip = { id: null as TipId | null, since: 0 };
  let toggled = false;
  return {
    kind, picks,
    step(s) {
      if (kind === 'undecided') return;
      if (kind === 'neglect') {
        if (!toggled) for (const a of ORDO_AREAS) act.setOrdo(s, a, false);
        toggled = true;
        return;
      }
      decide(s, picks, tip);
      const e = elapsed(s);
      if (kind === 'follower' && e % FOLLOW_EVERY === 0) follow(s);
      if (kind === 'builder' && e % BUILD_EVERY === 0) { buildRemedies(s); beautify(s); }
      // the attentive player (DESIGN §18.5): every advisor's works and the Ordo's paced ones by hand, gardens, and the top remedy
      if (kind === 'active' && e % BUILD_EVERY === 0) { buildRemedies(s, true); raiseAgenda(s); beautify(s, 0, ACTIVE_GARDENS); }
      if (kind === 'active' && e % FOLLOW_EVERY === 0) follow(s);
    },
  };
}

/** The decision-only player: charter and paths from the table, petitions when ready, situational edicts, default answers, tips read. */
function decide(s: GameState, picks: Record<PathDecisionId, PathOptionId>, tip: { id: TipId | null; since: number }): void {
  const v = view(s);
  const pn = petitionNeeds(s, v);
  // the charter is proclaimed once its tip has been read (DESIGN §11.12: the tip comes after the Ordo's), or late if it never shows
  const charterRead = s.guidance.tips.includes('charter') || elapsed(s) >= CHARTER_LATE;
  if (pn && pn.ready && pn.affordable && elapsed(s) >= B.guide.CHARTER && (pn.decision !== 'charter' || charterRead)) act.choosePath(s, pn.decision, picks[pn.decision]);
  const want = edictAdvice(s, v, pn);
  for (const id of EDICTS) if (s.decisions.edicts[id] !== want[id]) act.setEdict(s, id, want[id]);
  const c = s.choice;   // the default, or (if unaffordable) the next affordable answer, as on expiry (DESIGN §12.1)
  for (let k = 0; c && s.choice === c && k < c.options.length; k++) act.chooseOption(s, (c.defaultIndex + k) % c.options.length);
  const t = nextTip(s);
  if (!t) tip.id = null;
  else if (t.id !== tip.id) { tip.id = t.id; tip.since = s.day; }
  else if (s.day - tip.since >= TIP_READ_DAYS) act.dismissTip(s, t.id);
}

/** Remedy 0 of the top advisory (a `place` remedy executes as `ask`; a contract is sent as the form would send it; a
 *  block to clear is cleared and the work placed on it, as the player's confirm and the ghost waiting there do). */
export function follow(s: GameState): void {
  const top = activeAdvisories(s, { forCard: true })[0];
  const r = top ? renderAdvisory(s, view(s), top).remedies[0]?.remedy : undefined;
  if (!r) return;
  if (r.kind === 'place') applyRemedy(s, { kind: 'ask', building: r.building });
  else if (r.kind === 'contract') act.createContract(s, r.spec, 'player');
  else if (r.kind === 'clear') { if (applyRemedy(s, r).ok) act.place(s, r.building, r.tile, { owner: 'player' }); }
  else applyRemedy(s, r);
}

/** Every Aedilis/Fabrum build remedy, placed by hand at its best slot as a player site (affordable above the Ordo's reserve). */
function buildRemedies(s: GameState, every = false): void {
  const v = view(s);
  const done = new Set<BuildingId>();
  for (const a of activeAdvisories(s)) {
    if (!every && a.advisor !== 'aedilis' && a.advisor !== 'fabrum') continue;
    for (const { remedy: r } of renderAdvisory(s, v, a).remedies) {
      if (r.kind !== 'place' && r.kind !== 'ask') continue;
      const t = r.building;
      if (t !== 'area' && (done.has(t) || s.buildings.some((b) => b.type === t && b.owner === 'player' && b.status !== 'done'))) continue;
      const tile = (r.kind === 'place' ? r.tile : undefined) ?? bestSlot(s, t, { owner: 'player' })?.tile;
      if (tile === undefined) continue;
      const chk = canPlace(s, t, tile, { owner: 'player' });
      if (chk.ok && canAfford(s, chk.cost, reserved(s, v)) && act.place(s, t, tile, { owner: 'player' }).ok) done.add(t);
    }
  }
}

/** The attentive player reads the Agenda: a growth work the Ordo would raise only later ("raise it yourself for sooner")
 *  is placed by hand at the Ordo's own slot, from stock above the Ordo's reserve. */
function raiseAgenda(s: GameState): void {
  const v = view(s);
  for (const w of newWishes(s, v, 3)) {
    if (w.state !== 'paced' || w.tile === undefined) continue;
    const chk = canPlace(s, w.type, w.tile, { owner: 'player' });
    if (chk.ok && canAfford(s, chk.cost, reserved(s, v))) act.place(s, w.type, w.tile, { owner: 'player' });
  }
}

/** The builder also beautifies, which the Ordo leaves to the player (DESIGN §10.3): from Vicus on (the camp's plots are
 *  for wells and homes), a hortus among the houses, one site at a time, up to GARDENS_PER_HOUSE for every house, at its
 *  best slot from stock above the Ordo's reserve. Gardens add dignitas, and a town of renown draws Rome's colonists
 *  faster (DESIGN §6.6), so this is the building that pays beyond what the Ordo raises anyway. */
function beautify(s: GameState, from = 1, perHouse = GARDENS_PER_HOUSE): void {
  if (s.rank < from) return;
  const v = view(s);
  let gardens = 0;
  for (const b of s.buildings) {
    if (b.type !== 'hortus') continue;
    if (b.status !== 'done') return;
    gardens++;
  }
  if (gardens >= Math.floor(v.c.houses * perHouse)) return;
  if (perHouse !== GARDENS_PER_HOUSE && validSlots(s, 'area', 'player').size <= PLOTS_KEPT) return;   // homes first
  const slot = bestSlot(s, 'hortus', { owner: 'player' });
  if (!slot) return;
  const chk = canPlace(s, 'hortus', slot.tile, { owner: 'player' });
  if (chk.ok && canAfford(s, chk.cost, reserved(s, v))) act.place(s, 'hortus', slot.tile, { owner: 'player' });
}

/** Everything the balance tests and the trace read from one bot run. */
export interface Run {
  seed: number; kind: BotKind; s: GameState; picks: Record<PathDecisionId, PathOptionId>; nan: string[];
  rankDay: number[]; stageDay: number[]; victoryDay: number | null;   // elapsed day each rank / Capitolium stage 1..4 was reached
  minPop: number; maxPop: number; pops: number[]; starved: number[];  // min/max after day 30; per day: pop, hunger + thirst deaths
  minCoin: number; zeroStreak: number; stall: { construction: number; renovation: number };   // stall: days without progress while both had work
  snapshots: { rank: RankIndex; json: string }[];                     // serialised state on the day each rank was entered
  tabDay: Partial<Record<TabId, number>>; tipDay: Partial<Record<TipId, number>>;
  remedyIssues: string[]; flaps: number;                              // advisories that failed to render; most re-raises of a rule in 60 days
}

/** Options of one playthrough. */
export interface PlayOpts {
  days: number;                        // elapsed days to play at most (stops early on victory)
  stop?: (s: GameState) => boolean;
  snapshots?: boolean;                 // serialise the state at each rank-up (offline safety)
  guidanceDays?: number;               // render every active advisory daily for this many days
  onDay?: (s: GameState, r: Run) => void;
}

/** Plays one bot on one seed and records the balance metrics of DESIGN §18.5. */
export function play(seed: number, kind: BotKind, opts: PlayOpts): Run {
  const s = fresh(seed);
  const bot = makeBot(kind, seed);
  const r: Run = {
    seed, kind, s, picks: bot.picks, rankDay: [0], stageDay: [], victoryDay: null, minPop: Infinity, maxPop: 0, pops: [], starved: [],
    minCoin: Infinity, zeroStreak: 0, stall: { construction: 0, renovation: 0 }, snapshots: [], nan: [], tabDay: {}, tipDay: {},
    remedyIssues: [], flaps: 0,
  };
  const t: Tracker = { prog: 0, evolved: 0, renov: new Set(), cStall: 0, rStall: 0, zero: 0, dead: 0, raises: new Map(), active: new Set() };
  for (let i = 0; i < opts.days && !s.victory && !opts.stop?.(s); i++) {
    bot.step(s);
    tick(s, newCtx());
    observe(s, r, t, opts);
    opts.onDay?.(s, r);
  }
  r.nan.push(...noNaN(s).slice(0, 5));
  return r;
}

type Tracker = { prog: number; evolved: number; renov: Set<number>; cStall: number; rStall: number; zero: number; dead: number; raises: Map<string, number[]>; active: Set<string> };

function observe(s: GameState, r: Run, t: Tracker, opts: PlayOpts): void {
  const e = elapsed(s), pop = s.people.length;
  while (r.rankDay.length <= s.rank) {
    r.rankDay.push(e);
    if (opts.snapshots) r.snapshots.push({ rank: (r.rankDay.length - 1) as RankIndex, json: serialize(s) });
  }
  const cap = s.buildings.find((b) => b.type === 'capitolium');
  const stage = cap ? (cap.status === 'done' ? 4 : capitoliumStage(cap)) : 0;
  while (r.stageDay.length < stage) r.stageDay.push(e);
  if (s.victory && r.victoryDay === null) r.victoryDay = e;
  if (e > 30) { r.minPop = Math.min(r.minPop, pop); r.maxPop = Math.max(r.maxPop, pop); }
  const dead = s.stats.deathsBy.hunger + s.stats.deathsBy.thirst;
  r.pops.push(pop); r.starved.push(dead - t.dead); t.dead = dead;
  r.minCoin = Math.min(r.minCoin, s.res.denarii);
  t.zero = s.res.denarii < 1 ? t.zero + 1 : 0;
  r.zeroStreak = Math.max(r.zeroStreak, t.zero);
  if (e % 365 === 0 && r.nan.length === 0) r.nan.push(...noNaN(s).slice(0, 5));

  // no deadlock: construction and renovation each progress while both have work (DESIGN §18.5)
  let prog = s.stats.built, cWork = false, rWork = false, rProg = s.stats.evolved > t.evolved;
  const renov = new Set<number>();
  for (const b of s.buildings) {
    if (b.status === 'building' || b.status === 'staked') { cWork = true; prog += b.progress; }
    const h = b.house;
    if (!h || b.status !== 'done') continue;
    if (h.renovating) { renov.add(b.id); rWork = true; if (!t.renov.has(b.id)) rProg = true; }
    else if (h.okDays >= B.housing.OK_DAYS) rWork = true;
  }
  const cProg = prog > t.prog + 1e-9;
  t.prog = prog; t.evolved = s.stats.evolved; t.renov = renov;
  if (cWork && rWork) { t.cStall = cProg ? 0 : t.cStall + 1; t.rStall = rProg ? 0 : t.rStall + 1; } else { t.cStall = 0; t.rStall = 0; }
  r.stall.construction = Math.max(r.stall.construction, t.cStall);
  r.stall.renovation = Math.max(r.stall.renovation, t.rStall);

  // guidance: reveal days, tips, flapping, remedies render (DESIGN §18.5 "guidance")
  for (const tab of TABS) if (r.tabDay[tab] === undefined && tabRevealed(s, tab)) r.tabDay[tab] = e;
  const tip = nextTip(s);
  if (tip && r.tipDay[tip.id] === undefined) r.tipDay[tip.id] = e;
  for (const rule of RULES) {   // a flap = a rule raised again after it was cleared; count them per 60 days
    const on = s.guidance.advisories[rule]?.active === true;
    if (on && !t.active.has(rule)) {
      const days = t.raises.get(rule);
      if (!days) t.raises.set(rule, []);
      else { days.push(e); r.flaps = Math.max(r.flaps, days.filter((d) => d > e - 60).length); }
    }
    if (on) t.active.add(rule); else t.active.delete(rule);
  }
  if (e <= (opts.guidanceDays ?? 0)) {
    const v = view(s);
    for (const a of activeAdvisories(s)) {
      try { if (renderAdvisory(s, v, a).remedies.length < 1) r.remedyIssues.push(`day ${e} ${a.rule}: no remedy`); }
      catch (err) { r.remedyIssues.push(`day ${e} ${a.rule}: ${String(err)}`); }
    }
  }
}

/** The worst 365-day window of hunger + thirst deaths as a share of that window's average population. */
export function worstYear(r: Run): { share: number; day: number } {
  const n = r.pops.length, w = Math.min(365, n);
  let dead = 0, pop = 0, worst = { share: 0, day: 0 };
  for (let i = 0; i < n; i++) {
    dead += r.starved[i]; pop += r.pops[i];
    if (i >= w) { dead -= r.starved[i - w]; pop -= r.pops[i - w]; }
    if (i >= w - 1 && pop > 0 && dead / (pop / w) > worst.share) worst = { share: dead / (pop / w), day: i + 1 };
  }
  return worst;
}

/** Median (a value that was never reached counts as Infinity; Infinity when there are none). */
export function median(xs: readonly number[]): number {
  const v = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return v.length === 0 ? Infinity : v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

/** One line per run: rank days against their bands, victory, population, deaths and the paths taken. */
export function summary(r: Run): string {
  const ranks = RANK_DEFS.slice(1).map((d, k) => {
    const day = r.rankDay[k + 1], band = RANK_BANDS[k + 1];
    if (day === undefined) return `${d.name} —`;
    return `${d.name} ${day}${band && (day < band[0] || day > band[1]) ? '✗' : '✓'}`;
  }).join(' · ');
  const paths = PATH_DECISIONS.map((d) => r.s.decisions.paths[d] ?? '·').join('/');
  return `${r.kind} seed ${r.seed}: day ${elapsed(r.s)} · ${ranks} · victory ${r.victoryDay ?? '—'} · pop ${r.s.people.length} ` +
    `(min ${Number.isFinite(r.minPop) ? r.minPop : '—'}, peak ${r.s.stats.peakPop}) · starved ${r.s.stats.deathsBy.hunger + r.s.stats.deathsBy.thirst} · ` +
    `devolved ${r.s.stats.devolved} · coin ${Math.round(r.s.res.denarii)} (min ${Math.round(r.minCoin)}) · paths ${paths}`;
}
