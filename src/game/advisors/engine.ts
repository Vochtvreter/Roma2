// src/game/advisors/engine.ts — advisory evaluation, hysteresis, ordering, rendering, hush/mute (ARCHITECTURE §8.6,
// DESIGN §11.3–11.6). Owner: WP-E.
//
// Hysteresis (DESIGN §11.4), per rule and day:
//  · raise at once when evaluate() returns an eval (after `params.holdDays` consecutive days, when a rule asks for a
//    streak); a raise is logged when it is at Cave or above, and always emits fx {advisory};
//  · the threshold × CLEAR release lives in each rule's evaluate(): a raised rule keeps evaluating at its lowest
//    severity until its metric passes threshold × 1.25 (util.lowLadder / util.held); `clear()` may add a
//    rule-specific release condition;
//  · severity rises at once (that breaks a hush) and falls — or clears — only after DOWNGRADE_DAYS stable days, and
//    never before the advisory is MIN_LIFE days old;
//  · flap limit: `flips` holds the raise/clear days of the last FLAP_WINDOW days (alternating, newest last). A rule
//    already raised FLAP_MAX times in the window is not cleared but kept on the tablets as a quiet Nota
//    (`params.watch`), so no rule is raised more than FLAP_MAX times in any window and a real danger is never
//    suppressed.
//  · cadence: a rule with `every` (the house rules) is evaluated only when day % every == 0 and left untouched between.
import { B } from '../balance';
import { ADVISORS, RULES } from '../types';
import type {
  ActionResult, ActiveAdvisory, AdvisorId, AdvisorRule, AdvisoryEval, AdvisoryMemo, GameState, Remedy, RuleId, SimView, TickContext,
} from '../types';
import { nextSeasonStart } from '../calendar';
import { log } from '../state';
import { view } from '../sim';
import { ADVISOR_DEFS } from '../data/advisors';
import { checkRemedy, remedyLabel } from './remedies';
import { blockedHouses, lendRates, markAway, tidy } from './util';
import type { CadencedRule } from './util';
import { ANNONAE_RULES } from './rules-annonae';
import { AQUARUM_RULES } from './rules-aquarum';
import { FABRUM_RULES } from './rules-fabrum';
import { QUAESTOR_RULES } from './rules-quaestor';
import { AEDILIS_RULES } from './rules-aedilis';
import { AUGUR_RULES } from './rules-augur';

/** Every advisor rule in RULES order (one file per advisor). */
export const RULE_DEFS: AdvisorRule[] = [...ANNONAE_RULES, ...AQUARUM_RULES, ...FABRUM_RULES, ...QUAESTOR_RULES, ...AEDILIS_RULES, ...AUGUR_RULES];

const A = B.advisors;
const NOTA = 0, CAVE = 2, PERICULUM = 3;
const AUTUMNUS = 2;
const BY_ID = new Map<RuleId, AdvisorRule>(RULE_DEFS.map((r) => [r.id, r]));
/** Rules evaluated even before their advisor takes office: their first raise appoints him (DESIGN §11.3). */
const APPOINTING: readonly RuleId[] = ['quaestor.coin'];
/** Rules that never alarm their advisor's portrait (the gold Opportunitas). */
const CALM: readonly RuleId[] = ['augur.petition'];
/** target → the rules that hide it while they are active at ≥ its severity (DESIGN §11.4 supersede). */
const HIDDEN_BY = new Map<RuleId, RuleId[]>();
for (const r of RULE_DEFS) for (const t of r.supersedes ?? []) HIDDEN_BY.set(t, [...(HIDDEN_BY.get(t) ?? []), r.id]);
const WATCH_NOTE = 'It has come and gone twice of late; I keep it on my tablets until it stays away.';

/** The advisor a rule belongs to (its id prefix). */
function advisorOf(rule: RuleId): AdvisorId {
  return rule.slice(0, rule.indexOf('.')) as AdvisorId;
}

/** Daily counsel: appoint, evaluate the 22 rules with hysteresis, supersede, flips, log new ≥ Cave or raised, fx advisory. */
export function advisorsDay(s: GameState, ctx: TickContext, v: SimView): void {
  if (ctx.offline) markAway(s);
  appointAdvisors(s);
  lendRates(ctx.rates);
  try {
    for (const rule of RULE_DEFS) step(s, ctx, v, rule);
  } finally {
    lendRates(null);
  }
}

function step(s: GameState, ctx: TickContext, v: SimView, rule: CadencedRule): void {
  const day = s.day;
  if (rule.every && day % rule.every !== 0) return;
  const appointed = s.guidance.appointed.includes(rule.advisor);
  const e = appointed || APPOINTING.includes(rule.id) ? attempt(() => rule.evaluate(s, v), null) : null;   // a faulty rule never stops the tick
  const m = s.guidance.advisories[rule.id];
  if (m && m.flips.length > 0 && day - m.flips[0] >= A.FLAP_WINDOW) m.flips = m.flips.filter((d) => day - d < A.FLAP_WINDOW);
  if (!m || !m.active) {
    if (!e) {
      if (m && m.params.streakFrom !== undefined) m.params = {};
      return;
    }
    const hold = typeof e.params.holdDays === 'number' ? e.params.holdDays : 0;
    const from = m && typeof m.params.streakFrom === 'number' ? m.params.streakFrom : day;
    if (day - from + 1 < hold) {
      if (m) m.params = { streakFrom: from };
      else s.guidance.advisories[rule.id] = { rule: rule.id, active: false, sev: NOTA, since: day, lowerSince: null, params: { streakFrom: from }, flips: [] };
      return;
    }
    if (!appointed) appoint(s, rule.advisor);
    raise(s, ctx, rule, m, e);
  } else if (e) {
    update(s, ctx, rule, m, e);
  } else {
    fade(s, v, rule, m);
  }
}

function raise(s: GameState, ctx: TickContext, rule: AdvisorRule, prev: AdvisoryMemo | undefined, e: AdvisoryEval): void {
  const flips = prev ? prev.flips : [];
  flips.push(s.day);
  const m: AdvisoryMemo = { rule: rule.id, active: true, sev: e.severity, since: s.day, lowerSince: null, params: { ...e.params }, flips };
  if (e.metric) m.metric = { ...e.metric };
  s.guidance.advisories[rule.id] = m;
  announce(s, ctx, rule, m);
}

function update(s: GameState, ctx: TickContext, rule: AdvisorRule, m: AdvisoryMemo, e: AdvisoryEval): void {
  m.params = { ...e.params };
  if (e.metric) m.metric = { ...e.metric };
  else delete m.metric;
  if (e.severity > m.sev) {
    m.sev = e.severity;
    m.lowerSince = null;
    delete m.snoozeUntil;
    announce(s, ctx, rule, m);
  } else if (e.severity < m.sev) {
    if (m.lowerSince === null) m.lowerSince = s.day;
    else if (s.day - m.lowerSince >= A.DOWNGRADE_DAYS) { m.sev = e.severity; m.lowerSince = null; }
  } else {
    m.lowerSince = null;
  }
}

/** The rule no longer holds: clear after DOWNGRADE_DAYS stable days and MIN_LIFE, unless it is flapping. */
function fade(s: GameState, v: SimView, rule: AdvisorRule, m: AdvisoryMemo): void {
  const day = s.day;
  if (rule.clear && !rule.clear(s, v, m)) { m.lowerSince = null; return; }
  if (m.lowerSince === null) { m.lowerSince = day; return; }
  if (day - m.lowerSince < A.DOWNGRADE_DAYS || day - m.since < A.MIN_LIFE) return;
  if (raisesIn(m) >= A.FLAP_MAX) {
    if (m.params.watch !== 1) { m.sev = NOTA; m.params = { ...m.params, watch: 1 }; }
    return;
  }
  m.active = false;
  m.lowerSince = null;
  m.flips.push(day);
  delete m.snoozeUntil;
}

/** Raises within the flap window: flips alternate raise/clear and end with a raise while the memo is active. */
function raisesIn(m: AdvisoryMemo): number {
  return m.active ? Math.ceil(m.flips.length / 2) : Math.floor(m.flips.length / 2);
}

/** fx for every new or risen advisory; an Annales line when it is (or rises to) Cave or above. Hidden ones stay quiet. */
function announce(s: GameState, ctx: TickContext, rule: AdvisorRule, m: AdvisoryMemo): void {
  if (hidden(s, rule.id, m)) return;
  ctx.fx.push({ kind: 'advisory', rule: rule.id, sev: m.sev });
  if (m.sev < CAVE) return;
  const title = tidy(attempt(() => rule.title(s, m), ''));
  if (title) log(s, 'advisor', `${ADVISOR_DEFS[rule.advisor].office}: ${title}`, m.sev >= PERICULUM ? ['highlight'] : undefined);
}

/** True while a superseding rule is active at ≥ this memo's severity (famine hides the run-out, both hide the mess). */
function hidden(s: GameState, rule: RuleId, m: AdvisoryMemo): boolean {
  for (const by of HIDDEN_BY.get(rule) ?? []) {
    const o = s.guidance.advisories[by];
    if (o?.active && o.params.watch !== 1 && o.sev >= m.sev) return true;
  }
  return false;
}

/** Active advisories by severity, advisor tie order, age, rule order; superseded ones and muted Notas are left out; forCard also drops every Nota and the hushed (below Periculum). */
export function activeAdvisories(s: GameState, opts?: { forCard?: boolean }): ActiveAdvisory[] {
  const out: ActiveAdvisory[] = [];
  for (const rule of RULES) {
    const m = s.guidance.advisories[rule];
    if (!m || !m.active || hidden(s, rule, m)) continue;
    if (m.sev === NOTA && (opts?.forCard || s.guidance.muted.includes(rule))) continue;
    if (opts?.forCard && m.snoozeUntil !== undefined && m.snoozeUntil > s.day && m.sev < PERICULUM) continue;
    out.push({ rule, advisor: advisorOf(rule), memo: m });
  }
  return out.sort((a, b) => b.memo.sev - a.memo.sev
    || ADVISOR_DEFS[a.advisor].order - ADVISOR_DEFS[b.advisor].order
    || a.memo.since - b.memo.since
    || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
}

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Render-time title, text and pre-checked remedies (1–3) of an advisory; never throws. */
export function renderAdvisory(s: GameState, v: SimView, a: ActiveAdvisory): { title: string; text: string; remedies: { remedy: Remedy; label: string; check: ActionResult }[] } {
  const def = BY_ID.get(a.rule);
  if (!def) return { title: a.rule, text: '', remedies: [] };
  let title = attempt(() => def.title(s, a.memo), ADVISOR_DEFS[def.advisor].office);
  let text = attempt(() => def.text(s, v, a.memo), '');
  if (a.memo.params.watch === 1) {
    title = `Watching: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
    text = `${text} ${WATCH_NOTE}`.trim();
  }
  const list = attempt(() => def.remedies(s, v, a.memo), [] as Remedy[]).slice(0, 3);
  return { title: tidy(title), text: tidy(text), remedies: list.map((remedy) => ({ remedy, label: remedyLabel(s, remedy), check: checkRemedy(s, remedy) })) };
}

/** An advisor's portrait mood from their worst visible severity: 0 calm, 1 concerned (Monitum/Cave), 2 alarmed (Periculum). */
export function advisorMood(s: GameState, id: AdvisorId): 0 | 1 | 2 {
  let worst = -1;
  for (const a of activeAdvisories(s)) {
    if (a.advisor === id && !CALM.includes(a.rule) && a.memo.sev > worst) worst = a.memo.sev;
  }
  return worst >= PERICULUM ? 2 : worst > NOTA ? 1 : 0;
}

function appoint(s: GameState, id: AdvisorId): void {
  if (s.guidance.appointed.includes(id)) return;
  s.guidance.appointed = ADVISORS.filter((a) => a === id || s.guidance.appointed.includes(a));
  const d = ADVISOR_DEFS[id];
  log(s, 'advisor', `${d.name} takes office as ${d.office}.`);
}

/** Appoints advisors whose domain has become relevant (DESIGN §11.3): the Quaestor at Vicus or the first contract (or his first coin advisory, in advisorsDay); the Aedilis at Vicus or a house blocked ≥ 5 days; the Augur at the first event card or Kal. Sept. of the founding year. */
export function appointAdvisors(s: GameState): void {
  if (s.guidance.appointed.length >= ADVISORS.length) return;
  const has = (id: AdvisorId): boolean => s.guidance.appointed.includes(id);
  const vicus = s.rank >= 1;
  if (!has('quaestor') && (vicus || s.trade.contracts.length > 0)) appoint(s, 'quaestor');
  if (!has('aedilis') && (vicus || blockedHouses(s, view(s), A.APPOINT_BLOCKED).some((w) => w.want !== 'rank'))) appoint(s, 'aedilis');
  if (!has('augur') && (s.choice !== null || Object.keys(s.eventDays).length > 0 || s.day >= nextSeasonStart(B.time.START_DAY, AUTUMNUS))) {
    appoint(s, 'augur');
  }
}

/** Hushes an advisory for HUSH_DAYS (Nota, Monitum and Cave; never Periculum). */
export function hush(s: GameState, rule: RuleId): ActionResult {
  const m = s.guidance.advisories[rule];
  if (!m || !m.active) return { ok: false, code: 'notFound', reason: 'That advice is no longer given.' };
  if (m.sev >= PERICULUM) return { ok: false, code: 'invalid', reason: 'A Periculum cannot be hushed.' };
  m.snoozeUntil = s.day + A.HUSH_DAYS;
  return { ok: true };
}

/** Mutes a rule's Notas for good (only while it is no more than a Nota). */
export function mute(s: GameState, rule: RuleId): ActionResult {
  if (!RULES.includes(rule)) return { ok: false, code: 'invalid', reason: 'No such counsel.' };
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
