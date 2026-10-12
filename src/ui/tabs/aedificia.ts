// src/ui/tabs/aedificia.ts — Aedificia / Build: the Agenda, the works queue (↑, ✕, Move, stage bars), the builders line,
// the tool row, category chips and the building cards (Place, Ask the Ordo, Build next) (DESIGN §10.1, §15.3). Owner: WP-I.
import { PATH_DECISIONS } from '../../game/types';
import type { Building, BuildCat, BuildingId, GameState, ToolId } from '../../game/types';
import type { Game, Updater } from '../types';
import { costEl, fmt, h, img, tip } from '../dom';
import * as A from '../../game/actions';
import { buildingVisible, toolRevealed } from '../../game/reveal';
import { introduced, plainWork, taughtWorks } from '../../game/intro';
import { capitoliumFlow, capitoliumStage, worksQueue } from '../../game/construction';
import { derived } from '../../game/derived';
import { idx } from '../../game/map';
import { getBuilding } from '../../game/state';
import { resolvePlaceAt } from '../../game/site';
import { reasonText } from '../../game/ordo/reasons';
import { B } from '../../game/balance';
import { BUILD_ORDER, BUILDING_DEFS, CAT_LABELS } from '../../game/data/buildings';
import { PATH_DEFS } from '../../game/data/decisions';
import { LAYER_META } from '../../game/data/housing';
import { RESOURCE_DEFS } from '../../game/data/resources';
import { confirm2 } from '../modals';
import { touchInput } from '../pointer';
import { councilReport } from '../../game/ordo/index';
import { agendaEl, bar, btn, fresh, lackLine, lacking, newMark, rankReason, section, typeSprite } from './common';
import type { TabPanel } from './common';
import { labourEl, labourKey, labourShown } from './labour';

const TOOLS: { id: Exclude<ToolId, 'pin'>; label: string; tip: string }[] = [
  { id: 'road', label: 'Road', tip: 'Drag dirt roads across the land (R). Inside the pomerium streets follow the survey.' },
  { id: 'pave', label: 'Pave', tip: 'Pave built roads in basalt: 2 stone a tile, desirability +1.' },
  { id: 'reserve', label: 'Reserve block', tip: 'Mark a block the Ordo must leave alone.' },
  { id: 'demolish', label: 'Demolish', tip: 'Click a building twice to pull it down (25% refund).' },
];
const CATS: readonly BuildCat[] = ['domus', 'annona', 'aqua', 'materia', 'officinae', 'mercatus', 'religio', 'salus', 'ornamenta'];
const STAGES = ['Podium', 'Cella', 'Columnae', 'Fastigium'] as const;
const CLASS_NAME = { plot: 'plot', half: 'half-block', block: 'block', rural: 'rural', fixed: 'fixed' } as const;

let cat: BuildCat | 'all' = 'all';

function footprint(type: BuildingId): string {
  const d = BUILDING_DEFS[type];
  return d.place.map((c) => (c === 'plot' ? 'plot 2×2' : c === 'half' ? 'half-block 4×2' : c === 'block' ? 'block 4×4' : c === 'rural' ? `rural ${d.size[0]}×${d.size[1]}` : CLASS_NAME[c])).join(' or ');
}

function details(s: GameState, type: BuildingId): string {
  const d = BUILDING_DEFS[type];
  const lines = [`${d.name} · ${d.latin}`, d.desc, d.hint, `${footprint(type)} · work ${fmt(d.work)} builder-days`];
  if (d.slots) lines.push(`${d.slots} posts${d.output ? ` · ${d.output.perWorker} ${RESOURCE_DEFS[d.output.res].name.toLowerCase()} a hand a day` : ''}`);
  if (d.passive) lines.push(`${d.passive.perDay} ${RESOURCE_DEFS[d.passive.res].name.toLowerCase()} a day, unstaffed`);
  for (const sv of d.service ?? []) lines.push(`${LAYER_META[sv.layer].label} within ${sv.radius} road steps`);
  if (d.upkeep) lines.push(`Upkeep ${d.upkeep} den a day`);
  const c = lacking(s, d.cost);
  if (c) lines.push(`Short of ${Object.keys(c).length > 1 ? 'materials' : 'it'}: placed now it waits as a plan (⌛) until the stores cover it.`);
  return lines.join('\n');
}

/** The rank whose petition was granted on a day (for NEW markers on freshly unlocked cards). */
function rankDay(s: GameState, rank: number): number | undefined {
  const d = PATH_DECISIONS.find((x) => PATH_DEFS[x].grants === rank && rank > 0);
  return d ? s.decisions.pathDays[d] : undefined;
}

function queueRow(g: Game, b: Building, first: boolean, up: Updater[]): HTMLElement {
  const def = BUILDING_DEFS[b.type];
  const status = h('div', { class: 'bld-q-status' });
  const pb = bar();
  const refresh = (): void => {
    const s = g.state;
    const cur = getBuilding(s, b.id);
    if (!cur) return;
    if (cur.status === 'plan') {
      const lack = lacking(s, def.cost);
      status.textContent = lack ? `⌛ plan: waiting for ${lackLine(g, lack)}` : '⌛ plan: paid on the next day';
      pb.set(0, 'tab-bar plan');
    } else if (cur.status === 'staked') {
      status.textContent = `staked by the Ordo: builders start in ${Math.max(0, cur.placed + B.construction.STAKE_DAYS - s.day)} d`;
      pb.set(1, 'tab-bar staked');
    } else if (cur.type === 'capitolium') {
      const flow = capitoliumFlow(s);
      const st = capitoliumStage(cur);
      status.textContent = `${STAGES[Math.min(3, st)]} rising · ${Math.round(cur.progress * 100)}%${flow?.bottleneck ? ` · bottleneck: ${flow.bottleneck === 'crew' ? 'builders' : RESOURCE_DEFS[flow.bottleneck].name.toLowerCase()}` : ''}${flow?.eta ? ` · next stage ≈ ${flow.eta} d` : ''}`;
      pb.set(cur.progress, 'tab-bar gold');
    } else {
      const trench = cur.progress < B.construction.TRENCH;
      status.textContent = `${trench ? 'foundation trench' : 'rising'} · ${Math.round(cur.progress * 100)}%${first ? '' : ' · queued'}`;
      pb.set(cur.progress, trench ? 'tab-bar trench' : 'tab-bar gold');
    }
  };
  refresh();
  up.push(refresh);
  const refund = b.status === 'plan' ? 'nothing was paid' : g.state.day - b.placed <= B.construction.FULL_REFUND_DAYS && b.progress <= 0 ? '100% back' : '75% back';
  const cancel = b.type === 'capitolium' ? null : h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Cancel' }, '✕');
  if (cancel) {
    tip(cancel, `Cancel the works: ${refund}.`);
    confirm2(cancel, b.status === 'plan' ? 'Drop?' : `Cancel? ${refund.replace(' back', '')}`, () => { g.act(A.cancelSite(g.state, b.id), { okSfx: 'click' }); });
    cancel.addEventListener('click', (e) => e.stopPropagation());
  }
  const owner = b.owner === 'ordo' ? img('i_seal', 1, 'bld-q-owner') : b.status === 'plan' ? img('i_plan', 1, 'bld-q-owner') : null;
  const row = h('div', { class: `bld-q${b.owner === 'ordo' ? ' ordo' : ''}`, role: 'button', tabindex: '0', 'data-key': `q-${b.id}` },
    img(typeSprite(b.type), 1, 'bld-q-img'),
    h('div', { class: 'bld-q-main' }, h('div', { class: 'bld-q-name' }, owner, def.name, b.status === 'staked' ? img('i_stake', 1) : null), status, pb.el,
      b.owner === 'ordo' && b.reason ? h('div', { class: 'tab-why' }, reasonText(b.reason)) : null),
    h('div', { class: 'bld-q-btns' },
      b.status === 'staked' && b.owner === 'ordo' ? btn(g, 'Move', () => { g.startPlacing({ kind: 'building', type: b.type, replaceId: b.id }); }, { tip: 'Place it elsewhere yourself; the stake is refunded.' }) : null,
      btn(g, '↑', () => A.prioritise(g.state, b.id), { cls: 'ghost', reason: first ? 'Already first in the queue.' : null, tip: 'Build this first.' }),
      cancel));
  row.addEventListener('click', () => { g.select(b.id); g.focusTile(idx(b.x, b.y)); });
  return row;
}

/** A work's card; `plain` (while the lessons run, §11.13): its name, what it does, its cost and Place, nothing more. */
function cardEl(g: Game, type: BuildingId, up: Updater[], plain = false): HTMLElement {
  const s = g.state;
  const def = BUILDING_DEFS[type];
  const d = derived(s);
  const locked = rankReason(s, type);
  const max = def.maxCount !== undefined && (d.all[type] ?? 0) >= def.maxCount ? `Only ${def.maxCount} may be raised.` : null;
  const reason = locked ?? max;
  const placing = g.view.placing;
  const sel = placing?.kind === 'building' && placing.type === type;
  const cost = h('span', { class: 'bld-cost' });
  const refresh = (): void => { cost.replaceChildren(costEl(g.state, def.cost)); };
  refresh();
  up.push(refresh);
  const built = d.counts[type] ?? 0;
  const going = (d.all[type] ?? 0) - built;
  const pinned = s.ordo.pin === type;
  const full = s.ordo.requests.length >= B.ordo.REQUESTS_MAX ? `The Ordo already holds ${B.ordo.REQUESTS_MAX} requests.` : null;
  const card = h('div', { class: `bld-card${sel ? ' sel' : ''}${locked ? ' locked' : ''}`, 'data-anchor': `b-${type}` },
    h('div', { class: 'bld-img' }, img(typeSprite(type), 1)),
    h('div', { class: 'bld-main' },
      h('div', { class: 'bld-name' }, h('b', null, def.name), h('span', { class: 'bld-latin' }, def.latin),
        fresh(s, rankDay(s, def.rank)) ? newMark() : null),
      plain ? null : h('div', { class: 'bld-meta' }, footprint(type), built || going ? ` · ${built} built${going ? `, ${going} under way` : ''}` : ''),
      h('div', { class: 'bld-benefit' }, (plain && plainWork(type)) || def.benefit),
      locked ? h('div', { class: 'bld-lock' }, `Requires ${locked.replace(/^Rome grants this to (an?) /, '').replace(/\.$/, '')}`) : cost,
      locked ? null : h('div', { class: 'bld-btns' },
        // a finger previews before it places, so its ghost starts on the best plot; a mouse hovers the plots itself and
        // its camera never jumps (ui/pointer.ts reads this very press)
        btn(g, 'Place', () => { g.startPlacing({ kind: 'building', type, at: touchInput() ? resolvePlaceAt(g.state, type) : undefined }); },
          { cls: 'primary', reason, tip: 'Choose a glowing plot or site on the map.' }),
        s.ordo.on.build && !plain ? btn(g, 'Ask the Ordo', () => A.askOrdo(g.state, type), { reason: reason ?? full, tip: 'The Ordo places it at its best site within 2 days.' }) : null,
        toolRevealed(s, 'pin') && !plain ? btn(g, pinned ? 'Pinned ✓' : 'Build next', () => A.pinBuild(g.state, pinned ? null : type),
          { cls: pinned ? 'on' : '', reason: pinned ? null : reason, tip: pinned ? 'Release the pin.' : 'The Ordo saves for it and raises it first.' }) : null)));
  tip(card.querySelector('.bld-img') as HTMLElement, () => details(g.state, type), { wide: true });
  tip(card.querySelector('.bld-name') as HTMLElement, () => details(g.state, type), { wide: true });
  return card;
}

/** The Build tab. */
export const panel: TabPanel = {
  id: 'build', label: 'Aedificia', sub: 'Build', icon: 'i_tab_build', hotkey: 'B',
  signature(g: Game): string {
    const s = g.state;
    const d = derived(s);
    const placing = g.view.placing;
    return [
      s.rank, cat, BUILD_ORDER.filter((t) => buildingVisible(s, t)).join(','),
      (['pin', 'road', 'pave', 'reserve', 'demolish'] as const).map((t) => +toolRevealed(s, t)).join(''),
      worksQueue(s).map((b) => `${b.id}:${b.status}:${b.owner}`).join(','),
      BUILD_ORDER.map((t) => `${d.counts[t] ?? 0}.${d.all[t] ?? 0}`).join(','),
      +s.ordo.on.build, Object.values(s.ordo.works).map(Number).join(''), councilReport(s).would.build?.type ?? '', +introduced(s, 'catalog'), taughtWorks(s).join(','), labourKey(s), s.ordo.pin ?? '', s.ordo.requests.map((r) => r.type).join(','),
      placing?.kind === 'building' ? placing.type : placing?.kind ?? '',
      BUILD_ORDER.map((t) => +fresh(s, rankDay(s, BUILDING_DEFS[t].rank))).join(''),
    ].join('|');
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    // while the lessons run (§11.13) Aedificia offers only the works they have asked for, plainly: no Ordo agenda, no
    // tools, no categories; the queue shows only while something rises. Every work opens with its own lesson.
    const all = introduced(s, 'catalog');
    if (all) {
      const agenda = section('Agenda Ordinis', s.ordo.on.build ? 'What the Ordo raises next, and why' : 'What the Ordo would raise', { anchor: 'agenda' });
      agenda.append(agendaEl(g, up));
      body.append(agenda);
    }
    const queue = worksQueue(s);
    if (!all) {
      if (queue.length) {
        const works = section('Opera', `Works queue · ${queue.length}`, { anchor: 'works' });
        queue.forEach((b, i) => works.append(queueRow(g, b, i === 0, up)));
        body.append(works);
      }
      const sec = section('Aedificia', 'Raise a work yourself', { anchor: 'cards', note: 'Pick a work, then a glowing plot on the map.' });
      for (const t of taughtWorks(s)) sec.append(cardEl(g, t, up, true));
      body.append(sec);
      return;
    }
    const works = section('Opera', queue.length ? `Works queue · ${queue.length}` : 'Works queue', { anchor: 'works',
      note: queue.length ? `Builders work down the queue: your works first, then the Ordo's. ${touchInput() ? 'Tap' : 'Click'} a row to see it.` : 'Nothing is being built.' });
    queue.forEach((b, i) => works.append(queueRow(g, b, i === 0, up)));
    if (labourShown(s, 'builders')) works.append(labourEl(g, up, ['builders']));
    body.append(works);
    const tools = TOOLS.filter((t) => toolRevealed(s, t.id));
    if (tools.length) {
      body.append(h('div', { class: 'bld-tools' }, tools.map((t) => {
        const b = btn(g, [img(`i_tool_${t.id}`, 1), t.label], () => { g.startPlacing({ kind: t.id }); }, { cls: 'ghost', tip: t.tip });
        b.dataset.anchor = t.id;   // "Open Aedificia: roads" lands on the road tool
        return b;
      })));
    }
    const visible = BUILD_ORDER.filter((t) => buildingVisible(s, t));
    const cats = CATS.filter((c) => visible.some((t) => BUILDING_DEFS[t].cat === c));
    const chips = h('div', { class: 'bld-cats', role: 'tablist', 'aria-label': 'Categories' },
      [btn(g, 'All', () => { cat = 'all'; g.changed(); }, { cls: `bld-cat${cat === 'all' ? ' on' : ''}`, sfx: false }),
        ...cats.map((c) => btn(g, CAT_LABELS[c].latin, () => { cat = c; g.changed(); },
          { cls: `bld-cat${cat === c ? ' on' : ''}`, sfx: false, tip: CAT_LABELS[c].english }))]);
    const sec = section('Aedificia', cat === 'all' ? 'Raise a work yourself' : CAT_LABELS[cat].english, { anchor: 'cards',
      note: s.ordo.on.build ? 'Your works are raised before the Ordo\'s. Gold ground on the map means a bonus; the laurel marks the Ordo\'s choice.' : 'Pick a work, then a glowing plot. Unaffordable works wait as plans.' });
    sec.append(chips);
    for (const t of visible) if (cat === 'all' || BUILDING_DEFS[t].cat === cat) sec.append(cardEl(g, t, up));
    body.append(sec);
  },
  badge(g: Game) {
    const n = g.state.buildings.filter((b) => b.status === 'plan').length;
    return n ? { text: String(n), kind: 'info' } : null;
  },
  focus(anchor: string): void {
    // a card is shown among its own kind (the Aqua works for a cistern), so the work asked for is near the top
    if (anchor.startsWith('b-')) cat = BUILDING_DEFS[anchor.slice(2) as BuildingId]?.cat ?? 'all';
  },
};
