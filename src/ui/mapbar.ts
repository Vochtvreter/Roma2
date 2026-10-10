// src/ui/mapbar.ts — the map widgets of the shell (DESIGN §15.4, §11.9): the overlay bar (five toggles, the Officia
// layer selector and a legend), the zoom buttons and the placement banner. Owner: WP-H (split from ui/index.ts).
import { OVERLAYS } from '../game/types';
import type { CoverageLayerId, OverlayId, PlaceCheck } from '../game/types';
import type { Game, PlacingState } from './types';
import { clear, costEl, fmt, h, img, tip } from './dom';
import { idx } from '../game/map';
import { overlayRevealed } from '../game/reveal';
import { BUILDING_DEFS } from '../game/data/buildings';
import { LAYER_META } from '../game/data/housing';

const OVERLAY_LABEL: Record<OverlayId, string> = { none: 'Off', aqua: 'Aqua', domus: 'Domus', officia: 'Officia', desir: 'Dignitas loci', terra: 'Terra' };
const OVERLAY_SUB: Record<OverlayId, string> = {
  none: '', aqua: 'water reach', domus: 'what houses want', officia: 'service reach', desir: 'desirability', terra: 'the land',
};
const OFFICIA: { layer: CoverageLayerId; label: string }[] = [
  { layer: 'shrine', label: 'Shrines' }, { layer: 'market', label: 'Markets' }, { layer: 'baths', label: 'Baths' }, { layer: 'culture', label: 'Culture' },
];
/** The Officia selector groups temple with shrine and macellum with market. */
const LAYER_GROUP: Partial<Record<CoverageLayerId, CoverageLayerId>> = { shrine: 'shrine', temple: 'shrine', market: 'market', macellum: 'market', baths: 'baths', culture: 'culture' };
/** Overlay legends: [colour, label] swatches (ARCHITECTURE §12.5 colours). */
const LEGEND: Partial<Record<OverlayId, [string, string][]>> = {
  aqua: [['#9fd4f0', 'well water'], ['#3d7fa6', 'fountains'], ['#62b0d6', 'water table']],
  domus: [['#9ccc5a', 'ready'], ['#f2c94c', 'one need'], ['#e5554a', 'two or more'], ['#806b57', 'declining']],
  desir: [['#e5554a', '−20'], ['#806b57', '0'], ['#9ccc5a', '+30']],
  terra: [['#f2c94c', 'fertile'], ['#a99a62', 'hills'], ['#9a968a', 'rock'], ['#c0623f', 'ore'], ['#b5651d', 'clay'], ['#4f9a3a', 'timber']],
};
/** The overlay bar and zoom buttons in #map-tools (the minimap canvas there is WP-F's). */
export class MapTools {
  private key = '';

  constructor(private readonly g: Game, private readonly bar: HTMLElement, zoom: HTMLElement) {
    clear(zoom);
    const zbtn = (label: string, aria: string, fn: () => void): HTMLElement => {
      const b = h('button', { class: 'map-btn', 'aria-label': aria, onclick: () => { g.sfx('click'); fn(); } }, label);
      tip(b, aria);
      return b;
    };
    zoom.append(zbtn('+', 'Zoom in (+)', () => g.view.zoomBy(1)), zbtn('−', 'Zoom out (−)', () => g.view.zoomBy(-1)),
      zbtn('⌂', 'Centre on the forum (H)', () => g.view.centerOnForum()));
  }

  /** Forces a rebuild on the next update. */
  invalidate(): void {
    this.key = '';
  }

  /** Rebuilds the overlay bar when the revealed set, the overlay or its layer changed. */
  update(): void {
    const g = this.g;
    const cur = g.view.overlay;
    const list = OVERLAYS.filter((o) => o !== 'none' && (o === cur || overlayRevealed(g.state, o)));
    const key = `${list.join(',')}|${cur}|${g.view.overlayLayer}`;
    if (key === this.key) return;
    this.key = key;
    const bar = this.bar;
    clear(bar);
    const set = (o: OverlayId, layer?: CoverageLayerId): void => { g.sfx('click'); g.view.setOverlay(o, layer); this.key = ''; this.update(); };
    const row = h('div', { class: 'map-ov-row', role: 'group', 'aria-label': 'Overlays (O)' });
    for (const o of list) {
      const on = o === cur;
      const b = h('button', { class: on ? 'map-ov on' : 'map-ov', 'aria-pressed': String(on), onclick: () => set(on ? 'none' : o) },
        img(`i_ov_${o}`, 2), h('span', null, OVERLAY_LABEL[o]));
      tip(b, `${OVERLAY_LABEL[o]}: ${OVERLAY_SUB[o]}. ${on ? 'Click to turn off' : 'O cycles, Shift+O turns off'}.`);
      row.appendChild(b);
    }
    bar.appendChild(row);
    if (cur === 'officia') {
      bar.appendChild(h('div', { class: 'map-ov-row sub' }, OFFICIA.map((x) => h('button', {
        class: x.layer === LAYER_GROUP[g.view.overlayLayer] ? 'map-ov small on' : 'map-ov small',
        onclick: () => set('officia', x.layer),
      }, h('i', { class: 'map-sw', style: { background: LAYER_META[x.layer].color } }), x.label))));
    }
    const legend = cur === 'officia' ? [[LAYER_META[g.view.overlayLayer].color, 'covered'], ['#e5554a', 'unstaffed']] as [string, string][] : LEGEND[cur];
    if (legend) bar.appendChild(h('div', { class: 'map-legend' }, legend.map(([c, t]) => h('span', null, h('i', { class: 'map-sw', style: { background: c } }), t))));
  }
}

/** Fills #place-banner for a placing state (hidden when null): sprite, name, cost, verdict, help; Place on touch. */
export function renderPlaceBanner(g: Game, root: HTMLElement, p: PlacingState | null, check: PlaceCheck | null): void {
  clear(root);
  root.hidden = !p;
  document.getElementById('app')?.classList.toggle('placing', !!p);
  if (!p) return;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cancel = h('button', { class: 'btn small ghost', onclick: () => g.cancelPlacing() }, 'Cancel');
  if (p.kind !== 'building') {
    const what = { road: ['Road', 'DRAG TO LAY A ROAD · SHIFT = VERTICAL FIRST'], pave: ['Paving', 'DRAG OVER ROADS TO PAVE THEM IN BASALT'],
      reserve: ['Reserve a block', 'CLICK A BLOCK TO KEEP IT FOR YOURSELF, OR RELEASE IT'], demolish: ['Demolish', 'CLICK A BUILDING, THEN AGAIN TO CONFIRM'] }[p.kind];
    root.appendChild(h('div', { class: 'place-box' }, img(`i_tool_${p.kind}`, 3, 'place-ico'),
      h('div', { class: 'place-main' }, h('div', { class: 'place-name' }, what[0]), h('div', { class: 'place-help' }, `${what[1]} · ESC TO CANCEL`)), cancel));
    return;
  }
  const def = BUILDING_DEFS[p.type];
  const verdict = !check ? h('span', { class: 'place-verdict' }, def.benefit)
    : check.ok ? h('span', { class: 'place-verdict ok' }, check.mult >= 1.05 ? `+${Math.round((check.mult - 1) * 100)}% on this ground` : 'Good ground',
      check.fell > 0 ? ` · fells ${fmt(check.fell)} timber` : '', check.warn ? h('span', { class: 'place-warn' }, ` · ${check.warn}`) : null)
      : h('span', { class: 'place-verdict bad' }, check.reason);
  const place = coarse && check?.ok
    ? h('button', { class: 'btn small primary', onclick: () => { if (check.ok) g.placeAt(idx(check.x, check.y), false); } }, 'Place') : null;
  root.appendChild(h('div', { class: `place-box${check && !check.ok ? ' bad' : ''}` },
    img(p.type === 'area' ? 'h_tentoria_0' : `b_${p.type}`, 1, 'place-ico'),
    h('div', { class: 'place-main' },
      h('div', { class: 'place-name' }, def.name, h('span', { class: 'place-latin' }, def.latin), costEl(g.state, check?.ok ? check.cost : def.cost)),
      verdict,
      h('div', { class: 'place-help' }, coarse ? 'TAP A GLOWING PLOT, THEN PLACE' : 'CLICK A GLOWING PLOT · SHIFT-CLICK TO PLACE MORE · ESC / RIGHT-CLICK TO CANCEL')),
    place, cancel));
}

