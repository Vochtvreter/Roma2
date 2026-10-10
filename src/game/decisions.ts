// src/game/decisions.ts — focus, edicts, settings, switches, the charter and paths, petitions, rank-up (ARCHITECTURE §8.5, DESIGN §9, §10.8–10.10). Owner: WP-D.
// SCAFFOLD: everything is unlocked; the petition checklist only asks for population and dignitas.
import { B } from './balance';
import { PATH_DECISIONS } from './types';
import type { ActionResult, Cost, EdictId, FocusId, GameState, PathDecisionId, PathOptionId, RankIndex, SettingId, SimView, SwitchId, UnlockRef } from './types';
import { formatRoman, nextSeasonStart } from './calendar';
import { invalidate, pushActionFx } from './memo';
import { canAfford, log, pay, scaleCost } from './state';
import { fx } from './fx';
import { dignitas } from './civic';
import { ceremonyPaving } from './place';
import { startCapitolium } from './construction';
import { view } from './sim';
import { EDICT_DEFS, FOCUS_DEFS, PATH_DEFS, SETTING_DEFS, SWITCH_DEFS } from './data/decisions';
import { RANK_DEFS } from './data/ranks';

const OPPIDUM = RANK_DEFS.findIndex((r) => r.id === 'oppidum');
const COLONIA = RANK_DEFS.findIndex((r) => r.id === 'colonia');

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

/** Whether an edict may change now; `next` is the day its window opens (next season's Kalends after a change). */
export function edictWindow(s: GameState, id: EdictId): { open: boolean; next: number } {
  const lock = s.decisions.edictLock[id];
  if (lock !== undefined && s.day < lock) return { open: false, next: lock };
  return { open: true, next: nextSeasonStart(s.day) };
}

/** Sets the council focus (free to change; steers the Ordo only). */
export function setFocus(s: GameState, f: FocusId): ActionResult {
  if (!FOCUS_DEFS[f]) return { ok: false, code: 'invalid', reason: 'No such focus.' };
  if (s.decisions.focus === f) return { ok: true };
  s.decisions.focus = f;
  log(s, 'info', `The council turns to ${FOCUS_DEFS[f].name}.`);
  return { ok: true };
}

/** Changes an edict: one change per season window ('locked' / 'window' failures name why). */
export function setEdict(s: GameState, id: EdictId, option: string): ActionResult {
  const def = EDICT_DEFS[id];
  const opt = def?.options.find((o) => o.id === option);
  if (!def || !opt) return { ok: false, code: 'invalid', reason: 'No such edict.' };
  if (!isUnlocked(s, { kind: 'edict', id })) return { ok: false, code: 'locked', reason: 'The council has not yet the authority.' };
  if (s.decisions.edicts[id] === option) return { ok: true };
  const w = edictWindow(s, id);
  if (!w.open) return { ok: false, code: 'window', reason: `The edict may change again on ${formatRoman(w.next)}.` };
  s.decisions.edicts[id] = option;
  s.decisions.edictLock[id] = nextSeasonStart(s.day);
  log(s, 'info', `Edict: ${def.name} — ${opt.name}.`, ['decided']);
  return { ok: true };
}

/** Sets a council setting (clamped to its range, snapped to its step). */
export function setSetting(s: GameState, id: SettingId, value: number): ActionResult {
  const def = SETTING_DEFS[id];
  if (!def || !Number.isFinite(value)) return { ok: false, code: 'invalid', reason: 'No such setting.' };
  if (!isUnlocked(s, { kind: 'setting', id })) return { ok: false, code: 'locked', reason: 'The council has not yet the authority.' };
  const snapped = def.min + Math.round((value - def.min) / def.step) * def.step;
  s.decisions.settings[id] = Math.min(def.max, Math.max(def.min, snapped));
  return { ok: true };
}

/** Turns a switch on or off. */
export function setSwitch(s: GameState, id: SwitchId, on: boolean): ActionResult {
  if (!SWITCH_DEFS[id]) return { ok: false, code: 'invalid', reason: 'No such switch.' };
  s.decisions.switches[id] = on;
  log(s, 'info', `${SWITCH_DEFS[id].name}: ${on ? 'on' : 'off'}.`);
  return { ok: true };
}

/** Renames the colony (1..NAME_MAX characters). */
export function renameColony(s: GameState, name: string): ActionResult {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length === 0 || n.length > B.ui.NAME_MAX) return { ok: false, code: 'invalid', reason: `A name of 1 to ${B.ui.NAME_MAX} letters.` };
  s.name = n;
  log(s, 'info', `The colony shall be called ${n}.`);
  return { ok: true };
}

/** The next undecided path decision (charter first), or null when all five are decided. */
export function nextPath(s: GameState): PathDecisionId | null {
  return PATH_DECISIONS.find((d) => s.decisions.paths[d] === undefined) ?? null;
}

/** The next petition: decision, rank it grants, checklist, readiness, fee and affordability; null when none is left. */
export function petitionNeeds(s: GameState, v: SimView): { decision: PathDecisionId; rank: RankIndex | null; needs: { label: string; met: boolean }[]; ready: boolean; fee: Cost; affordable: boolean } | null {
  const decision = nextPath(s);
  if (!decision) return null;
  const grants = PATH_DEFS[decision].grants;
  const rank: RankIndex | null = grants > s.rank ? grants : null;
  const needs: { label: string; met: boolean }[] = [];
  let fee: Cost = {};
  if (rank !== null) {
    const def = RANK_DEFS[rank];
    fee = scaleCost(def.fee, fx(s, 'petitionFee'));
    const pet = (B.progress.PETITION as Readonly<Record<string, { POP: number }>>)[def.id];
    if (pet) needs.push({ label: `${pet.POP} souls`, met: v.c.pop >= pet.POP });
    needs.push({ label: `Dignitas ${def.dignitas}`, met: dignitas(s).value >= def.dignitas });
    // STUB(WP-D): the full DESIGN §9.1 checklist (houses by tier, coverage, hubs, iron, milestones).
  }
  const ready = needs.every((n) => n.met);
  return { decision, rank, needs, ready, fee, affordable: canAfford(s, fee) };
}

/** Decides the next path: pays the fee × fx(petitionFee), records it, ranks up; Colonia begins the Capitolium. */
export function choosePath(s: GameState, decision: PathDecisionId, option: PathOptionId): ActionResult {
  if (s.decisions.paths[decision] !== undefined) return { ok: false, code: 'chosen', reason: 'That choice is made for good.' };
  if (nextPath(s) !== decision) return { ok: false, code: 'locked', reason: 'Another decision comes first.' };
  const opt = PATH_DEFS[decision].options.find((o) => o.id === option);
  if (!opt) return { ok: false, code: 'invalid', reason: 'No such path.' };
  const pn = petitionNeeds(s, view(s));
  if (!pn || !pn.ready) return { ok: false, code: 'locked', reason: 'Rome would not yet hear our petition.' };
  if (!pn.affordable) return { ok: false, code: 'unaffordable', reason: 'The petition fee is beyond our stores.' };
  pay(s, pn.fee);
  s.decisions.paths[decision] = option;
  s.decisions.pathDays[decision] = s.day;
  log(s, 'rank', `${PATH_DEFS[decision].name}: ${opt.name}.`, ['highlight', 'decided']);
  if (pn.rank !== null) rankUp(s, pn.rank);
  if (option === 'viaMilitaris') ceremonyPaving(s, 'via');
  if (pn.rank === COLONIA) startCapitolium(s);
  invalidate(s);
  return { ok: true };
}

/** Raises the colony's rank: rings and territory (invalidate), ceremony paving at Oppidum, log, fx rank. */
export function rankUp(s: GameState, rank: RankIndex): void {
  if (rank <= s.rank) return;
  s.rank = rank;
  invalidate(s);
  if (rank === OPPIDUM) ceremonyPaving(s, 'castrumAxes');
  log(s, 'rank', `Rome names ${s.name} a ${RANK_DEFS[rank].name}.`, ['highlight']);
  pushActionFx({ kind: 'rank', rank });
}

/** Whether an unlockable (edict, setting, switch, tool, overlay, section, cosmetic, victory) is unlocked. */
export function isUnlocked(s: GameState, ref: UnlockRef): boolean {
  // STUB(WP-D): milestone unlocks (DESIGN §9.4); the scaffold unlocks everything.
  void s; void ref;
  return true;
}
