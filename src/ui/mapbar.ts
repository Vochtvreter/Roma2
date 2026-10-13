// src/ui/mapbar.ts — the map widgets of the shell (DESIGN §15.4, §11.9): the overlay bar (five toggles, the Officia
// layer selector and a legend), the zoom buttons, the phones' tool column (Via, Mappae, the zoom: the SHEET's, the
// DRAWER's, and the tablet DOCK's under 960 px wide) and the placement banner with the touch verbs (⟳ keep placing, ↕
// vertical first), and the pure rules of
// placing a work: where its ghost starts (startAt), what a Place does next (afterPlace) and why the work is being placed
// (placingWhy). Owner: WP-H (split from ui/index.ts).
import { OVERLAYS } from '../game/types';
import type { BuildingId, CoverageLayerId, GameState, OverlayId, PlaceCheck, ToolId } from '../game/types';
import type { Game, PlacingState } from './types';
import type { Host, Layout, WClass } from './layout';
import { currentHost, registerBringer, safeArea, slimBanner, toolColumn } from './layout';
import { clear, costEl, fmt, h, img, tip } from './dom';
import { idx } from '../game/map';
import { overlayRevealed, toolRevealed } from '../game/reveal';
import { BACK_RANK, registerBack } from './history';
import { present, shows } from './intro';
import { Home } from './sheet';
import { notePractice } from '../game/actions';
import { currentLesson } from '../game/intro';
import { activeAdvisories, renderAdvisory } from '../game/advisors/engine';
import { view } from '../game/sim';
import { BUILDING_DEFS } from '../game/data/buildings';
import { LAYER_META } from '../game/data/housing';
import { lastTouch, primaryCoarse, touchInput } from './pointer';
import { textSize } from './textsize';

// ───────────────────────────── placing a work (pure) ─────────────────────────────
/** Where a building's ghost starts (pure; tests/sheet.test.ts): the tile it was given; else, for a finger or on a phone
 *  host (`phone`: the SHEET or the DRAWER, where the hand is a finger), the best plot (`best`: resolvePlaceAt), so Place
 *  shows at once and the camera glides there only if it is out of view; never for a Move (replaceId: the player chooses
 *  where), nor for a mouse elsewhere (it hovers the plots itself, and the camera never jumps). */
export function startAt(p: PlacingState, touch: boolean, phone: boolean, best: () => number | undefined): PlacingState {
  if (p.kind !== 'building' || p.at !== undefined || p.replaceId !== undefined || !(touch || phone)) return p;
  const at = best();
  return at === undefined ? p : { ...p, at };
}

/** What follows a Place (pure; tests/sheet.test.ts): 'stay' placing after a refusal (its toast says why); after a work
 *  placed, 'more' of the same for Shift (a mouse) or, by the ⟳ toggle, a finger (its touch equivalent: the ghost moves
 *  on to the next plot), 'end' otherwise and always after a Move (the stake it replaced is gone). */
export function afterPlace(o: { ok: boolean; shift: boolean; touch: boolean; keep: boolean; moving: boolean }): 'stay' | 'more' | 'end' {
  if (!o.ok) return 'stay';
  if (o.moving) return 'end';
  return o.shift || (o.touch && o.keep) ? 'more' : 'end';
}

/** Why a work is being placed, for a phone banner's reason (its row on the SHEET, after the verdict on the DRAWER): the
 *  job of the lesson that asks for it, else the title of the Periculum or Cave whose remedy it is; null for a work placed
 *  of the player's own accord. */
export function placingWhy(s: GameState, type: BuildingId): string | null {
  const cur = currentLesson(s);
  if (cur && !cur.done && (cur.lesson.anchor === `b-${type}` || cur.lesson.id === 'works')) return cur.lesson.job;
  for (const a of activeAdvisories(s, { forCard: true })) {
    if (a.memo.sev < 2) continue;
    const r = renderAdvisory(s, view(s), a);
    if (r.remedies.some((x) => (x.remedy.kind === 'place' || x.remedy.kind === 'ask') && x.remedy.building === type)) return r.title;
  }
  return null;
}

/** The works ⟳ keep placing offers to place again (pure; tests/sheet.test.ts): the ones laid out by the dozen, house
 *  plots and fields (roads are a drag of their own). A granary from a fix-it chip, or a well, is one: the setting, kept
 *  for them all, never leaves a second ghost one tap from a second building. */
export function keepable(type: BuildingId): boolean {
  return type === 'area' || type === 'ager';
}

/** The ⟳ keep-placing toggle, kept per browser in a UI-owned key (never in Prefs, which the save carries). */
const KEEP_KEY = 'castravaleria.ui.keepPlacing.v1';
let keepOn: boolean | null = null;

/** Whether ⟳ keep placing is on (a finger's Place leaves the next ghost up, as Shift-click does for a mouse). */
export function keepPlacing(): boolean {
  if (keepOn === null) {
    try { keepOn = localStorage.getItem(KEEP_KEY) === '1'; } catch { keepOn = false; }   // storage blocked: off, this session
  }
  return keepOn;
}

/** Turns ⟳ keep placing on or off and remembers it. */
export function setKeepPlacing(on: boolean): void {
  keepOn = on;
  try { localStorage.setItem(KEEP_KEY, on ? '1' : '0'); } catch { /* storage blocked: it lasts this session */ }
}

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
    const set = (o: OverlayId, layer?: CoverageLayerId): void => {
      g.sfx('click');
      g.view.setOverlay(o, layer);
      if (o !== 'none') notePractice(g.state, 'overlay');   // the overlays lesson's job (§11.13)
      this.key = '';
      this.update();
    };
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

/** The road tools a phone's Via button offers, as the Aedificia tool row names them (those revealed show). */
const VIA: readonly { id: Exclude<ToolId, 'pin'>; label: string; sub: string }[] = [
  { id: 'road', label: 'Road', sub: 'drag across the land' },
  { id: 'pave', label: 'Pave', sub: 'basalt over built roads' },
  { id: 'reserve', label: 'Reserve block', sub: 'the Ordo leaves it alone' },
  { id: 'demolish', label: 'Demolish', sub: 'tap a work twice' },
];
const POP_GAP = 8;   // CSS px kept between a popover and the HUD, the column and the screen's (safe) edge
const POP_W = 264;   // a popover's width (sheet.css), less where the map left of the column is narrower
const POP_MIN = 220; // a strip of map narrower than this beside the DRAWER's pane: the popover opens over the pane
const COL_EDGE = 8;  // CSS px the tool column keeps from the sheet (or the drawer's foot) and from the HUD
const COL_BTN = 44;  // the column's buttons (sheet.css)
const COL_GAP = 4;

/** The phones' tool column in #map-col (DESIGN §15.7): [Via][Mappae][+][−][⌂], 44 px each. On the SHEET at the right edge
 *  8 px above what stands on the bar (the sheet: it rides up with half, hides at full; a card in the sheet's slot; the
 *  placing banner, over which it stays in view while placing); on the DRAWER at the right edge of the free map, left of
 *  the spine or the open pane, from the foot up (it hides at full; drawer.css); on the DOCK under 960 px wide the same,
 *  left of its pane (dock.css). Via drops the road tools it offers (Road, Pave, Reserve block, Demolish: those revealed,
 *  once the lessons open the catalogue); Mappae drops the overlay bar itself (#overlay-bar, re-hosted, its labels and
 *  legend shown); + − ⌂ are the zoom buttons (#zoom-ctl, re-hosted). Each popover is a Back and Esc layer and closes on
 *  a press outside it. Where the host has no tool column (layout.toolColumn: the desktop, the DOCK from 960 px) it hides
 *  and the bar and the zoom go home to #map-tools, beside the minimap (layout.onMount). */
export class MapColumn {
  private readonly via: HTMLButtonElement;
  private readonly mappae: HTMLButtonElement;
  private readonly group: HTMLElement;   // Via and Mappae, one column (beside the zoom's when the map is short: fit)
  private readonly viaPop: HTMLElement;
  private readonly viaList: HTMLElement;
  private readonly mapPop: HTMLElement;
  private readonly bar: Home;
  private readonly zoom: Home;
  private openNow: 'via' | 'mappae' | null = null;
  private hostNow: Host | null = null;
  private on = false;                    // the host carries the column (toolColumn): the bar and the zoom are here
  private toolsKey = '';

  constructor(private readonly g: Game, private readonly root: HTMLElement, bar: HTMLElement, zoom: HTMLElement,
    private readonly layout: Pick<Layout, 'sheetHeights' | 'detent' | 'dockH'>) {
    this.bar = new Home(bar);
    this.zoom = new Home(zoom);
    root.setAttribute('aria-label', 'Map tools');
    const btn = (id: string, icon: string, label: string, which: 'via' | 'mappae'): HTMLButtonElement => {
      const b = h('button', { class: 'map-btn map-col-btn', id, type: 'button', 'aria-label': label, 'aria-expanded': 'false',
        onclick: () => { g.sfx('click'); this.toggle(which); } }, img(icon, 2));
      tip(b, label);
      return b;
    };
    this.via = btn('map-via', 'i_tool_road', 'Via: roads, paving, reserve, demolish', 'via');
    this.mappae = btn('map-mappae', 'i_ov_aqua', 'Mappae: maps of the land (O)', 'mappae');
    this.viaList = h('div', { class: 'map-pop-list' });
    this.viaPop = h('div', { class: 'map-pop', id: 'via-pop', role: 'dialog', 'aria-label': 'Via: the road tools', hidden: true },
      h('div', { class: 'map-pop-h' }, h('span', { class: 'map-pop-k' }, 'VIA'), 'Roads and tools'), this.viaList);
    this.mapPop = h('div', { class: 'map-pop', id: 'mappae-pop', role: 'dialog', 'aria-label': 'Mappae: map overlays', hidden: true },
      h('div', { class: 'map-pop-h' }, h('span', { class: 'map-pop-k' }, 'MAPPAE'), 'Maps of the land'));
    this.group = h('div', { class: 'map-col-group' }, this.via, this.mappae);
    clear(root);
    root.append(this.viaPop, this.mapPop, this.group);
    // a layer of the Back and Esc chain; a press anywhere outside the column closes the popover
    registerBack({ rank: BACK_RANK.popover, open: () => this.openNow !== null, close: () => this.close() });
    document.addEventListener('pointerdown', (e) => {
      if (this.openNow && !(e.target instanceof Node && root.contains(e.target))) this.close();
    }, true);
    // "Show me" on the overlay bar (lesson IX, the wants and fork tips) opens the popover that holds it
    registerBringer('#overlay-bar', () => {
      if (!this.on || this.mappae.hidden) return false;
      this.show('mappae');
      return true;
    });
  }

  /** The host or its width class changed (layout.onMount): where the host carries the column (toolColumn: a phone, the
   *  DOCK under 960 px) the overlay bar moves into the Mappae popover and the zoom buttons into the column; elsewhere they
   *  go home and any popover closes (a popover open across a turn of the phone closes: the column moved under it). */
  mount(host: Host, w: WClass): void {
    const on = toolColumn(host, w);
    if (host === this.hostNow && on === this.on) return;
    this.hostNow = host;
    this.on = on;
    this.close();
    if (on) {
      this.mapPop.append(this.bar.el);
      this.root.append(this.zoom.el);
    } else {
      this.bar.back();
      this.zoom.back();
    }
  }

  /** Throttled by the UI root: Via and Mappae come with what they hold (the catalogue's tools, the overlays lesson), the
   *  Via list follows the tools revealed, and a popover whose button went away closes. */
  update(): void {
    if (!this.on) return;
    const g = this.g;
    const tools = shows(g, 'catalog') ? VIA.filter((t) => toolRevealed(g.state, t.id)) : [];
    present(g, this.via, tools.length > 0);
    present(g, this.mappae, shows(g, 'overlays'));
    const key = tools.map((t) => t.id).join(',');
    if (key !== this.toolsKey) {
      this.toolsKey = key;
      clear(this.viaList);
      for (const t of tools) {
        this.viaList.append(h('button', { class: 'map-pop-row', type: 'button', dataset: { tool: t.id },
          onclick: () => { this.close(); g.startPlacing({ kind: t.id }); } },
        img(`i_tool_${t.id}`, 2), h('span', { class: 'map-pop-t' }, h('span', null, t.label), h('span', { class: 'map-pop-s' }, t.sub))));
      }
    }
    if ((this.openNow === 'via' && this.via.hidden) || (this.openNow === 'mappae' && this.mappae.hidden)) this.close();
    this.fit();
  }

  /** Fits the column to the strip of map between the HUD and its foot (on the SHEET what stands on the bar, layout.dockH:
   *  the sheet at its detent's height, not mid-slide; a card in the sheet's slot; the placing banner; on the DRAWER the
   *  foot of #app; on the DOCK too): one column when it can, else Via and Mappae beside the zoom (wrap), else without the
   *  zoom (tight: fingers pinch), else none at all (gone). */
  fit(): void {
    const hs = this.layout.sheetHeights, app = this.root.parentElement;
    if (!this.on || !app || (this.hostNow === 'sheet' && !hs)) return;
    const hud = document.getElementById('hud');
    const top = hud ? hud.offsetTop + hud.offsetHeight : 0;
    let room: number;
    if (this.hostNow === 'sheet') {
      const bar = document.getElementById('tabs')?.offsetHeight ?? 0;
      room = app.clientHeight - bar - this.layout.dockH - COL_EDGE - top - COL_EDGE;
    } else room = app.clientHeight - (parseFloat(getComputedStyle(this.root).bottom) || COL_EDGE) - top - COL_EDGE;
    // the stacks' own heights, whatever fit() hid last time (so it never flips back and forth)
    const stack = (el: HTMLElement): number => { const n = Array.from(el.children).filter((c) => !(c as HTMLElement).hidden).length; return n ? n * (COL_BTN + COL_GAP) - COL_GAP : 0; };
    const a = stack(this.group), b = stack(this.zoom.el);
    const one = a + (a && b ? COL_GAP : 0) + b;
    // and with no room even for Via over Mappae (a tall card in the sheet's slot), the column steps aside altogether
    const wrap = one > room, tight = wrap && Math.max(a, b) > room, gone = tight && a > room;
    if (wrap !== this.root.classList.contains('wrap')) this.root.classList.toggle('wrap', wrap);
    if (tight !== this.root.classList.contains('tight')) this.root.classList.toggle('tight', tight);
    if (gone !== this.root.classList.contains('gone')) this.root.classList.toggle('gone', gone);
  }

  /** Opens a popover (the other one closes), sized to the map between the HUD and the column's foot and, across, to the
   *  map left of the column inside the safe area; beside the DRAWER's half pane, where that strip is narrow (a 568 or 667
   *  px phone), it opens to the column's right instead, over the pane. */
  show(which: 'via' | 'mappae'): void {
    this.openNow = which;
    const pop = which === 'via' ? this.viaPop : this.mapPop;
    for (const [p, b] of [[this.viaPop, this.via], [this.mapPop, this.mappae]] as const) {
      p.hidden = p !== pop;
      b.setAttribute('aria-expanded', String(p === pop));
      b.classList.toggle('on', p === pop);
    }
    const hud = document.getElementById('hud')?.getBoundingClientRect(), col = this.root.getBoundingClientRect();
    if (hud) pop.style.maxHeight = `${Math.max(120, Math.round(col.bottom - hud.bottom - POP_GAP))}px`;
    const app = document.getElementById('app')?.getBoundingClientRect(), sa = safeArea();
    const edge = (app?.left ?? 0) + (sa?.left ?? 0) + POP_GAP;
    const left = Math.floor(col.left - POP_GAP - edge);
    const spine = this.hostNow === 'drawer' ? document.getElementById('tabs')?.getBoundingClientRect() : undefined;
    const right = spine && spine.width ? Math.floor(spine.left - POP_GAP - (col.right + POP_GAP)) : 0;
    const over = left < Math.min(POP_W, POP_MIN) && right > left;
    pop.classList.toggle('map-pop-over', over);
    this.root.classList.toggle('map-pop-over', over);
    pop.style.maxWidth = `${Math.max(160, Math.min(POP_W, over ? right : left))}px`;
  }

  /** Closes the open popover, if any. */
  close(): void {
    if (!this.openNow) return;
    this.openNow = null;
    this.root.classList.remove('map-pop-over');
    for (const [p, b] of [[this.viaPop, this.via], [this.mapPop, this.mappae]] as const) {
      p.hidden = true;
      b.setAttribute('aria-expanded', 'false');
      b.classList.remove('on');
    }
  }

  private toggle(which: 'via' | 'mappae'): void {
    if (this.openNow === which) this.close();
    else this.show(which);
  }
}

/** The banner's largest box while one thing is placed at one window size: it only grows, so Cancel (and Place on touch)
 *  stay where the eye left them while the verdict under the cursor changes length. */
let floor = { key: '', w: 0, h: 0 };

function steadyBox(box: HTMLElement, what: string): void {
  const key = `${what}|${window.innerWidth}|${document.getElementById('side')?.classList.contains('collapsed') ?? false}`;
  if (key !== floor.key) floor = { key, w: 0, h: 0 };
  if (floor.w) { box.style.minWidth = `${floor.w}px`; box.style.minHeight = `${floor.h}px`; }
  const r = box.getBoundingClientRect();
  floor.w = Math.max(floor.w, Math.ceil(r.width));
  floor.h = Math.max(floor.h, Math.ceil(r.height));
}

/** A toggle button of the banner (⟳ keep placing, ↕ vertical first): pressed or not, flipped in place on a tap. */
function toggleBtn(g: Game, cls: string, label: string, aria: string, on: boolean, set: (on: boolean) => void): HTMLButtonElement {
  const b = h('button', { class: `btn small ${cls}${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': aria }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    g.sfx('click');
    const now = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(now));
    b.classList.toggle('on', now);
    set(now);
  });
  tip(b, aria);
  return b;
}

/** Fills #place-banner for a placing state (hidden when null): sprite, name, cost, verdict, help; Place on touch. On a
 *  phone it carries the reason (the lesson job or the advisory that asked for the work: placingWhy; else the help) and
 *  at the right ⟳ keep placing, Place and ✕ (DESIGN §15.7): the SHEET's is the 76 px banner over the bar (the name and
 *  cost, the verdict, the reason row), the DRAWER's one row of 56 px at the foot of the free map (the name and cost over
 *  the verdict and the reason). A finger gets ↕ vertical first on the road banner (its Shift) on every host. */
export function renderPlaceBanner(g: Game, root: HTMLElement, p: PlacingState | null, check: PlaceCheck | null): void {
  clear(root);
  root.hidden = !p;
  document.getElementById('app')?.classList.toggle('placing', !!p);
  if (!p) return;
  // the map treats any non-mouse tap as a preview (render/view.ts), so the Place button follows the last pointer used: a
  // touch laptop, a Surface or a pen taps a plot to preview it, as a phone does (ui/pointer.ts)
  const coarse = lastTouch() || primaryCoarse();
  const sheet = slimBanner(currentHost());   // the phones' and the tablet's slim banner
  // 'Cancel' in words; ✕ on the phone's banner, whose row of buttons is tight
  const cancel = h('button', { class: 'btn small ghost place-x', type: 'button', 'aria-label': 'Cancel placing', onclick: () => g.cancelPlacing() },
    h('span', { class: 'place-x-t' }, 'Cancel'), h('span', { class: 'place-x-i', 'aria-hidden': 'true' }, '✕'));
  if (p.kind !== 'building') {
    const tap = touchInput();   // the words follow the hand: a finger taps and has no Shift or Esc
    const roadHelp = (): string => (tap ? `DRAG TO LAY A ROAD${g.view.verticalFirst ? ' · UP OR DOWN FIRST' : ''}` : 'DRAG TO LAY A ROAD · SHIFT = VERTICAL FIRST');
    const what = {
      road: ['Road', roadHelp()],
      pave: ['Paving', 'DRAG OVER ROADS TO PAVE THEM IN BASALT'],
      reserve: ['Reserve a block', `${tap ? 'TAP' : 'CLICK'} A BLOCK TO KEEP IT FOR YOURSELF, OR RELEASE IT`],
      demolish: ['Demolish', `${tap ? 'TAP' : 'CLICK'} A BUILDING, THEN AGAIN TO CONFIRM`],
    }[p.kind];
    const help = h('div', { class: 'place-help' }, tap ? what[1] : `${what[1]} · ESC TO CANCEL`);
    // a finger has no Shift: ↕ turns a road's (or paving's) drag after its vertical leg instead
    const vert = tap && (p.kind === 'road' || p.kind === 'pave')
      ? toggleBtn(g, 'place-vert', '↕', 'Vertical first: the drag goes up or down, then across', g.view.verticalFirst, (on) => {
        g.view.verticalFirst = on;
        if (p.kind === 'road') help.textContent = roadHelp();
      }) : null;
    root.appendChild(h('div', { class: 'place-box tool' }, img(`i_tool_${p.kind}`, 3, 'place-ico'),
      h('div', { class: 'place-main' }, h('div', { class: 'place-name' }, what[0]), help), h('div', { class: 'place-btns' }, vert, cancel)));
    return;
  }
  const def = BUILDING_DEFS[p.type];
  const verdict = !check ? h('span', { class: 'place-verdict' }, def.benefit)
    : check.ok ? h('span', { class: 'place-verdict ok' }, check.mult >= 1.05 ? `+${Math.round((check.mult - 1) * 100)}% on this ground` : 'Good ground',
      check.fell > 0 ? ` · fells ${fmt(check.fell)} timber` : '', check.route?.length ? ` · ${check.route.length} arches from the spring` : '',
      check.warn ? h('span', { class: 'place-warn' }, ` · ${check.warn}`) : null)
      : h('span', { class: 'place-verdict bad' }, check.reason);
  const place = coarse && check?.ok
    ? h('button', { class: 'btn small primary place-go', onclick: () => { if (check.ok) g.placeAt(idx(check.x, check.y), false); } }, 'Place') : null;
  // ⟳: a finger's Place leaves the next ghost up (the touch Shift-click), for house plots and fields (keepable); not
  // for a Move, which places one stake. On the slim banners (the phones', the tablet's); the desktop's keeps Shift-click
  const keep = sheet && coarse && p.replaceId === undefined && keepable(p.type)
    ? toggleBtn(g, 'place-keep', '⟳', 'Keep placing: after Place, the next plot is ready', keepPlacing(), setKeepPlacing) : null;
  const why = sheet ? placingWhy(g.state, p.type) : null;
  const box = root.appendChild(h('div', { class: `place-box${check && !check.ok ? ' bad' : ''}${why ? ' why' : ''}` },
    img(p.type === 'area' ? 'h_tentoria_0' : `b_${p.type}`, 1, 'place-ico'),
    h('div', { class: 'place-main' },
      h('div', { class: 'place-name' }, def.name, h('span', { class: 'place-latin' }, def.latin), costEl(g.state, check?.ok ? check.cost : def.cost)),
      verdict,
      why ? h('div', { class: 'place-why' }, why) : null,
      // the words follow the hand, as Place does (a mouse in a narrow or short window is on a phone host too, and clicks)
      // (Text size Large: the short form, whole on a 744 px tablet's banner beside its pane)
      h('div', { class: 'place-help' }, coarse ? (sheet ? (textSize() === 'large' ? 'Tap a plot · Place' : 'Tap a plot, then Place') : 'TAP A GLOWING PLOT, THEN PLACE') : 'CLICK A GLOWING PLOT · SHIFT-CLICK TO PLACE MORE · ESC / RIGHT-CLICK TO CANCEL')),
    h('div', { class: 'place-btns' }, keep, place, cancel)));
  if (!sheet) steadyBox(box, `${p.type}:${coarse}`);   // a slim banner has its own height whatever its words (sheet.css, drawer.css, dock.css)
}

