// src/game/decisions.ts — focus, edicts, settings, switches, the charter and paths, petitions, rank-up, legacy
// (ARCHITECTURE §8.5, DESIGN §9.1–9.2, §9.6, §10.8–10.10). Owner: WP-D.
// Edicts and settings unlock with their milestone; an edict changes at most once per season window (locked until the
// next season's Kalends). Paths are permanent and never chosen automatically; the petition checklist is rendered from
// petitionNeeds() and its fee is paid by choosePath.
import { B as B$ } from './balance';
import { PATH_DECISIONS as PATH_DECISIONS$ } from './types';
import type {
  ActionResult, BuildingId, Cost, EdictId, FocusId, GameState, PathDecisionId, PathOptionId, RankIndex, SettingId, SimView, SwitchId, UnlockRef,
} from './types';
import { aucYear as aucYear$, formatAuc as formatAuc$, formatRoman as formatRoman$, nextSeasonStart as nextSeasonStart$ } from './calendar';
import { invalidate as invalidate$, pushActionFx as pushActionFx$ } from './memo';
import { canAfford, log, pay, scaleCost } from './state';
import { fx as fx$ } from './fx';
import { dignitas } from './civic';
import { houseHas } from './coverage';
import { charterPaving, paveVia } from './place';
import { startCapitolium } from './construction';
import { view } from './sim';
import { FIRST_HIEMS_OVER, MILESTONES, housesAtLeast, milestoneDone, milestoneIndex } from './objectives';
import { overlayRevealed, sectionRevealed, switchRevealed, toolRevealed } from './reveal';
import { EDICT_DEFS as EDICT_DEFS$, FOCUS_DEFS as FOCUS_DEFS$, PATH_DEFS as PATH_DEFS$, SETTING_DEFS as SETTING_DEFS$, SWITCH_DEFS as SWITCH_DEFS$ } from './data/decisions';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, PATH_DECISIONS = PATH_DECISIONS$, aucYear = aucYear$, formatAuc = formatAuc$, formatRoman = formatRoman$,
  nextSeasonStart = nextSeasonStart$, invalidate = invalidate$, pushActionFx = pushActionFx$, fx = fx$,
  EDICT_DEFS = EDICT_DEFS$, FOCUS_DEFS = FOCUS_DEFS$, PATH_DEFS = PATH_DEFS$, SETTING_DEFS = SETTING_DEFS$,
  SWITCH_DEFS = SWITCH_DEFS$, BUILDING_DEFS = BUILDING_DEFS$, RANK_DEFS = RANK_DEFS$;

const COLONIA = 4;
const P = B.progress;

/** The edict's current option id. */
export function edictOption(s: GameState, id: EdictId): string {
  return s.decisions.edicts[id] ?? EDICT_DEFS[id].initial;
}

/** A council setting's value (the initial value until unlocked). */
export function settingValue(s: GameState, id: SettingId): number {
  return isUnlocked(s, { kind: 'setting', id }) ? s.decisions.settings[id] ?? SETTING_DEFS[id].initial : SETTING_DEFS[id].initial;
}

/** A switch's state. */
export function switchOn(s: GameState, id: SwitchId): boolean {
  return s.decisions.switches[id] ?? SWITCH_DEFS[id].initial;
}

/** Whether an edict may change now; `next` is the day its window opens (the next season's Kalends after a change). */
export function edictWindow(s: GameState, id: EdictId): { open: boolean; next: number } {
  const lock = s.decisions.edictLock[id];
  if (lock !== undefined && s.day < lock) return { open: false, next: lock };
  return { open: true, next: nextSeasonStart(s.day) };
}

/** "Settled. Next window: Kal. Sept. (in 47 days)." */
export function edictWindowText(s: GameState, id: EdictId): string {
  const w = edictWindow(s, id);
  const days = w.next - s.day;
  return `Settled. Next window: ${formatRoman(w.next)} (in ${days} ${days === 1 ? 'day' : 'days'}).`;
}

function lockedReason(ref: UnlockRef): string {
  const id = ref.kind === 'edict' ? EDICT_DEFS[ref.id].unlock : ref.kind === 'setting' ? SETTING_DEFS[ref.id].unlock : null;
  const ms = id ? MILESTONES[milestoneIndex(id)] : null;
  return ms ? `Unlocked by the Res Gestae: ${ms.text}.` : 'The council has not yet the authority.';
}

/** Sets the council focus (free to change; steers the Ordo only; revealed by the charter milestone). */
export function setFocus(s: GameState, f: FocusId): ActionResult {
  if (!FOCUS_DEFS[f]) return { ok: false, code: 'invalid', reason: 'No such focus.' };
  if (!isUnlocked(s, { kind: 'section', id: 'focus' })) return { ok: false, code: 'locked', reason: 'Proclaim the Lex coloniae first.' };
  if (s.decisions.focus === f) return { ok: true };
  s.decisions.focus = f;
  log(s, 'info', `The council turns to ${FOCUS_DEFS[f].latin}: ${FOCUS_DEFS[f].name.toLowerCase()}.`);
  return { ok: true };
}

/** Changes an edict: one change per season window ('locked' / 'window' failures say why and when). */
export function setEdict(s: GameState, id: EdictId, option: string): ActionResult {
  const def = EDICT_DEFS[id];
  const opt = def?.options.find((o) => o.id === option);
  if (!def || !opt) return { ok: false, code: 'invalid', reason: 'No such edict.' };
  if (!isUnlocked(s, { kind: 'edict', id })) return { ok: false, code: 'locked', reason: lockedReason({ kind: 'edict', id }) };
  if (edictOption(s, id) === option) return { ok: true };
  if (!edictWindow(s, id).open) return { ok: false, code: 'window', reason: edictWindowText(s, id) };
  s.decisions.edicts[id] = option;
  s.decisions.edictLock[id] = nextSeasonStart(s.day);
  log(s, 'info', `Edict: ${def.latin} ${opt.name}. Settled until ${formatRoman(s.decisions.edictLock[id] as number)}.`);
  return { ok: true };
}

/** Sets a council setting (clamped to its range, snapped to its step). */
export function setSetting(s: GameState, id: SettingId, value: number): ActionResult {
  const def = SETTING_DEFS[id];
  if (!def || !Number.isFinite(value)) return { ok: false, code: 'invalid', reason: 'No such setting.' };
  if (!isUnlocked(s, { kind: 'setting', id })) return { ok: false, code: 'locked', reason: lockedReason({ kind: 'setting', id }) };
  const steps = Math.round((value - def.min) / def.step);
  const snapped = Math.min(def.max, Math.max(def.min, def.min + steps * def.step));
  s.decisions.settings[id] = Math.round(snapped * 1e6) / 1e6;     // keep 0.15 from becoming 0.15000000000000002
  return { ok: true };
}

/** Turns a switch on or off (once it is shown). */
export function setSwitch(s: GameState, id: SwitchId, on: boolean): ActionResult {
  if (!SWITCH_DEFS[id]) return { ok: false, code: 'invalid', reason: 'No such switch.' };
  if (!isUnlocked(s, { kind: 'switch', id })) return { ok: false, code: 'locked', reason: 'The council has not yet the authority.' };
  if (switchOn(s, id) === on) return { ok: true };
  s.decisions.switches[id] = on;
  log(s, 'info', `${SWITCH_DEFS[id].name}: ${on ? 'on' : 'off'}.`);
  return { ok: true };
}

/** Renames the colony (1..NAME_MAX characters). */
export function renameColony(s: GameState, name: string): ActionResult {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length === 0 || n.length > B.ui.NAME_MAX) return { ok: false, code: 'invalid', reason: `A name of 1 to ${B.ui.NAME_MAX} letters.` };
  if (n === s.name) return { ok: true };
  s.name = n;
  log(s, 'info', `The colony shall be called ${n}.`);
  return { ok: true };
}

/** The next undecided path decision (charter first), or null when all five are decided. */
export function nextPath(s: GameState): PathDecisionId | null {
  return PATH_DECISIONS.find((d) => s.decisions.paths[d] === undefined) ?? null;
}

type Need = { label: string; met: boolean };

/** A finished building of `type` with at least one worker. */
function staffed(s: GameState, v: SimView, type: BuildingId): boolean {
  const c = v.c;
  return s.buildings.some((b) => b.type === type && b.status === 'done' && (c.staffed[b.id] ?? 0) > 0);
}

/** Share of houses covered by religion (shrine or temple) and a market (taberna or macellum). */
function religionMarketShare(s: GameState, v: SimView): number {
  const houses = v.d.houses;
  if (houses.length === 0) return 0;
  let n = 0;
  for (const id of houses) {
    const rel = houseHas(s, id, 'shrine') || houseHas(s, id, 'temple');
    const mkt = houseHas(s, id, 'market') || houseHas(s, id, 'macellum');
    if (rel && mkt) n++;
  }
  return n / houses.length;
}

const count = (label: string, have: number, goal: number): Need => ({ label: `${label}: ${Math.floor(have)} / ${goal}`, met: have >= goal });

/** The DESIGN §9.1 checklist to ENTER `rank` (1..4). */
function rankNeeds(s: GameState, v: SimView, rank: RankIndex): Need[] {
  const c = v.c;
  const def = RANK_DEFS[rank];
  const pop = c.pop;
  const dig = dignitas(s).value;
  const needs: Need[] = [];
  const staffList = (types: BuildingId[]): Need => {
    const missing = types.filter((t) => !staffed(s, v, t)).map((t) => BUILDING_DEFS[t].name);
    const all = types.map((t) => BUILDING_DEFS[t].name).join(', ');
    return { label: missing.length ? `${all} staffed (missing: ${missing.join(', ')})` : `${all} staffed`, met: missing.length === 0 };
  };
  switch (def.id) {
    case 'vicus': {
      needs.push({ label: 'Lex coloniae proclaimed', met: s.decisions.paths.charter !== undefined });
      needs.push(count('Souls', pop, P.PETITION.vicus.POP));
      needs.push({ label: `First Hiems weathered (${formatRoman(FIRST_HIEMS_OVER, { year: true })})`, met: s.day >= FIRST_HIEMS_OVER });
      needs.push({ label: 'A Horreum', met: (v.d.counts.horreum ?? 0) > 0 });
      const stab = milestoneDone(s, 'stabilitas') || s.counters.stabStreak >= P.STAB.DAYS;
      needs.push({
        label: `Stabilitas: grain ≥ ${P.STAB.GRAIN} d, water ≥ ${P.STAB.WATER} d, spirits ≥ ${P.STAB.MORALE} for ${P.STAB.DAYS} days`
          + (stab ? '' : ` (${Math.min(s.counters.stabStreak, P.STAB.DAYS)} / ${P.STAB.DAYS})`),
        met: stab,
      });
      break;
    }
    case 'oppidum': {
      const q = P.PETITION.oppidum;
      const share = religionMarketShare(s, v);
      needs.push(count('Souls', pop, q.POP));
      needs.push(count('Homes of Casa tegulata or better', housesAtLeast(c, 2), q.T2_HOUSES));
      needs.push({ label: `Shrine and market reach ${Math.round(q.COVERAGE * 100)}% of homes (now ${Math.round(share * 100)}%)`, met: share >= q.COVERAGE });
      needs.push(count('Caravans returned from markets', s.trade.hubsTraded.length, q.HUBS));
      break;
    }
    case 'municipium': {
      const q = P.PETITION.municipium;
      needs.push(count('Souls', pop, q.POP));
      needs.push(count('Homes of Domus parva or better', housesAtLeast(c, 3), q.T3_HOUSES));
      needs.push(count('…of which insulae or domus', housesAtLeast(c, 4), q.T4_HOUSES));
      needs.push(staffList(['templum', 'macellum', 'balneum']));
      needs.push(count('Iron smelted', s.counters.ironMade, q.IRON));
      break;
    }
    case 'colonia': {
      const q = P.PETITION.colonia;
      needs.push(count('Souls', pop, q.POP));
      needs.push({ label: 'The aqueduct flows', met: v.d.castellumActive });
      needs.push(staffList(['thermae', 'theatrum']));
      needs.push(count('Insulae and domus', housesAtLeast(c, 4), q.T4_HOUSES));
      needs.push(count('Markets traded with by contract', s.trade.hubsTraded.length, q.HUBS));
      break;
    }
    default:
      break;
  }
  needs.push(count('Dignitas', dig, def.dignitas));
  return needs;
}

/** The next petition: decision, rank it grants, checklist, readiness, fee and affordability; null when none is left. */
export function petitionNeeds(s: GameState, v: SimView): { decision: PathDecisionId; rank: RankIndex | null; needs: { label: string; met: boolean }[]; ready: boolean; fee: Cost; affordable: boolean } | null {
  const decision = nextPath(s);
  if (!decision) return null;
  const grants = PATH_DEFS[decision].grants;
  const rank: RankIndex | null = grants > s.rank ? grants : null;
  const needs = rank !== null ? rankNeeds(s, v, rank) : [];
  const fee: Cost = rank !== null ? scaleCost(RANK_DEFS[rank].fee, fx(s, 'petitionFee')) : {};
  return { decision, rank, needs, ready: needs.every((n) => n.met), fee, affordable: canAfford(s, fee) };
}

/** Decides the next path: pays the fee × fx(petitionFee), records it, ranks up; Colonia begins the Capitolium. */
export function choosePath(s: GameState, decision: PathDecisionId, option: PathOptionId): ActionResult {
  if (!PATH_DEFS[decision]) return { ok: false, code: 'invalid', reason: 'No such decision.' };
  if (s.decisions.paths[decision] !== undefined) return { ok: false, code: 'chosen', reason: 'That choice is made for good.' };
  if (nextPath(s) !== decision) return { ok: false, code: 'locked', reason: `First: ${PATH_DEFS[nextPath(s) ?? 'charter'].name}.` };
  const opt = PATH_DEFS[decision].options.find((o) => o.id === option);
  if (!opt) return { ok: false, code: 'invalid', reason: 'No such path.' };
  const pn = petitionNeeds(s, view(s));
  if (!pn || !pn.ready) {
    const first = pn?.needs.find((n) => !n.met);
    return { ok: false, code: 'notReady', reason: `Rome would not yet hear our petition${first ? `: ${first.label}` : ''}.` };
  }
  if (!pn.affordable) return { ok: false, code: 'unaffordable', reason: 'The petition fee is beyond our stores.' };
  pay(s, pn.fee);
  s.decisions.paths[decision] = option;
  s.decisions.pathDays[decision] = s.day;
  if (pn.rank !== null) s.modifiers = s.modifiers.filter((m) => m.source !== 'legatus' || !m.fx.mul?.petitionFee);   // the Legate's good word is spent
  log(s, 'rank', `${PATH_DEFS[decision].name}: ${opt.name}. ${storyText(option)}.`, ['highlight']);
  if (pn.rank !== null) rankUp(s, pn.rank);
  if (option === 'viaMilitaris') paveVia(s);
  if (pn.rank === COLONIA) startCapitolium(s);
  invalidate(s);
  return { ok: true };
}

/** Raises the colony's rank: rings and territory (invalidate), log, the rank's charter streets paved, fx rank. */
export function rankUp(s: GameState, rank: RankIndex): void {
  if (rank <= s.rank) return;
  s.rank = rank;
  invalidate(s);
  const def = RANK_DEFS[rank];
  const opens = def.unlocks.map((t) => BUILDING_DEFS[t].name).join(', ');
  log(s, 'rank', `${formatAuc(aucYear(s.day))} · ${inscription(`${s.name} fit ${def.name}`)}. Rome names you ${def.title}${opens ? `; open to us now: ${opens}` : ''}.`, ['highlight']);
  const paved = charterPaving(s);
  if (paved > 0) log(s, 'build', `At Rome's cost ${CHARTER_TEXT[rank] ?? 'the streets are'} paved in silex: ${paved} paces.`);
  pushActionFx({ kind: 'rank', rank });
}

/** What a rank's charter paves (B.map.CHARTER, survey.ts charterStreets). */
const CHARTER_TEXT: Partial<Record<RankIndex, string>> = {
  [B.map.CHARTER.axes]: 'the cardo and the decumanus of the camp are',
  [B.map.CHARTER.inner]: 'the streets of the inner city are',
  [B.map.CHARTER.outer]: 'the streets of the first ring and across the old wall line are',
};

/** Inscription capitals with V for U ("CASTRA VALERIA FIT OPPIDVM"). */
export function inscription(text: string): string {
  return text.toUpperCase().replace(/U/g, 'V');
}

/** Whether an unlockable (edict, setting, switch, tool, overlay, section, cosmetic, victory) is unlocked. */
export function isUnlocked(s: GameState, ref: UnlockRef): boolean {
  switch (ref.kind) {
    case 'edict': return milestoneDone(s, EDICT_DEFS[ref.id].unlock);
    case 'setting': return milestoneDone(s, SETTING_DEFS[ref.id].unlock);
    case 'switch': return switchRevealed(s, ref.id);
    case 'tool': return toolRevealed(s, ref.id);
    case 'overlay': return overlayRevealed(s, ref.id);
    case 'section': return sectionRevealed(s, ref.id);
    case 'cosmetic': return MILESTONES.some((ms) => milestoneDone(s, ms.id) && ms.unlocks.some((u) => u.kind === 'cosmetic' && u.id === ref.id));
    case 'victory': return s.victory;
  }
}

const STORY: Record<PathOptionId, string> = {
  veterani: 'the colony was founded for the veterans of the legion',
  agricolae: 'the colony was founded for farmers of the land',
  mercatores: 'the camp market became an emporium',
  canabae: 'the canabae became a market village',
  pagus: 'the vicus became a farming pagus',
  coloni: 'the vicus opened its gates to coloni',
  arsFabrilis: 'the oppidum turned to the crafts of fire',
  pietas: 'the oppidum became known for its piety',
  viaMilitaris: 'the via was paved in basalt to the edge',
  iusLatii: 'the municipium received the Latin right',
  annonaPublica: 'the municipium founded a public grain dole',
  aquaeSalutares: 'the municipium became famed for its healing waters',
  iuppiter: 'the Capitolium was vowed to Iuppiter Optimus Maximus',
  aeternitas: 'the Capitolium was vowed to Aeternitas',
  imperium: 'the Capitolium was vowed to the Imperium',
};

function storyText(option: PathOptionId): string {
  const t = STORY[option];
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Your story" chips: one line per decided path, in decision order ("AUC DCCCII: the canabae became a market village."). */
export function pathStory(s: GameState): { decision: PathDecisionId; option: PathOptionId; day: number; text: string }[] {
  const out: { decision: PathDecisionId; option: PathOptionId; day: number; text: string }[] = [];
  for (const d of PATH_DECISIONS) {
    const option = s.decisions.paths[d];
    if (!option) continue;
    const day = s.decisions.pathDays[d] ?? s.day;
    out.push({ decision: d, option, day, text: `${formatAuc(aucYear(day))}: ${STORY[option]}.` });
  }
  return out;
}

/** Legacy of the next colony: +1 after a dedication (+0.05 bonus with Imperium); abandoning adds nothing (DESIGN §9.6). */
export function nextColonyLegacy(s: GameState): { legacy: number; legacyBonus: number } {
  if (!s.victory) return { legacy: s.legacy, legacyBonus: s.legacyBonus };
  const bonus = s.decisions.paths.path4 === 'imperium' ? P.LEGACY_IMPERIUM : 0;
  return { legacy: s.legacy + 1, legacyBonus: s.legacyBonus + bonus };
}
