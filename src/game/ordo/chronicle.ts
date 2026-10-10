// src/game/ordo/chronicle.ts — the Ordo's Annales lines and today's decisions for the ticker (DESIGN §10.6). Owner: WP-C.
// One Annales line per Ordo decision: when the acting module (placement, contract) already wrote a line about the entity,
// that line is rewritten with the Ordo's reason instead of adding a second one. Today's decisions live in a WeakMap
// (never saved, never read by the sim).
import type { GameState, LogKind, LogTag, Reason } from '../types';
import { log } from '../state';
import { reasonText } from './reasons';

const today = new WeakMap<GameState, { day: number; reasons: Reason[] }>();

/** Starts the council's day: the list of today's decisions begins empty. */
export function beginDay(s: GameState): void {
  today.set(s, { day: s.day, reasons: [] });
}

/** The decisions recorded today, in order (ticker material). */
export function decisionsToday(s: GameState): Reason[] {
  const t = today.get(s);
  return t && t.day === s.day ? t.reasons : [];
}

/** Writes the Annales line of an Ordo decision (rewriting today's line about `ref` if one exists) and records it for the ticker; `decided` marks it as done in the player's name. */
export function chronicle(s: GameState, kind: LogKind, reason: Reason, opts?: { ref?: number; decided?: boolean }): void {
  const text = reasonText(reason);
  const tags: LogTag[] | undefined = opts?.decided ? ['decided'] : undefined;
  let entry: GameState['log'][number] | undefined;
  if (opts?.ref !== undefined) {
    for (let i = s.log.length - 1; i >= 0 && s.log[i].day === s.day; i--) {
      if (s.log[i].ref === opts.ref) { entry = s.log[i]; break; }
    }
  }
  if (entry) {
    entry.kind = kind;
    entry.text = text;
    if (tags) entry.tags = [...new Set([...(entry.tags ?? []), ...tags])];
  } else {
    log(s, kind, text, tags, opts?.ref);
  }
  let t = today.get(s);
  if (!t || t.day !== s.day) { t = { day: s.day, reasons: [] }; today.set(s, t); }
  t.reasons.push(reason);
}
