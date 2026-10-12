// src/ui/ticker.ts — the one ticker (DESIGN §15.1): the Ordo line and the Acta merged, rotating every B.ui.TICKER_S —
// current Ordo action, next wish, saving line, latest Annales line (a new line shows at once). Click → the Agenda. Owner: WP-H.
// On the phone SHEET the ticker is the voice line in calm (sheet.ts hosts it in the line's slot): an ACTA line opens the
// Annales there (the bar has no Annales slot), any other line the Agenda part-way.
import type { LogEntry, WishView } from '../game/types';
import type { Game } from './types';
import { clear, h, img, tip } from './dom';
import { councilReport } from '../game/ordo/index';
import { reasonShort } from '../game/ordo/reasons';
import { formatRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { B } from '../game/balance';
import { WISH_STATE, lacking, savingLine } from './tabs/common';
import { currentHost } from './layout';
import { tabShown } from './intro';

interface Line { kicker: string; text: string; kind: string }

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
  if (rep.saving) {
    const ready = rep.saving.for === 'petition' && !lacking(s, rep.saving.cost);
    out.push({ kicker: 'ORDO', text: ready ? 'Fee ready: petition Rome in Edicta' : savingLine(g, rep.saving), kind: 'saving' });
  }
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
  private kind = '';
  private named = '';
  private readonly kicker = h('span', { class: 'tick-kicker' });
  private readonly text = h('span', { class: 'tick-text' });
  private readonly box: HTMLButtonElement;

  constructor(private readonly g: Game, root: HTMLElement) {
    clear(root);
    const box = (this.box = h('button', { class: 'tick-box', onclick: () => {
      g.sfx('click');
      if (this.toAnnals()) g.openTab('annals');
      else g.openTab('build', 'agenda', 'chip');
    } }, img('i_seal', 2, 'tick-seal'), h('span', { class: 'tick-lines' }, this.kicker, this.text)));
    this.name();
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
    this.set(all.length ? all[this.k % all.length] : { kicker: 'ORDO', text: 'The council sits in session.', kind: 'ordo' });
    this.name();
  }

  /** A tap on an ACTA line opens the Annales on a phone's sheet (its bar has no Annales slot); else the Agenda. */
  private toAnnals(): boolean {
    return currentHost() === 'sheet' && this.kind.startsWith('acta') && tabShown(this.g.state, 'annals');
  }

  /** The button's name says where its tap goes now (the line shown, the host). */
  private name(): void {
    const n = this.toAnnals() ? 'Acta: open the Annales' : 'The Ordo: open the Agenda';
    if (n !== this.named) { this.named = n; this.box.setAttribute('aria-label', n); }
  }

  private set(l: Line): void {
    const key = `${l.kicker}|${l.text}`;
    if (key === this.shown) return;
    const sameKind = this.shown.startsWith(`${l.kicker}|`);
    this.shown = key;
    this.kind = l.kind;
    this.kicker.textContent = l.kicker;
    this.text.textContent = l.text;
    this.text.closest('.tick-box')?.setAttribute('data-kind', l.kind);
    if (!sameKind) {
      this.text.classList.remove('tick-in');
      void this.text.offsetWidth;
      this.text.classList.add('tick-in');
    }
  }
}
