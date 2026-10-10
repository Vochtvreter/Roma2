// src/ui/tabs/populus.ts — Populus / People: the census, homes by tier with what blocks them, labour lines, the Watch
// list, the Gentes and the roster (DESIGN §6, §7, §10.4, §15.3). Owner: WP-I.
import { BUILDER, HOUSE_TIERS, STAGES } from '../../game/types';
import type { GameState, HouseTierId, NeedId, Person } from '../../game/types';
import type { Game, Updater } from '../types';
import { fmt, h, img, plural, tip } from '../dom';
import { ageOf, census, stageOf } from '../../game/census';
import { personName } from '../../game/people';
import { firstWant } from '../../game/housing';
import { derived } from '../../game/derived';
import { getBuilding } from '../../game/state';
import { elapsed } from '../../game/calendar';
import { B } from '../../game/balance';
import { BUILDING_DEFS } from '../../game/data/buildings';
import { NEED_META, TIER_DEFS } from '../../game/data/housing';
import { RANK_DEFS } from '../../game/data/ranks';
import { feminine } from '../../game/data/names';
import { houseSprite } from '../../render/art/index';
import { section } from './common';
import type { TabPanel } from './common';
import { labourEl } from './labour';

const STAGE_NAME = ['Children', 'Youths', 'Adults', 'Elders'] as const;
const HUNGER = ['Sated', 'Peckish', 'Hungry', 'Starving'] as const;
const THIRST = ['Hydrated', 'Thirsty', 'Parched', 'Dehydrated'] as const;
const WATCH_BAND = 2;                 // Hungry / Parched or worse
const ROSTER = 60;
const GENTES_SHOWN = 12;

let rosterOpen = false;

function band(v: number): number {
  const [a, b, c] = B.needs.BAND;
  return v <= a ? 0 : v <= b ? 1 : v <= c ? 2 : 3;
}

function moraleLabel(m: number): string {
  const [hi, mid, lo] = B.morale.LABELS;
  return m >= hi ? 'High spirits' : m >= mid ? 'Steady' : m >= lo ? 'Uneasy' : 'Despondent';
}

/** Watch entries: stage groups Hungry/Parched or worse, the sick and the homeless. */
function watch(s: GameState): string[] {
  const out: string[] = [];
  STAGES.forEach((_, i) => {
    const hb = band(s.needs.hunger[i]), tb = band(s.needs.thirst[i]);
    if (hb >= WATCH_BAND) out.push(`${STAGE_NAME[i]} are ${HUNGER[hb].toLowerCase()} (${Math.round(s.needs.hunger[i])}).`);
    if (tb >= WATCH_BAND) out.push(`${STAGE_NAME[i]} are ${THIRST[tb].toLowerCase()} (${Math.round(s.needs.thirst[i])}).`);
  });
  const sick = s.people.filter((p) => p.sickUntil !== undefined && p.sickUntil > s.day);
  if (sick.length) out.push(`${plural(sick.length, 'soul lies', 'souls lie')} sick with fever: ${sick.slice(0, 3).map(personName).join(', ')}${sick.length > 3 ? '…' : ''}.`);
  const homeless = s.people.filter((p) => p.home === null);
  if (homeless.length) out.push(`${plural(homeless.length, 'soul has', 'souls have')} no roof. After ${B.people.HOMELESS_LEAVE} days they leave.`);
  return out;
}

function role(s: GameState, p: Person): string {
  if (p.sickUntil !== undefined && p.sickUntil > s.day) return 'sick';
  if (p.work === BUILDER) return 'builder';
  if (p.work !== null) { const b = getBuilding(s, p.work); return b ? BUILDING_DEFS[b.type].name.toLowerCase() : 'at work'; }
  const st = stageOf(p, s.day);
  if (st < 2) return st === 0 ? 'child' : 'youth';
  if (ageOf(p, s.day) >= B.people.RETIRE) return 'retired';
  const home = p.home !== null ? getBuilding(s, p.home) : undefined;
  return home?.house?.tier === 'domus' ? 'patrician' : 'idle';
}

function stats(g: Game, up: Updater[]): HTMLElement {
  const grid = h('div', { class: 'pop-grid' });
  const cell = (k: string, t: () => string): HTMLElement => {
    const v = h('div', { class: 'pop-v num' });
    grid.append(tip(h('div', { class: 'pop-cell' }, h('div', { class: 'pop-k' }, k), v), t));
    return v;
  };
  const souls = cell('Souls', () => `Everyone in ${g.state.name}. Peak ${g.state.stats.peakPop}.`);
  const beds = cell('Free beds', () => 'Families arrive only when a house has beds for all of them.');
  const roll = cell('Rome\'s roll', () => 'Immigration never takes us above Rome\'s roll; a petition for the next rank raises it.');
  const spirits = cell('Spirits', () => 'Laetitia: happy people work harder (×0.85–1.15), marry, and draw newcomers.');
  const work = cell('Able hands', () => 'Adults and elders under 65, not patricii, not sick.');
  const life = cell('Births · deaths', () => `Since the founding: ${g.state.stats.births} births, ${g.state.stats.deaths} deaths, ${g.state.stats.immigrants} arrivals, ${g.state.stats.emigrants} departures.`);
  const stage = h('div', { class: 'pop-stages' });
  const legend = h('div', { class: 'pop-legend' });
  const refresh = (): void => {
    const s = g.state;
    const c = census(s);
    souls.textContent = fmt(c.pop);
    beds.textContent = `${fmt(c.freeBeds)} / ${fmt(c.beds)}`;
    beds.classList.toggle('warn', c.freeBeds < 2);
    roll.textContent = `${fmt(c.pop)} / ${fmt(c.roll || RANK_DEFS[s.rank].ceiling)}`;
    spirits.textContent = `${Math.round(s.morale)} · ${moraleLabel(s.morale)}`;
    work.textContent = `${c.workforce} · ${c.idle.length} idle`;
    const years = Math.max(1, elapsed(s) / B.time.YEAR_DAYS);
    life.textContent = `${fmt(s.stats.births / years)} · ${fmt(s.stats.deaths / years)} a year`;
    stage.replaceChildren(...c.byStage.map((n, i) => h('i', { class: `pop-st${i}`, style: { flexGrow: String(n) } })));
    legend.textContent = c.byStage.map((n, i) => `${STAGE_NAME[i]} ${n}`).join(' · ');
  };
  refresh();
  up.push(refresh);
  return h('div', null, grid, stage, legend);
}

/** Houses of each tier, and what the next tier waits for (first unmet want), refreshed once a day. */
function homes(g: Game, up: Updater[]): HTMLElement {
  const box = h('div', { class: 'pop-homes' });
  let day = -1;
  const refresh = (): void => {
    const s = g.state;
    if (s.day === day) return;
    day = s.day;
    const c = census(s);
    const max = Math.max(1, ...HOUSE_TIERS.map((t) => c.byTier[t]));
    const wants: Record<string, Partial<Record<NeedId, number>>> = {};
    for (const id of derived(s).houses) {
      const b = getBuilding(s, id);
      if (!b?.house) continue;
      const w = firstWant(s, b);
      if (!w) continue;
      const m = (wants[b.house.tier] ??= {});
      m[w] = (m[w] ?? 0) + 1;
    }
    box.replaceChildren(...HOUSE_TIERS.filter((t) => c.byTier[t] > 0).map((t: HouseTierId) => {
      const def = TIER_DEFS[t];
      const blocked = Object.entries(wants[t] ?? {}) as [NeedId, number][];
      return h('div', { class: 'pop-tier' },
        img(houseSprite(t, false, 0, 0), 1, 'pop-tier-img'),
        h('div', { class: 'pop-tier-main' },
          h('div', null, h('b', null, def.latin), h('span', { class: 'ed-en' }, def.name), h('span', { class: 'pop-tier-n num' }, String(c.byTier[t]))),
          h('div', { class: 'tab-bar gold' }, h('i', { style: { width: `${Math.round((c.byTier[t] / max) * 100)}%` } })),
          blocked.length ? h('div', { class: 'pop-blocked' }, 'Waiting for: ', blocked.sort((a, b) => b[1] - a[1]).map(([n, k]) =>
            h('button', { class: 'chip pop-want', type: 'button', onclick: () => { g.view.setOverlay('domus'); g.sfx('click'); } },
              img(NEED_META[n].icon, 1, 'chip-ico'), `${k} · ${NEED_META[n].label.toLowerCase()}`))) : null));
    }));
    if (c.declining) box.append(h('div', { class: 'ed-warn' }, `${plural(c.declining, 'home is', 'homes are')} declining. Hover them on the map to see what lapsed.`));
    if (!c.houses) box.append(h('div', { class: 'tab-quiet' }, 'No homes yet.'));
  };
  refresh();
  up.push(refresh);
  return box;
}

function gentes(g: Game, up: Updater[]): HTMLElement {
  const list = h('div', { class: 'pop-gentes' });
  let day = -1;
  const refresh = (): void => {
    const s = g.state;
    if (s.day === day) return;
    day = s.day;
    const size: Record<number, number> = {};
    const vets = new Set<number>();
    for (const p of s.people) { size[p.family] = (size[p.family] ?? 0) + 1; if (p.vet) vets.add(p.family); }
    const fams = s.families.filter((f) => size[f.id]).sort((a, b) => (size[b.id] ?? 0) - (size[a.id] ?? 0) || a.id - b.id);
    const row = (f: GameState['families'][number]): HTMLElement => {
      const head = s.people.find((p) => p.id === f.head);
      const home = f.home !== null ? getBuilding(s, f.home) : undefined;
      return h('div', { class: 'pop-gens' }, h('b', null, `gens ${feminine(f.gens)}`), vets.has(f.id) ? h('span', { class: 'chip gold' }, 'veterans') : null,
        h('span', { class: 'muted' }, ` ${head ? personName(head) : '—'} · ${size[f.id]} souls · ${home?.house ? TIER_DEFS[home.house.tier].latin : 'no roof'}`));
    };
    list.replaceChildren(...fams.slice(0, GENTES_SHOWN).map(row));
    if (fams.length > GENTES_SHOWN) list.append(h('details', null, h('summary', { class: 'muted' }, `${fams.length - GENTES_SHOWN} more households`), fams.slice(GENTES_SHOWN).map(row)));
  };
  refresh();
  up.push(refresh);
  return list;
}

function roster(g: Game): HTMLElement {
  const grid = h('div', { class: 'pop-roster' });
  const fill = (): void => {
    const s = g.state;
    const old = [...s.people].sort((a, b) => a.born - b.born || a.id - b.id).slice(0, ROSTER);
    grid.replaceChildren(h('span', { class: 'pop-k' }, 'NAME'), h('span', { class: 'pop-k' }, 'ROLE'), h('span', { class: 'pop-k r' }, 'AGE'),
      ...old.flatMap((p) => [h('span', null, personName(p)), h('span', { class: 'muted' }, role(s, p)), h('span', { class: 'num r' }, String(ageOf(p, s.day)))]));
  };
  const d = h('details', { class: 'pop-roster-wrap', open: rosterOpen }, h('summary', { class: 'tab-sec-head' }, h('span', { class: 'tab-sec-latin' }, 'TABVLAE'), h('span', { class: 'tab-sec-en' }, `Roster · the ${ROSTER} eldest`)), grid);
  d.addEventListener('toggle', () => { rosterOpen = d.open; if (d.open) fill(); });
  if (rosterOpen) fill();
  return d;
}

/** The People tab. */
export const panel: TabPanel = {
  id: 'people', label: 'Populus', sub: 'People', icon: 'i_tab_people', hotkey: 'P',
  signature(g: Game): string {
    const s = g.state;
    const c = census(s);
    return [HOUSE_TIERS.map((t) => c.byTier[t]).join(','), c.declining, +s.ordo.on.labour, s.families.length,
      watch(s).length, s.ordo.priorities.map((p) => p.cat).join(',')].join('|');
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    const census_ = section('Census', 'Souls, beds and spirits', { anchor: 'census' });
    census_.append(stats(g, up));
    body.append(census_);
    const w = watch(s);
    if (w.length) {
      const sec = section('Custodia', 'Watch', { anchor: 'watch' });
      sec.append(h('ul', { class: 'pop-watch' }, w.map((x) => h('li', null, x))));
      body.append(sec);
    }
    const labour = section('Operae', s.ordo.on.labour ? 'Labour: hands at work / wanted · posts' : 'Labour: your targets', { anchor: 'labour',
      note: s.ordo.on.labour ? 'The Ordo staffs every post daily, water first, then food, and says why.' : null });
    labour.append(labourEl(g, up));
    body.append(labour);
    const domus = section('Domus', 'Homes by tier, and what they wait for', { anchor: 'homes' });
    domus.append(homes(g, up));
    body.append(domus);
    const gens = section('Gentes', `Households · ${s.families.length}`, { anchor: 'gentes' });
    gens.append(gentes(g, up));
    body.append(gens, roster(g));
  },
  badge(g: Game) {
    const s = g.state;
    const w = watch(s).length;
    if (w) return { text: String(w), kind: 'bad' };
    const idle = s.ordo.on.labour ? 0 : census(s).idle.length;
    return idle ? { text: String(idle), kind: 'info' } : null;
  },
};
