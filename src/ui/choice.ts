// src/ui/choice.ts — the event card (ARCHITECTURE §13.3, DESIGN §12.1, §15.4). Owner: WP-I.
// Shows s.choice at the top centre: Latin kicker, title, text, options with −cost / +gain chips (disabled with a reason
// when unaffordable), the default marked, a countdown; veterans show each family's skills and the free beds.
import { RESOURCES } from '../game/types';
import type { Cost, GameState, PendingChoice } from '../game/types';
import type { Game, Updater } from './types';
import { clear, fmt, fmtCost, h, img, plural, realTime, tip } from './dom';
import * as A from '../game/actions';
import { ageOf, census } from '../game/census';
import { personName } from '../game/people';
import { missing } from '../game/state';
import { B } from '../game/balance';
import { feminine } from '../game/data/names';
import { resIcon } from '../render/art/index';
import { btn, caps } from './tabs/common';

const PULSE_MS = 1600;

function chips(c: Cost, sign: '−' | '+', s: GameState): HTMLElement {
  return h('span', { class: 'cost' }, RESOURCES.filter((r) => (c[r] ?? 0) > 0).map((r) => {
    const short = sign === '−' && s.res[r] < (c[r] ?? 0);
    return h('span', { class: `chip ${short ? 'bad' : sign === '+' ? 'good' : ''}` }, img(resIcon(r), 1, 'chip-ico'), `${sign}${fmt(c[r] ?? 0)}`);
  }));
}

function shortReason(s: GameState, cost: Cost | undefined): string | null {
  if (!cost) return null;
  const m = missing(s, cost);
  return RESOURCES.some((r) => (m[r] ?? 0) > 0) ? `We lack ${fmtCost(m)}.` : null;
}

/** Veterans at the gate: each family's head, skills and size, and our free beds (DESIGN §12.2). */
function gate(g: Game): HTMLElement | null {
  const s = g.state;
  if (!s.gate) return null;
  return h('div', { class: 'choice-gate' }, s.gate.families.map(({ family, people }) => {
    const head = people.find((p) => p.id === family.head) ?? people[0];
    const skills = Object.entries(head?.skills ?? {}).filter(([, v]) => (v ?? 0) >= 1);
    return h('div', { class: 'choice-fam' }, h('b', null, `gens ${feminine(family.gens)}`),
      ` · ${head ? `${personName(head)}, ${ageOf(head, s.day)}` : ''} · ${plural(people.length, 'soul', 'souls')} `,
      skills.map(([k, v]) => h('span', { class: 'chip gold' }, `${k} ${Math.floor(v ?? 0)}`)));
  }), h('div', { class: 'choice-beds muted' }, `Free beds in the colony: ${census(s).freeBeds}`));
}

/** The event card in #choice. */
export class ChoiceCard {
  private sig = '';
  private last = -Infinity;
  private lastClick = -Infinity;
  private ups: Updater[] = [];
  private folded = false;
  private folding: PendingChoice | null = null;
  private shown = '';                         // the dispatch on screen: only a new one slides in, a refresh stays put

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'A dispatch awaits your answer');
    root.addEventListener('pointerdown', () => { this.lastClick = performance.now(); });
  }

  /** "Read the dispatch": unfolds the pending card at once and pulses it; false when no dispatch is pending. */
  reveal(): boolean {
    if (!this.g.state.choice) return false;
    this.folded = false;
    this.last = -Infinity;
    this.lastClick = -Infinity;
    this.frame(performance.now());
    const card = this.root.querySelector<HTMLElement>('.choice-card');
    if (card) {
      card.classList.add('side-pulse');
      window.setTimeout(() => card.classList.remove('side-pulse'), PULSE_MS);
    }
    return true;
  }

  /** Throttled: rebuilds when the pending choice, an option's affordability or the fold changes; else ticks the countdown. */
  frame(now: number): void {
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    const s = this.g.state;
    const c = s.choice;
    if (c !== this.folding) { this.folding = c; this.folded = false; }
    const sig = c ? `${c.event}:${c.created}:${c.options.map((o) => +!shortReason(s, o.cost)).join('')}:${+this.folded}:${s.gate ? s.gate.families.length : 0}` : '';
    if (sig !== this.sig && (now - this.lastClick > B.ui.CLICK_GUARD_MS || !c)) this.build(c, sig);
    else for (const u of this.ups) u();
  }

  private build(c: PendingChoice | null, sig: string): void {
    const g = this.g;
    const s = g.state;
    this.sig = sig;
    this.ups = [];
    clear(this.root);
    this.root.hidden = !c;
    if (!c) return;
    const def = c.options[c.defaultIndex];
    const left = h('span', { class: 'chip choice-left num' });
    const meter = h('i');
    const silent = h('div', { class: 'choice-silent' });
    const tickDown = (): void => {
      const st = g.state;
      const days = Math.max(0, c.expires - st.day);
      left.textContent = `${days} d`;
      meter.style.width = `${Math.round((days / Math.max(1, c.expires - c.created)) * 100)}%`;
      silent.textContent = `If we are silent for ${days} ${days === 1 ? 'day' : 'days'}: ${def?.label ?? 'the cautious course'}.`;
      left.classList.toggle('bad', days <= B.advisors.RULES.CHOICE_SOON);
    };
    tickDown();
    this.ups.push(tickDown);
    tip(left, () => realTime(Math.max(0, c.expires - g.state.day), g.speed));
    const fold = h('button', { class: 'btn small ghost choice-fold', type: 'button', 'aria-expanded': String(!this.folded), 'aria-label': this.folded ? 'Open the dispatch' : 'Fold the dispatch',
      onclick: () => { this.folded = !this.folded; this.last = -Infinity; this.lastClick = -Infinity; } }, this.folded ? '▾' : '▴');
    const id = `${c.event}:${c.created}`;
    const enter = id !== this.shown ? ' enter' : '';
    this.shown = id;
    const head = h('div', { class: 'choice-head' }, img('f_seal', 2, 'choice-seal'),
      h('div', { class: 'choice-titles' }, h('div', { class: 'kicker choice-kicker' }, caps(c.kicker)), h('div', { class: 'choice-title' }, c.title)), left, fold);
    if (this.folded) {
      this.root.append(h('div', { class: `card choice-card folded${enter}` }, head, h('div', { class: 'meter choice-meter' }, meter)));
      return;
    }
    const opts = h('div', { class: 'choice-opts' }, c.options.map((o, i) => {
      const reason = shortReason(s, o.cost);
      const body = [h('span', { class: 'choice-opt-label' }, o.label, i === c.defaultIndex ? h('span', { class: 'chip choice-default' }, 'if silent') : null),
        o.note ? h('span', { class: 'choice-opt-note' }, o.note) : null,
        o.cost || o.gain ? h('span', { class: 'choice-opt-cost' }, o.cost ? chips(o.cost, '−', s) : null, o.gain ? chips(o.gain, '+', s) : null) : null];
      return btn(g, body, () => A.chooseOption(g.state, i), { cls: `choice-opt${i === c.defaultIndex ? ' default' : ''}`, reason });
    }));
    this.root.append(h('div', { class: `card choice-card${enter}` }, head, h('p', { class: 'choice-text' }, c.text), gate(g), opts,
      h('div', { class: 'meter choice-meter' }, meter), silent));
  }
}
