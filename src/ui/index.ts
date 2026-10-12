// src/ui/index.ts — the UI root (ARCHITECTURE §13.3, §13.7): builds every widget in its DOM id, runs the throttled update
// loop, turns FxEvents into toasts, sounds, banners and dispatches, and shows the catch-up veil. Map widgets live in
// mapbar.ts; the side panel, inspector and event card are WP-I's classes; the layout engine (layout.ts) owns the panel's
// detent, the data-* size classes on #app and the camera's insets; the Breviarium (tray.ts) drops from any HUD figure and
// holds the Res Gestae panel on a phone's sheet. On the phone SHEET host, sheet.ts gives the sheet its grabber and voice
// line (the counsel and the ticker re-hosted there), the tab buttons are its bar, and MapColumn (mapbar.ts) its tool
// column; placing, the pinned inspector, the lessons and the voice line's chips route the sheet (layout.go). The sheet's
// slot holds one card at a time (here: the context card or the event card, docked by Layout.dock), and closing it puts
// the sheet back as it was. Owner: WP-H.
import type { AwayReport, FxEvent, GameState, OfflineRun, PlaceCheck, RankIndex } from '../game/types';
import type { Game, PlacingState } from './types';
import { clear, fmt, h } from './dom';
import { caps, installMeander } from './tipkit';
import { Hud } from './hud';
import { Objective, milestoneToast } from './objective';
import { Counsel, pulseTarget } from './counsel';
import { Ticker } from './ticker';
import { TitleScreen } from './title';
import { toast, toastBatch } from './toasts';
import { showBanner } from './banner';
import { openDispatch } from './dispatch';
import { MapColumn, MapTools, renderPlaceBanner } from './mapbar';
import { SidePanel } from './panels';
import { Layout, hostPointer, lessonFolds } from './layout';
import { SheetHost } from './sheet';
import { Tray } from './tray';
import type { Detent } from './layout';
import { Inspector } from './inspector';
import { ChoiceCard } from './choice';
import { BACK_RANK, registerBack, syncBack } from './history';
import { watchPointer } from './pointer';
import { getBuilding } from '../game/state';
import { dismissTip } from '../game/actions';
import { aucYear, formatRoman, toRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { TIER_DEFS } from '../game/data/housing';
import { RANK_DEFS } from '../game/data/ranks';
import { HUB_DEFS } from '../game/data/hubs';
import { PATH_DEFS } from '../game/data/decisions';
import { PATH_DECISIONS } from '../game/types';
import { B } from '../game/balance';
import { present, shows } from './intro';
import { currentLesson, introRunning } from '../game/intro';
import { DUTY_DEFS } from '../game/ordo/duties';

const STAGE_NAMES = ['', 'Podium', 'Cella', 'Columnae', 'Fastigium'] as const;
const SPLASH: readonly string[] = ['castellum', 'lacus'];
/** Off the SHEET host, today's portrait bottom sheet of mobile.css (a 720–899 px tablet until P4 docks it): the event
 *  card's step-aside covers it as it covers the SHEET. */
const SHEET_PHONE = '(max-width: 899px) and (min-height: 521px)';

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e;
}

/** The UI root. */
export class UI {
  side!: SidePanel;
  /** The layout engine: size classes, host, the panel's detent, the free map (window.cv.ui.layout in ?dev). */
  layout!: Layout;
  inspector!: Inspector;
  choice!: ChoiceCard;
  /** The Breviarium, the accounts every HUD figure opens (window.cv.ui.tray in ?dev). */
  tray!: Tray;
  private hud!: Hud;
  private objective!: Objective;
  private counsel!: Counsel;
  private ticker!: Ticker;
  private title!: TitleScreen;
  private last = -Infinity;
  private bellAt = -Infinity;
  private lifeAt = -Infinity;
  private veil: { run: OfflineRun; bar: HTMLElement; label: HTMLElement; date: HTMLElement } | null = null;
  private tools!: MapTools;
  private column!: MapColumn;
  private lessonShown: { s: GameState; i: number } | null = null;
  private lowered: Detent | null = null;   // the sheet was dropped for the event card (choice.onStage): its detent, to go back to
  private placedOk = false;                // the placing that ends now ended in a work placed (placed()): the sheet stays closed
  private unpinning = false;               // the pinned card closed this turn: its restore waits to see whether another opens
  private swapping = false;                // one card is giving the sheet's slot to the other: no restore in between

  constructor(private readonly g: Game) {}

  /** Creates every widget in its DOM id; builds SidePanel, Inspector and ChoiceCard. */
  build(): void {
    const g = this.g;
    installMeander();
    watchPointer();   // from the first press: placing and the help follow the hand in use (pointer.ts)
    this.hud = new Hud(g, el('hud'));
    this.hud.build();
    this.objective = new Objective(g, el('objective'));
    this.tray = new Tray(g, el('tray'), el('objective'));
    this.hud.onFigure = (fig, from, key) => this.tray.toggle(fig, from, key);
    this.hud.quiet = (fig) => this.tray.covers(fig);   // a hover card that would drop over the open tray (which shows it) holds back
    this.counsel = new Counsel(g, el('counsel'));
    this.ticker = new Ticker(g, el('ticker'));
    this.title = new TitleScreen(g, el('title-screen'));
    this.side = new SidePanel(g, el('side'));
    this.layout = new Layout(g, el('app'), this.side);   // from here SidePanel.toggle() goes through the layout
    // per host, before the layout measures: the tab buttons (the SHEET's bar), the sheet's head (the counsel and the
    // ticker in its voice line), the Res Gestae (in the tray on the SHEET)
    this.layout.onMount((host) => this.side.mount(host));
    new SheetHost(g, this.layout, el('side'), el('counsel'), el('ticker'));
    this.layout.onMount((host) => this.tray.mount(host));
    this.inspector = new Inspector(g, el('inspector'));
    this.layout.onChange(() => this.inspector.reseek());   // the UI moved: a pinned target it now covers glides clear
    // new classes: the phone's speed popover folds into the row; an open tray follows the layout
    this.layout.onChange((why) => {
      if (why === 'classes') this.hud.closePopover();
      this.tray.relayout();
    });
    // the SHEET's voice line: '+n' opens "Awaiting you", Read the dispatch; its unfolded card rides the sheet (lift), and
    // folds when the sheet comes down to closed
    this.counsel.layout = this.layout;
    this.counsel.onAwaiting = () => this.tray.show('awaiting');
    this.counsel.onRead = () => this.readDispatch();
    this.layout.onChange((why) => { if (why === 'detent' && this.layout.host === 'sheet' && this.layout.detent === 'closed') this.counsel.fold(); });
    this.choice = new ChoiceCard(g, el('choice'));
    // the phone SHEET's one card slot (SPEC A graft 4): the context card (the pinned inspector) or the event card, never
    // both, docked above the bar where the sheet was (Layout.dock). Opening one is a focus (IMPL §1: the sheet closes,
    // remembered, and the camera brings the target clear above the card); one card taking the slot from the other keeps it
    // closed; closing the last (✕, Back, its building gone, a bar slot) puts the sheet back: its tab, detent and scroll. A
    // card replaced by another of its kind in the same turn (a tap from one target to the next) keeps it closed too
    this.inspector.onPin = (on) => {
      if (this.layout.host !== 'sheet') return;
      if (on) {
        this.unpinning = false;
        if (this.choice.staged) this.swap(() => this.choice.fold());
        this.layout.go({ kind: 'focus' });
        return;
      }
      if (this.swapping) return;
      this.unpinning = true;
      queueMicrotask(() => { if (this.unpinning && !this.inspector.pinned) { this.unpinning = false; this.layout.restore(); } });
    };
    this.inspector.onDock = (card) => {
      if (card) this.layout.dock(card);
      else if (this.layout.docked === this.inspector.popupEl) this.layout.dock(null);
    };
    this.side.onChoiceAnchor = () => this.readDispatch();   // "Read the dispatch" unfolds the event card itself
    this.tray.onRead = () => this.readDispatch();
    // a bar slot tapped while a card stands in the sheet's slot: the card steps aside for the tab (its restore first)
    this.side.onSlotTap = () => {
      if (this.choice.staged && this.layout.docked === el('choice')) { this.choice.fold(); return true; }
      if (!this.inspector.pinned) return false;
      g.select(null);
      g.inspect(null, true);
      if (this.unpinning) { this.unpinning = false; this.layout.restore(); }
      return true;
    };
    // the event card on the phone SHEET: Read docks it in the sheet's slot (a focus, as above) and folding or answering it
    // gives the slot back. Back folds it (a layer). Elsewhere a portrait sheet (a 720–899 px tablet until P4 docks it)
    // drops to its tab bar while the card is up and comes back once it is answered or folded
    registerBack({ rank: BACK_RANK.card, open: () => this.layout.host === 'sheet' && this.choice.staged, close: () => this.choice.fold() });
    this.choice.onStage = (up) => {
      const L = this.layout;
      if (L.host === 'sheet') {
        const card = el('choice');
        if (up) {
          if (this.inspector.pinned) this.swap(() => { g.select(null); g.inspect(null, true); });
          L.go({ kind: 'focus' });
          L.dock(card);
        } else {
          if (L.docked === card) L.dock(null);
          if (!this.swapping && !this.inspector.pinned) L.restore();
        }
        return;
      }
      if (L.docked === el('choice')) L.dock(null);   // the phone turned with the card up: it floats again here
      if (up) {
        if (L.detent !== 'closed' && typeof matchMedia === 'function' && matchMedia(SHEET_PHONE).matches) { this.lowered = L.detent; L.setDetent('closed'); }
      } else if (this.lowered) {
        const d = this.lowered;
        this.lowered = null;
        if (L.detent === 'closed') L.setDetent(d);
      }
    };
    this.tools = new MapTools(g, el('overlay-bar'), el('zoom-ctl'));
    this.column = new MapColumn(g, el('map-col'), el('overlay-bar'), el('zoom-ctl'), this.layout);
    this.layout.onMount((host) => this.column.mount(host));
    this.layout.onChange(() => this.column.fit());   // a detent, a host, the free map: the column fits its strip again
    // a new detent or host can change how a tab draws itself (Aedificia is a build tray at the SHEET's half)
    this.layout.onChange((why) => { if (why !== 'free') this.side.poke(); });
    this.showPlaceBanner(null, null);
  }

  /** Runs `fn` while one card hands the sheet's slot to the other: the closing card's restore stays off. */
  private swap(fn: () => void): void {
    this.swapping = true;
    try { fn(); } finally { this.swapping = false; }
  }

  /** Forces every widget to re-check its signature on the next frame (Game.changed). */
  changed(): void {
    this.last = -Infinity;
    this.tools?.invalidate();
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
    syncBack(this.g.mode !== 'title');   // Back walks the layers in a game, and leaves from the title (history.ts)
    if (this.g.mode === 'title') return;
    this.side.frame(now);
    this.inspector.frame(now);
    this.choice.frame(now);
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    const g = this.g;
    // the 'wants' tip asks the player to open the Domus overlay; seeing it (by any route: bar, key, remedy) reads it
    if (this.g.view.overlay === 'domus' && !this.g.state.guidance.tips.includes('wants')) this.g.act(dismissTip(this.g.state, 'wants'));
    this.showLesson();
    present(g, el('objective'), shows(g, 'goals'));
    present(g, el('ticker'), shows(g, 'ticker'));
    present(g, el('overlay-bar'), shows(g, 'overlays'));
    this.hud.update();
    this.tray.update(now);
    this.objective.update(this.counsel.held);
    this.counsel.update();
    this.ticker.update(now);
    this.tools.update();
    this.column.update();
  }

  /** An opening lesson's job was done (a lyre), the next lesson began (a tink), or the lessons ended (the cornu). */
  onLesson(step: 'done' | 'next' | 'end'): void {
    this.g.sfx(step === 'done' ? 'lyre' : step === 'next' ? 'tink' : 'cornu');
    this.changed();
  }

  /** Show, don't tell: when a lesson begins (or a colony mid-lesson is entered), its tab opens on the work it asks for
   *  and its target glows, so the right action is the one in front of the player. */
  private showLesson(): void {
    if (this.g.modalOpen) return;   // the founding letter first: the lesson begins once the standard is raised
    const s = this.g.state;
    const cur = currentLesson(s);
    const key = cur && !cur.done ? cur.index : -1;
    if (this.lessonShown?.s === s && this.lessonShown.i === key) return;
    this.lessonShown = { s, i: key };
    if (!cur || cur.done) return;
    // where the lessons' table routes it (layout.ts LESSON_VIEW): its tab opens, or the panel makes way for the map (on
    // the phone a card lesson's own card carries its job: hostPointer)
    const ptr = hostPointer(cur.lesson, this.layout.host);
    // a lesson whose job is a card of the phone's build tray comes folded (lessonFolds): the card that stood in the voice
    // line folds at once, so the tray's card is whole in view as it pulses (the counsel draws the new lesson a moment on)
    if (lessonFolds(cur.lesson, this.layout.host)) this.counsel.fold();
    if (ptr.open) this.g.openTab(ptr.open, ptr.anchor, 'lesson');
    else this.layout.go({ kind: 'lesson', lesson: cur.lesson.id });
    if (ptr.glow) pulseTarget(ptr.glow);
  }

  /** FxEvents → toasts, sounds, banners and dispatches (§13.7). */
  onFx(events: FxEvent[]): void {
    const g = this.g;
    const s = g.state;
    const now = performance.now();
    this.deeds(events.filter((e): e is Extract<FxEvent, { kind: 'milestone' }> => e.kind === 'milestone').map((e) => e.id));
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
        case 'milestone': break;   // after the loop: deeds done together make one toast
        case 'learned':
          toast(`Learned: ${DUTY_DEFS[e.duty].name}`, 'good', 'i_seal', 5000, 'The Ordo can take it up for you whenever you choose.');
          break;
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

  /** Res Gestae done: one toast and one lyre, however many deeds a tick completed (a long-met deed waits behind the
   *  one before it, so several can fall together), and none before the lessons bring the Res Gestae panel. */
  private deeds(ids: string[]): void {
    if (ids.length === 0 || !shows(this.g, 'goals')) return;
    const m = milestoneToast(ids[ids.length - 1]);
    const quiet = introRunning(this.g.state);   // while the lessons run, no list of things they have not brought yet
    if (ids.length === 1) toast(m.text, 'gold', 'i_laurel', 6000, quiet ? undefined : m.unlock || undefined);
    else toast(`Res Gestae: ${ids.length} deeds done`, 'gold', 'i_laurel', 6000, quiet ? undefined : `Latest: ${m.text.replace(/^Res Gestae: /, '')}. New things wait in Edicta.`);
    this.g.sfx('lyre');
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

  /** Shows the title screen (hides the game chrome: the whole map is free behind it). */
  showTitle(): void {
    document.getElementById('app')?.classList.add('in-title');
    this.tray.close();
    this.showPlaceBanner(null, null);
    this.title.show();
    this.layout.refresh();
  }

  /** Hides the title screen. The colony's own tab bar comes up at once (a new colony has none yet, and its panel hides)
   *  and the layout measures the chrome, so the view that attaches next centres and zooms on the map it leaves free. */
  hideTitle(): void {
    document.getElementById('app')?.classList.remove('in-title');
    this.title.hide();
    this.changed();
    this.side.frame(performance.now());
    if (this.layout.host === 'sheet') this.layout.setDetent('closed', { instant: true });   // a colony entered on a phone: the map
    this.layout.refresh();
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

  /** The placement banner: sprite, name, cost, verdict and the help line; a Place button on touch. Entering or leaving
   *  placing changes the free map on a phone: on the SHEET placing routes the sheet to closed (remembered; the banner
   *  stands in its place), and it comes back when placing is cancelled, but not after a work was placed (placed()): the
   *  player is on the map. The layout measures again before view.startPlacing glides a pre-positioned ghost into it. */
  showPlaceBanner(p: PlacingState | null, check: PlaceCheck | null): void {
    const app = document.getElementById('app'), was = app?.classList.contains('placing');
    renderPlaceBanner(this.g, el('place-banner'), p, check);
    const now = app?.classList.contains('placing');
    if (!app || was === now) return;
    const L = this.layout;
    if (L?.host === 'sheet') {
      if (now) L.go({ kind: 'place' });
      else if (this.placedOk) L.forget();
      else if (!this.inspector.pinned) L.restore();   // a card placing started from comes back: the sheet stays aside
    }
    this.placedOk = false;
    L?.refresh();
  }

  /** Unfolds the event card (the voice line's Read, the Breviarium's, "Read the dispatch"): on the phone it docks in the
   *  sheet's slot (choice.onStage), never over placing (asked for while placing, the placing ends first). False when no
   *  dispatch waits. */
  private readDispatch(): boolean {
    if (!this.g.state.choice) return false;
    if (this.layout.host === 'sheet' && this.g.view.placing) this.g.cancelPlacing();
    return this.choice.reveal();
  }

  /** A work was placed and the placing ends (App.placeAt): a phone's sheet stays where placing put it. */
  placed(): void {
    this.placedOk = true;
  }
}
