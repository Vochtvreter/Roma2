// src/ui/tabs/house.ts — the house part of the inspector: tier, household, beds and tax, the next tier's needs with
// icons (✔/○) and how to fix each ○, renovation, decline countdown, the insula/domus preference (DESIGN §7, §15.4). Owner: WP-I.
import { HOUSE_TIERS, HUBS, TRADE_RES } from '../../game/types';
import type { Building, BuildingId, HousePref, HubId, NeedId, TradeRes } from '../../game/types';
import type { Game, Updater } from '../types';
import { costEl, fmt, h, img } from '../dom';
import type { Kid } from '../dom';
import * as A from '../../game/actions';
import { houseBeds, residents } from '../../game/census';
import { houseTax, nextTier, unmetNeeds, firstWant } from '../../game/housing';
import { derived } from '../../game/derived';
import { hubOpen, price } from '../../game/trade';
import { personName } from '../../game/people';
import { overlayRevealed } from '../../game/reveal';
import { B } from '../../game/balance';
import { BUILDING_DEFS } from '../../game/data/buildings';
import { NEED_META, TIER_DEFS } from '../../game/data/housing';
import { RANK_DEFS } from '../../game/data/ranks';
import { feminine } from '../../game/data/names';
import { article, btn, rankReason, seg } from './common';

/** The service a want asks for (water becomes a fountain once a castellum flows). */
const SERVICE: Partial<Record<NeedId, BuildingId>> = {
  water: 'puteus', religion: 'lararium', market: 'taberna', temple: 'templum', baths: 'balneum', macellum: 'macellum', desirability: 'hortus', oil: 'olivetum',
};
const HINT: Record<NeedId, string> = {
  street: 'A street or road beside it.', water: 'A well within 4 road steps of its street, or a public fountain.',
  fed: 'The whole colony fed for a month (fed index ≥ 90%).', religion: 'A wayside shrine within 5 steps, or a temple.',
  market: 'A shop row within 6 steps, or a market hall.', temple: 'A temple within 12 steps.',
  desirability: 'A finer street: gardens, temples and fountains raise it; workshops, stores and insulae lower it.',
  baths: 'A bathhouse within 8 steps.', macellum: 'A market hall within 10 steps.',
  oil: 'Oil delivered by a market hall: olive groves or imports.', wine: 'Wine delivered by a market hall: it comes only by trade.',
  rank: 'A higher charter from Rome.', materials: 'Renovation materials: the stores lack them beyond the Ordo\'s reserve.',
};
const PREFS: readonly HousePref[] = ['auto', 'insula', 'domus'];
const IMPORT_QTY = 40;

/** The cheapest open hub that sells a good, or null. */
function cheapestHub(g: Game, res: TradeRes): HubId | null {
  let best: { id: HubId; p: number } | null = null;
  for (const id of HUBS) {
    if (!hubOpen(g.state, id)) continue;
    const p = price(g.state, id, res, 'buy');
    if (p !== null && (!best || p < best.p)) best = { id, p };
  }
  return best?.id ?? null;
}

/** How to fix one unmet need: a hint and the buttons that do it. */
function fix(g: Game, need: NeedId): Kid[] {
  const s = g.state;
  let type = SERVICE[need];
  if (need === 'water' && derived(s).castellumActive && !rankReason(s, 'lacus')) type = 'lacus';
  const out: Kid[] = [];
  if (type) {
    const reason = rankReason(s, type);
    if (s.ordo.on.build) out.push(btn(g, 'Ask the Ordo', () => A.askOrdo(g.state, type), { reason, tip: `The Ordo raises ${BUILDING_DEFS[type].name.toLowerCase()} at its best site.` }));
    out.push(btn(g, `Place ${article(BUILDING_DEFS[type].name.toLowerCase())}`, () => { g.startPlacing({ kind: 'building', type }); }, { cls: 'primary', reason }));
  }
  if (need === 'desirability' && overlayRevealed(s, 'desir')) out.push(btn(g, 'Show on map', () => { g.view.setOverlay('desir'); }, { cls: 'ghost' }));
  if (need === 'fed') out.push(btn(g, 'Rations', () => { g.openTab('council', 'edict-rationes'); }, { cls: 'ghost' }));
  if (need === 'rank') out.push(btn(g, 'Petition', () => { g.openTab('council', 'petition'); }, { cls: 'ghost' }));
  if (need === 'street') out.push(btn(g, 'Lay a road', () => { g.startPlacing({ kind: 'road' }); }, { cls: 'ghost' }));
  if ((need === 'oil' || need === 'wine') && (TRADE_RES as readonly string[]).includes(need)) {
    const hub = cheapestHub(g, need);
    out.push(btn(g, `Import ${need}`, () => { if (hub) g.prefillContract({ hub, mode: 'import', res: need, qty: IMPORT_QTY, repeat: true }); },
      { cls: 'ghost', reason: hub ? null : `No open market sells ${need} yet.` }));
  }
  return out;
}

/** The household's gens: the family living here, else the first resident's. */
function gensOf(g: Game, b: Building): string | null {
  const s = g.state;
  const fam = s.families.find((f) => f.home === b.id) ?? s.families.find((f) => f.id === residents(s, b.id)[0]?.family);
  return fam ? `gens ${feminine(fam.gens)}` : null;
}

/** The house view's parts (header facts first). */
export function houseView(g: Game, b: Building, up: Updater[]): HTMLElement[] {
  const s = g.state;
  const hs = b.house;
  if (!hs) return [];
  const tier = TIER_DEFS[hs.tier];
  const out: HTMLElement[] = [];
  const beds = h('div', { class: 'ins-line' });
  const who = h('div', { class: 'ins-small muted' });
  const refresh = (): void => {
    const st = g.state;
    const res = residents(st, b.id);
    const tax = houseTax(st, b) * res.length;
    beds.textContent = `${res.length} of ${houseBeds(st, b)} beds · tax ${fmt(tax)} den a day${hs.declining ? ' (halved while declining)' : ''}`;
    who.textContent = res.length ? res.slice(0, 6).map(personName).join(', ') + (res.length > 6 ? ` and ${res.length - 6} more` : '') : 'Nobody lives here yet.';
  };
  refresh();
  up.push(refresh);
  const gens = gensOf(g, b);
  out.push(h('div', { class: 'ins-sub' }, `${tier.name}${gens ? ` · ${gens}` : ''}`), beds, who);
  if (hs.renovating) {
    const r = h('div', { class: 'ins-good' });
    const tick = (): void => { r.textContent = `Renovating into ${TIER_DEFS[hs.renovating?.to ?? hs.tier].latin}: ${Math.max(0, (hs.renovating?.until ?? 0) - g.state.day)} days left.`; };
    tick();
    up.push(tick);
    out.push(r);
  }
  if (hs.declining) {
    const lower = HOUSE_TIERS[Math.max(B.housing.MIN_DROP_LEVEL, HOUSE_TIERS.indexOf(hs.tier) - 1)];
    const lapsed = unmetNeeds(s, b, hs.tier).map((n) => NEED_META[n].label.toLowerCase()).join(', ');
    const d = h('div', { class: 'ins-bad' });
    const tick = (): void => { d.textContent = `Declining${lapsed ? `: ${lapsed} lapsed` : ''}. Falls back to ${TIER_DEFS[lower].latin} in ${Math.max(0, B.housing.DROP_AFTER - hs.declineDays)} days unless restored.`; };
    tick();
    up.push(tick);
    out.push(d);
  }
  const next = nextTier(s, b);
  if (!next) {
    out.push(h('div', { class: 'ins-good' }, `The finest home of its kind.`));
  } else {
    const nt = TIER_DEFS[next];
    const unmet = unmetNeeds(s, b, next);
    const want = firstWant(s, b);
    const list = h('ul', { class: 'ins-needs' }, nt.needs.filter((n) => n !== 'street').map((n) => {
      const met = !unmet.includes(n);
      return h('li', { class: met ? 'met' : 'unmet' }, h('span', { class: 'ins-mark' }, met ? '✔' : '○'), img(NEED_META[n].icon, 1, 'ins-want'),
        h('span', { class: 'ins-need' }, n === 'rank' ? `A ${RANK_DEFS[nt.rank].name} charter` : NEED_META[n].label,
          met ? null : h('div', { class: 'ins-hint' }, HINT[n]), met ? null : h('div', { class: 'ins-fix' }, fix(g, n))));
    }));
    if (want === 'materials') list.append(h('li', { class: 'unmet' }, h('span', { class: 'ins-mark' }, '○'), img(NEED_META.materials.icon, 1, 'ins-want'),
      h('span', { class: 'ins-need' }, NEED_META.materials.label, h('div', { class: 'ins-hint' }, HINT.materials))));
    out.push(h('div', { class: 'ins-head2' }, `To become ${nt.latin} (${nt.name.toLowerCase()}, ${nt.beds} beds)`), list,
      h('div', { class: 'ins-line' }, 'Renovation: ', costEl(s, nt.renovation), h('span', { class: 'ins-small muted' }, ` after ${B.housing.OK_DAYS} days with every need met`)));
  }
  if (tier.level >= 3) {
    out.push(h('div', { class: 'ins-head2' }, 'Insula or domus?'),
      seg(g, PREFS.map((p) => ({ id: p, label: p === 'auto' ? 'As the street allows' : p === 'insula' ? 'Insula' : 'Domus',
        tip: p === 'auto' ? 'A domus where desirability reaches 10, else an insula.' : p === 'insula' ? 'Many hands for work: 24 beds.' : 'Patricians: few hands, rich taxes and prestige; needs wine and desirability 10.' })),
      hs.pref, (p) => A.setHousePref(g.state, b.id, p)));
  }
  return out;
}
