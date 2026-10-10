// src/ui/objective.ts — the Res Gestae panel: current milestone, hint, meter, unlocks, CTA, danger chips (DESIGN §11.8). Owner: WP-H.
// SCAFFOLD: milestone text and progress (MILESTONES is empty until WP-D), petition CTA, Periculum chips.
import type { Game } from './types';
import { clear, h } from './dom';
import { MILESTONES, currentMilestone } from '../game/objectives';
import { petitionNeeds } from '../game/decisions';
import { activeAdvisories } from '../game/advisors/engine';
import { view } from '../game/sim';
import { toRoman } from '../game/calendar';
import { RANK_DEFS } from '../game/data/ranks';

/** The Res Gestae panel in #objective (signature-diffed). */
export class Objective {
  private sig = '';
  private meter: HTMLElement | null = null;
  private prog: HTMLElement | null = null;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Rebuilds when the milestone, CTA or danger chips change; otherwise refreshes the meter. */
  update(): void {
    const s = this.g.state;
    const m = currentMilestone(s);
    const pn = petitionNeeds(s, view(s));
    const danger = activeAdvisories(s).filter((a) => a.memo.sev === 3).map((a) => a.rule);
    const sig = `${m?.id ?? '-'}|${pn?.decision ?? '-'}|${pn?.ready ? 1 : 0}|${danger.join(',')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.build(m?.text ?? null, m?.hint ?? '', pn?.ready ? (pn.decision === 'charter' ? 'Charter: choose the founding law' : `Petition Rome: ${pn.rank !== null ? RANK_DEFS[pn.rank].name : ''}`) : null, danger);
    }
    if (m && this.meter && this.prog) {
      const [a, b] = m.progress(s);
      this.prog.textContent = `${Math.floor(a)} / ${b}`;
      this.meter.style.width = `${Math.round(Math.max(0, Math.min(1, b > 0 ? a / b : 0)) * 100)}%`;
    }
  }

  private build(text: string | null, hint: string, cta: string | null, danger: string[]): void {
    const g = this.g;
    clear(this.root);
    const idx = g.state.guidance.objective;
    this.meter = h('i', { class: 'meter-fill' });
    this.prog = h('span', { class: 'obj-prog num' });
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'kicker obj-kicker' }, `RES GESTAE · ${toRoman(Math.min(idx + 1, Math.max(1, MILESTONES.length)))} / ${toRoman(Math.max(1, MILESTONES.length))}`),
      text ? h('div', { class: 'obj-goal' }, text, ' ', this.prog) : h('div', { class: 'obj-goal muted' }, 'The colony keeps its own counsel.'),
      text && hint ? h('div', { class: 'obj-hint muted' }, hint) : null,
      text ? h('div', { class: 'meter' }, this.meter) : null,
      cta ? h('button', { class: 'btn legate small obj-cta', onclick: () => g.openTab('council') }, cta) : null,
      danger.length ? h('div', { class: 'obj-danger' }, danger.map((d) => h('span', { class: 'chip bad' }, d))) : null,
    ];
    for (const p of parts) if (p) this.root.appendChild(p);
  }
}
