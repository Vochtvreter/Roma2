// src/game/advisors/engine.ts — advisory evaluation, hysteresis, ordering, rendering, hush/mute (ARCHITECTURE §8.6, DESIGN §11.3–11.6). Owner: WP-E.
// SCAFFOLD: RULE_DEFS is empty (the rule files are stubs), so advisorsDay raises nothing; ordering, rendering, moods
// and hush/mute/unmute work on whatever memos exist.
import { B } from '../balance';
import { RULES } from '../types';
import type { ActionResult, ActiveAdvisory, AdvisorId, AdvisorRule, GameState, Remedy, RuleId, SimView, TickContext } from '../types';
import { ADVISOR_DEFS } from '../data/advisors';
import { checkRemedy, remedyLabel } from './remedies';
import { ANNONAE_RULES } from './rules-annonae';
import { AQUARUM_RULES } from './rules-aquarum';
import { FABRUM_RULES } from './rules-fabrum';
import { QUAESTOR_RULES } from './rules-quaestor';
import { AEDILIS_RULES } from './rules-aedilis';
import { AUGUR_RULES } from './rules-augur';

/** Every advisor rule in RULES order (one file per advisor). */
export const RULE_DEFS: AdvisorRule[] = [...ANNONAE_RULES, ...AQUARUM_RULES, ...FABRUM_RULES, ...QUAESTOR_RULES, ...AEDILIS_RULES, ...AUGUR_RULES];

const NOTA = 0, PERICULUM = 3;

/** The advisor a rule belongs to (its id prefix). */
function advisorOf(rule: RuleId): AdvisorId {
  return rule.slice(0, rule.indexOf('.')) as AdvisorId;
}

/** Daily counsel: evaluate, hysteresis (DESIGN §11.4), supersede, flips, appoint, log new ≥ Cave or raised, fx advisory. */
export function advisorsDay(s: GameState, ctx: TickContext, v: SimView): void {
  // STUB(WP-E): evaluation and hysteresis over RULE_DEFS (empty in the scaffold).
  void ctx; void v;
  appointAdvisors(s);
}

/** Active advisories sorted by severity, then advisor order, then rule order; forCard drops hushed, muted and Nota. */
export function activeAdvisories(s: GameState, opts?: { forCard?: boolean }): ActiveAdvisory[] {
  const out: ActiveAdvisory[] = [];
  for (const rule of RULES) {
    const memo = s.guidance.advisories[rule];
    if (!memo || !memo.active) continue;
    if (opts?.forCard) {
      if (memo.sev === NOTA || s.guidance.muted.includes(rule)) continue;
      if (memo.snoozeUntil !== undefined && memo.snoozeUntil > s.day) continue;
    }
    out.push({ rule, advisor: advisorOf(rule), memo });
  }
  return out.sort((a, b) => b.memo.sev - a.memo.sev
    || ADVISOR_DEFS[a.advisor].order - ADVISOR_DEFS[b.advisor].order
    || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
}

/** Render-time title, text and checked remedies of an advisory. */
export function renderAdvisory(s: GameState, v: SimView, a: ActiveAdvisory): { title: string; text: string; remedies: { remedy: Remedy; label: string; check: ActionResult }[] } {
  const def = RULE_DEFS.find((r) => r.id === a.rule);
  if (!def) return { title: a.rule, text: '', remedies: [] };
  return {
    title: def.title(s, a.memo),
    text: def.text(s, v, a.memo),
    remedies: def.remedies(s, v, a.memo).map((remedy) => ({ remedy, label: remedyLabel(s, remedy), check: checkRemedy(s, remedy) })),
  };
}

/** An advisor's portrait mood from their worst active severity: 0 calm, 1 concerned (Monitum/Cave), 2 alarmed (Periculum). */
export function advisorMood(s: GameState, id: AdvisorId): 0 | 1 | 2 {
  let worst = -1;
  for (const a of activeAdvisories(s)) if (a.advisor === id && a.memo.sev > worst) worst = a.memo.sev;
  return worst >= PERICULUM ? 2 : worst > NOTA ? 1 : 0;
}

/** Appoints advisors whose domain has become relevant (DESIGN §11.3). */
export function appointAdvisors(s: GameState): void {
  // STUB(WP-E): appointment triggers (Aedilis, Quaestor, Augur).
  void s;
}

/** Hushes an advisory for HUSH_DAYS (not for Periculum). */
export function hush(s: GameState, rule: RuleId): ActionResult {
  const m = s.guidance.advisories[rule];
  if (!m || !m.active) return { ok: false, code: 'notFound', reason: 'That advice is no longer given.' };
  if (m.sev >= PERICULUM) return { ok: false, code: 'invalid', reason: 'Periculum cannot be hushed.' };
  m.snoozeUntil = s.day + B.advisors.HUSH_DAYS;
  return { ok: true };
}

/** Mutes a rule for good (Nota only). */
export function mute(s: GameState, rule: RuleId): ActionResult {
  const m = s.guidance.advisories[rule];
  if (m && m.active && m.sev > NOTA) return { ok: false, code: 'invalid', reason: 'Only a Nota may be muted.' };
  if (!s.guidance.muted.includes(rule)) s.guidance.muted = RULES.filter((r) => r === rule || s.guidance.muted.includes(r));
  return { ok: true };
}

/** Unmutes a rule. */
export function unmute(s: GameState, rule: RuleId): ActionResult {
  s.guidance.muted = s.guidance.muted.filter((r) => r !== rule);
  return { ok: true };
}
