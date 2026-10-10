// src/ui/objective.ts — the Res Gestae panel (DESIGN §11.8): kicker and progress, goal, hint, meter, "Unlocks: …", the
// pulsing CTA (charter / petition), danger chips from Periculum advisories only, and active timed modifiers. Owner: WP-H.
// Signature-diffed: rebuilt when the milestone, the CTA or the chip set changes; numbers are patched in place.
import type { ActiveAdvisory, Effects, MilestoneDef, Modifier, UnlockRef } from '../game/types';
import type { Game } from './types';
import { clear, fmt, fmtCost, h, img, tip } from './dom';
import { caps } from './tipkit';
import { MILESTONES, currentMilestone } from '../game/objectives';
import { petitionNeeds } from '../game/decisions';
import { activeAdvisories } from '../game/advisors/engine';
import { view } from '../game/sim';
import { toRoman } from '../game/calendar';
import { EDICT_DEFS, SETTING_DEFS, SWITCH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { ADVISOR_DEFS } from '../game/data/advisors';

const TOOL_LABEL: Record<string, string> = { pin: '"Build next" pin', road: 'Road tool', pave: 'Paving brush', reserve: 'Reserve-block tool', demolish: 'Demolish' };
const OVERLAY_LABEL: Record<string, string> = { aqua: 'Aqua overlay', domus: 'Domus overlay', officia: 'Officia overlay', desir: 'Dignitas loci overlay', terra: 'Terra overlay' };
const SECTION_LABEL: Record<string, string> = { focus: 'Council Focus', edicts: 'Edicts', settings: 'Council settings', switches: 'Switches', manual: '"Who decides the details?"', story: 'Your story' };
const UNIT: Record<string, string> = { days: ' d', houses: '', den: ' den', pct: '%', souls: '' };

/** A readable name for a milestone unlock ("Hospites edict", "Spare beds setting"). */
export function unlockLabel(u: UnlockRef): string {
  switch (u.kind) {
    case 'edict': return `${EDICT_DEFS[u.id].latin} edict`;
    case 'setting': return `${SETTING_DEFS[u.id].name} setting`;
    case 'switch': return `${SWITCH_DEFS[u.id].name} switch`;
    case 'tool': return TOOL_LABEL[u.id] ?? u.id;
    case 'overlay': return OVERLAY_LABEL[u.id] ?? u.id;
    case 'section': return SECTION_LABEL[u.id] ?? u.id;
    case 'cosmetic': return u.label;
    case 'victory': return 'Victory';
  }
}

/** The short chip of a Periculum advisory ("Grain 6 d", "3 homes declining"), from its metric. */
export function dangerLabel(a: ActiveAdvisory): string {
  const m = a.memo.metric;
  if (a.rule === 'quaestor.coin' && a.memo.params.unpaid) return 'Unpaid works';
  if (a.rule === 'aedilis.declining' && m) return `${fmt(m.value)} homes declining`;
  if (m) return `${m.label} ${fmt(Math.max(0, Math.floor(m.value)))}${UNIT[m.unit] ?? ''}`;
  return ADVISOR_DEFS[a.advisor].office;
}

/** Effects in words ("fields ×0.5 · morale +4"). */
export function effectsText(fx: Effects): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fx.mul ?? {})) if (v !== undefined) parts.push(`${k} ×${fmt(v)}`);
  for (const [k, v] of Object.entries(fx.add ?? {})) if (v !== undefined) parts.push(`${k} ${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`);
  return parts.join(' · ');
}

/** The Res Gestae panel in #objective (signature-diffed). */
export class Objective {
  private sig = '';
  private shownId = '';
  private readonly up: (() => void)[] = [];

  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Rebuilds when the milestone, CTA or chips change; otherwise refreshes the meter and chip numbers. */
  update(): void {
    const s = this.g.state;
    const m = currentMilestone(s);
    const pn = petitionNeeds(s, view(s));
    const danger = activeAdvisories(s).filter((a) => a.memo.sev === 3);
    const mods = s.modifiers.filter((x) => x.until > s.day);
    const sig = `${m?.id ?? '-'}|${s.guidance.objective}|${pn?.decision ?? '-'}|${pn?.ready ? 1 : 0}${pn?.affordable ? 1 : 0}|`
      + `${danger.map((a) => a.rule).join(',')}|${mods.map((x) => x.id).join(',')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.build(m, pn, danger, mods);
      const id = m?.id ?? '';
      if (this.shownId && id !== this.shownId) this.pop();
      this.shownId = id;
    }
    for (const u of this.up) u();
  }

  private pop(): void {
    this.root.classList.remove('obj-pop');
    void this.root.offsetWidth;
    this.root.classList.add('obj-pop');
  }

  private build(m: MilestoneDef | null, pn: ReturnType<typeof petitionNeeds>, danger: ActiveAdvisory[], mods: Modifier[]): void {
    const g = this.g;
    const s = g.state;
    clear(this.root);
    this.up.length = 0;
    const main = MILESTONES.filter((x) => !x.postVictory).length;
    const idx = s.guidance.objective;
    const kicker = m ? (m.postVictory ? 'RES GESTAE · POST VICTORIAM' : `RES GESTAE · ${toRoman(idx + 1)} / ${toRoman(Math.max(1, main))}`) : 'RES GESTAE';
    const prog = h('span', { class: 'obj-prog num' });
    const fill = h('i');
    this.root.append(h('div', { class: 'obj-kicker' }, h('span', null, kicker), m ? prog : null));
    if (m) {
      this.root.append(h('div', { class: 'obj-goal' }, img('i_laurel', 2, 'obj-laurel'), h('span', null, m.text)));
      if (m.hint) this.root.append(h('div', { class: 'obj-hint' }, m.hint));
      this.root.append(h('div', { class: 'meter obj-meter' }, fill));
      const un = m.unlocks.map(unlockLabel);
      if (un.length) this.root.append(h('div', { class: 'obj-unlocks' }, h('span', { class: 'obj-unlocks-k' }, 'Unlocks: '), un.join(' · ')));
      this.up.push(() => {
        const [a, b] = m.progress(g.state);
        prog.textContent = b > 1 ? `${fmt(Math.min(a, b))} / ${fmt(b)}` : '';
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, b > 0 ? a / b : 0)) * 100)}%`;
      });
    } else {
      this.root.append(h('div', { class: 'obj-goal muted' }, s.victory ? 'The Capitolium stands. Govern as you will.' : 'The colony keeps its own counsel.'));
    }
    if (pn?.ready) this.root.append(this.cta(pn));
    const chips: HTMLElement[] = [];
    for (const a of danger) {
      const chip = h('button', { class: 'chip bad obj-chip', onclick: () => { g.sfx('click'); g.openTab('advisors', a.advisor); } }, dangerLabel(a));
      tip(chip, `${ADVISOR_DEFS[a.advisor].office}: Periculum. Click for the remedy.`);
      this.up.push(() => { chip.textContent = dangerLabel(a); });
      chips.push(chip);
    }
    for (const x of mods) {
      const chip = h('span', { class: x.benign ? 'chip good obj-chip' : 'chip bad obj-chip' });
      tip(chip, () => `${x.label}: ${effectsText(x.fx) || 'in effect'} for ${Math.max(0, x.until - g.state.day)} more days.`);
      this.up.push(() => { chip.textContent = `${x.label}, ${Math.max(0, x.until - g.state.day)} d`; });
      chips.push(chip);
    }
    if (chips.length) this.root.append(h('div', { class: 'obj-chips' }, chips));
  }

  private cta(pn: NonNullable<ReturnType<typeof petitionNeeds>>): HTMLElement {
    const g = this.g;
    const label = pn.decision === 'charter' ? 'Charter: choose the founding law'
      : `Petition Rome: ${pn.rank !== null ? RANK_DEFS[pn.rank].name : 'the next path'}`;
    const btn = h('button', { class: 'obj-cta', onclick: () => { g.sfx('click'); g.openTab('council', 'crossroads'); } },
      h('span', { class: 'obj-cta-k' }, caps(pn.decision === 'charter' ? 'Lex coloniae' : 'Petitio')), h('span', null, label));
    if (!pn.affordable) {
      const note = h('div', { class: 'obj-cta-note' }, `The Ordo is saving: ${fmtCost(pn.fee)}`);
      return h('div', null, btn, note);
    }
    return btn;
  }
}

/** The milestone toast line: "Res Gestae: {text}" plus "Unlocked: …" (DESIGN §9.4). */
export function milestoneToast(id: string): { text: string; unlock: string } {
  const m = MILESTONES.find((x) => x.id === id);
  const un = m ? m.unlocks.map(unlockLabel) : [];
  return { text: `Res Gestae: ${m?.text ?? id}`, unlock: un.length ? `Unlocked: ${un.join(', ')}.` : '' };
}
