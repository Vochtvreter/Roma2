// src/ui/choice.ts — the event card (ARCHITECTURE §13.3, DESIGN §15.4). Owner: WP-I.
// Shows s.choice at the top centre; options → actions.chooseOption. SCAFFOLD: title, text, option buttons, default line.
import type { Game } from './types';
import { clear, costEl, h } from './dom';
import { chooseOption } from '../game/actions';
import { canAfford } from '../game/state';
import { B } from '../game/balance';

/** The event card in #choice. */
export class ChoiceCard {
  private sig = '';
  private last = -Infinity;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    root.hidden = true;
  }

  /** Throttled: rebuilds when the pending choice or affordability changes. */
  frame(now: number): void {
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    const s = this.g.state;
    const c = s.choice;
    const sig = c ? `${c.event}:${c.created}:${c.options.map((o) => (o.cost ? (canAfford(s, o.cost) ? 1 : 0) : 1)).join('')}` : '';
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.root);
    this.root.hidden = !c;
    if (!c) return;
    this.root.appendChild(h('div', { class: 'card choice-card' },
      h('div', { class: 'kicker' }, c.kicker),
      h('div', { class: 'choice-title' }, c.title),
      h('p', null, c.text),
      h('div', { class: 'choice-opts' }, c.options.map((o, i) => h('button', {
        class: 'btn small', disabled: !!o.cost && !canAfford(s, o.cost),
        onclick: () => { this.g.act(chooseOption(this.g.state, i)); },
      }, o.label, o.cost ? costEl(s, o.cost) : null))),
      h('div', { class: 'muted' }, `If you do not decide, your people will choose "${c.options[c.defaultIndex]?.label ?? ''}".`)));
  }
}
