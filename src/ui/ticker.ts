// src/ui/ticker.ts — the one ticker (DESIGN §15.1): the Ordo line and the Acta merged, rotating every B.ui.TICKER_S —
// current Ordo action, next wish, saving line, latest Annales line (a new line shows at once). Click → the Agenda. Owner: WP-H.
import type { LogEntry, WishView } from '../game/types';
import type { Game } from './types';
import { clear, fmtCost, h, img, tip } from './dom';
import { councilReport } from '../game/ordo/index';
import { reasonShort } from '../game/ordo/reasons';
import { formatRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { B } from '../game/balance';

interface Line { kicker: string; text: string; kind: string }

const WISH_STATE: Record<WishView['state'], string> = {
  staked: 'Staked', building: 'Raising', saving: 'Saving for', waiting: 'Waiting on', proposed: 'Next',
};
const SAVING_FOR: Record<string, string> = { petition: 'the petition', plan: 'your plan', pin: 'your pinned work', request: 'your request', wish: 'the next work' };

function wishLine(w: WishView, day: number): Line {
  const eta = w.eta !== undefined && w.eta > day ? ` (≈ ${w.eta - day} d)` : '';
  return { kicker: 'AGENDA', text: `${WISH_STATE[w.state]}: ${BUILDING_DEFS[w.type].name}${eta} · ${reasonShort(w.reason)}`, kind: 'next' };
}

function actaLine(e: LogEntry): Line {
  return { kicker: 'ACTA', text: `${formatRoman(e.day)} · ${e.text}`, kind: `acta ${e.kind}` };
}

/** The merged lines in rotation order. */
function lines(g: Game): Line[] {
  const s = g.state;
  const rep = councilReport(s);
  const out: Line[] = rep.ticker.slice(0, 2).map((r) => ({ kicker: 'ORDO', text: reasonShort(r), kind: 'ordo' }));
  if (rep.agenda[0]) out.push(wishLine(rep.agenda[0], s.day));
  if (rep.saving) out.push({ kicker: 'ORDO', text: `Saving ${fmtCost(rep.saving.cost)} for ${SAVING_FOR[rep.saving.for] ?? rep.saving.for}`, kind: 'saving' });
  const last = s.log[s.log.length - 1];
  if (last) out.push(actaLine(last));
  return out;
}

/** The ticker in #ticker. */
export class Ticker {
  private k = 0;
  private turnAt = 0;
  private lastLog: LogEntry | null = null;
  private shown = '';
  private readonly kicker = h('span', { class: 'tick-kicker' });
  private readonly text = h('span', { class: 'tick-text' });

  constructor(private readonly g: Game, root: HTMLElement) {
    clear(root);
    const box = h('button', { class: 'tick-box', 'aria-label': 'The Ordo: open the Agenda', onclick: () => { g.sfx('click'); g.openTab('build', 'agenda'); } },
      img('i_seal', 2, 'tick-seal'), this.kicker, this.text);
    tip(box, () => {
      const all = lines(g);
      return all.length ? all.map((l) => `${l.kicker} · ${l.text}`).join('\n') : 'The Ordo Decurionum has nothing to report.';
    }, { wide: true });
    root.appendChild(box);
  }

  /** Rotates every TICKER_S; a new Annales line jumps the queue. */
  update(now: number): void {
    const s = this.g.state;
    const all = lines(this.g);
    const last = s.log[s.log.length - 1] ?? null;
    if (last !== this.lastLog) {
      const fresh = this.lastLog !== null;
      this.lastLog = last;
      if (fresh && all.length) { this.k = all.length - 1; this.turnAt = now; }
    }
    if (now - this.turnAt >= B.ui.TICKER_S * 1000) { this.turnAt = now; this.k++; }
    if (!all.length) { this.set({ kicker: 'ORDO', text: 'The council sits in session.', kind: 'ordo' }); return; }
    this.set(all[this.k % all.length]);
  }

  private set(l: Line): void {
    const key = `${l.kicker}|${l.text}`;
    if (key === this.shown) return;
    const sameKind = this.shown.startsWith(`${l.kicker}|`);
    this.shown = key;
    this.kicker.textContent = l.kicker;
    this.text.textContent = l.text;
    this.text.parentElement?.setAttribute('data-kind', l.kind);
    if (!sameKind) {
      this.text.classList.remove('tick-in');
      void this.text.offsetWidth;
      this.text.classList.add('tick-in');
    }
  }
}
