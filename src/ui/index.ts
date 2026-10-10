// src/ui/index.ts — the UI root (ARCHITECTURE §13.3, §13.7): builds every widget in its DOM id, runs the throttled update
// loop, turns FxEvents into toasts, sounds, banners and dispatches, and owns the map widgets (overlay bar, zoom, place
// banner) and the catch-up veil. The side panel, inspector and event card are WP-I's classes. Owner: WP-H.
import { OVERLAYS } from '../game/types';
import type { AwayReport, CoverageLayerId, FxEvent, OfflineRun, OverlayId, PlaceCheck, RankIndex } from '../game/types';
import type { Game, PlacingState } from './types';
import { clear, costEl, fmt, h, img, tip } from './dom';
import { caps, installMeander } from './tipkit';
import { Hud } from './hud';
import { Objective, milestoneToast } from './objective';
import { Counsel } from './counsel';
import { Ticker } from './ticker';
import { TitleScreen } from './title';
import { toast, toastBatch } from './toasts';
import { showBanner } from './banner';
import { openDispatch } from './dispatch';
import { SidePanel } from './panels';
import { Inspector } from './inspector';
import { ChoiceCard } from './choice';
import { idx } from '../game/map';
import { getBuilding } from '../game/state';
import { overlayRevealed } from '../game/reveal';
import { aucYear, formatRoman, toRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { TIER_DEFS, LAYER_META } from '../game/data/housing';
import { RANK_DEFS } from '../game/data/ranks';
import { HUB_DEFS } from '../game/data/hubs';
import { PATH_DEFS } from '../game/data/decisions';
import { PATH_DECISIONS } from '../game/types';
import { B } from '../game/balance';

const OVERLAY_LABEL: Record<OverlayId, string> = { none: 'Off', aqua: 'Aqua', domus: 'Domus', officia: 'Officia', desir: 'Dignitas loci', terra: 'Terra' };
const OVERLAY_SUB: Record<OverlayId, string> = {
  none: '', aqua: 'water reach', domus: 'what houses want', officia: 'service reach', desir: 'desirability', terra: 'the land',
};
const OFFICIA: { layer: CoverageLayerId; label: string }[] = [
  { layer: 'shrine', label: 'Shrines' }, { layer: 'market', label: 'Markets' }, { layer: 'baths', label: 'Baths' }, { layer: 'culture', label: 'Culture' },
];
/** Overlay legends: [colour, label] swatches (ARCHITECTURE §12.5 colours). */
const LEGEND: Partial<Record<OverlayId, [string, string][]>> = {
  aqua: [['#9fd4f0', 'well water'], ['#3d7fa6', 'fountains'], ['#62b0d6', 'water table']],
  domus: [['#9ccc5a', 'ready'], ['#f2c94c', 'one need'], ['#e5554a', 'two or more'], ['#806b57', 'declining']],
  desir: [['#e5554a', '−20'], ['#806b57', '0'], ['#9ccc5a', '+30']],
  terra: [['#f2c94c', 'fertile'], ['#a99a62', 'hills'], ['#9a968a', 'rock'], ['#c0623f', 'ore'], ['#b5651d', 'clay'], ['#4f9a3a', 'timber']],
};
const STAGE_NAMES = ['', 'Podium', 'Cella', 'Columnae', 'Fastigium'] as const;
const SPLASH: readonly string[] = ['castellum', 'lacus'];

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e;
}

/** The UI root. */
export class UI {
  side!: SidePanel;
  inspector!: Inspector;
  choice!: ChoiceCard;
  private hud!: Hud;
  private objective!: Objective;
  private counsel!: Counsel;
  private ticker!: Ticker;
  private title!: TitleScreen;
  private last = -Infinity;
  private bellAt = -Infinity;
  private lifeAt = -Infinity;
  private veil: { run: OfflineRun; bar: HTMLElement; label: HTMLElement; date: HTMLElement } | null = null;
  private overlayKey = '';

  constructor(private readonly g: Game) {}

  /** Creates every widget in its DOM id; builds SidePanel, Inspector and ChoiceCard. */
  build(): void {
    const g = this.g;
    installMeander();
    this.hud = new Hud(g, el('hud'));
    this.hud.build();
    this.objective = new Objective(g, el('objective'));
    this.counsel = new Counsel(g, el('counsel'));
    this.ticker = new Ticker(g, el('ticker'));
    this.title = new TitleScreen(g, el('title-screen'));
    this.side = new SidePanel(g, el('side'));
    this.inspector = new Inspector(g, el('inspector'));
    this.choice = new ChoiceCard(g, el('choice'));
    const zoom = el('zoom-ctl');
    clear(zoom);
    const zbtn = (label: string, aria: string, fn: () => void): HTMLElement => {
      const b = h('button', { class: 'map-btn', 'aria-label': aria, onclick: () => { g.sfx('click'); fn(); } }, label);
      tip(b, aria);
      return b;
    };
    zoom.append(zbtn('+', 'Zoom in (+)', () => g.view.zoomBy(1)), zbtn('−', 'Zoom out (−)', () => g.view.zoomBy(-1)),
      zbtn('⌂', 'Centre on the forum (H)', () => g.view.centerOnForum()));
    this.showPlaceBanner(null, null);
  }

  /** Forces every widget to re-check its signature on the next frame (Game.changed). */
  changed(): void {
    this.last = -Infinity;
    this.overlayKey = '';
    this.side?.poke();
  }

  /** Every animation frame: veil progress, WP-I widgets, then the throttled shell widgets. */
  frame(now: number): void {
    if (this.veil) {
      const v = this.veil;
      const p = v.run.progress();
      v.bar.style.width = `${(p * 100).toFixed(1)}%`;
      v.label.textContent = `${fmt(Math.round(p * v.run.days))} / ${fmt(v.run.days)} days`;
      v.date.textContent = formatRoman(this.g.state.day, { year: true });
    }
    if (this.g.mode === 'title') return;
    this.side.frame(now);
    this.inspector.frame(now);
    this.choice.frame(now);
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    this.hud.update();
    this.objective.update();
    this.counsel.update();
    this.ticker.update(now);
    this.updateOverlayBar();
  }

  /** FxEvents → toasts, sounds, banners and dispatches (§13.7). */
  onFx(events: FxEvent[]): void {
    const g = this.g;
    const s = g.state;
    const now = performance.now();
    for (const e of events) {
      switch (e.kind) {
        case 'built': {
          const b = getBuilding(s, e.id);
          const name = !b ? 'A work' : b.type === 'area' ? 'A house plot' : BUILDING_DEFS[b.type].name;
          toastBatch('built', (n) => (n === 1 ? `${name} finished` : `${n} works finished`), 'good', 'i_star');
          g.sfx(b && SPLASH.includes(b.type) ? 'splash' : 'build');
          break;
        }
        case 'evolved':
          toastBatch('evolved', (n) => (n === 1 ? `A home became a ${TIER_DEFS[e.tier].latin.toLowerCase()}` : `${n} homes improved`), 'good', 'i_beds');
          g.sfx('tink');
          break;
        case 'milestone': {
          const m = milestoneToast(e.id);
          toast(m.text, 'gold', 'i_laurel', 6000, m.unlock || undefined);
          g.sfx('lyre');
          break;
        }
        case 'rank': this.rankBanner(e.rank); g.sfx('cornu'); break;
        case 'stage':
          showBanner({ kicker: `AUC ${toRoman(aucYear(s.day))} · CAPITOLIVM`, title: `Capitolium: ${STAGE_NAMES[e.stage] ?? `stage ${e.stage}`}`,
            sub: e.stage >= 4 ? 'The pediment is crowned.' : `Stage ${toRoman(e.stage)} of IV raised · spirits lift for 30 days`, icon: 'i_star' });
          g.sfx('cornu');
          break;
        case 'taxes': case 'caravanIn': g.sfx('coin'); this.hud.flashCoin(); break;
        case 'arrive': g.sfx('gate'); break;
        case 'fire': g.sfx('crackle'); break;
        case 'event':
          g.sfx('event');
          if (g.prefs.slowForNews && !g.paused && g.speed > 2) g.setSpeed(2);
          break;
        case 'advisory':
          if (e.sev === 3) {
            if (now - this.bellAt >= B.advisors.BELL_S * 1000) { this.bellAt = now; g.sfx('tintinnabulum'); }
            if (g.prefs.pauseOnCritical && !g.paused) g.setPaused(true);
          }
          break;
        case 'victory':
          showBanner({ kicker: `AUC ${toRoman(aucYear(s.day))}`, title: `${caps(s.name)}: CAPITOLIVM DEDICATVM`, icon: 'i_laurel' });
          g.sfx('victory');
          this.showDispatch('victory');
          break;
        case 'birth': case 'death':
          if (now - this.lifeAt >= B.ui.LIFE_SFX_S * 1000) { this.lifeAt = now; g.sfx(e.kind); }
          break;
        default: break;
      }
    }
  }

  private rankBanner(rank: RankIndex): void {
    const s = this.g.state;
    const def = RANK_DEFS[rank];
    const dec = PATH_DECISIONS.find((d) => PATH_DEFS[d].grants === rank);
    const opt = dec ? PATH_DEFS[dec].options.find((o) => o.id === s.decisions.paths[dec]) : undefined;
    const chips = [...def.unlocks.map((b) => BUILDING_DEFS[b].name), ...def.hubs.map((x) => HUB_DEFS[x].name), `Rome's roll ${fmt(def.ceiling)}`];
    showBanner({ kicker: `AUC ${toRoman(aucYear(s.day))}`, title: `${caps(s.name)} FIT ${caps(def.name)}`,
      sub: `${opt ? `${opt.name} · ` : ''}you are now ${def.title}`, chips, icon: 'i_laurel' });
  }

  /** Shows the title screen (hides the game chrome). */
  showTitle(): void {
    document.getElementById('app')?.classList.add('in-title');
    this.showPlaceBanner(null, null);
    this.title.show();
  }

  /** Hides the title screen. */
  hideTitle(): void {
    document.getElementById('app')?.classList.remove('in-title');
    this.title.hide();
    this.changed();
  }

  /** The catch-up veil: "Anni transeunt…" with progress, the racing date and Skip; the HUD and map race underneath. */
  showVeil(run: OfflineRun, onSkip: () => void): void {
    const v = el('veil');
    clear(v);
    const bar = h('i', { class: 'veil-fill' });
    const label = h('div', { class: 'veil-days num' });
    const date = h('div', { class: 'veil-date' });
    const skip = h('button', { class: 'btn', onclick: () => { skip.disabled = true; skip.textContent = 'The scribes hurry…'; window.setTimeout(onSkip, 30); } }, 'Skip');
    v.appendChild(h('div', { class: 'veil-box', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'veil-kicker' }, 'DVM ABERAS · WHILE YOU WERE AWAY'),
      h('div', { class: 'veil-title' }, 'Anni transeunt…'),
      h('div', { class: 'veil-sub' }, 'the years pass'),
      date, h('div', { class: 'veil-meter' }, bar), label, skip));
    v.hidden = false;
    this.veil = { run, bar, label, date };
    skip.focus();
  }

  /** Removes the veil. */
  hideVeil(): void {
    const v = el('veil');
    v.hidden = true;
    clear(v);
    this.veil = null;
  }

  /** Opens a parchment dispatch (founding, away report, victory). */
  showDispatch(kind: 'founding' | 'away' | 'victory', report?: AwayReport): void {
    openDispatch(this.g, kind, report);
  }

  /** The placement banner: sprite, name, cost, verdict and the help line; a Place button on touch. */
  showPlaceBanner(p: PlacingState | null, check: PlaceCheck | null): void {
    const root = el('place-banner');
    clear(root);
    root.hidden = !p;
    document.getElementById('app')?.classList.toggle('placing', !!p);
    if (!p) return;
    const g = this.g;
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

  private updateOverlayBar(): void {
    const g = this.g;
    const list = OVERLAYS.filter((o) => o !== 'none' && overlayRevealed(g.state, o));
    const cur = g.view.overlay;
    const key = `${list.join(',')}|${cur}|${g.view.overlayLayer}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const bar = el('overlay-bar');
    clear(bar);
    const set = (o: OverlayId, layer?: CoverageLayerId): void => { g.sfx('click'); g.view.setOverlay(o, layer); this.overlayKey = ''; this.updateOverlayBar(); };
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
        class: g.view.overlayLayer === x.layer || (x.layer === 'shrine' && g.view.overlayLayer === 'temple') || (x.layer === 'market' && g.view.overlayLayer === 'macellum') ? 'map-ov small on' : 'map-ov small',
        onclick: () => set('officia', x.layer),
      }, h('i', { class: 'map-sw', style: { background: LAYER_META[x.layer].color } }), x.label))));
    }
    const legend = cur === 'officia' ? [[LAYER_META[g.view.overlayLayer].color, 'covered'], ['#e5554a', 'unstaffed']] as [string, string][] : LEGEND[cur];
    if (legend) bar.appendChild(h('div', { class: 'map-legend' }, legend.map(([c, t]) => h('span', null, h('i', { class: 'map-sw', style: { background: c } }), t))));
  }
}
