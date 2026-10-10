// src/ui/tabs/consiliarii.ts — Consiliarii / Advisors: six portraits as filters, every advisory card by severity with
// remedies, Hush and Mute, and the Ordo's agenda with its reasons (DESIGN §11.3–11.6, §15.3). Owner: WP-I.
import { ADVISORS, RULES } from '../../game/types';
import type { ActionResult, ActiveAdvisory, AdvisorId, BuildingId, GameState, Remedy, RuleId } from '../../game/types';
import type { Game, Updater } from '../types';
import { fmt, h, img } from '../dom';
import * as A from '../../game/actions';
import { activeAdvisories, advisorMood, renderAdvisory } from '../../game/advisors/engine';
import { checkRemedy, remedyLabel } from '../../game/advisors/remedies';
import { councilReport } from '../../game/ordo/index';
import { reasonShort } from '../../game/ordo/reasons';
import { view } from '../../game/sim';
import { formatRoman } from '../../game/calendar';
import { ADVISOR_DEFS } from '../../game/data/advisors';
import { portrait } from '../../render/art/index';
import { agendaEl, btn, caps, section } from './common';
import type { TabPanel } from './common';

const SEV_NAME = ['Nota', 'Monitum', 'Cave', 'Periculum'] as const;
const OPPORTUNITAS: RuleId = 'augur.petition';
const APPOINTED_AT: Record<AdvisorId, string> = {
  annonae: 'Serves from the founding.', aquarum: 'Serves from the founding.', fabrum: 'Serves from the founding.',
  quaestor: 'Appointed at Vicus, or with the first coin trouble or contract.',
  aedilis: 'Appointed at Vicus, or when a house has waited five days.',
  augur: 'Appointed with the first dispatch, or on Kal. Sept.',
};
const METRIC_UNIT = { days: 'd', houses: 'houses', den: 'den', pct: '%', souls: 'souls' } as const;

let filter: AdvisorId | null = null;

function hushed(s: GameState, a: ActiveAdvisory): boolean {
  return a.memo.snoozeUntil !== undefined && a.memo.snoozeUntil > s.day;
}

/** Remedy buttons; building remedies become "Ask the Ordo" + "Place it myself" (only the latter when construction is manual). */
function remedies(g: Game, list: { remedy: Remedy; label: string; check: ActionResult }[]): HTMLElement {
  const s = g.state;
  const row = h('div', { class: 'adv-remedies' });
  const seen = new Set<BuildingId>();
  const add = (r: Remedy, label: string, check: ActionResult, cls = ''): void => {
    row.append(btn(g, label, () => { g.applyRemedy(r); }, { cls, reason: check.ok ? null : check.reason }));
  };
  for (const x of list) {
    const r = x.remedy;
    if (r.kind !== 'ask' && r.kind !== 'place') { add(r, x.label, x.check, row.childElementCount ? '' : 'primary'); continue; }
    if (seen.has(r.building)) continue;
    seen.add(r.building);
    const ask: Remedy = { kind: 'ask', building: r.building };
    const place: Remedy = r.kind === 'place' ? r : { kind: 'place', building: r.building };
    if (s.ordo.on.build) add(ask, remedyLabel(s, ask), r.kind === 'ask' ? x.check : checkRemedy(s, ask), row.childElementCount ? '' : 'primary');
    add(place, s.ordo.on.build ? 'Place it myself' : remedyLabel(s, place), r.kind === 'place' ? x.check : checkRemedy(s, place));
  }
  return row;
}

function card(g: Game, a: ActiveAdvisory, up: Updater[]): HTMLElement {
  const s = g.state;
  const sev = a.memo.sev;
  const gold = a.rule === OPPORTUNITAS;
  const r = renderAdvisory(s, view(s), a);
  const title = h('div', { class: 'adv-title' }, r.title);
  const text = h('p', { class: 'adv-text' }, r.text);
  const metric = h('span', { class: 'chip adv-metric' });
  let day = s.day;
  const refresh = (): void => {
    const st = g.state;
    const m = st.guidance.advisories[a.rule];
    metric.hidden = !m?.metric;
    if (m?.metric) metric.textContent = `${fmt(m.metric.value)} ${METRIC_UNIT[m.metric.unit]}`;
    if (st.day === day) return;
    day = st.day;
    const cur = activeAdvisories(st).find((x) => x.rule === a.rule);
    if (!cur) return;
    const rr = renderAdvisory(st, view(st), cur);
    title.textContent = rr.title;
    text.textContent = rr.text;
  };
  refresh();
  up.push(refresh);
  const muted = s.guidance.muted.includes(a.rule);
  const foot = h('div', { class: 'adv-foot' },
    h('span', { class: 'adv-since' }, `since ${formatRoman(a.memo.since)}${hushed(s, a) ? ` · hushed until ${formatRoman(a.memo.snoozeUntil ?? s.day)}` : ''}${muted ? ' · muted' : ''}`),
    sev < 3 && !hushed(s, a) ? btn(g, 'Hush 30 d', () => A.hush(g.state, a.rule), { cls: 'ghost', tip: 'Keep it off the counsel card for 30 days. It stays here.' }) : null,
    sev === 0 && !muted ? btn(g, 'Mute', () => A.mute(g.state, a.rule), { cls: 'ghost', tip: 'Never show this note on the counsel card.' }) : null,
    muted ? btn(g, 'Unmute', () => A.unmute(g.state, a.rule), { cls: 'ghost' }) : null);
  return h('div', { class: `card adv-card sev-${sev}${gold ? ' gold' : ''}`, 'data-anchor': a.rule },
    h('div', { class: 'adv-head' }, img(portrait(a.advisor, advisorMood(s, a.advisor)), 2, 'adv-pt'),
      h('div', null, h('div', { class: 'kicker' }, `${caps(ADVISOR_DEFS[a.advisor].office)} · ${gold ? 'OPPORTVNITAS' : caps(SEV_NAME[sev])}`),
        h('div', { class: 'adv-title-row' }, title, metric))),
    text, remedies(g, r.remedies), foot);
}

function portraits(g: Game): HTMLElement {
  const s = g.state;
  const all = activeAdvisories(s);
  return h('div', { class: 'adv-filters', role: 'toolbar', 'aria-label': 'Advisors' }, ADVISORS.map((id) => {
    const appointed = s.guidance.appointed.includes(id);
    const mine = all.filter((x) => x.advisor === id);
    const worst = mine.reduce((m, x) => Math.max(m, x.memo.sev), -1);
    const def = ADVISOR_DEFS[id];
    const b = btn(g, [img(appointed ? portrait(id, advisorMood(s, id)) : portrait('silhouette'), 2),
      h('span', { class: 'adv-f-office' }, def.office.replace(/^(Praefectus|Curator) /, '')),
      worst >= 0 ? h('span', { class: `adv-pip sev-bg-${worst}` }, String(mine.length)) : null],
    () => { filter = filter === id ? null : id; g.changed(); },
    { cls: `adv-f${filter === id ? ' on' : ''}${appointed ? '' : ' absent'}`, sfx: false,
      tip: `${def.office} · ${def.name}\n${def.domain}.${appointed ? '' : `\n${APPOINTED_AT[id]}`}` });
    b.setAttribute('aria-pressed', String(filter === id));
    return b;
  }));
}

/** The Advisors tab. */
export const panel: TabPanel = {
  id: 'advisors', label: 'Consiliarii', sub: 'Advisors', icon: 'i_tab_advisors', hotkey: 'V',
  signature(g: Game): string {
    const s = g.state;
    const rep = councilReport(s);
    return [
      s.guidance.appointed.join(','), filter ?? '',
      activeAdvisories(s).map((a) => `${a.rule}:${a.memo.sev}:${+hushed(s, a)}`).join(','),
      s.guidance.muted.join(','), +s.ordo.on.build, s.ordo.pin ?? '', s.ordo.requests.length,
      rep.agenda.map((w) => `${w.type}:${w.state}`).join(','), rep.would.build?.type ?? '', +!!rep.saving,
    ].join('|');
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    body.append(portraits(g));
    const list = activeAdvisories(s).filter((a) => !filter || a.advisor === filter);
    if (filter) {
      const def = ADVISOR_DEFS[filter];
      const appointed = s.guidance.appointed.includes(filter);
      body.append(h('div', { class: 'adv-who' }, h('b', null, def.name), `, ${def.office}. `, h('span', { class: 'muted' }, `${def.domain}.`),
        appointed ? null : h('div', { class: 'muted' }, APPOINTED_AT[filter])));
    }
    const sec = section('Consilium', filter ? 'What this advisor says' : 'Every advisory, gravest first', { anchor: 'advisories' });
    for (const a of list) sec.append(card(g, a, up));
    const quiet = s.guidance.appointed.filter((id) => (!filter || id === filter) && !list.some((a) => a.advisor === id));
    if (quiet.length) sec.append(h('div', { class: 'adv-quiet' }, `Quiet: ${quiet.map((id) => ADVISOR_DEFS[id].office).join(', ')} ${quiet.length === 1 ? 'has' : 'have'} nothing to say.`));
    if (!list.length && !quiet.length) sec.append(h('div', { class: 'adv-quiet' }, 'Not yet appointed.'));
    body.append(sec);
    const mutedOff = s.guidance.muted.filter((r) => !list.some((a) => a.rule === r) && (!filter || r.startsWith(`${filter}.`)));
    if (mutedOff.length) {
      body.append(h('div', { class: 'adv-muted' }, h('span', { class: 'muted' }, 'Muted notes:'),
        mutedOff.map((r) => btn(g, `${r} ✕`, () => A.unmute(g.state, r), { cls: 'ghost', tip: 'Unmute this note.' }))));
    }
    if (!filter) {
      const ordo = section('Ordo Decurionum', 'The council\'s agenda and why', { anchor: 'agenda' });
      ordo.append(agendaEl(g, up));
      const today = h('ul', { class: 'adv-ticker' });
      const refresh = (): void => { today.replaceChildren(...councilReport(g.state).ticker.slice(0, 4).map((r) => h('li', null, reasonShort(r)))); };
      refresh();
      up.push(refresh);
      ordo.append(h('div', { class: 'tab-note' }, 'Today the Ordo:'), today);
      body.append(ordo);
    }
  },
  badge(g: Game) {
    const adv = activeAdvisories(g.state).filter((a) => a.memo.sev >= 2);
    if (!adv.length) return null;
    return { text: String(adv.length), kind: adv.some((a) => a.memo.sev === 3) ? 'bad' : 'warn' };
  },
  focus(anchor: string): void {
    if ((ADVISORS as readonly string[]).includes(anchor)) filter = anchor as AdvisorId;
    else if ((RULES as readonly string[]).includes(anchor)) filter = null;
  },
};
