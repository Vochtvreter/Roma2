// src/game/advisors/rules-augur.ts — the Augur's advisories: rules 21–22 (augur.choice, augur.petition)
// (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { RESOURCES } from '../types';
import type { AdvisorRule, AdvisoryEval } from '../types';
import { petitionNeeds } from '../decisions';
import { missing } from '../state';
import { RANK_DEFS } from '../data/ranks';
import { R, days, int, listJoin, netToday, resName, three } from './util';

const P = (x: unknown): number => (typeof x === 'number' ? x : 0);

// ───────────────────────────── 21 · augur.choice ─────────────────────────────

const choice: AdvisorRule = {
  id: 'augur.choice', advisor: 'augur',
  evaluate(s): AdvisoryEval | null {
    const c = s.choice;
    if (!c) return null;
    const d = Math.max(0, c.expires - s.day);
    return { rule: 'augur.choice', severity: d <= R.CHOICE_SOON ? 1 : 0, metric: { label: 'To decide', value: d, unit: 'days' }, params: { d, title: c.title } };
  },
  title: (_s, a) => `${String(a.params.title)}: ${days(P(a.params.d))} to decide.`,
  text(s) {
    const c = s.choice;
    const opt = c?.options[c.defaultIndex];
    if (!opt) return 'The dispatch awaits your answer.';
    return `If we are silent: ${opt.label}${opt.note ? ` (${opt.note.replace(/\.$/, '')})` : ''}.`;
  },
  remedies: () => three({ kind: 'open', tab: 'council', anchor: 'choice' }),
};

// ───────────────────────────── 22 · augur.petition ─────────────────────────────

const petition: AdvisorRule = {
  id: 'augur.petition', advisor: 'augur',
  evaluate(s, v): AdvisoryEval | null {
    const pn = petitionNeeds(s, v);
    if (!pn || !pn.ready || pn.rank === null) return null;
    const lack = missing(s, pn.fee);
    const parts: string[] = [];
    let eta = 0;
    for (const r of RESOURCES) {
      const q = lack[r] ?? 0;
      if (q <= 0) continue;
      parts.push(`${int(Math.ceil(q))} ${r === 'denarii' ? 'denarii' : resName(r)}`);
      const net = netToday(r);
      eta = eta < 0 || net === null || net <= 0 ? -1 : Math.max(eta, Math.ceil(q / net));
    }
    return { rule: 'augur.petition', severity: 1, params: { rank: pn.rank, lacking: listJoin(parts), eta: parts.length > 0 ? eta : 0 } };
  },
  title: (_s, a) => `Rome would hear our petition for ${RANK_DEFS[P(a.params.rank)]?.name ?? 'a new rank'}.`,
  text(_s, _v, a) {
    const p = a.params;
    if (!p.lacking) return 'Every requirement is met and the fee lies in the aerarium. The path you choose is for ever.';
    return P(p.eta) >= 0 ? `The Ordo saves ${p.lacking} for the fee (≈ ${days(P(p.eta))}).` : `We still lack ${p.lacking} for the fee.`;
  },
  remedies: () => three({ kind: 'open', tab: 'council', anchor: 'petition' }),
};

/** The Augur's rules, in RULES order. */
export const AUGUR_RULES: AdvisorRule[] = [choice, petition];
