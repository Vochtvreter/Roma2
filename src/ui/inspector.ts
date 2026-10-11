// src/ui/inspector.ts — the house / building / block / tile inspector (ARCHITECTURE §13.3, DESIGN §15.4, §11.10). Owner: WP-I.
// Hover = a transient card bottom left, click = a closable popup pinned beside the target; signature-diffed like the panels (rebuild on discrete change, else updaters).
// The same target is not rebuilt while the mouse rests on its card, unless to answer a click there (steady.ts): its buttons stay put.
import { BUILDER, F, T } from '../game/types';
import type { Building, GameState, ResId, SiteNote, Terrain } from '../game/types';
import type { Game, InspectTarget, Updater } from './types';
import { clear, fmt, fmtRunway, h, img, plural } from './dom';
import * as A from '../game/actions';
import { getBuilding } from '../game/state';
import { fertility, getMap, idx, isFertile, tx, ty, woodAt } from '../game/map';
import { derived, inCamp } from '../game/derived';
import { WALL_RING, ringsOf } from '../game/survey';
import { footfall, wearOf } from '../game/urbs';
import { canPlace } from '../game/place';
import { worksQueue } from '../game/construction';
import { siteMult } from '../game/site';
import { effectiveRadius } from '../game/coverage';
import { census } from '../game/census';
import { forecast } from '../game/forecast';
import { personName } from '../game/people';
import { outputChain } from '../game/hints';
import { isAquae, nextTier, unmetNeeds } from '../game/housing';
import { reasonText } from '../game/ordo/reasons';
import { seasonOf, formatRoman } from '../game/calendar';
import { buildingVisible, toolRevealed } from '../game/reveal';
import { B } from '../game/balance';
import { BUILD_ORDER, BUILDING_DEFS } from '../game/data/buildings';
import { LAYER_META, TIER_DEFS } from '../game/data/housing';
import { RESOURCE_DEFS } from '../game/data/resources';
import { RANK_DEFS } from '../game/data/ranks';
import { buildingSprite, houseSprite } from '../render/art/index';
import { confirm2 } from './modals';
import { PointerHold } from './steady';
import { bar, btn, caps, lackLine, lacking, pct, rankReason, seg, typeSprite } from './tabs/common';
import { houseView } from './tabs/house';

/** '+4,000 grain (4.2 months at today's 32/day)': what a store adds, in time at today's need for grain and water (§8.6). */
function storeText(s: GameState, r: ResId, n: number): string {
  const base = `+${fmt(n)} ${RESOURCE_DEFS[r].name.toLowerCase()}`;
  if (r !== 'grain' && r !== 'water') return base;
  const need = forecast(s)[r].need;
  return need > 0 ? `${base} (${fmtRunway(n / need)} at today's ${fmt(need)}/day)` : base;
}

const TERRAIN: Record<number, string> = {
  [T.grass]: 'Grassland', [T.meadow]: 'Meadow', [T.loam]: 'River loam', [T.scrub]: 'Scrub', [T.forest]: 'Forest',
  [T.dense]: 'Dense forest', [T.hills]: 'Hills', [T.rock]: 'Rock', [T.crag]: 'Crag', [T.river]: 'River',
};
const FEATURE: Record<number, string> = { [F.clay]: 'a clay bank', [F.ore]: 'an iron vein', [F.fons]: 'a spring', [F.lucus]: 'a sacred grove', [F.ruins]: 'old ruins' };
const DISTRICT = { praetentura: 'Praetentura', latera: 'Latera', retentura: 'Retentura', canabae: 'Canabae', vallum: 'Vetus vallum' } as const;
const RING = ['inside the castrum', 'in the canabae ring', 'in the outer ring', 'on the old camp wall'] as const;
const WEAR_WORD = ['a grassy track', 'a track', 'a busy road', 'a highway'] as const;
const NOTE: Record<SiteNote['code'], (v?: number) => string> = {
  river: (v) => `beside the river${v ? ` (${pct(1 + v)})` : ''}`, loam: () => 'on river loam', fields: (v) => `next to ${v ?? 1} fields`,
  forum: (v) => `${v ?? '?'} steps from the forum`, woods: (v) => `woods ${v !== undefined ? `×${fmt(v)}` : 'nearby'}`, rock: () => 'on hills and rock',
  clay: () => 'touching a clay bank', vein: (v) => `on an iron vein${v ? ` (quality ×${fmt(v)})` : ''}`, quarryNear: () => 'a quarry within 6 tiles',
  mineNear: () => 'a mine within 4 tiles', district: () => 'in its proper district', covers: (v) => `covers ${plural(v ?? 0, 'house', 'houses')}`,
  unblocks: (v) => `lets ${plural(v ?? 0, 'house', 'houses')} evolve`, felling: (v) => `felling gave ${v ?? 0} timber`, water: () => 'on the water table', via: () => 'touching the via',
};
const PRIO = ['Low', 'Normal', 'High'] as const;
const PRIO_IDS = ['0', '1', '2'] as const;
const STAGES = ['Podium', 'Cella', 'Columnae', 'Fastigium'] as const;

function staffOf(s: GameState, b: Building): number {
  return census(s).staffed[b.id] ?? 0;
}

/** Discrete facts of a target: a change rebuilds the card; everything continuous refreshes through updaters. */
function targetSig(s: GameState, t: InspectTarget, sticky: boolean): string {
  if (t.kind === 'building') {
    const b = getBuilding(s, t.id);
    if (!b) return `gone:${t.id}`;
    const hs = b.house;
    const next = hs ? nextTier(s, b) : null;
    return [`b${b.id}`, b.status, b.owner, +b.open, b.prio, staffOf(s, b), hs ? `${hs.tier}:${hs.pref}:${+hs.declining}:${+!!hs.renovating}` : '',
      next ? unmetNeeds(s, b, next).join(',') : '', +s.ordo.on.build, s.rank].join('|');
  }
  if (t.kind === 'block') {
    const p = derived(s).plotOwner;
    return `k${t.block}|${+s.ordo.reserved.includes(t.block)}|${[0, 1, 2, 3].map((i) => p[t.block * 4 + i]).join(',')}|${s.rank}`;
  }
  return `t${t.tile}|${derived(s).buildingAt[t.tile]}|${+sticky}|${s.rank}|${s.buildings.length}`;
}

const same = (a: InspectTarget | null, b: InspectTarget | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The inspector: hover cards in #inspector (bottom left); a clicked target opens a closable popup beside it on the map. */
export class Inspector {
  private readonly hoverCard: InspectorCard;
  private readonly popup: InspectorCard;
  private hover: InspectTarget | null = null;

  constructor(g: Game, root: HTMLElement) {
    this.hoverCard = new InspectorCard(g, root, false);
    const pop = h('div', { class: 'ins-popup', role: 'dialog', 'aria-label': 'Selection' });
    (root.closest('#app') ?? document.body).appendChild(pop);
    this.popup = new InspectorCard(g, pop, true);
  }

  /** True while a clicked (sticky) card is pinned: Esc closes it before opening the menu. */
  get pinned(): boolean { return this.popup.target !== null; }

  /** Shows a target: a sticky one (click) opens the popup until closed or replaced; a transient one (hover) shows bottom left. */
  show(t: InspectTarget | null, sticky: boolean): void {
    if (sticky) this.popup.set(t); else this.hover = t;
    this.hoverCard.set(same(this.hover, this.popup.target) ? null : this.hover);   // no second card for what the popup shows
  }

  /** Every frame: throttled card refreshes; the popup follows its target on the map. */
  frame(now: number): void {
    this.hoverCard.frame(now);
    this.popup.frame(now);
  }
}

/** One card slot: the hover card in #inspector, or the popup pinned to a clicked target. */
class InspectorCard {
  target: InspectTarget | null = null;
  private sig = '';
  private last = -Infinity;
  private readonly hold: PointerHold;
  private ups: Updater[] = [];
  private collapsed = false;
  private placed = '';

  constructor(private readonly g: Game, private readonly root: HTMLElement, private readonly sticky: boolean) {
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    this.hold = new PointerHold(root);
  }

  set(t: InspectTarget | null): void {
    if (same(t, this.target)) return;
    this.target = t;
    this.last = -Infinity;   // a new target re-renders at once, not at the next throttled frame
  }

  /** Throttled refresh: rebuild on a changed signature (not under a fresh click), else run the updaters. */
  frame(now: number): void {
    if (now - this.last >= B.time.UI_THROTTLE_MS) {
      this.last = now;
      const s = this.g.state;
      if (this.target?.kind === 'building' && !getBuilding(s, this.target.id)) this.target = null;
      const t = this.target;
      const sig = t ? `${t.kind}|${targetSig(s, t, this.sticky)}|${+this.collapsed}` : '';
      const sameTarget = sig.split('|')[1] === this.sig.split('|')[1];
      if (sig !== this.sig && (!sameTarget || !this.hold.holds(now))) this.rebuild(t, sig, this.sticky);
      else for (const u of this.ups) { try { u(); } catch (e) { console.error('[inspector] updater', e); } }
    }
    if (this.sticky) this.place();
  }

  /** Pins the popup beside its target, inside the free map (below the HUD, clear of the side panel or sheet). */
  private place(): void {
    const t = this.target, pop = this.root;
    if (!t || pop.hidden) return;
    const view = this.g.view;
    const r = t.kind === 'building' ? view.buildingRect(t.id)
      : t.kind === 'block' ? (() => { const k = getMap(this.g.state.seed).survey.blocks[t.block]; return k ? view.screenRect(k.x, k.y, 4, 4) : null; })()
      : view.screenRect(tx(t.tile), ty(t.tile), 1, 1);
    const app = (pop.offsetParent ?? document.body).getBoundingClientRect();
    const hud = document.getElementById('hud')?.getBoundingClientRect();
    const panel = document.getElementById('side')?.getBoundingClientRect();
    const column = document.getElementById('left')?.getBoundingClientRect();
    const M = 8, GAP = 10, MAX_H = 560, MIN_H = 180;
    let bx0 = M, bx1 = app.width - M, by1 = app.height - M;
    const by0 = (hud && hud.height ? hud.bottom - app.top : 0) + M;
    if (panel && panel.width && panel.height && panel.left < app.right && panel.top < app.bottom) {
      if (panel.left - app.left > app.width / 2) bx1 = Math.min(bx1, panel.left - app.left - M);   // a panel or drawer on the right
      else if (panel.top - app.top > app.height / 2) by1 = Math.min(by1, panel.top - app.top - M);   // a bottom sheet
    }
    const off = !r || r.right < 0 || r.left > bx1 || r.bottom < by0 || r.top > by1;
    if (column && column.width && column.width < app.width / 2) bx0 = column.right - app.left + M;   // the left column of a wide screen
    const card = pop.firstElementChild as HTMLElement | null;
    if (off || !r || !card) { this.apply('hidden', () => { pop.style.visibility = 'hidden'; }); return; }
    const w = pop.offsetWidth;
    const natural = card.scrollHeight + card.offsetHeight - card.clientHeight;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const fullH = Math.min(MAX_H, by1 - by0), need = Math.min(natural, fullH);
    const below = by1 - (r.bottom + GAP), above = r.top - GAP - by0;
    // beside the target (right first), else below or above it where the whole card fits, else where there is more room;
    // a target too big for any of these (the forum close up) gets the card over its emptier edge, with no tail
    const side: 'l' | 'r' | 't' | 'b' | '' = r.right + GAP + w <= bx1 ? 'l' : r.left - GAP - w >= bx0 ? 'r'
      : need <= below ? 't' : need <= above ? 'b' : Math.max(below, above) >= MIN_H ? (below >= above ? 't' : 'b') : '';
    let left: number, top: number, maxH: number;
    if (side === 't' || side === 'b') {
      maxH = Math.min(MAX_H, side === 't' ? below : above);
      top = side === 't' ? r.bottom + GAP : r.top - GAP - Math.min(natural, maxH);
      left = clamp(cx - w / 2, bx0, Math.max(bx0, bx1 - w));
    } else {
      maxH = fullH;
      top = clamp(cy - need / 2, by0, by1 - need);
      left = side === 'l' ? r.right + GAP : side === 'r' ? r.left - GAP - w : bx1 - r.right >= r.left - bx0 ? Math.max(bx0, bx1 - w) : bx0;
    }
    const hh = Math.min(natural, maxH);
    const tail = side === 't' || side === 'b' ? clamp(cx - left, 14, w - 14) : clamp(cy - top, 14, hh - 14);
    const key = `${Math.round(left)},${Math.round(top)},${Math.round(maxH)},${side},${Math.round(tail)}`;
    this.apply(key, () => {
      pop.style.visibility = '';
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      pop.style.maxHeight = `${Math.round(maxH)}px`;
      pop.dataset.tail = side;
      pop.style.setProperty('--tail', `${Math.round(tail)}px`);
    });
  }

  /** Writes the popup's style only when its placement changed. */
  private apply(key: string, write: () => void): void {
    if (key === this.placed) return;
    this.placed = key;
    write();
  }

  private rebuild(t: InspectTarget | null, sig: string, sticky: boolean): void {
    this.sig = sig;
    this.ups = [];
    clear(this.root);
    this.root.hidden = !t;
    this.placed = '';
    if (!t) return;
    const card = h('div', { class: `card ins-card${sticky ? ' sticky' : ''}${this.collapsed ? ' collapsed' : ''}` });
    try { this.render(t, card, sticky); } catch (e) { console.error('[inspector] render', e); }
    this.root.appendChild(card);
  }

  private head(card: HTMLElement, sprite: string, kicker: string, title: string, sticky: boolean): void {
    const g = this.g;
    card.append(h('div', { class: 'ins-head' }, h('div', { class: 'ins-img' }, img(sprite, 2)),
      h('div', { class: 'ins-titles' }, h('div', { class: 'kicker' }, kicker), h('div', { class: 'ins-title' }, title)),
      h('div', { class: 'ins-ctl' },
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': this.collapsed ? 'Expand' : 'Collapse', onclick: () => { this.collapsed = !this.collapsed; this.last = -Infinity; this.hold.release(); } }, this.collapsed ? '▸' : '▾'),
        sticky ? h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Close', onclick: () => { g.select(null); g.inspect(null, true); } }, '✕') : null)));
  }

  private render(t: InspectTarget, card: HTMLElement, sticky: boolean): void {
    const s = this.g.state;
    if (t.kind === 'building') {
      const b = getBuilding(s, t.id);
      if (!b) { card.append(h('div', { class: 'muted' }, 'It is gone.')); return; }
      const def = BUILDING_DEFS[b.type];
      if (b.house && b.status === 'done') {
        this.head(card, houseSprite(b.house.tier, isAquae(s, b), b.x, b.y), `DOMVS · T${TIER_DEFS[b.house.tier].level}${isAquae(s, b) ? ' · AQVAE' : ''}`, TIER_DEFS[b.house.tier].latin, sticky);
        if (!this.collapsed) card.append(...houseView(this.g, b, this.ups), this.demolish(b));
        return;
      }
      const sprite = b.status === 'done' ? buildingSprite(s, b, seasonOf(s.day)) : typeSprite(b.type);
      this.head(card, sprite, `${caps(def.latin)}${b.owner === 'ordo' ? ' · ORDO' : ''}`, def.name, sticky);
      if (!this.collapsed) card.append(...(b.status === 'done' ? this.works(b) : this.site(b)));
      return;
    }
    if (t.kind === 'block') { this.block(card, t.block, sticky); return; }
    this.tile(card, t.tile, sticky);
  }

  /** An unfinished site: state, progress, what it waits for, ↑, Cancel / Move. */
  private site(b: Building): HTMLElement[] {
    const g = this.g;
    const def = BUILDING_DEFS[b.type];
    const line = h('div', { class: 'ins-line' });
    const pb = bar();
    const refresh = (): void => {
      const s = g.state;
      const cur = getBuilding(s, b.id);
      if (!cur) return;
      if (cur.status === 'plan') { const lack = lacking(s, def.cost); line.textContent = `⌛ A plan: works begin when the stores hold ${lack ? lackLine(g, lack) : 'enough'}.`; pb.set(0, 'tab-bar plan'); return; }
      if (cur.status === 'staked') { line.textContent = `Staked by the Ordo. Builders start in ${plural(Math.max(0, cur.placed + B.construction.STAKE_DAYS - s.day), 'day', 'days')}; until then you may cancel it in full or move it.`; pb.set(1, 'tab-bar staked'); return; }
      const builders = s.people.filter((p) => p.work === BUILDER).length;
      const stage = cur.type === 'capitolium' ? ` · ${STAGES[Math.min(3, Math.floor(cur.progress * 4))]}` : '';
      line.textContent = `${Math.round(cur.progress * 100)}% of ${fmt(cur.work)} builder-days${stage} · ${plural(builders, 'builder', 'builders')} in the colony`;
      pb.set(cur.progress, cur.progress < B.construction.TRENCH ? 'tab-bar trench' : 'tab-bar gold');
    };
    refresh();
    this.ups.push(refresh);
    const out = [line, pb.el];
    if (b.reason) out.push(h('div', { class: 'ins-why' }, img('i_seal', 1), reasonText(b.reason)));
    if (b.notes?.length) out.push(h('div', { class: 'ins-small muted' }, `Why here: ${b.notes.map((n) => NOTE[n.code](n.value)).join(', ')}.`));
    const first = worksQueue(g.state)[0]?.id === b.id;
    const btns = h('div', { class: 'ins-btns' }, btn(g, '↑ Build first', () => A.prioritise(g.state, b.id), { reason: first ? 'Already first in the queue.' : null }));
    if (b.status === 'staked' && b.owner === 'ordo') btns.append(btn(g, 'Move', () => { g.startPlacing({ kind: 'building', type: b.type, replaceId: b.id }); }, { tip: 'Place it elsewhere yourself; the stake is refunded.' }));
    if (b.type !== 'capitolium') {
      const full = b.status === 'plan' || (g.state.day - b.placed <= B.construction.FULL_REFUND_DAYS && b.progress <= 0);
      const c = h('button', { class: 'btn small danger', type: 'button' }, b.status === 'plan' ? 'Drop the plan' : `Cancel (${full ? '100' : Math.round(B.construction.REFUND_CANCEL * 100)}% back)`);
      confirm2(c, 'Click again to cancel', () => { g.act(A.cancelSite(g.state, b.id), { okSfx: 'click' }); });
      btns.append(c);
    }
    out.push(btns);
    return out;
  }

  /** A finished work: staff, output chain, coverage, storage, upkeep, site, Ordo reason, controls. */
  private works(b: Building): HTMLElement[] {
    const g = this.g;
    const s = g.state;
    const def = BUILDING_DEFS[b.type];
    const out: HTMLElement[] = [h('div', { class: 'ins-sub' }, def.benefit)];
    if (def.slots > 0) {
      const staff = h('div', { class: 'ins-line' });
      const names = h('div', { class: 'ins-small muted' });
      const refresh = (): void => {
        const st = g.state;
        const ppl = st.people.filter((p) => p.work === b.id);
        staff.textContent = `${ppl.length} of ${def.slots} hands${b.open ? '' : ' · closed (CLAVSVM)'}`;
        names.textContent = ppl.map((p) => `${personName(p)}${def.skill && p.skills[def.skill] ? ` (${def.skill} ${Math.floor(p.skills[def.skill] ?? 0)})` : ''}`).join(', ');
      };
      refresh();
      this.ups.push(refresh);
      out.push(staff, names);
    }
    const chain = h('div', { class: 'ins-chain' });
    const refreshChain = (): void => {
      const rows = outputChain(g.state, b);
      chain.replaceChildren(...rows.map((r) => h('div', { class: 'tab-kv' }, h('span', { class: 'tab-kv-k' }, r.label), h('span', { class: 'tab-kv-v num' }, r.value))));
      if (def.output) {
        const all = g.rates.prod[def.output.res][b.type] ?? 0;
        const n = derived(g.state).counts[b.type] ?? 1;
        if (n > 1) chain.append(h('div', { class: 'ins-small muted' }, `All ${n} together: +${fmt(all)} ${RESOURCE_DEFS[def.output.res].name.toLowerCase()} yesterday.`));
      }
    };
    refreshChain();
    this.ups.push(refreshChain);
    if (def.output || def.passive) out.push(chain);
    if (def.inputs) out.push(h('div', { class: 'ins-small' }, `Uses ${Object.entries(def.inputs).map(([r, n]) => `${n} ${RESOURCE_DEFS[r as keyof typeof RESOURCE_DEFS].name.toLowerCase()}`).join(' + ')} per hand a day.`));
    if (def.passive && !def.output) out.push(h('div', { class: 'ins-small' }, `${def.passive.perDay} ${RESOURCE_DEFS[def.passive.res].name.toLowerCase()} a day with no hands.`));
    for (const sv of def.service ?? []) {
      const r = effectiveRadius(s, b, sv.layer);
      out.push(h('div', { class: `ins-line ${r ? '' : 'ins-bad'}` }, `${LAYER_META[sv.layer].label}: ${r ? `${r} road steps` : 'inactive'}${r && r < sv.radius ? ` (full ${sv.radius} at ${Math.ceil(def.slots * B.economy.SERVICE_FULL)} hands)` : ''}`));
    }
    if (def.storage) {
      const store = def.storage;
      const line = h('div', { class: 'ins-line' });
      const refreshStore = (): void => { line.textContent = `Stores: ${(Object.keys(store) as ResId[]).map((r) => storeText(g.state, r, store[r] ?? 0)).join(' · ')}`; };
      refreshStore();
      this.ups.push(refreshStore);
      out.push(line);
    }
    const mult = siteMult(s, b);
    const site = Math.abs(mult - 1) > 0.01 ? `Site ${pct(mult)}` : 'Site';
    if (site !== 'Site' || b.notes?.length) out.push(h('div', { class: 'ins-small' }, `${site}${b.notes?.length ? `: ${b.notes.map((n) => NOTE[n.code](n.value)).join(', ')}` : ''}.`));
    const flags: string[] = [];
    if (def.upkeep) flags.push(b.open ? `Upkeep ${fmt(def.upkeep)} den a day${b.unpaid ? ' · UNPAID: works at half pace' : ''}` : 'Closed: no upkeep');
    if ((b.toolUntil ?? 0) > s.day) flags.push(`Tool kit: +20%, ${plural((b.toolUntil ?? 0) - s.day, 'day', 'days')} left`);
    if ((b.damagedUntil ?? 0) > s.day) flags.push(`Damaged by fire until ${formatRoman(b.damagedUntil ?? 0)}`);
    if ((b.idleUntil ?? 0) > s.day) flags.push(`Idle until ${formatRoman(b.idleUntil ?? 0)}`);
    if ((b.bonusUntil ?? 0) > s.day) flags.push(`${pct(1 + (b.bonus ?? 0))} until ${formatRoman(b.bonusUntil ?? 0)}`);
    if ((b.youngUntil ?? 0) > s.day) flags.push(`Young grove: half yield until ${formatRoman(b.youngUntil ?? 0)}`);
    if (flags.length) out.push(h('div', { class: `ins-small ${b.unpaid ? 'ins-bad' : 'muted'}` }, flags.join(' · ')));
    if (b.reason) out.push(h('div', { class: 'ins-why' }, img('i_seal', 1), `Raised by the Ordo on ${formatRoman(b.placed)}: ${reasonText(b.reason)}`));
    if (def.slots > 0) {
      out.push(h('div', { class: 'ins-btns' },
        btn(g, b.open ? 'Close it' : 'Reopen it', () => A.setOpen(g.state, b.id, !b.open), { cls: b.open ? '' : 'primary', tip: b.open ? 'Closed works keep their sprite and release their hands.' : 'Let it take hands again.' }),
        seg(g, PRIO_IDS.map((p, i) => ({ id: p, label: PRIO[i], tip: `${PRIO[i]} staffing priority` })), String(b.prio) as (typeof PRIO_IDS)[number],
          (p) => A.setPrio(g.state, b.id, Number(p) as 0 | 1 | 2))));
    }
    if (b.type !== 'principia' && b.type !== 'capitolium') out.push(this.demolish(b));
    return out;
  }

  private demolish(b: Building): HTMLElement {
    const g = this.g;
    const d = h('button', { class: 'btn small ghost ins-demolish', type: 'button' }, 'Demolish');
    confirm2(d, `Demolish? ${Math.round(B.construction.REFUND_DEMOLISH * 100)}% back`, () => { g.act(A.demolish(g.state, b.id), { okSfx: 'place' }); });
    return h('div', { class: 'ins-btns end' }, d);
  }

  private block(card: HTMLElement, id: number, sticky: boolean): void {
    const g = this.g;
    const s = g.state;
    const blk = getMap(s.seed).survey.blocks[id];
    if (!blk) return;
    const reserved = s.ordo.reserved.includes(id);
    const razed = s.urbs.razed !== null;                    // once the castrum is razed the canabae are the outer city
    const district = razed && blk.district === 'canabae' ? 'Urbs exterior' : DISTRICT[blk.district];
    const ring = razed ? (blk.ring === 0 ? 'in the inner city' : blk.ring === WALL_RING ? 'on the old wall line' : 'in the outer city') : RING[blk.ring];
    this.head(card, 'i_tool_reserve', `INSVLA · ${caps(district)}`, `A block ${ring}`, sticky);
    if (this.collapsed) return;
    const active = ringsOf(s).includes(blk.ring);
    const plots = [0, 1, 2, 3].map((i) => derived(s).plotOwner[id * 4 + i]);
    const free = plots.filter((p) => !p).length;
    const status = blk.masked ? 'The surveyors left this block to the fields.' : blk.reserved ? `Kept by the groma for the ${blk.reserved}.`
      : !active && blk.ring === WALL_RING ? 'The camp\'s vallum and fossa stand here. They come down once a town wall rings the whole town, and the line becomes house plots.'
      : !active ? `Surveyed for later: it joins the pomerium at ${RANK_DEFS[blk.ring].name}.` : `${free} of 4 plots free.`;
    card.append(h('div', { class: 'ins-line' }, status));
    const usable = !blk.masked && !blk.reserved && active;
    if (usable) card.append(h('div', { class: 'ins-small muted' }, plots.map((p, i) => `plot ${i + 1}: ${p ? BUILDING_DEFS[getBuilding(s, p)?.type ?? 'area'].name.toLowerCase() : 'free'}`).join(' · ')));
    if (reserved) card.append(h('div', { class: 'ins-good' }, 'Reserved: the Ordo leaves it alone.'));
    card.append(h('div', { class: 'ins-btns' },
        btn(g, 'Place a house plot', () => { g.startPlacing({ kind: 'building', type: 'area' }); }, { cls: 'primary', reason: usable && free ? null : 'No free plot to build on here.' }),
        btn(g, reserved ? 'Release the block' : 'Reserve the block', () => A.toggleReserveBlock(g.state, id),
          { tip: 'The Ordo never builds in a reserved block.', reason: blk.masked || blk.reserved ? 'Only surveyed house blocks can be reserved.' : !toolRevealed(s, 'reserve') ? 'The Reserve-block tool comes with Oppidum.' : null })));
  }

  /** The fortifications on a tile: the castrum's rampart and ditch (and when they will come down), or the town wall. */
  private walls(card: HTMLElement, tile: number): void {
    const g = this.g;
    const s = g.state;
    const mo = s.urbs.moenia;
    const rising = mo !== null && mo.done === null;
    const share = mo ? `${Math.round(mo.progress * 100)}%` : '';
    if (inCamp(s, tile)) {
      const what = getMap(s.seed).survey.wall[tile] === 2 ? 'A gate of the camp' : getMap(s.seed).survey.wall[tile] ? `The camp's ${s.rank >= 2 ? 'murus' : 'vallum'}` : 'The camp\'s fossa';
      const when = rising ? `The town wall is rising (${share}); when it stands, this rampart comes down and the old wall line becomes house plots.`
        : s.rank < B.urbs.MOENIA.RANK ? 'Once the colony is a Municipium you may ring the whole town with a wall (the Ordo does it as a Colonia, once the outer town outgrows the camp), and this rampart will come down.'
        : 'Lay out a town wall round the whole town and this rampart comes down once it stands: the camp becomes the inner city, its wall line house plots. As a Colonia the Ordo does it, once the outer town outgrows the camp.';
      card.append(h('div', { class: 'ins-head2' }, what), h('div', { class: 'ins-small' }, when));
      if (!mo) {
        const reason = s.rank < B.urbs.MOENIA.RANK ? 'Rome lets a Municipium wall the whole town.' : null;
        card.append(h('div', { class: 'ins-btns' }, btn(g, 'Lay out the town wall', () => g.act(A.commissionWalls(g.state), { okSfx: 'place' }),
          { cls: 'primary', reason, tip: `About ${B.urbs.MOENIA.WORK} builder-days, ${B.urbs.MOENIA.MAT.stone} stone and ${B.urbs.MOENIA.MAT.denarii} denarii a pace, drawn as it rises from what the Ordo is not saving.` })));
      }
      return;
    }
    if (!mo) return;
    const gate = mo.gates.includes(tile);
    card.append(h('div', { class: 'ins-head2' }, gate ? 'A gate of the town wall' : 'The town wall'),
      h('div', { class: 'ins-small' }, mo.done !== null
        ? `Finished ${formatRoman(mo.done)}: ${mo.tiles.length} paces of stone and ${mo.gates.length} gates ring the whole town.`
        : `Rising: ${share} of ${mo.tiles.length} paces and ${mo.gates.length} gates, from the work the builders spare.`));
  }

  private tile(card: HTMLElement, tile: number, sticky: boolean): void {
    const g = this.g;
    const s = g.state;
    const map = getMap(s.seed);
    const ter = map.terrain[tile];
    const feat = map.feature[tile];
    this.head(card, 'i_ov_terra', 'TERRA', `${TERRAIN[ter] ?? 'Land'}${FEATURE[feat] ? `, ${FEATURE[feat]}` : ''}`, sticky);
    if (this.collapsed) return;
    const d = derived(s);
    const facts: string[] = [];
    if (isFertile(ter as Terrain)) facts.push(`fertile ground ×${fertility(ter as Terrain).toFixed(2)}`);
    if (map.woodMax[tile] > 0) facts.push(`timber ${Math.round(woodAt(s, tile))} of ${Math.round(map.woodMax[tile])}`);
    if (map.vein[tile] > 0) facts.push(`ore quality ×${fmt(map.vein[tile])}`);
    if (map.waterTable[tile]) facts.push('on the water table');
    facts.push(d.pomerium[tile] ? 'inside the pomerium' : d.territory[tile] ? 'in our territory' : 'beyond our territory');
    const road = d.road[tile] ? footfall(s, tile) : 0;
    if (road > 0) facts.push(`${WEAR_WORD[wearOf(road)]}: about ${fmt(road)} walkers a day`);
    card.append(h('div', { class: 'ins-line' }, facts.join(' · ')), h('div', { class: 'ins-small muted' }, `(${tx(tile)}, ${ty(tile)})`));
    if (d.wall[tile]) this.walls(card, tile);
    if (!sticky) { card.append(h('div', { class: 'ins-small muted' }, 'Click the ground to see what could be built here.')); return; }
    const can = BUILD_ORDER.filter((type) => buildingVisible(s, type) && !rankReason(s, type))
      .map((type) => ({ type, c: canPlace(s, type, tile, { owner: 'player' }) }))
      .filter((x) => x.c.ok);
    card.append(h('div', { class: 'ins-head2' }, can.length ? 'Could be built here' : 'Nothing can be built on this spot.'),
      h('div', { class: 'ins-btns wrap' }, can.map(({ type, c }) => btn(g, [img(typeSprite(type), 1, 'chip-ico'), BUILDING_DEFS[type].name, c.ok && c.mult >= 1.05 ? ` ${pct(c.mult)}` : ''],
        () => { g.startPlacing({ kind: 'building', type, at: c.ok ? idx(c.x, c.y) : tile }); }, { cls: 'ghost' }))));
  }
}
