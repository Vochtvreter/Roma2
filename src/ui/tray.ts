// src/ui/tray.ts — the Breviarium, "the accounts" (DESIGN §15.2, §15.7): the pull-down under the HUD that every HUD figure
// opens, on every host. Owner: WP-H. UI-only, never a tab (TabId): what waits on the player, the Res Gestae, Grain and
// Aqua with their 12-month strips, run-out lines, year charts and "how to get more", the coin, souls, spirits, dignitas,
// the date and its seasons, every material, and the Ordo's lines since the player last looked. A phone's HUD keeps one
// row (hud.css), so every figure it drops lives here; a mouse still has the hover cards, and a click opens this.
// Non-modal: the colony runs on, the map stays live; a press outside, a second tap on the same figure, the ✕, a swipe up
// on the grip, Esc and Back (a history.ts layer) close it. Full width under a phone's HUD; elsewhere a 420 px panel under
// the HUD on the tapped figure's side. At most 70% of #app tall; its body scrolls inside.
// One instance of every widget: on the phone hosts (the SHEET, the DRAWER) the Res Gestae panel itself (#objective,
// objective.ts) moves in here and goes back to the left column on any other host, which shows a one-line entry instead. The essentials' strips
// and cards are vitals.ts' own helpers; the ledgers are hud-tips.ts' cards. Refreshed like the side panel while open (and
// only then): each section rebuilds on its discrete signature (never within a click of the pointer, nor while the mouse
// rests here), its updaters patch numbers in place, and the cards are redrawn once a game day (at most once a second);
// the element in view keeps its place across a redraw that changes a height (steady.ts).
// On the tablet DOCK's wide pane from 960 px wide and the desktop COLUMNS' wide panel (layout.ts brevColumn) the same
// tray stands as the pane's first column (column(): re-hosted into #side, open for as long as the pane is wide; no ✕, no
// grip, no Back layer, and a press outside leaves it; a HUD figure scrolls it to its section), and goes back under the
// HUD, closed, when the pane docks again.
import type { Essential, GameState, LogEntry, LogKind, ResId } from '../game/types';
import type { Game, Updater } from './types';
import type { Host } from './layout';
import { isPhone } from './layout';
import { clear, fmt, fmtRate, h, img, scrollWithin } from './dom';
import { caps } from './tipkit';
import { PointerHold, ScrollAnchor } from './steady';
import { BACK_RANK, registerBack } from './history';
import { awaitAction, awaitingItems, showLesson } from './counsel';
import type { AwaitItem, VoiceAction } from './counsel';
import { daysText, emptyLine, paintCells, paintSeasons, stripCells, trendOf, vitalTip } from './vitals';
import type { SeasonRow } from './vitals';
import { coinTip, dateTip, dignitasTip, moraleTip, netRate, soulsTip, stripShown } from './hud-tips';
import { dangerLabel } from './objective';
import { shows, tabShown } from './intro';
import { btn } from './tabs/common';
import { activeAdvisories, renderAdvisory } from '../game/advisors/engine';
import { currentMilestone, MILESTONES } from '../game/objectives';
import { LESSONS } from '../game/intro';
import { forecast } from '../game/forecast';
import { census } from '../game/census';
import { getBuilding } from '../game/state';
import { idx } from '../game/map';
import { view } from '../game/sim';
import { formatRoman, toRoman } from '../game/calendar';
import { ADVISOR_DEFS } from '../game/data/advisors';
import { DUTY_DEFS } from '../game/ordo/duties';
import { PATH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { RESOURCE_DEFS } from '../game/data/resources';
import { resIcon } from '../render/art/index';
import { Home } from './sheet';

/** The section each HUD figure opens the tray at (its data-anchor). */
const SECTION_OF: Readonly<Record<string, string>> = {
  grain: 'grain', water: 'water', coin: 'coin', souls: 'souls', spirits: 'spirits', dignitas: 'dignitas', date: 'date', materials: 'materials',
};
const SEV_NAME = ['NOTA', 'MONITVM', 'CAVE', 'PERICVLVM'] as const;
const LATIN: Record<Essential, string> = { grain: 'Frumentum', water: 'Aqua' };
const NAME: Record<Essential, string> = { grain: 'Grain', water: 'Water' };
const WIDTH = 420;          // the panel off the phone sheet
const GAP = 6;              // between the HUD and the panel off the phone sheet
const EDGE = 8;             // kept clear of #app's edges
const SHARE = 0.7;          // of #app's height, at most
const CARD_MS = 1000;       // the cards are redrawn at most once a second (and only on a new day)
const SWIPE = 24;           // px up on the grip that close the tray
const ORDO_LINES = 6;
/** The Annales' Ordo and Works lines (annales.ts filters): what the Ordo did and what was raised. */
const ORDO_KINDS: readonly LogKind[] = ['ordo', 'emergency', 'ledger', 'build'];

/** Runs a UI step; a bug in one section must never stop the game loop. */
function safe(what: string, fn: () => void): void {
  try { fn(); } catch (e) { console.error(`[tray] ${what}`, e); }
}

/** One section: shown or not (the lessons bring parts in), a discrete signature that rebuilds its static part, updaters
 *  that patch its numbers, and an optional card redrawn once a game day. */
interface Section {
  id: string;
  el: HTMLElement;
  body: HTMLElement;
  cardBox: HTMLElement | null;
  shown(): boolean;
  sig(): string;
  build(body: HTMLElement, up: Updater[]): void;
  card?(): Node;
  key: string;
  ups: Updater[];
}

/** The latest Ordo and Works lines of the Annales, newest first. */
function ordoLines(s: GameState): LogEntry[] {
  const out: LogEntry[] = [];
  for (let i = s.log.length - 1; i >= 0 && out.length < ORDO_LINES; i--) if (ORDO_KINDS.includes(s.log[i].kind)) out.push(s.log[i]);
  return out;
}

/** The Breviarium in #tray. */
export class Tray {
  private readonly body: HTMLElement;
  private readonly steady: ScrollAnchor;
  private readonly hold: PointerHold;
  private readonly sections: Section[] = [];
  private readonly slot = h('div', { class: 'tray-gestae-slot' });   // the Res Gestae panel's place here (on a phone)
  private readonly home: { parent: HTMLElement | null; next: Node | null };
  private shownNow = false;
  private fig: string | null = null;          // the figure that opened the tray ('' when a caller opened it)
  private opener: HTMLElement | null = null;
  private hostNow: Host | null = null;
  private stateRef: GameState | null = null;
  private cardDay = -1;
  private cardsAt = -Infinity;
  private seen: LogEntry | null = null;       // the newest Ordo line when the tray last closed: later ones are new
  private col: HTMLElement | null = null;     // the pane the tray stands in as its first column (column), else null
  private readonly rootHome: Home;            // the tray's own place in #app (under the HUD)
  /** "Read" on a waiting dispatch: the UI root unfolds the event card (ChoiceCard.reveal); false when none is pending. */
  onRead: (() => boolean) | null = null;

  constructor(private readonly g: Game, private readonly root: HTMLElement, private readonly objective: HTMLElement) {
    this.home = { parent: objective.parentElement, next: objective.nextSibling };
    this.rootHome = new Home(root);
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Breviarium: the accounts');
    const close = h('button', { class: 'tray-x', 'aria-label': 'Close the accounts (Esc)', onclick: () => { g.sfx('click'); this.close(); } }, '✕');
    const head = h('div', { class: 'tray-head' }, h('span', { class: 'tray-k' }, 'BREVIARIVM'), h('span', { class: 'tray-title' }, 'The accounts'), close);
    this.body = h('div', { class: 'tray-body' });
    this.steady = new ScrollAnchor(this.body);
    this.hold = new PointerHold(root);
    const grip = h('div', { class: 'tray-grip', 'aria-hidden': 'true' }, h('i'));
    this.grip(grip);
    // the Res Gestae panel's buttons (its next step, a danger chip) go to a tab: the tray folds first, as its rows do
    this.slot.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) this.close();
    }, true);
    clear(root);
    root.append(head, this.body, grip);
    this.sections.push(
      this.awaiting(), this.gestae(), this.vital('grain'), this.vital('water'),
      this.card('coin', () => shows(g, 'coin'), () => coinTip(g)),
      this.card('souls', () => shows(g, 'souls'), () => soulsTip(g)),
      this.card('spirits', () => shows(g, 'souls'), () => moraleTip(g)),
      this.card('dignitas', () => shows(g, 'dignitas'), () => dignitasTip(g)),
      this.card('date', () => true, () => dateTip(g)),
      this.materials(), this.ordo());
    this.body.append(this.steady.head, ...this.sections.map((x) => x.el), this.steady.foot);
    // a layer of the Back and Esc chain (history.ts); a press anywhere else closes it (a figure's own tap toggles it)
    registerBack({ rank: BACK_RANK.tray, open: () => this.shownNow && !this.col, close: () => this.close() });
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', (e) => {
        if (!this.shownNow || this.col || !(e.target instanceof Node) || root.contains(e.target)) return;
        const el = e.target instanceof Element ? e.target : e.target.parentElement;
        if (el?.closest('[data-fig], #modal-root, #tooltip')) return;
        this.close();
      }, true);
      window.addEventListener('resize', () => { if (this.shownNow) this.place(); });
    }
  }

  /** The tray is open (as the pull-down; the wide pane's column is part of the pane). */
  get open(): boolean {
    return this.shownNow && !this.col;
  }

  /** Whether a HUD figure's hover card would drop over the open tray (it follows the pointer down from the figure): the
   *  figure stands over the tray's span. Those cards hold their tongue; the others still speak (hud.ts quiet). */
  covers(el: HTMLElement): boolean {
    if (!this.shownNow || this.col) return false;
    const t = this.root.getBoundingClientRect(), r = el.getBoundingClientRect();
    return r.left < t.right && r.right > t.left;
  }

  /** A HUD figure was tapped or clicked: open the tray at its section, or close it on a second tap of the same figure
   *  (the same element: every material cell opens the materials, and another one keeps the tray open). */
  toggle(fig: string, from: HTMLElement | null, viaKey = false): void {
    if (this.col) { this.g.sfx('click'); this.show(SECTION_OF[fig] ?? 'awaiting'); return; }   // the column: to its section
    if (this.shownNow && (from ? from === this.opener : this.fig === fig)) { this.g.sfx('click'); this.close(); return; }
    this.show(SECTION_OF[fig] ?? 'awaiting', from, fig, viaKey);
  }

  /** Opens the tray at a section ('awaiting' by default: the top), anchored to `from` off the phone sheet. */
  show(section = 'awaiting', from: HTMLElement | null = null, fig = '', viaKey = false): void {
    if (this.col) { from = null; fig = ''; viaKey = false; }   // the wide pane's column: it only scrolls to the section
    const was = this.shownNow;
    this.opener?.setAttribute('aria-expanded', 'false');
    this.opener = from;
    this.fig = fig;
    from?.setAttribute('aria-expanded', 'true');
    if (!was) {
      this.g.sfx('click');
      this.shownNow = true;
      this.root.hidden = false;
      this.update(performance.now(), true);
    }
    this.place();
    const at = this.body.querySelector<HTMLElement>(`[data-anchor="${section}"]`);
    if (at && !at.hidden && section !== 'awaiting') scrollWithin(this.body, at, 'start');
    else this.body.scrollTop = 0;
    if (viaKey) this.root.querySelector<HTMLElement>('.tray-x')?.focus({ preventScroll: true });
  }

  /** Closes the tray; the Ordo's lines shown so far are no longer new. Not the wide pane's column: it stays while the pane
   *  is wide (a row's action leaves it standing). */
  close(): void {
    if (!this.shownNow || this.col) return;
    this.hide();
  }

  /** Stands the tray in `pane` as its first column (the DOCK's wide pane: layout.brevColumn), open and at its top; null
   *  puts it back under the HUD, closed. An open pull-down becomes the column. */
  column(pane: HTMLElement | null): void {
    if (pane === this.col) return;
    const was = this.col;
    this.col = pane;
    const st = this.root.style;
    if (pane) {
      this.opener?.setAttribute('aria-expanded', 'false');
      this.opener = null;
      this.fig = null;
      pane.insertBefore(this.root, pane.firstChild);
      this.root.classList.add('tray-col');
      st.top = st.left = st.width = st.maxHeight = '';
      if (!this.shownNow) { this.shownNow = true; this.root.hidden = false; this.update(performance.now(), true); }
      this.body.scrollTop = 0;
      return;
    }
    if (!was) return;
    this.root.classList.remove('tray-col');
    this.rootHome.back();
    this.hide();
  }

  private hide(): void {
    this.shownNow = false;
    this.root.hidden = true;
    this.opener?.setAttribute('aria-expanded', 'false');
    if (this.opener && this.root.contains(document.activeElement)) this.opener.focus({ preventScroll: true });
    this.opener = null;
    this.fig = null;
    this.seen = ordoLines(this.g.state)[0] ?? this.seen;
  }

  /** The host changed (or the layout started): the Res Gestae panel moves in here on a phone and back to the left
   *  column anywhere else; an open tray takes the new host's shape. */
  mount(host: Host): void {
    if (host === this.hostNow) { if (this.shownNow) this.place(); return; }
    const wasPhone = isPhone(this.hostNow);
    this.hostNow = host;
    const o = this.objective;
    if (isPhone(host)) { if (o.parentElement !== this.slot) this.slot.appendChild(o); }
    else if (o.parentElement === this.slot && this.home.parent) {
      const next = this.home.next && this.home.next.parentNode === this.home.parent ? this.home.next : this.home.parent.firstChild;
      this.home.parent.insertBefore(o, next);
    }
    const gestae = this.sections.find((x) => x.id === 'gestae');
    if (gestae && wasPhone !== isPhone(host)) gestae.key = '\u0000';   // the one-line entry or the panel: rebuilt for the host
    if (this.shownNow) { this.update(performance.now(), true); this.place(); }
  }

  /** The layout moved (the HUD grew, the window turned): an open tray follows. */
  relayout(): void {
    if (this.shownNow) this.place();
  }

  /** Throttled by the UI root: while open, sections show or hide as the lessons bring their parts, rebuild on their
   *  signatures, and patch numbers; the cards are redrawn once a game day. `force` (opening): rebuild what changed now. */
  update(now: number, force = false): void {
    if (!this.shownNow) return;
    const s = this.g.state;
    if (s !== this.stateRef) {   // a new or loaded colony: everything from scratch, nothing of the old one's Ordo is new
      this.stateRef = s;
      for (const x of this.sections) x.key = '\u0000';
      this.seen = null;
      this.cardDay = -1;
    }
    const cards = force || (s.day !== this.cardDay && now - this.cardsAt >= CARD_MS);
    if (cards) { this.cardDay = s.day; this.cardsAt = now; }
    const held = !force && this.hold.holds();
    let mark: ReturnType<ScrollAnchor['capture']> | null = null;
    let moved = false;
    const redraw = (x: Section, fn: () => void): void => {
      mark ??= this.steady.capture();
      const before = x.el.offsetHeight;
      safe(`${x.id} build`, fn);
      if (x.el.offsetHeight !== before) moved = true;
    };
    for (const x of this.sections) {
      let on = false;
      safe(`${x.id} shown`, () => { on = x.shown(); });
      if (x.el.hidden === on) { mark ??= this.steady.capture(); x.el.hidden = !on; moved = true; }   // marked before it moves
      if (!on) continue;
      let sig = '';
      safe(`${x.id} signature`, () => { sig = x.sig(); });
      if (sig !== x.key && !held) {
        x.key = sig;
        redraw(x, () => {
          x.ups = [];
          clear(x.body);
          x.build(x.body, x.ups);
          if (x.cardBox && x.card) x.cardBox.replaceChildren(x.card());
        });
      } else if (cards && x.cardBox && x.card) {
        const c = x.card;
        const box = x.cardBox;
        redraw(x, () => box.replaceChildren(c()));
      }
      for (const u of x.ups) safe(`${x.id} updater`, u);
    }
    if (mark && moved) { const m = mark; safe('anchor', () => this.steady.restore(m)); }
  }

  // ───────────────────────────── placement ─────────────────────────────
  /** Under the HUD: full width on a phone's sheet; elsewhere (a landscape phone's drawer too) a 420 px panel on the
   *  tapped figure's side. */
  private place(): void {
    const app = this.root.parentElement;
    if (!app || this.col) return;
    const hud = document.getElementById('hud');
    const sheet = this.hostNow === 'sheet';
    const top = (hud && !hud.hidden ? hud.offsetTop + hud.offsetHeight : 0) + (sheet ? 0 : GAP);
    const W = app.clientWidth, H = app.clientHeight;
    const st = this.root.style;
    st.top = `${top}px`;
    st.maxHeight = `${Math.max(120, Math.min(H * SHARE, H - top - EDGE))}px`;
    if (sheet) { st.left = ''; st.width = ''; return; }
    const w = Math.min(WIDTH, W - 2 * EDGE);
    let left = EDGE;
    if (this.opener?.isConnected) {
      const a = app.getBoundingClientRect(), r = this.opener.getBoundingClientRect();
      const l = r.left - a.left, rt = r.right - a.left;
      left = l + r.width / 2 < W / 2 ? l : rt - w;
    }
    st.left = `${Math.round(Math.max(EDGE, Math.min(W - w - EDGE, left)))}px`;
    st.width = `${w}px`;
  }

  /** The grip at the tray's foot: a tap or a swipe up closes it. */
  private grip(el: HTMLElement): void {
    let y0: number | null = null;
    el.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { el.setPointerCapture(e.pointerId); } catch { /* no capture: the release still lands */ } });
    el.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = y0 - e.clientY;
      y0 = null;
      if (dy >= SWIPE || Math.abs(dy) < SWIPE / 2) { this.g.sfx('click'); this.close(); }
    });
    el.addEventListener('pointercancel', () => { y0 = null; });
  }

  // ───────────────────────────── sections ─────────────────────────────
  /** A section: its heading, a body its build() fills, the card box when it has a card. `lead`: a node that stays put
   *  before the body across rebuilds (the Res Gestae panel's slot: it must stay in the document, where its id is found). */
  private section(id: string, o: Omit<Section, 'id' | 'el' | 'body' | 'cardBox' | 'key' | 'ups'>, head?: [string, string], lead?: HTMLElement): Section {
    const body = h('div', { class: 'tray-sec-body' });
    const cardBox = o.card ? h('div', { class: 'tray-card' }) : null;
    const el = h('section', { class: `tray-sec tray-${id}`, dataset: { anchor: id } },
      head ? h('div', { class: 'tray-h' }, head[0], h('span', { class: 'tray-latin' }, head[1])) : null, lead ?? null, body, cardBox);
    el.hidden = true;
    return { id, el, body, cardBox, key: '\u0000', ups: [], ...o };
  }

  /** A section that is a ledger card of hud-tips.ts, drawn afresh once a game day. */
  private card(id: string, shown: () => boolean, card: () => Node): Section {
    return this.section(id, { shown, sig: () => '', build: () => undefined, card });
  }

  /** "Awaiting you": what waits on the player, each with its one action (counsel.ts awaitingItems, awaitAction). */
  private awaiting(): Section {
    const g = this.g;
    const itemKey = (x: AwaitItem, a: VoiceAction | null): string => {
      const act = a ? `${a.label}${a.kind === 'remedy' ? (a.ok ? 1 : 0) : ''}` : '-';
      if (x.kind === 'advisory') return `a:${x.a.rule}:${x.a.memo.sev}:${act}`;
      if (x.kind === 'event') return `e:${x.title}:${x.expires}`;
      if (x.kind === 'offer') return `o:${x.duties.join(',')}`;
      return `p:${x.decision}:${x.affordable ? 1 : 0}`;
    };
    let list: { item: AwaitItem; act: VoiceAction | null; key: string }[] = [];
    return this.section('awaiting', {
      shown: () => true,
      sig: () => {
        const s = g.state;
        list = awaitingItems(s).map((item) => { const act = awaitAction(item, s); return { item, act, key: itemKey(item, act) }; });
        return list.map((x) => x.key).join('|');
      },
      build: (body, up) => {
        if (!list.length) { body.append(h('div', { class: 'tray-quiet' }, 'Nothing waits on you. The council is content.')); return; }
        for (const x of list) body.append(this.awaitRow(x.item, x.act, x.key, up));
      },
    }, ['Awaiting you', 'quae exspectant']);
  }

  private awaitRow(item: AwaitItem, act: VoiceAction | null, key: string, up: Updater[]): HTMLElement {
    const g = this.g;
    const title = h('span', { class: 'tray-row-t' });
    const sub = h('span', { class: 'tray-row-s' });
    let kicker = '', cls = '';
    let day = -1;
    let refresh: () => void = () => undefined;
    if (item.kind === 'advisory') {
      const a = item.a;
      kicker = `${SEV_NAME[a.memo.sev]} · ${caps(ADVISOR_DEFS[a.advisor].office)}`;
      cls = `sev-c${a.memo.sev}`;
      refresh = () => {
        const s = g.state;
        const live = activeAdvisories(s).find((x) => x.rule === a.rule) ?? a;
        title.textContent = renderAdvisory(s, view(s), live).title;
        sub.textContent = live.memo.metric ? dangerLabel(live) : '';
      };
    } else if (item.kind === 'event') {
      kicker = 'NVNTIVS';
      cls = 'gold';
      title.textContent = item.title;
      refresh = () => { sub.textContent = `${Math.max(0, item.expires - g.state.day)} d to answer`; };
    } else if (item.kind === 'offer') {
      kicker = 'MANDATA';
      title.textContent = item.duties.length === 1 ? `The Ordo can take up ${DUTY_DEFS[item.duties[0]].name.toLowerCase()}` : `The Ordo can take up ${item.duties.length} chores`;
      sub.textContent = 'Hand them over, or keep them yours';
    } else {
      kicker = item.decision === 'charter' ? 'LEX COLONIAE' : 'PETITIO';
      cls = 'gold';
      title.textContent = item.decision === 'charter' ? 'Choose the founding law' : `Petition Rome: ${item.rank !== null ? RANK_DEFS[item.rank].name : PATH_DEFS[item.decision].name}`;
      sub.textContent = item.affordable ? 'Rome would hear us now' : 'The Ordo saves for the fee';
    }
    up.push(() => { if (g.state.day !== day) { day = g.state.day; refresh(); } });
    const row = h('div', { class: 'tray-row', dataset: { key } },
      h('div', { class: 'tray-row-main' }, h('span', { class: `tray-row-k ${cls}` }, kicker), title, sub),
      act ? this.actionBtn(act) : null);
    return row;
  }

  /** The row's one action; a remedy that cannot run now shows why (and refuses with a toast). */
  private actionBtn(a: VoiceAction): HTMLElement {
    const g = this.g;
    const run = (): void => {
      this.close();
      switch (a.kind) {
        case 'remedy': g.applyRemedy(a.remedy); return;
        case 'open': g.openTab(a.tab, a.anchor, 'chip'); return;   // part-way: Review the Mandata, Petition
        case 'event': if (!this.onRead?.()) g.openTab('council', 'choice', 'chip'); return;
        case 'lesson': {
          const l = LESSONS.find((x) => x.id === a.lesson);
          if (l) showLesson(g, l);
          return;
        }
      }
    };
    const reason = a.kind === 'remedy' && !a.ok ? a.reason : null;
    const b = btn(g, a.label, () => { g.sfx('click'); run(); }, { cls: 'primary', reason, sfx: false });
    return reason ? h('span', { class: 'tray-act' }, b, h('span', { class: 'tray-why' }, reason)) : b;
  }

  /** The Res Gestae: the panel itself on a phone (moved in by mount); elsewhere the left column keeps it, and a one-line
   *  entry stands here. */
  private gestae(): Section {
    const g = this.g;
    return this.section('gestae', {
      shown: () => shows(g, 'goals'),
      sig: () => `${isPhone(this.hostNow) ? 'panel' : 'line'}|${currentMilestone(g.state)?.id ?? '-'}`,
      build: (body, up) => {
        if (isPhone(this.hostNow)) return;   // the panel itself stands in the slot
        const s = g.state;
        const m = currentMilestone(s);
        const main = MILESTONES.filter((x) => !x.postVictory).length;
        const k = m ? (m.postVictory ? 'RES GESTAE · POST VICTORIAM' : `RES GESTAE · ${toRoman(s.guidance.objective + 1)} / ${toRoman(Math.max(1, main))}`) : 'RES GESTAE';
        const prog = h('span', { class: 'tray-gestae-p num' });
        body.append(h('div', { class: 'tray-gestae-line' }, h('span', { class: 'tray-row-k' }, k),
          h('span', { class: 'tray-gestae-t' }, m ? m.text : s.victory ? 'The Capitolium stands. Govern as you will.' : 'The colony keeps its own counsel.'), prog));
        if (m) up.push(() => { const [a, b] = m.progress(g.state); prog.textContent = b > 1 ? `${fmt(Math.min(a, b))} / ${fmt(b)}` : ''; });
      },
    }, undefined, this.slot);
  }

  /** Grain or Aqua: days on hand and the trend, the 12-month strip with its seasons and red run-out line, then the card
   *  (stock, ledger, the year chart, the outlook, how to get more: vitals.ts' hover card). */
  private vital(res: Essential): Section {
    const g = this.g;
    return this.section(res, {
      shown: () => true,
      sig: () => '',
      build: (body, up) => {
        const days = h('span', { class: 'tray-vit-days num' });
        const unit = h('span', { class: 'tray-vit-unit' }, 'days on hand');
        const trend = h('span', { class: 'tray-vit-trend' });
        const cells = stripCells();
        const row: SeasonRow = { seasons: h('div', { class: 'tray-seasons' }), seasonKey: '' };
        const empty = h('div', { class: 'tray-empty' });
        body.append(
          h('div', { class: `tray-vit-head vit-${res}` }, img(resIcon(res), 2), h('span', { class: 'tray-h' }, NAME[res], h('span', { class: 'tray-latin' }, LATIN[res])),
            h('span', { class: 'tray-vit-n' }, days, unit), trend),
          h('div', { class: 'tray-strip' }, cells), row.seasons, empty);
        up.push(() => {
          const f = forecast(g.state)[res];
          const n = daysText(f);
          days.textContent = n;
          unit.hidden = n === '∞';
          const t = trendOf(g, res);
          trend.textContent = `${t.arrow} ${t.rate} a day`;
          trend.className = `tray-vit-trend${t.cls ? ` ${t.cls}` : ''}`;
          empty.textContent = emptyLine(g, res, f);
          empty.hidden = empty.textContent === '';
          const months = f.months.slice(0, cells.length);
          paintCells(cells, months);
          paintSeasons(row, months);
        });
      },
      card: () => vitalTip(g, res),
    });
  }

  /** Every material on the strip, three to a row: name, amount over cap, the day's net. */
  private materials(): Section {
    const g = this.g;
    return this.section('materials', {
      shown: () => shows(g, 'materials') && stripShown(g.state).length > 0,
      sig: () => stripShown(g.state).join(','),
      build: (body, up) => {
        const grid = h('div', { class: 'tray-mats' });
        for (const r of stripShown(g.state)) grid.append(this.matCell(r, up));
        body.append(grid);
      },
    }, ['Materials', 'Materia']);
  }

  private matCell(r: ResId, up: Updater[]): HTMLElement {
    const g = this.g;
    const def = RESOURCE_DEFS[r];
    const n = h('span', { class: 'tray-mat-n num' });
    const rate = h('span', { class: 'tray-mat-r num' });
    const el = h('div', { class: 'tray-mat', dataset: { key: `m-${r}` } },
      h('div', { class: 'tray-mat-top' }, img(resIcon(r), 2), h('span', { class: 'tray-mat-name' }, def.name)), n, rate);
    up.push(() => {
      const s = g.state;
      const cap = census(s).caps[r];
      const v = s.res[r];
      n.textContent = `${fmt(v)}/${fmt(cap)}`;
      n.classList.toggle('full', v >= cap - 0.5);
      const net = netRate(g, r);
      rate.textContent = fmtRate(net);
      rate.className = `tray-mat-r num${net > 0.05 ? ' good' : net < -0.05 ? ' bad' : ''}`;
    });
    return el;
  }

  /** "The Ordo since you looked": its latest lines and the works raised, those since the tray last closed marked new;
   *  a line about a work finds it on the map. */
  private ordo(): Section {
    const g = this.g;
    return this.section('ordo', {
      shown: () => shows(g, 'ticker') && ordoLines(g.state).length > 0,
      sig: () => { const l = ordoLines(g.state); return `${l.length}|${l[0]?.day ?? ''}|${l[0]?.text ?? ''}|${this.seen?.text ?? ''}|${tabShown(g.state, 'annals') ? 1 : 0}`; },
      build: (body) => {
        const s = g.state;
        const lines = ordoLines(s);
        const at = this.seen ? lines.indexOf(this.seen) : -1;
        const fresh = this.seen === null ? 0 : at < 0 ? lines.length : at;   // a first look marks nothing new
        const ul = h('ul', { class: 'tray-log' });
        lines.forEach((e, i) => {
          const b = e.ref !== undefined ? getBuilding(s, e.ref) : undefined;
          const li = h('li', { class: `${i < fresh ? 'new' : ''}${b ? ' click' : ''}`, dataset: { key: `l-${e.day}-${e.text}` } },
            h('span', { class: 'tray-log-d num' }, formatRoman(e.day)), h('span', { class: 'tray-log-t' }, e.text));
          if (b) li.addEventListener('click', () => { this.close(); g.select(b.id); g.focusTile(idx(b.x, b.y)); });
          ul.append(li);
        });
        body.append(ul);
        if (tabShown(s, 'annals')) body.append(h('button', { class: 'btn small tray-more', onclick: () => { g.sfx('click'); this.close(); g.openTab('annals'); } }, 'Annales · the whole chronicle'));
      },
    }, ['The Ordo since you looked', 'Acta Ordinis']);
  }
}
