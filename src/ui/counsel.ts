// src/ui/counsel.ts — the portrait strip and the one counsel card (ARCHITECTURE §13.5, DESIGN §15.1). Owner: WP-H.
// Exactly one item by priority: Periculum advisory › urgent tip › Cave advisory › tip (prefs.tips) › Monitum/Opportunitas
// advisory › calm line. SCAFFOLD: the priority rule, remedies, Hush, Mute, Understood and Show me work; styling is WP-H's.
import type { ActiveAdvisory, GuideStep } from '../game/types';
import type { Game } from './types';
import { clear, h, img } from './dom';
import { activeAdvisories, advisorMood, renderAdvisory } from '../game/advisors/engine';
import { dismissTip, hush, mute } from '../game/actions';
import { mentorKicker, nextTip } from '../game/guide';
import { currentMilestone } from '../game/objectives';
import { view } from '../game/sim';
import { ADVISOR_DEFS } from '../game/data/advisors';
import { portrait } from '../render/art/index';

type Item = { kind: 'advisory'; a: ActiveAdvisory } | { kind: 'tip'; t: GuideStep } | { kind: 'calm' };

function pick(g: Game): Item {
  const s = g.state;
  const adv = activeAdvisories(s, { forCard: true });
  const tipStep = nextTip(s);
  const bySev = (sev: number): ActiveAdvisory | undefined => adv.find((a) => a.memo.sev === sev);
  const peril = bySev(3);
  if (peril) return { kind: 'advisory', a: peril };
  if (tipStep?.urgent) return { kind: 'tip', t: tipStep };
  const cave = bySev(2);
  if (cave) return { kind: 'advisory', a: cave };
  if (tipStep && g.prefs.tips) return { kind: 'tip', t: tipStep };
  const low = adv[0];
  if (low) return { kind: 'advisory', a: low };
  return { kind: 'calm' };
}

/** The portrait strip and the counsel card in #counsel (signature-diffed). */
export class Counsel {
  private sig = '';

  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Rebuilds when the shown item or the strip changes. */
  update(): void {
    const s = this.g.state;
    const item = pick(this.g);
    const strip = s.guidance.appointed.map((a) => `${a}${advisorMood(s, a)}`).join(',');
    const key = item.kind === 'advisory' ? `a:${item.a.rule}:${item.a.memo.sev}:${item.a.memo.since}` : item.kind === 'tip' ? `t:${item.t.id}` : `c:${currentMilestone(s)?.id ?? ''}`;
    const sig = `${strip}|${key}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.build(item);
  }

  private build(item: Item): void {
    const g = this.g;
    const s = g.state;
    clear(this.root);
    const strip = h('div', { class: 'counsel-strip' }, s.guidance.appointed.map((a) =>
      h('button', { class: 'counsel-pt', 'aria-label': ADVISOR_DEFS[a].office, onclick: () => g.openTab('advisors', a) }, img(portrait(a, advisorMood(s, a)), 1))));
    this.root.appendChild(strip);
    if (item.kind === 'calm') {
      const m = currentMilestone(s);
      this.root.appendChild(h('div', { class: 'counsel-calm muted' }, `The council is content.${m ? ` Next: ${m.text}` : ''}`));
      return;
    }
    if (item.kind === 'tip') {
      const t = item.t;
      this.root.appendChild(h('div', { class: 'card counsel-card' },
        h('div', { class: 'counsel-head' }, img(portrait('mentor'), 1), h('span', { class: 'kicker' }, mentorKicker(s))),
        h('div', { class: 'counsel-title' }, t.title),
        h('p', { class: 'counsel-text' }, t.text(s)),
        h('div', { class: 'counsel-actions' },
          h('button', { class: 'btn small primary', onclick: () => { g.act(dismissTip(g.state, t.id)); } }, 'Understood'),
          t.tab ? h('button', { class: 'btn small', onclick: () => { if (t.tab) g.openTab(t.tab); } }, 'Show me') : null)));
      return;
    }
    const a = item.a;
    const r = renderAdvisory(s, view(s), a);
    const sev = a.memo.sev;
    this.root.appendChild(h('div', { class: `card counsel-card sev-${sev}` },
      h('div', { class: 'counsel-head' }, img(portrait(a.advisor, advisorMood(s, a.advisor)), 1), h('span', { class: 'kicker' }, ADVISOR_DEFS[a.advisor].office.toUpperCase())),
      h('div', { class: 'counsel-title' }, r.title, a.memo.metric ? h('span', { class: 'chip' }, `${Math.round(a.memo.metric.value)} ${a.memo.metric.unit}`) : null),
      h('p', { class: 'counsel-text' }, r.text),
      h('div', { class: 'counsel-actions' },
        r.remedies.slice(0, 3).map((x) => h('button', {
          class: 'btn small', disabled: !x.check.ok, onclick: () => g.applyRemedy(x.remedy),
        }, x.label)),
        sev < 3 ? h('button', { class: 'btn small ghost', onclick: () => { g.act(hush(g.state, a.rule)); } }, 'Hush 30 d') : null,
        sev === 0 ? h('button', { class: 'btn small ghost', onclick: () => { g.act(mute(g.state, a.rule)); } }, 'Mute') : null)));
  }
}
