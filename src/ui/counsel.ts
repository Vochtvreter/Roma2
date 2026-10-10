// src/ui/counsel.ts — the portrait strip and the ONE counsel card (ARCHITECTURE §13.5, DESIGN §15.1, §11.1–11.7). Owner: WP-H.
// Exactly one item by priority: Periculum advisory › urgent tip › Cave advisory › tip (prefs.tips) › Monitum / Opportunitas
// advisory › calm line. Signature-diffed; the advisory's title and text re-render once a day; buttons are never rebuilt
// under the pointer within B.ui.CLICK_GUARD_MS of a click.
import { ADVISORS } from '../game/types';
import type { ActiveAdvisory, ActionResult, AdvisorId, BuildingId, GuideStep, Remedy } from '../game/types';
import type { Game } from './types';
import { clear, fmtDays, h, img, tip } from './dom';
import { caps } from './tipkit';
import { dangerLabel } from './objective';
import { activeAdvisories, advisorMood, renderAdvisory } from '../game/advisors/engine';
import { checkRemedy } from '../game/advisors/remedies';
import { dismissTip, hush, mute } from '../game/actions';
import { mentorKicker, nextTip } from '../game/guide';
import { currentMilestone } from '../game/objectives';
import { forecast } from '../game/forecast';
import { view } from '../game/sim';
import { ADVISOR_DEFS } from '../game/data/advisors';
import { BUILDING_DEFS } from '../game/data/buildings';
import { B } from '../game/balance';
import { portrait } from '../render/art/index';

/** The one item the card shows. */
export type CounselItem = { kind: 'advisory'; a: ActiveAdvisory } | { kind: 'tip'; t: GuideStep } | { kind: 'calm' };

const SEV_NAME = ['Nota', 'Monitum', 'Cave', 'Periculum'] as const;
const OPPORTUNITAS = 'augur.petition';
const PULSE_MS = 3000;
const PULSE_TRIES = 20;
const APPOINTED_AT: Partial<Record<AdvisorId, string>> = {
  quaestor: 'Appointed at Vicus, or with the first coin trouble', aedilis: 'Appointed at Vicus, or when a house is stuck',
  augur: 'Appointed with the first omen, or on Kal. Sept.',
};

/** The counsel priority rule (DESIGN §15.1): exactly one item. */
export function pickCounsel(g: Game): CounselItem {
  const s = g.state;
  const adv = activeAdvisories(s, { forCard: true });
  const tipStep = nextTip(s);
  const bySev = (sev: number): ActiveAdvisory | undefined => adv.find((a) => a.memo.sev === sev && a.rule !== OPPORTUNITAS);
  const peril = bySev(3);
  if (peril) return { kind: 'advisory', a: peril };
  if (tipStep?.urgent) return { kind: 'tip', t: tipStep };
  const cave = bySev(2);
  if (cave) return { kind: 'advisory', a: cave };
  if (tipStep && g.prefs.tips) return { kind: 'tip', t: tipStep };
  const low = adv.find((a) => a.memo.sev >= 1);   // Monitum or Opportunitas (ranks as Monitum, never above Cave)
  if (low) return { kind: 'advisory', a: low };
  return { kind: 'calm' };
}

/** Pulses a selector's element for 3 s (retries while a freshly opened tab builds). */
export function pulseTarget(selector: string): void {
  let tries = 0;
  const go = (): void => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) { if (++tries < PULSE_TRIES) window.setTimeout(go, 60); return; }
    el.classList.add('guide-glow');
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    window.setTimeout(() => el.classList.remove('guide-glow'), PULSE_MS);
  };
  go();
}

/** The portrait strip and the counsel card in #counsel (signature-diffed). */
export class Counsel {
  private sig = '';
  private textDay = -1;
  private clickAt = -Infinity;
  private refresh: (() => void) | null = null;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    root.addEventListener('pointerdown', () => { this.clickAt = performance.now(); });
  }

  /** Rebuilds when the shown item, the strip or the remedies' availability change; refreshes the text daily. */
  update(): void {
    const g = this.g;
    const s = g.state;
    const item = pickCounsel(g);
    const strip = ADVISORS.map((a) => (s.guidance.appointed.includes(a) ? `${a}${advisorMood(s, a)}` : '-')).join(',');
    let key = 'c';
    if (item.kind === 'tip') key = `t:${item.t.id}`;
    if (item.kind === 'advisory') {
      const r = renderAdvisory(s, view(s), item.a);
      key = `a:${item.a.rule}:${item.a.memo.sev}:${s.ordo.on.build ? 1 : 0}:${r.remedies.map((x) => `${x.label}${x.check.ok ? 1 : 0}`).join(',')}`;
    }
    const sig = `${strip}|${key}|${g.prefs.tips ? 1 : 0}`;
    if (sig !== this.sig && performance.now() - this.clickAt > B.ui.CLICK_GUARD_MS) {
      this.sig = sig;
      this.build(item);
      this.textDay = s.day;
    } else if (this.refresh && s.day !== this.textDay) {
      this.textDay = s.day;
      this.refresh();
    }
  }

  private build(item: CounselItem): void {
    clear(this.root);
    this.refresh = null;
    this.root.className = `counsel-${item.kind}`;
    this.root.appendChild(h('div', { class: 'counsel-strip' }, ADVISORS.map((a) => this.portraitBtn(a))));
    if (item.kind === 'calm') { this.root.appendChild(this.calm()); return; }
    const card = item.kind === 'tip' ? this.tipCard(item.t) : this.advisoryCard(item.a);
    const toggle = h('button', { class: 'counsel-toggle', 'aria-label': 'Show or hide the counsel', onclick: () => this.root.classList.toggle('open') }, '▾');
    card.prepend(toggle);
    this.root.appendChild(card);
  }

  private portraitBtn(a: AdvisorId): HTMLElement {
    const g = this.g;
    const s = g.state;
    const def = ADVISOR_DEFS[a];
    if (!s.guidance.appointed.includes(a)) {
      const el = h('span', { class: 'counsel-pt vacant' }, img(portrait('silhouette'), 1));
      tip(el, `${def.office} · ${APPOINTED_AT[a] ?? 'Not yet appointed'}`);
      return el;
    }
    const worst = activeAdvisories(s).filter((x) => x.advisor === a).reduce((m, x) => Math.max(m, x.memo.sev), -1);
    const el = h('button', { class: 'counsel-pt', 'aria-label': `${def.office}: open the advisors`, onclick: () => { g.sfx('click'); g.openTab('advisors', a); } },
      img(portrait(a, advisorMood(s, a)), 1), worst >= 1 ? h('i', { class: `pip sev-bg-${worst}` }) : null);
    tip(el, () => {
      const n = activeAdvisories(g.state).filter((x) => x.advisor === a).length;
      return `${def.office} · ${def.name}\n${def.domain}.\n${n ? `${n} ${n === 1 ? 'matter' : 'matters'} to raise.` : 'Quiet.'}`;
    });
    return el;
  }

  private calm(): HTMLElement {
    const g = this.g;
    const line = h('span');
    const set = (): void => {
      const f = forecast(g.state);
      const m = currentMilestone(g.state);
      line.textContent = `All is well: grain ${fmtDays(f.grain.doh)}, water ${fmtDays(f.water.doh)}.${m ? ` Next: ${m.text}.` : ' The council is content.'}`;
    };
    set();
    this.refresh = set;
    return h('div', { class: 'counsel-calm' }, img('i_seal', 1, 'counsel-seal'), line);
  }

  private tipCard(t: GuideStep): HTMLElement {
    const g = this.g;
    const s = g.state;
    const text = h('p', { class: 'counsel-text' }, t.text(s));
    this.refresh = () => { text.textContent = t.text(g.state); };
    const notes = s.counters.mentorDiedDay !== null;
    const done = (): void => { g.act(dismissTip(g.state, t.id), { okSfx: 'click' }); };
    const showMe = t.tab || t.target ? h('button', { class: 'btn small', onclick: () => {
      g.sfx('click');
      if (t.tab) g.openTab(t.tab);
      if (t.target) pulseTarget(t.target);
    } }, 'Show me') : null;
    return h('div', { class: `counsel-card tip${t.urgent ? ' urgent' : ''}`, role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.root.classList.toggle('open') }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('span', { class: 'counsel-kicker' }, mentorKicker(s)), h('span', { class: 'counsel-title' }, t.title))),
      h('div', { class: 'counsel-body' }, text,
        h('div', { class: 'counsel-actions' },
          h('button', { class: 'btn small primary', onclick: done }, 'Understood'), showMe,
          t.urgent ? null : h('button', { class: 'counsel-link', onclick: () => { g.setPref('tips', false); } }, 'Hide tips'))));
  }

  private advisoryCard(a: ActiveAdvisory): HTMLElement {
    const g = this.g;
    const s = g.state;
    const def = ADVISOR_DEFS[a.advisor];
    const sev = a.memo.sev;
    const opp = a.rule === OPPORTUNITAS;
    const r = renderAdvisory(s, view(s), a);
    const title = h('span', { class: 'counsel-title' }, r.title);
    const text = h('p', { class: 'counsel-text' }, r.text);
    const metric = a.memo.metric ? h('span', { class: `chip counsel-metric sev-c${sev}` }, dangerLabel(a)) : null;
    this.refresh = () => {
      const st = g.state;
      const live = activeAdvisories(st).find((x) => x.rule === a.rule);
      if (!live) return;
      const rr = renderAdvisory(st, view(st), live);
      title.textContent = rr.title;
      text.textContent = rr.text;
      if (metric) metric.textContent = dangerLabel(live);
    };
    const kicker = `${opp ? 'OPPORTVNITAS' : caps(SEV_NAME[sev])} · ${caps(def.office)}`;
    return h('div', { class: `counsel-card adv sev-${sev}${opp ? ' opp' : ''}`, role: sev >= 2 ? 'alert' : 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.root.classList.toggle('open') }, img(portrait(a.advisor, advisorMood(s, a.advisor)), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('div', { class: 'counsel-krow' }, h('span', { class: 'counsel-kicker' }, kicker), metric), title)),
      h('div', { class: 'counsel-body' }, text, this.remedies(r.remedies),
        h('div', { class: 'counsel-foot' },
          h('span', { class: 'counsel-name' }, def.name),
          sev < 3 && !opp ? h('button', { class: 'counsel-link', onclick: () => { g.act(hush(g.state, a.rule), { okSfx: 'click' }); } }, `Hush ${B.advisors.HUSH_DAYS} d`) : null,
          sev === 0 ? h('button', { class: 'counsel-link', onclick: () => { g.act(mute(g.state, a.rule), { okSfx: 'click' }); } }, 'Mute') : null)));
  }

  /** Up to three remedy groups; a building remedy renders as Ask the Ordo + Place it myself (only the latter with Ordo building off). */
  private remedies(list: { remedy: Remedy; label: string; check: ActionResult }[]): HTMLElement {
    const g = this.g;
    const s = g.state;
    const rows: HTMLElement[] = [];
    const seen = new Set<BuildingId>();
    for (const x of list) {
      if (rows.length >= 3) break;
      const rem = x.remedy;
      if (rem.kind === 'ask' || rem.kind === 'place') {
        if (seen.has(rem.building)) continue;
        seen.add(rem.building);
        const place: Remedy = rem.kind === 'place' ? rem : list.find((y) => y.remedy.kind === 'place' && y.remedy.building === rem.building)?.remedy ?? { kind: 'place', building: rem.building };
        const ask: Remedy = { kind: 'ask', building: rem.building };
        const btns = [s.ordo.on.build ? this.remedyBtn(ask, 'Ask the Ordo', checkRemedy(s, ask), true) : null, this.remedyBtn(place, 'Place it myself', checkRemedy(s, place), false)];
        const sprite = rem.building === 'area' ? 'h_tentoria_0' : `b_${rem.building}`;
        rows.push(h('div', { class: 'counsel-rem build' }, img(sprite, 1, 'counsel-rem-ico'),
          h('div', { class: 'counsel-rem-main' }, h('span', { class: 'counsel-rem-name' }, BUILDING_DEFS[rem.building].name), h('div', { class: 'counsel-rem-btns' }, btns))));
      } else {
        rows.push(h('div', { class: 'counsel-rem' }, this.remedyBtn(rem, x.label, x.check, rows.length === 0)));
      }
    }
    return h('div', { class: 'counsel-remedies' }, rows);
  }

  private remedyBtn(r: Remedy, label: string, check: ActionResult, primary: boolean): HTMLElement {
    const g = this.g;
    const btn = h('button', { class: primary ? 'btn small primary' : 'btn small', disabled: !check.ok, onclick: () => { g.sfx('click'); g.applyRemedy(r); } }, label);
    if (check.ok) return btn;
    const why = h('span', { class: 'counsel-why' }, check.reason);
    const wrap = h('span', { class: 'counsel-btnwrap' }, btn, why);
    tip(wrap, check.reason);
    return wrap;
  }
}
