// src/game/events.ts — the events framework: festivals, the gate party, choice cards and their defaults, the paced
// random roll, the Legate's relief and bandits (ARCHITECTURE §8.5, DESIGN §12). Owner: WP-D.
// Pacing (real time): no random event before elapsed day START; one daily roll of CHANCE; at most one card pending and
// ≥ CHOICE_GAP days between cards; ≥ HARMFUL_GAP days between harmful events. Offline: benign instant events only,
// rolled on half the days; no new cards except the auto-accepted relief; a pending card resolves at expiry to its
// default. This module is the one place that branches on ctx.offline for events (ARCHITECTURE §10.6).
import { B } from './balance';
import { EVENTS, RESOURCES } from './types';
import type { ActionResult, Caravan, EventId, GameState, SimView, TickContext } from './types';
import { Rng, withRng } from './rng';
import { elapsed } from './calendar';
import { fx } from './fx';
import { pushActionFx } from './memo';
import { canAfford, log, NEVER, pay } from './state';
import { newCtx, view } from './sim';
import { spawnMerchant } from './trade';
import { applyFrigus, EVENT_DEFS } from './events-catalogue';
import type { EvCtx, EventDef } from './events-catalogue';
import { festivalsDay } from './events-festivals';
import { HUB_DEFS } from './data/hubs';
import { RESOURCE_DEFS } from './data/resources';

const E = B.events;
const RELIEF_STREAM = 0x5bd1e995;

/** Whether the daily roll may draw this event today (cooldown, pacing, offline rules; conditions are its weight). */
function eligible(s: GameState, def: EventDef, offline: boolean): boolean {
  if (!def.roll) return false;
  if (offline && (!def.benign || def.kind === 'choice')) return false;
  if (def.kind === 'choice' && (s.choice !== null || s.day - s.counters.lastChoiceDay < E.CHOICE_GAP)) return false;
  if (def.harmful && s.day - s.counters.lastHarmfulDay < E.HARMFUL_GAP) return false;
  return s.day - (s.eventDays[def.id] ?? NEVER) >= def.cooldown;
}

/** Applies answer `index` of the pending card: cost, gain, the event's own resolution, one Annales line. */
function resolveChoice(s: GameState, index: number, ev: EvCtx): void {
  const c = s.choice;
  if (!c) return;
  const opt = c.options[index];
  if (opt.cost) pay(s, opt.cost);
  if (opt.gain) for (const r of RESOURCES) s.res[r] += opt.gain[r] ?? 0;
  s.choice = null;
  const line = EVENT_DEFS[c.event].resolve?.(s, opt.key, ev, c) ?? `${c.title}: ${opt.label}.`;
  log(s, 'event', line, ev.auto ? ['highlight', 'decided'] : ['highlight']);
}

/** The option silence takes: the default, or if unaffordable the first affordable after it (wrapping). */
export function silentOption(s: GameState): number {
  const c = s.choice;
  if (!c) return -1;
  for (let k = 0; k < c.options.length; k++) {
    const i = (c.defaultIndex + k) % c.options.length;
    const cost = c.options[i].cost;
    if (!cost || canAfford(s, cost)) return i;
  }
  return c.defaultIndex;
}

/** Resolves the pending card as if nobody answered (expiry, or making way for the relief). */
function resolveSilently(s: GameState, rng: Rng, ctx: TickContext, v: SimView): void {
  if (!s.choice) return;
  resolveChoice(s, silentOption(s), { rng, tc: ctx, v, auto: true });
}

/** Daily: festivals, Hiems dura, the coloni rescue, choice expiry (default), gate-party expiry, the paced random roll. */
export function eventsDay(s: GameState, ctx: TickContext, rng: Rng, v: SimView): void {
  festivalsDay(s, ctx);
  applyFrigus(s);
  if (EVENT_DEFS.coloni.weight(s, v) > 0) fireEvent(s, ctx, rng, v, 'coloni');
  if (s.choice && s.day >= s.choice.expires) resolveSilently(s, rng, ctx, v);
  if (s.gate && s.day >= s.gate.until) {
    s.gate = null;
    log(s, 'event', 'The veterans strike their tents and take the via; no word came from the principia.');
  }
  if (elapsed(s) < E.START) return;
  if (ctx.offline && !rng.chance(E.OFFLINE_ROLL)) return;
  if (!rng.chance(E.CHANCE)) return;
  const pool: { w: number; v: EventId }[] = [];
  for (const id of EVENTS) {
    const def = EVENT_DEFS[id];
    if (!eligible(s, def, ctx.offline)) continue;
    const w = def.weight(s, v);
    if (w > 0) pool.push({ w, v: id });
  }
  const id = rng.weighted(pool);
  if (id) fireEvent(s, ctx, rng, v, id);
}

/** The player answers the pending choice card with option `index`. */
export function chooseOption(s: GameState, index: number): ActionResult {
  const c = s.choice;
  if (!c) return { ok: false, code: 'noChoice', reason: 'Nothing awaits an answer.' };
  const opt = c.options[index];
  if (!opt) return { ok: false, code: 'invalid', reason: 'No such answer.' };
  if (opt.cost && !canAfford(s, opt.cost)) return { ok: false, code: 'unaffordable', reason: 'We cannot afford that answer.' };
  const tc = newCtx();
  const v = view(s);
  withRng(s, (rng) => resolveChoice(s, index, { rng, tc, v, auto: false }));
  for (const e of tc.fx) pushActionFx(e);
  return { ok: true };
}

/** Starts one event now if its conditions hold (used by eventsDay and tests); true when it started. Ignores pacing. */
export function fireEvent(s: GameState, ctx: TickContext, rng: Rng, v: SimView, id: EventId): boolean {
  const def = EVENT_DEFS[id];
  if (!def) return false;
  if (def.kind === 'choice' && s.choice !== null) return false;
  if (def.weight(s, v) <= 0) return false;
  const started = id === 'mercator' ? spawnMerchant(s, rng) : def.start(s, { rng, tc: ctx, v, auto: false });
  if (!started) return false;
  s.eventDays[id] = s.day;
  if (def.kind === 'choice') s.counters.lastChoiceDay = s.day;
  if (def.harmful) s.counters.lastHarmfulDay = s.day;
  if (id !== 'mercator') ctx.fx.push({ kind: 'event', id });
  return true;
}

/** The Legate's relief card (DESIGN §8.12 step 4): once per RELIEF_COOLDOWN; offline it is accepted at once. */
export function triggerRelief(s: GameState, ctx: TickContext, v: SimView): void {
  if (s.choice?.event === 'mutuum') return;
  if (s.day - s.ordo.emergency.lastRelief < B.emergency.RELIEF_COOLDOWN) return;
  const rng = new Rng((s.rng ^ RELIEF_STREAM) | 0);          // a side stream: triggerRelief has no tick rng (state-derived, deterministic)
  if (s.choice) resolveSilently(s, rng, ctx, v);             // famine first: an older card takes its default
  if (!fireEvent(s, ctx, rng, v, 'mutuum')) return;
  log(s, 'emergency', 'The Legate offers the legion\'s grain.', ['highlight']);
  if (ctx.offline) resolveChoice(s, 0, { rng, tc: ctx, v, auto: true });
}

/** Bandits on a long road (one-way ≥ BANDIT_DAYS): BANDIT_P × fx(bandits) to lose BANDIT_LOSS of the cargo. Never offline. */
export function banditCheck(s: GameState, ctx: TickContext, rng: Rng, caravan: Caravan): void {
  if (ctx.offline || caravan.kind !== 'contract') return;
  if ((caravan.arrive - caravan.depart) / 2 < E.BANDIT_DAYS) return;
  if (s.day - s.counters.lastHarmfulDay < E.HARMFUL_GAP) return;
  if (!rng.chance(E.BANDIT_P * fx(s, 'bandits'))) return;
  const what = RESOURCE_DEFS[caravan.res].name.toLowerCase();
  if (caravan.mode === 'export') caravan.value *= 1 - E.BANDIT_LOSS;
  else caravan.qty *= 1 - E.BANDIT_LOSS;
  s.eventDays.latrones = s.day;
  s.counters.lastHarmfulDay = s.day;
  ctx.fx.push({ kind: 'event', id: 'latrones' });
  const lost = caravan.mode === 'export' ? 'the purse' : `the ${what}`;
  log(s, 'bad', `Latrones! Bandits fell on our caravan from ${HUB_DEFS[caravan.hub].name} and took ${Math.round(E.BANDIT_LOSS * 100)}% of ${lost}.`, ['highlight']);
}
