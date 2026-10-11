// src/ui/counsel.ts — the portrait strip and the ONE counsel card (ARCHITECTURE §13.5, DESIGN §15.1, §11.1–11.7). Owner: WP-H.
// Exactly one item by priority: Periculum advisory › urgent tip › lesson › Cave advisory › duties to hand over › tip
// (prefs.tips) › Monitum / Opportunitas advisory › calm line. Signature-diffed; the advisory's title and text re-render once a day; the card is never rebuilt
// under the pointer within B.ui.CLICK_GUARD_MS of a click, nor while the mouse rests on it (unless to answer a click
// there): what the player is reading or aiming at is never swapped or moved under the cursor. Only a new item slides in.
import { ADVISORS } from '../game/types';
import type { ActiveAdvisory, ActionResult, AdvisorId, BuildingId, DutyId, GuideStep, Remedy } from '../game/types';
import type { Game } from './types';
import { clear, fmtDays, h, img, reveal, tip } from './dom';
import { caps } from './tipkit';
import { PointerHold } from './steady';
import { dangerLabel } from './objective';
import { activeAdvisories, advisorMood, renderAdvisory } from '../game/advisors/engine';
import { checkRemedy } from '../game/advisors/remedies';
import { beginNextLesson, dismissTip, handOverAll, hush, keepDuties, mute, setDuty, skipIntro, skipLesson } from '../game/actions';
import { DUTY_DEFS, pendingOffers } from '../game/ordo/duties';
import { LESSONS, currentLesson, lessonAge, lessonPointer } from '../game/intro';
import type { Lesson } from '../game/intro';
import { toRoman } from '../game/calendar';
import { mentorKicker, nextTip } from '../game/guide';
import { currentMilestone } from '../game/objectives';
import { forecast } from '../game/forecast';
import { view } from '../game/sim';
import { ADVISOR_DEFS } from '../game/data/advisors';
import { BUILDING_DEFS } from '../game/data/buildings';
import { B } from '../game/balance';
import { portrait } from '../render/art/index';
import { shows } from './intro';

/** The one item the card shows. */
export type CounselItem = { kind: 'advisory'; a: ActiveAdvisory } | { kind: 'tip'; t: GuideStep }
  | { kind: 'lesson'; l: Lesson; index: number; done: boolean; nudge: boolean; stuck: boolean }
  | { kind: 'offer'; duties: DutyId[] } | { kind: 'calm' };

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
  // an opening lesson (§11.13) holds the card until its job is done, then shows its payoff for a few seconds
  const cur = currentLesson(s);
  const age = cur ? lessonAge(s) : 0;
  const waited = cur && !cur.done && !cur.lesson.progress?.(s) ? age : 0;   // a work already rising needs no nudge
  const lesson = (): CounselItem => ({ kind: 'lesson', l: cur!.lesson, index: cur!.index, done: cur!.done,
    nudge: waited >= B.intro.NUDGE_S * 1000, stuck: waited >= B.intro.STUCK_S * 1000 });
  if (cur && !cur.done) return lesson();
  const cave = bySev(2);
  if (cave) return { kind: 'advisory', a: cave };
  if (cur) return lesson();   // the breather: the payoff, the next lesson's name, and Begin now
  const offers = pendingOffers(s);   // duties the player has learned: theirs to hand to the Ordo or keep (§10.2)
  if (offers.length) return { kind: 'offer', duties: offers };
  const spaced = s.stats.playMs - s.guidance.tipAt >= B.intro.TIP_GAP_S * 1000;   // tips spaced in real time, whatever the speed
  if (tipStep && g.prefs.tips && spaced) return { kind: 'tip', t: tipStep };
  const low = adv.find((a) => a.memo.sev >= 1);   // Monitum or Opportunitas (ranks as Monitum, never above Cave)
  if (low) return { kind: 'advisory', a: low };
  return { kind: 'calm' };
}

/** The card's signature: the portrait strip, the shown item and, for an advisory, its remedies' labels and availability
 *  — a place remedy with its tile, so once the Ordo builds on the best plot the button aims at the next one. */
export function counselSig(g: Game, item: CounselItem): string {
  const s = g.state;
  const strip = shows(g, 'portraits') ? ADVISORS.map((a) => (s.guidance.appointed.includes(a) ? `${a}${advisorMood(s, a)}` : '-')).join(',') : 'x';
  let key = 'c';
  if (item.kind === 'tip') key = `t:${item.t.id}`;
  if (item.kind === 'lesson') key = `l:${item.index}:${item.done ? 1 : 0}:${item.nudge ? 1 : 0}${item.stuck ? 1 : 0}:${item.l.progress?.(s) ?? ''}:${item.l.id === 'ordo' ? pendingOffers(s).join(',') : ''}`;
  if (item.kind === 'offer') key = `o:${item.duties.join(',')}`;
  if (item.kind === 'advisory') {
    const r = renderAdvisory(s, view(s), item.a);
    key = `a:${item.a.rule}:${item.a.memo.sev}:${s.ordo.on.build ? 1 : 0}:${r.remedies.map((x) => `${x.label}${x.check.ok ? 1 : 0}${x.remedy.kind === 'place' ? `@${x.remedy.tile ?? ''}` : ''}`).join(',')}`;
  }
  return `${strip}|${key}|${g.prefs.tips ? 1 : 0}`;
}

/** Pulses a selector's element for 3 s (retries while a freshly opened tab builds). */
export function pulseTarget(selector: string): void {
  let tries = 0;
  const go = (): void => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) { if (++tries < PULSE_TRIES) window.setTimeout(go, 60); return; }
    el.classList.add('guide-glow');
    reveal(el, { smooth: true });   // not scrollIntoView: that would scroll the fixed #app frame too (dom.ts)
    window.setTimeout(() => el.classList.remove('guide-glow'), PULSE_MS);
  };
  go();
}

/** The portrait strip and the counsel card in #counsel (signature-diffed). */
export class Counsel {
  private sig = '';
  private textDay = -1;
  private readonly hold: PointerHold;
  private shownKey = '';                      // the shown item (not its remedies): a new one slides in, a refresh does not
  private refresh: (() => void) | null = null;
  private open = false;                       // mobile: the card is expanded from its portrait chip
  private autoOpen = false;                   // … and it was a tip or lesson that unfolded it
  private skipArmed = false;                  // "Skip the lessons" asks once more before it skips

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.hold = new PointerHold(root);
  }

  /** True while the mouse rests on the card or the strip: the Res Gestae above holds still too (objective.ts). */
  get held(): boolean {
    return this.hold.holds();
  }

  /** Rebuilds when the shown item, the strip or the remedies' availability change; refreshes the text daily. */
  update(): void {
    const g = this.g;
    const s = g.state;
    const item = pickCounsel(g);
    const sig = counselSig(g, item);
    if (sig !== this.sig && !this.hold.holds()) {
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
    const key = item.kind === 'advisory' ? `a:${item.a.rule}:${item.a.memo.sev}` : item.kind === 'tip' ? `t:${item.t.id}`
      : item.kind === 'lesson' ? `l:${item.index}:${item.done ? 1 : 0}` : item.kind === 'offer' ? `o:${item.duties[0]}` : 'c';
    const enter = key !== this.shownKey;
    this.shownKey = key;
    // a phone shows the card folded to its title: a new tip or lesson unfolds it (the next waits on it), and once it is
    // read or its payoff has shown the card folds again
    if (enter && (item.kind === 'tip' || item.kind === 'lesson' || item.kind === 'offer')) { this.open = true; this.autoOpen = true; }
    else if (enter && this.autoOpen) { this.open = false; this.autoOpen = false; }
    this.root.className = `counsel-${item.kind}${this.open ? ' open' : ''}`;
    // the portraits come with the advisors' tip (the paced introduction); until then the card stands alone
    if (shows(this.g, 'portraits')) this.root.appendChild(h('div', { class: 'counsel-strip' }, ADVISORS.map((a) => this.portraitBtn(a))));
    if (item.kind === 'calm') { this.root.appendChild(this.calm()); return; }
    const card = item.kind === 'tip' ? this.tipCard(item.t) : item.kind === 'lesson' ? this.lessonCard(item)
      : item.kind === 'offer' ? this.offerCard(item.duties) : this.advisoryCard(item.a);
    if (enter) card.classList.add('enter');
    const toggle = h('button', { class: 'counsel-toggle', 'aria-label': 'Show or hide the counsel', onclick: () => this.toggleOpen() }, '▾');
    card.prepend(toggle);
    this.root.appendChild(card);
  }

  private toggleOpen(): void {
    this.open = !this.open;
    this.root.classList.toggle('open', this.open);
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
      const cur = currentLesson(g.state);
      const lesson = cur ? LESSONS[cur.index + 1] : undefined;   // in a breather between lessons: what comes next
      const next = lesson ? ` Next lesson: ${lesson.title}.` : m ? ` Next: ${m.text}.` : ' The council is content.';
      line.textContent = `All is well: grain ${fmtDays(f.grain.doh)}, water ${fmtDays(f.water.doh)}.${next}`;
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
    const done = (): void => { this.open = false; g.act(dismissTip(g.state, t.id), { okSfx: 'click' }); };
    const showMe = t.tab || t.target ? h('button', { class: 'btn small', onclick: () => {
      g.sfx('click');
      if (t.tab) g.openTab(t.tab);
      if (t.target) pulseTarget(t.target);
    } }, 'Show me') : null;
    return h('div', { class: `counsel-card tip${t.urgent ? ' urgent' : ''}`, role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('span', { class: 'counsel-kicker' }, mentorKicker(s)), h('span', { class: 'counsel-title' }, t.title))),
      h('div', { class: 'counsel-body' }, text,
        h('div', { class: 'counsel-actions' },
          h('button', { class: 'btn small primary', onclick: done }, 'Understood'), showMe,
          t.urgent ? null : h('button', { class: 'counsel-link', onclick: () => { g.setPref('tips', false); } }, 'Hide tips'))));
  }

  /** An opening lesson (§11.13): the reason and the job (with its progress), and what comes after; once done, the
   *  payoff, the next lesson's name and "Begin now", so the breather is never an empty wait. */
  private lessonCard(x: Extract<CounselItem, { kind: 'lesson' }>): HTMLElement {
    const g = this.g;
    const s = g.state;
    const l = x.l;
    const next = LESSONS[x.index + 1];
    const text = h('p', { class: 'counsel-text' }, x.done ? l.reward : l.text(s));
    const prog = !x.done ? l.progress?.(s) ?? null : null;
    const job = h('div', { class: `lesson-job${x.done ? ' done' : ''}` }, h('span', { class: 'lesson-box', 'aria-hidden': 'true' }, x.done ? '✓' : ''),
      h('span', null, l.job), prog ? h('span', { class: 'lesson-prog' }, prog) : null);
    const show = (): void => {
      g.sfx('click');
      const ptr = lessonPointer(l);
      if (ptr.open) g.openTab(ptr.open, ptr.anchor);
      if (ptr.glow) pulseTarget(ptr.glow);
    };
    const skip = h('button', { class: 'counsel-link', onclick: () => {
      if (!this.skipArmed) { this.skipArmed = true; skip.textContent = 'Skip every lesson?'; return; }
      this.skipArmed = false;
      g.act(skipIntro(g.state), { okSfx: 'click' });
    } }, 'Skip the lessons');
    let acts: HTMLElement;
    if (x.done) {
      acts = h('div', { class: 'counsel-actions' },
        next ? h('button', { class: 'btn small primary', onclick: () => { g.act(beginNextLesson(g.state)); } }, 'Begin now') : null,
        h('span', { class: 'lesson-next' }, next ? `Next: ${next.title}` : 'The lessons are done.'));
    } else if (l.id === 'ordo' && pendingOffers(s).length) {
      // the Ordo's lesson: the duties learned so far, each to hand over here; or keep them all (Edicta can later)
      acts = h('div', { class: 'counsel-actions' },
        pendingOffers(s).map((d) => h('button', { class: 'btn small primary', onclick: () => { g.act(setDuty(g.state, d, true), { okSfx: 'click' }); } },
          `Hand over: ${DUTY_DEFS[d].name}`)),
        h('button', { class: 'counsel-link', onclick: () => { g.act(keepDuties(g.state), { okSfx: 'click' }); } }, 'Keep them all mine'),
        skip);
    } else {
      acts = h('div', { class: 'counsel-actions' },
        l.tab || l.target ? h('button', { class: 'btn small primary', onclick: show }, 'Show me') : null,
        x.stuck ? h('button', { class: 'counsel-link', onclick: () => { g.act(skipLesson(g.state), { okSfx: 'click' }); } }, 'Skip this step') : null,
        skip);
    }
    const then = !x.done && next ? h('div', { class: 'lesson-then' }, `Then: ${next.title}`) : null;
    if (x.nudge && !x.done) { const glow = lessonPointer(l).glow ?? (l.tab ? `#tab-${l.tab}` : null); if (glow) pulseTarget(glow); }
    const notes = s.counters.mentorDiedDay !== null;
    return h('div', { class: `counsel-card tip lesson${x.done ? ' done' : ''}${x.nudge ? ' nudge' : ''}`, role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('span', { class: 'counsel-kicker' }, `DISCIPLINA · ${toRoman(x.index + 1)} / ${toRoman(LESSONS.length)}`),
          h('span', { class: 'counsel-title' }, l.title))),
      h('div', { class: 'counsel-body' }, text, job, acts, then));
  }

  /** Duties the player has learned (§10.2): each to hand to the Ordo or keep; Edicta's Mandata can change it later. */
  private offerCard(duties: DutyId[]): HTMLElement {
    const g = this.g;
    const s = g.state;
    const one = duties.length === 1 ? DUTY_DEFS[duties[0]] : null;
    const text = one ? `${one.done} From now on the Ordo can see to ${one.does} for you, even while you sleep.`
      : 'You have learned these chores by your own hand. The Ordo can carry any of them for you, even while you sleep.';
    const rows = duties.map((d) => h('div', { class: 'counsel-rem duty' },
      h('div', { class: 'counsel-rem-main' }, h('span', { class: 'counsel-rem-name' }, DUTY_DEFS[d].name),
        h('div', { class: 'counsel-rem-btns' },
          h('button', { class: 'btn small primary', onclick: () => { g.act(setDuty(g.state, d, true), { okSfx: 'click' }); } }, 'Hand to the Ordo'),
          h('button', { class: 'btn small', onclick: () => { g.act(keepDuties(g.state, [d]), { okSfx: 'click' }); } }, 'Keep it mine')))));
    const notes = s.counters.mentorDiedDay !== null;
    return h('div', { class: 'counsel-card tip offer', role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('span', { class: 'counsel-kicker' }, 'MANDATA'),
          h('span', { class: 'counsel-title' }, one ? `The Ordo can take up ${one.name.toLowerCase()}` : 'The Ordo can take up your chores'))),
      h('div', { class: 'counsel-body' }, h('p', { class: 'counsel-text' }, text), h('div', { class: 'counsel-remedies' }, rows),
        h('div', { class: 'counsel-foot' },
          h('span', { class: 'counsel-name' }, 'Edicta · Mandata keeps them all'),
          duties.length > 1 ? h('button', { class: 'counsel-link', onclick: () => { g.act(handOverAll(g.state, duties), { okSfx: 'click' }); } }, 'Hand over all') : null,
          duties.length > 1 ? h('button', { class: 'counsel-link', onclick: () => { g.act(keepDuties(g.state), { okSfx: 'click' }); } }, 'Keep them all') : null)));
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
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(a.advisor, advisorMood(s, a.advisor)), 2, 'counsel-face'),
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
