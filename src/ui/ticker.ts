// src/ui/ticker.ts — the one ticker: Ordo line and Acta merged, rotating every 6 s (DESIGN §15.1). Owner: WP-H.
// SCAFFOLD: rotates the council's ticker reasons and the latest log line; click → Agenda (build tab).
import type { Game } from './types';
import { clear, h } from './dom';
import { councilReport } from '../game/ordo/index';
import { reasonShort } from '../game/ordo/reasons';
import { formatRoman } from '../game/calendar';

const ROTATE_MS = 6000;

/** The ticker in #ticker. */
export class Ticker {
  private k = 0;
  private lastRotate = 0;
  private readonly kicker = h('span', { class: 'kicker tick-kicker' }, 'ORDO');
  private readonly text = h('span', { class: 'tick-text' });

  constructor(private readonly g: Game, root: HTMLElement) {
    clear(root);
    root.appendChild(h('button', { class: 'tick-box', onclick: () => g.openTab('build', 'agenda') }, this.kicker, this.text));
  }

  /** Rotates the line every 6 s and refreshes its text. */
  update(now: number): void {
    if (now - this.lastRotate >= ROTATE_MS) { this.lastRotate = now; this.k++; }
    const s = this.g.state;
    const lines: { kicker: string; text: string }[] = councilReport(s).ticker.map((r) => ({ kicker: 'ORDO', text: reasonShort(r) }));
    const last = s.log[s.log.length - 1];
    if (last) lines.push({ kicker: 'ACTA', text: `${formatRoman(last.day)} · ${last.text}` });
    if (!lines.length) { this.text.textContent = ''; return; }
    const l = lines[this.k % lines.length];
    this.kicker.textContent = l.kicker;
    if (this.text.textContent !== l.text) this.text.textContent = l.text;
  }
}
