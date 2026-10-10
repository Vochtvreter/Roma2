// src/ui/inspector.ts — the house / building / block / tile inspector (ARCHITECTURE §13.3, DESIGN §15.4). Owner: WP-I.
// Hover = transient, click = sticky. SCAFFOLD: name, status and the basic facts; chains, needs and buttons are WP-I's.
import { T } from '../game/types';
import type { Game, InspectTarget } from './types';
import { clear, h } from './dom';
import { getBuilding } from '../game/state';
import { getMap, woodAt } from '../game/map';
import { BUILDING_DEFS } from '../game/data/buildings';
import { TIER_DEFS } from '../game/data/housing';
import { census } from '../game/census';
import { B } from '../game/balance';

const TERRAIN_NAME: Record<number, string> = {
  [T.grass]: 'Grass', [T.meadow]: 'Meadow', [T.loam]: 'River loam', [T.scrub]: 'Scrub', [T.forest]: 'Forest',
  [T.dense]: 'Dense forest', [T.hills]: 'Hills', [T.rock]: 'Rock', [T.crag]: 'Crag', [T.river]: 'River',
};

/** The inspector in #inspector. */
export class Inspector {
  private sticky: InspectTarget | null = null;
  private hover: InspectTarget | null = null;
  private sig = '';
  private last = -Infinity;
  private body: HTMLElement | null = null;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Shows a target: a sticky one (click) stays until replaced or cleared; a transient one (hover) shows over it. */
  show(t: InspectTarget | null, sticky: boolean): void {
    if (sticky) { this.sticky = t; this.hover = null; } else this.hover = t;
    this.last = -Infinity;
  }

  /** Throttled refresh (signature-diffed). */
  frame(now: number): void {
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    const t = this.hover ?? this.sticky;
    const sig = t ? `${t.kind}:${t.kind === 'building' ? t.id : t.kind === 'tile' ? t.tile : t.block}|${this.g.state.day}` : '';
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.root);
    this.root.hidden = !t;
    if (!t) return;
    this.body = h('div', { class: 'card ins-card' });
    this.root.appendChild(this.body);
    this.render(t, this.body);
  }

  private render(t: InspectTarget, el: HTMLElement): void {
    const s = this.g.state;
    if (t.kind === 'building') {
      const b = getBuilding(s, t.id);
      if (!b) { el.textContent = 'Gone.'; return; }
      const def = BUILDING_DEFS[b.type];
      const title = b.house ? TIER_DEFS[b.house.tier].name : def.name;
      const staff = census(s).staffed[b.id] ?? 0;
      el.append(
        h('div', { class: 'kicker' }, b.house ? 'DOMVS' : def.latin.toUpperCase()),
        h('div', { class: 'ins-title' }, title),
        h('div', { class: 'muted' }, b.status === 'done' ? (def.slots ? `${staff} / ${def.slots} hands` : def.benefit) : `${b.status} · ${Math.round(b.progress * 100)}%`),
        h('div', { class: 'muted' }, `Owner: ${b.owner}${b.open ? '' : ' · closed'}`),
      );
      return;
    }
    if (t.kind === 'block') {
      const blk = getMap(s.seed).survey.blocks[t.block];
      el.append(h('div', { class: 'kicker' }, 'INSVLA'), h('div', { class: 'ins-title' }, blk ? `Block ${blk.id} · ${blk.district}` : 'Block'),
        h('div', { class: 'muted' }, blk ? `ring ${blk.ring}${blk.masked ? ' · masked' : ''}${s.ordo.reserved.includes(blk.id) ? ' · reserved' : ''}` : ''));
      return;
    }
    const map = getMap(s.seed);
    const tt = map.terrain[t.tile];
    const wood = map.woodMax[t.tile] > 0 ? ` · timber ${Math.round(woodAt(s, t.tile))}` : '';
    el.append(h('div', { class: 'kicker' }, 'TERRA'), h('div', { class: 'ins-title' }, TERRAIN_NAME[tt] ?? 'Land'),
      h('div', { class: 'muted' }, `(${t.tile % map.W}, ${Math.floor(t.tile / map.W)})${wood}`));
  }
}
