// src/ui/tabs/edicta.ts — Edicta / Decisions: the Crossroads card, your story, focus, edicts, settings, switches, the
// next-unlock teaser and "Who decides the details?" (DESIGN §9.1–9.2, §10.2, §10.8–10.10, §15.3). Owner: WP-I.
import { EDICTS, FOCUSES, ORDO_AREAS, PATH_DECISIONS, SETTINGS, SWITCHES } from '../../game/types';
import type { EdictId, GameState, LaborCat, OrdoArea, PathDecisionId, PathOptionId, SectionId, SettingId, SwitchId } from '../../game/types';
import type { Game, Panel, Updater } from '../types';
import { costEl, fmt, fmtCost, h, img, sentence, tip } from '../dom';
import * as A from '../../game/actions';
import { edictOption, edictWindow, isUnlocked, petitionNeeds, settingValue, switchOn } from '../../game/decisions';
import { nextTeaser, sectionRevealed } from '../../game/reveal';
import { councilReport } from '../../game/ordo/index';
import { reasonText } from '../../game/ordo/reasons';
import { view } from '../../game/sim';
import { census } from '../../game/census';
import { portion } from '../../game/economy';
import { aucYear, formatAuc, formatRoman } from '../../game/calendar';
import { B } from '../../game/balance';
import { EDICT_DEFS, FOCUS_DEFS, PATH_DEFS, SETTING_DEFS, SWITCH_DEFS } from '../../game/data/decisions';
import { RANK_DEFS } from '../../game/data/ranks';
import { BUILDING_DEFS } from '../../game/data/buildings';
import { WISH_STATE, btn, caps, confirmRich, fresh, lackLine, lacking, newMark, savingLine, section, seg, toggle } from './common';
import { CAT_LABEL } from './labour';

/** How each permanent choice reads in "Your story" (DESIGN §9.2). */
const STORY: Record<PathOptionId, string> = {
  veterani: 'the colony was founded for the veterans of the legion', agricolae: 'the colony was founded for farmers',
  mercatores: 'the colony was founded as a camp market', canabae: 'the canabae became a market village',
  pagus: 'the vicus became a farming pagus', coloni: 'the gates opened to new coloni',
  arsFabrilis: 'the oppidum turned to the crafts of fire', pietas: 'the oppidum vowed itself to the gods',
  viaMilitaris: 'the via was paved as a military road', iusLatii: 'the municipium won the Latin right',
  annonaPublica: 'the municipium took up the public grain dole', aquaeSalutares: 'the municipium chose healing waters',
  iuppiter: 'the Capitolium was vowed to Iuppiter Optimus Maximus', aeternitas: 'the Capitolium was vowed to Aeternitas',
  imperium: 'the Capitolium was vowed to the Imperium',
};
const AREA_LABEL: Record<OrdoArea, [string, string, string]> = {
  labour: ['Operae', 'Labour', 'who works where (Populus)'],
  build: ['Aedificatio', 'Construction', 'what is raised (Aedificia)'],
  trade: ['Negotia', 'Trade', 'contracts and merchant deals (Commercium)'],
};
const SECTIONS: readonly SectionId[] = ['story', 'focus', 'edicts', 'settings', 'switches', 'manual'];

function settingText(id: SettingId, v: number): string {
  const d = SETTING_DEFS[id];
  return d.unit === '%' ? `${Math.round(v * 100)}%` : d.unit === 'den' ? `${fmt(v)} den` : `${fmt(v)} ${d.unit}`;
}

function windowLine(s: GameState, id: EdictId): string {
  const w = edictWindow(s, id);
  const inDays = Math.max(0, w.next - s.day);
  return w.open ? sentence(`Window open. A change holds until ${formatRoman(w.next)}`) : `Settled. Next window: ${formatRoman(w.next)} (in ${inDays} ${inDays === 1 ? 'day' : 'days'}).`;
}

/** Measured impact of an edict option (DESIGN §10.9 tooltips), where it can be measured. */
function impact(g: Game, id: EdictId, opt: string): string {
  const s = g.state;
  if (id === 'rationes') {
    const P = B.economy.PORTIONS as Record<string, number>;
    const need = census(s).need.grain / Math.max(0.01, portion(s));
    const delta = need * ((P[opt] ?? 1) - (P[edictOption(s, id)] ?? 1));
    const moraleDelta = ((B.morale.RATION_TERMS as Record<string, number>)[opt] ?? 0) - ((B.morale.RATION_TERMS as Record<string, number>)[edictOption(s, id)] ?? 0);
    if (Math.abs(delta) < 0.05) return '';
    return `${delta < 0 ? `Saves ${fmt(-delta)}` : `Costs ${fmt(delta)} more`} grain a day${moraleDelta ? `; ${moraleDelta > 0 ? 'lifts' : 'costs'} ${Math.abs(moraleDelta)} spirits` : ''}.`;
  }
  if (id === 'tributum') {
    const taxes = g.rates.prod.denarii.taxes ?? 0;
    const mult = (o: string): number => EDICT_DEFS.tributum.options.find((x) => x.id === o)?.fx.mul?.tax ?? 1;
    const delta = taxes * (mult(opt) / mult(edictOption(s, id)) - 1);
    return Math.abs(delta) < 0.05 ? '' : `About ${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))} den a day in taxes.`;
  }
  return '';
}

/** The Crossroads card: the charter or the next petition, its checklist, fee, note and the three permanent paths. */
function crossroads(g: Game, up: Updater[]): HTMLElement {
  const s = g.state;
  const pn = petitionNeeds(s, view(s));
  if (!pn) {
    return h('div', { class: 'card ed-path done path-card' }, h('div', { class: 'kicker' }, 'FATA · EVERY PATH IS CHOSEN'),
      h('div', { class: 'ed-path-title' }, 'Rome has heard every petition'),
      h('p', { class: 'ed-path-prompt' }, s.victory ? 'The Capitolium is dedicated. Keep governing as you wish.' : 'Now the Capitolium must rise on the Area Capitolina.'));
  }
  const def = PATH_DEFS[pn.decision];
  const charter = pn.decision === 'charter';
  const rank = pn.rank !== null ? RANK_DEFS[pn.rank] : null;
  const ready = pn.ready && pn.affordable;
  const card = h('div', { class: `card ed-path path-card${ready ? ' ready' : ''}`, 'data-anchor': 'petition' },
    h('div', { class: 'kicker' }, charter ? 'LEX COLONIAE · THE FOUNDING CHARTER' : `PETITIO · ${caps(rank?.name ?? '')}`),
    h('div', { class: 'ed-path-title' }, charter ? 'Proclaim the law of the colony' : `Petition Rome: ${rank?.name ?? def.name}`),
    h('p', { class: 'ed-path-prompt' }, def.prompt));
  if (rank) {
    const items = pn.needs.map((n) => {
      const el = h('li', { class: n.met ? 'met' : 'unmet' }, n.met ? '✔ ' : '○ ', n.label);
      return el;
    });
    up.push(() => {
      const now = petitionNeeds(g.state, view(g.state));
      now?.needs.forEach((n, i) => { const el = items[i]; if (el) { el.textContent = `${n.met ? '✔' : '○'} ${n.label}`; el.className = n.met ? 'met' : 'unmet'; } });
    });
    card.append(h('ul', { class: 'ed-checklist' }, items,
      h('li', { class: pn.affordable ? 'met' : 'unmet' }, pn.affordable ? '✔ ' : '○ ', 'Fee ', costEl(s, pn.fee))));
  }
  const note = h('div', { class: `ed-path-note ${ready ? 'good' : ''}` });
  const setNote = (): void => {
    if (charter) note.textContent = 'Choose any time. The charter is permanent: it is the first line of your story.';
    else if (!pn.ready) note.textContent = 'Not yet. The Ordo works toward these on its own; the paths open once every item is ticked.';
    else if (!pn.affordable) {
      const lack = lacking(g.state, pn.fee);
      note.textContent = `Ready, but the fee is short. The Ordo is saving: ${lack ? lackLine(g, lack) : 'almost there'}.`;
    } else note.textContent = `Rome would hear our petition for ${rank?.name}. The path you choose is permanent and shapes the town.`;
  };
  setNote();
  up.push(setNote);
  card.append(note);
  const reason = !pn.ready ? `Rome would not yet hear us: ${pn.needs.filter((n) => !n.met).length} of ${pn.needs.length} requirements remain.`
    : !pn.affordable ? `The fee is short: ${fmtCost(lacking(s, pn.fee) ?? pn.fee)}.` : null;
  const opts = h('div', { class: 'ed-opts' });
  for (const o of def.options) {
    const body = [h('span', { class: 'ed-opt-name' }, o.name), h('span', { class: 'ed-opt-desc' }, o.desc),
      o.visible ? h('span', { class: 'ed-opt-vis' }, `You will see: ${o.visible}`) : null];
    if (reason) { opts.append(btn(g, body, () => undefined, { cls: 'ed-opt', reason })); continue; }
    opts.append(confirmRich(h('button', { class: 'ed-opt', type: 'button' }, body), 'Click again to choose. This is for good.',
      () => { g.act(A.choosePath(g.state, pn.decision, o.id), { okSfx: 'cornu' }); }));
  }
  card.append(opts);
  return card;
}

function story(s: GameState): HTMLElement | null {
  const chosen = PATH_DECISIONS.filter((d) => s.decisions.paths[d] !== undefined);
  if (!chosen.length) return null;
  const sec = section('Res gestae nostrae', 'Your story');
  for (const d of chosen) {
    const id = s.decisions.paths[d] as PathOptionId;
    const o = PATH_DEFS[d].options.find((x) => x.id === id);
    const day = s.decisions.pathDays[d] ?? s.day;
    const el = h('div', { class: 'ed-chapter' }, h('span', { class: 'ed-chapter-auc num' }, formatAuc(aucYear(day))),
      h('span', null, `${STORY[id].charAt(0).toUpperCase()}${STORY[id].slice(1)}.`));
    tip(el, `${PATH_DEFS[d].name}: ${o?.name ?? id}\n${o?.desc ?? ''}${o?.visible ? `\n${o.visible}` : ''}`);
    sec.append(el);
  }
  return sec;
}

function focusSec(g: Game, up: Updater[]): HTMLElement {
  const s = g.state;
  const cur = s.decisions.focus;
  const sec = section('Propositum', 'Council focus', { anchor: 'focus', note: 'Steers what the Ordo builds and where spare hands go. Free to change at any time.' });
  sec.append(seg(g, FOCUSES.map((f) => ({ id: f, label: FOCUS_DEFS[f].latin, tip: `${FOCUS_DEFS[f].latin} · ${FOCUS_DEFS[f].name}\n${FOCUS_DEFS[f].desc}` })),
    cur, (f) => A.setFocus(g.state, f)));
  sec.append(h('div', { class: 'ed-desc' }, h('b', null, FOCUS_DEFS[cur].name), ': ', FOCUS_DEFS[cur].desc));
  const line = h('div', { class: 'ed-ordo-line' });
  let shown = '';
  const refresh = (): void => {
    const rep = councilReport(g.state);
    const w = rep.agenda[0];
    const parts: string[] = [];
    // the first wish by its state (staked, raising, saving for, …), as the ticker names it
    if (w) parts.push(`Ordo · ${WISH_STATE[w.state]}: ${BUILDING_DEFS[w.type].name}. ${reasonText(w.reason)}`);
    if (rep.saving) parts.push(savingLine(g, rep.saving));
    if (!parts.length) parts.push('Ordo: nothing in hand today.');
    const key = parts.join('\n');
    if (key === shown) return;
    shown = key;
    line.replaceChildren(...parts.map((t) => h('div', null, t)));
  };
  refresh();
  up.push(refresh);
  sec.append(line);
  return sec;
}

function edictsSec(g: Game, up: Updater[]): HTMLElement | null {
  const s = g.state;
  const open = EDICTS.filter((e) => isUnlocked(s, { kind: 'edict', id: e }));
  if (!open.length) return null;
  const sec = section('Edicta', 'Edicts', { guide: 'edicts', anchor: 'edicts',
    note: `Each edict trades one good for another. It may change once a season; a change holds until the next season's Kalends (${formatRoman(edictWindow(s, open[0]).next)}).` });
  for (const id of open) {
    const def = EDICT_DEFS[id];
    const cur = edictOption(s, id);
    const w = edictWindow(s, id);
    const locked = w.open ? null : windowLine(s, id);
    const box = h('div', { class: 'ed-box', 'data-anchor': `edict-${id}` },
      h('div', { class: 'ed-box-head' }, h('b', null, def.latin), h('span', { class: 'ed-en' }, def.name),
        fresh(s, s.guidance.milestoneDays[def.unlock]) ? newMark() : null),
      h('div', { class: 'ed-q' }, def.prompt),
      seg(g, def.options.map((o) => ({
        id: o.id, label: o.name, reason: locked,
        tip: () => [`${o.name}${o.id === def.initial ? ' · the default' : ''}`, o.desc, impact(g, id, o.id), o.id !== def.initial ? `When: ${def.situational}` : '']
          .filter((x) => x).join('\n'),
      })), cur, (o) => A.setEdict(g.state, id, o)),
      h('div', { class: 'ed-desc' }, def.options.find((o) => o.id === cur)?.desc ?? ''));
    if (id === 'rationes' && s.ordo.emergency.rations !== 'none') {
      box.append(h('div', { class: 'ed-warn' }, `Lex de annona: rations are cut to ${s.ordo.emergency.rations === 'arctae' ? 'Arctae' : 'Parcae'} until grain recovers.`));
    }
    if (!w.open) {
      const wl = h('div', { class: 'ed-window' });
      const refresh = (): void => { wl.textContent = windowLine(g.state, id); };
      refresh();
      up.push(refresh);
      box.append(wl);
    }
    sec.append(box);
  }
  return sec;
}

function settingsSec(g: Game): HTMLElement | null {
  const s = g.state;
  const open = SETTINGS.filter((id) => isUnlocked(s, { kind: 'setting', id }));
  if (!open.length) return null;
  const sec = section('Mandata Ordini', 'Council settings', { anchor: 'settings', note: 'Standing orders the Ordo follows every day.' });
  for (const id of open) {
    const def = SETTING_DEFS[id];
    const val = h('span', { class: 'ed-val num' }, settingText(id, settingValue(s, id)));
    const input = h('input', {
      type: 'range', class: 'ed-slider', min: def.min, max: def.max, step: def.step, value: String(settingValue(s, id)),
      'aria-label': `${def.latin}, ${def.name}`,
    });
    input.addEventListener('input', () => {
      const r = A.setSetting(g.state, id, Number(input.value));
      if (!r.ok) g.act(r);
      val.textContent = settingText(id, settingValue(g.state, id));
    });
    input.addEventListener('change', () => { g.act(A.setSetting(g.state, id, Number(input.value)), { okSfx: 'click' }); });
    const box = h('div', { class: 'ed-box ed-setting', 'data-anchor': `setting-${id}` },
      h('div', { class: 'ed-box-head' }, h('b', null, def.latin), h('span', { class: 'ed-en' }, def.name),
        fresh(s, s.guidance.milestoneDays[def.unlock]) ? newMark() : null, val),
      input, h('div', { class: 'ed-q' }, def.desc));
    sec.append(box);
  }
  return sec;
}

function switchesSec(g: Game): HTMLElement | null {
  const s = g.state;
  const open = SWITCHES.filter((id) => isUnlocked(s, { kind: 'switch', id }));
  if (!open.length) return null;
  const sec = section('Leges', 'Switches', { anchor: 'switches' });
  for (const id of open as SwitchId[]) {
    const def = SWITCH_DEFS[id];
    sec.append(h('div', { class: 'ed-row' }, h('div', { class: 'ed-row-main' }, h('b', null, def.name), h('div', { class: 'ed-q' }, def.desc)),
      toggle(g, switchOn(s, id), ['On', 'Off'], (on) => A.setSwitch(g.state, id, on))));
  }
  return sec;
}

function wouldLine(g: Game, area: OrdoArea): string | null {
  const would = councilReport(g.state).would;
  if (area === 'labour') {
    const parts = (Object.entries(would.labour) as [LaborCat, number][]).filter(([, n]) => n > 0).map(([c, n]) => `${CAT_LABEL[c][1]} ${n}`);
    return parts.length ? `The Ordo would assign: ${parts.join(' · ')}` : null;
  }
  if (area === 'build') return would.build ? `The Ordo would raise: ${BUILDING_DEFS[would.build.type].name}. ${reasonText(would.build.reason)}` : null;
  return would.trade ? `The Ordo would: ${reasonText(would.trade)}` : null;
}

function manualSec(g: Game, up: Updater[]): HTMLElement {
  const s = g.state;
  const sec = section('Quis decernit?', 'Who decides the details?', { guide: 'manual', anchor: 'manual',
    note: 'The Ordo runs the day-to-day and says why. Take any part of it yourself; leaving it all to them works just as well.' });
  for (const area of ORDO_AREAS) {
    const on = s.ordo.on[area];
    const [latin, en, where] = AREA_LABEL[area];
    const row = h('div', { class: 'ed-row' },
      h('div', { class: 'ed-row-main' }, h('b', null, latin), h('span', { class: 'ed-en' }, en),
        h('div', { class: 'ed-q' }, on ? `The Ordo decides ${where}.` : `You decide ${where}.`)),
      toggle(g, on, ['Ordo', 'Mine'], (v) => A.setOrdo(g.state, area, v)));
    sec.append(row);
    if (on) continue;
    const ghost = h('div', { class: 'ed-would' });
    const refresh = (): void => { const t = wouldLine(g, area); ghost.textContent = t ?? 'The Ordo would change nothing today.'; };
    refresh();
    up.push(refresh);
    sec.append(h('div', { class: 'ed-would-row' }, img('i_seal', 1), ghost,
      btn(g, 'Apply once', () => A.applyOnce(g.state, area), { tip: 'Do what the Ordo would do, this once.' })));
  }
  return sec;
}

/** The Decisions tab. */
export const panel: Panel = {
  id: 'council', label: 'Edicta', sub: 'Decisions', icon: 'i_tab_council', hotkey: 'E',
  signature(g: Game): string {
    const s = g.state;
    const pn = petitionNeeds(s, view(s));
    const would = councilReport(s).would;
    return [
      pn ? `${pn.decision}:${pn.rank}:${+pn.ready}${+pn.affordable}:${pn.needs.map((n) => +n.met).join('')}` : '-',
      PATH_DECISIONS.map((d: PathDecisionId) => s.decisions.paths[d] ?? '').join(','),
      s.decisions.focus,
      EDICTS.map((e) => `${+isUnlocked(s, { kind: 'edict', id: e })}${edictOption(s, e)}${+edictWindow(s, e).open}${+fresh(s, s.guidance.milestoneDays[EDICT_DEFS[e].unlock])}`).join(','),
      SETTINGS.map((id) => `${+isUnlocked(s, { kind: 'setting', id })}${+fresh(s, s.guidance.milestoneDays[SETTING_DEFS[id].unlock])}`).join(''),
      SWITCHES.map((id) => `${+isUnlocked(s, { kind: 'switch', id })}${+switchOn(s, id)}`).join(''),
      SECTIONS.map((x) => +sectionRevealed(s, x)).join(''),
      ORDO_AREAS.map((a) => +s.ordo.on[a]).join(''),
      `${+Object.values(would.labour).some((n) => (n ?? 0) > 0)}${+!!would.build}${+!!would.trade}`,
      s.ordo.emergency.rations, nextTeaser(s)?.label ?? '', +s.victory,
    ].join('|');
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    body.append(crossroads(g, up));
    if (sectionRevealed(s, 'story')) { const st = story(s); if (st) body.append(st); }
    if (sectionRevealed(s, 'focus')) body.append(focusSec(g, up));
    if (sectionRevealed(s, 'edicts')) { const e = edictsSec(g, up); if (e) body.append(e); }
    if (sectionRevealed(s, 'settings')) { const e = settingsSec(g); if (e) body.append(e); }
    if (sectionRevealed(s, 'switches')) { const e = switchesSec(g); if (e) body.append(e); }
    const teaser = nextTeaser(s);
    if (teaser) body.append(h('div', { class: 'ed-teaser' }, img('i_laurel', 1), h('span', null, h('b', null, `Next: ${teaser.label}`), ` · ${teaser.at}`)));
    if (sectionRevealed(s, 'manual')) body.append(manualSec(g, up));
  },
  badge(g: Game) {
    const pn = petitionNeeds(g.state, view(g.state));
    return pn && pn.ready && pn.affordable ? { text: '!', kind: 'gold' } : null;
  },
};
