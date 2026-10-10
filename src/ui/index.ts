// src/ui/index.ts — the UI root: builds every widget, the update loop, fx → toasts/sfx/banners (ARCHITECTURE §13.3, §13.7). Owner: WP-H.
// Created by App (main.ts). Widgets throttle to UI_THROTTLE_MS; the side panel, inspector and event card are WP-I's classes.
// SCAFFOLD: overlay bar and zoom buttons, place banner, veil and the §13.7 fx table work in a minimal form.
import { OVERLAYS } from '../game/types';
import type { AwayReport, FxEvent, OfflineRun, OverlayId, PlaceCheck } from '../game/types';
import type { Game, PlacingState } from './types';
import { clear, costEl, h, img } from './dom';
import { Hud } from './hud';
import { Objective } from './objective';
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
import { aucYear, toRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { TIER_DEFS } from '../game/data/housing';
import { RANK_DEFS } from '../game/data/ranks';
import { MILESTONES } from '../game/objectives';
import { B } from '../game/balance';
import { spriteURL } from '../render/sprites';

const LIFE_SFX_MS = 10_000;                      // birth/death sounds at most every 10 s
const OVERLAY_LABEL: Record<OverlayId, string> = { none: 'Off', aqua: 'Aqua', domus: 'Domus', officia: 'Officia', desir: 'Dignitas loci', terra: 'Terra' };
const caps = (s: string): string => s.toUpperCase().replace(/U/g, 'V');

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
  private veil: { run: OfflineRun; bar: HTMLElement; label: HTMLElement } | null = null;
  private overlayKey = '';

  constructor(private readonly g: Game) {}

  /** Creates every widget in its DOM id; builds SidePanel, Inspector and ChoiceCard. */
  build(): void {
    const g = this.g;
    document.documentElement.style.setProperty('--meander', `url(${spriteURL('f_meander', 2)})`);
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
    zoom.append(
      h('button', { class: 'btn small', 'aria-label': 'Zoom in', onclick: () => g.view.zoomBy(1) }, '+'),
      h('button', { class: 'btn small', 'aria-label': 'Zoom out', onclick: () => g.view.zoomBy(-1) }, '−'),
      h('button', { class: 'btn small', 'aria-label': 'Centre on the forum', onclick: () => g.view.centerOnForum() }, '⌂'),
    );
    this.showPlaceBanner(null, null);
  }

  /** Forces every widget to re-check its signature on the next frame (Game.changed). */
  changed(): void {
    this.last = -Infinity;
    this.side?.poke();
  }

  /** Every animation frame: throttled widget updates, veil progress. */
  frame(now: number): void {
    if (this.veil) {
      const p = this.veil.run.progress();
      this.veil.bar.style.width = `${Math.round(p * 100)}%`;
      this.veil.label.textContent = `${Math.round(p * this.veil.run.days)} / ${this.veil.run.days} days`;
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
          const name = b ? (b.house ? TIER_DEFS[b.house.tier].name : BUILDING_DEFS[b.type].name) : 'A work';
          toastBatch('built', (n) => (n === 1 ? `${name} finished` : `${n} works finished`), 'good');
          g.sfx('build');
          break;
        }
        case 'evolved':
          toastBatch('evolved', (n) => (n === 1 ? `A house became ${TIER_DEFS[e.tier].name}` : `${n} houses improved`), 'good');
          g.sfx('tink');
          break;
        case 'milestone': {
          const m = MILESTONES.find((x) => x.id === e.id);
          toast(`Res Gestae: ${m?.text ?? e.id}`, 'gold', 'i_laurel', 6000);
          g.sfx('lyre');
          break;
        }
        case 'rank':
          showBanner(`AUC ${toRoman(aucYear(s.day))}`, `${caps(s.name)} FIT ${caps(RANK_DEFS[e.rank].name)}`, RANK_DEFS[e.rank].title);
          g.sfx('cornu');
          break;
        case 'stage':
          showBanner('CAPITOLIVM', `Capitolium: stage ${e.stage} of 4`);
          g.sfx('cornu');
          break;
        case 'taxes': case 'caravanIn': g.sfx('coin'); break;
        case 'arrive': g.sfx('gate'); break;
        case 'fire': g.sfx('crackle'); break;
        case 'event':
          g.sfx('event');
          if (g.prefs.slowForNews && !g.paused && g.speed > 2) g.setSpeed(2);
          break;
        case 'advisory':
          if (e.sev === 3) {
            if (now - this.bellAt >= B.advisors.BELL_S * 1000) { this.bellAt = now; g.sfx('tintinnabulum'); }
            if (g.prefs.pauseOnCritical) g.setPaused(true);
          }
          break;
        case 'victory':
          g.sfx('victory');
          this.showDispatch('victory');
          break;
        case 'birth': case 'death':
          if (now - this.lifeAt >= LIFE_SFX_MS) { this.lifeAt = now; g.sfx(e.kind); }
          break;
        default: break;
      }
    }
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

  /** The catch-up veil: "Anni transeunt…" with progress and Skip. */
  showVeil(run: OfflineRun, onSkip: () => void): void {
    const v = el('veil');
    clear(v);
    const bar = h('i', { class: 'veil-fill' });
    const label = h('div', { class: 'veil-days num' });
    v.appendChild(h('div', { class: 'veil-box' },
      h('div', { class: 'veil-title' }, 'Anni transeunt…'),
      h('div', { class: 'veil-sub' }, 'the years pass'),
      h('div', { class: 'meter veil-meter' }, bar), label,
      h('button', { class: 'btn', onclick: () => onSkip() }, 'Skip')));
    v.hidden = false;
    this.veil = { run, bar, label };
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

  /** The placement banner: what is being placed, its cost, the verdict; a Place button on touch. */
  showPlaceBanner(p: PlacingState | null, check: PlaceCheck | null): void {
    const root = el('place-banner');
    clear(root);
    root.hidden = !p;
    if (!p) return;
    const g = this.g;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const cancel = h('button', { class: 'btn small ghost', onclick: () => g.cancelPlacing() }, 'Cancel');
    if (p.kind !== 'building') {
      const text = p.kind === 'road' ? 'DRAG TO LAY A ROAD · SHIFT = VERTICAL FIRST' : p.kind === 'pave' ? 'DRAG OVER ROADS TO PAVE THEM'
        : p.kind === 'reserve' ? 'CLICK A BLOCK TO RESERVE OR RELEASE IT' : 'CLICK A BUILDING TWICE TO DEMOLISH IT';
      root.appendChild(h('div', { class: 'place-box' }, img(`i_tool_${p.kind}`, 2), h('span', { class: 'kicker' }, `${text} · ESC TO CANCEL`), cancel));
      return;
    }
    const def = BUILDING_DEFS[p.type];
    const verdict = check
      ? check.ok
        ? h('span', { class: 'place-ok' }, check.mult >= 1.05 ? `+${Math.round((check.mult - 1) * 100)}%` : 'Good ground', check.warn ? ` · ${check.warn}` : '')
        : h('span', { class: 'place-bad' }, check.reason)
      : null;
    const place = coarse && check?.ok
      ? h('button', { class: 'btn small primary', onclick: () => { if (check.ok) g.placeAt(idx(check.x, check.y), false); } }, 'Place')
      : null;
    root.appendChild(h('div', { class: 'place-box' },
      img(`b_${p.type}`, 1), h('span', { class: 'place-name' }, def.name), costEl(g.state, check?.ok ? check.cost : def.cost), verdict,
      h('div', { class: 'kicker place-help' }, coarse ? 'TAP A GLOWING PLOT, THEN PLACE' : 'CLICK A GLOWING PLOT · SHIFT-CLICK TO PLACE MORE · ESC / RIGHT-CLICK TO CANCEL'),
      place, cancel));
  }

  private updateOverlayBar(): void {
    const g = this.g;
    const list = OVERLAYS.filter((o) => o === 'none' || overlayRevealed(g.state, o));
    const key = `${list.join(',')}|${g.view.overlay}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const bar = el('overlay-bar');
    clear(bar);
    for (const o of list)
      bar.appendChild(h('button', {
        class: o === g.view.overlay ? 'btn small on' : 'btn small', 'aria-pressed': String(o === g.view.overlay),
        onclick: () => { g.sfx('click'); g.view.setOverlay(o); this.overlayKey = ''; },
      }, o === 'none' ? null : img(`i_ov_${o}`, 1), OVERLAY_LABEL[o]));
  }
}
