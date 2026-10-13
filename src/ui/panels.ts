// src/ui/panels.ts — the side panel host: tabs, badges, NEW markers, signature diffing (ARCHITECTURE §13.3, DESIGN §15.3). Owner: WP-I.
// Signature-diff pattern (Hearthlands): at most every UI_THROTTLE_MS compute the open tab's signature; when it changed,
// clear and rebuild, else run the updaters. Never rebuild under the pointer within 300 ms of a click, nor while a
// dropdown is focused (its list may be open) or a slider is being dragged. Either way the
// element under the mouse (else the first in view) keeps its place on screen (steady.ts): a works row finishing or a
// caravan coming home never slides the card the player is about to click.
// The tab buttons (#tabs) head the panel on most hosts; on the phone SHEET (layout.ts) they are its fixed bottom bar of
// five stable slots, on the landscape DRAWER its 56 px spine of icons at the right edge (labels in the long-press tip and
// the aria-label), re-hosted into #app either way (mount), and a tab opens where layout.go() routes it. On the tablet DOCK
// they stay in the pane, under its head: a 3×2 grid docked, one row wide, and the 56 px spine of icons when the pane is
// folded (dock.css; their names in the aria-label there too). On the desktop COLUMNS the folded panel is a 64 px badge
// spine of the same buttons (columns.css), and ⤢ (#side-wide, beside the ▸ toggle on the panel's edge) widens it to the
// Tabularium and docks it again.
import { TABS } from '../game/types';
import type { GameState, TabId } from '../game/types';
import type { Game, Updater } from './types';
import type { TabPanel } from './tabs/common';
import type { Detent, Host, Layout, OpenFrom } from './layout';
import { isPhone, slotTap } from './layout';
import { clear, h, img, scrollWithin, tip } from './dom';
import { tabShown } from './intro';
import { notePractice } from '../game/actions';
import { ControlHold, PointerHold, ScrollAnchor } from './steady';
import { B } from '../game/balance';
import { panel as edicta } from './tabs/edicta';
import { panel as consiliarii } from './tabs/consiliarii';
import { panel as aedificia } from './tabs/aedificia';
import { panel as populus } from './tabs/populus';
import { panel as commercium } from './tabs/commercium';
import { panel as annales } from './tabs/annales';

export type { TabPanel };

/** Every tab panel by id. */
export const PANELS: Readonly<Record<TabId, TabPanel>> = {
  council: edicta, advisors: consiliarii, build: aedificia, people: populus, trade: commercium, annals: annales,
};

const PULSE_MS = 1600;

/** Runs a UI step; a bug in one panel must never stop the game loop. */
function safe(what: string, fn: () => void): boolean {
  try { fn(); return true; } catch (e) { console.error(`[panels] ${what}`, e); return false; }
}

/** Scrolls to `[data-anchor=…]` inside the body (that box alone: dom.scrollWithin) and pulses it. */
export function pulseAnchor(anchor: string, body: HTMLElement): void {
  const el = body.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`);
  if (!el) return;
  scrollWithin(body, el, 'start');
  el.classList.add('side-pulse');
  window.setTimeout(() => el.classList.remove('side-pulse'), PULSE_MS);
}

/** What #app[data-panel] says of the panel (a token list for `~=`): 'collapsed' (#side.collapsed: folded to its toggle,
 *  the spine or the phone's bar), 'empty' (#side.empty: no tab yet) and 'notabs' (#tabs holds no button). The stylesheets
 *  key on it instead of #app:has(#side.collapsed): any :has() on #app had each text change under it (a HUD figure, a
 *  tab's line, every frame) check #app's rules again and restyle what they reach. '' when none holds. */
export function panelTokens(collapsed: boolean, empty: boolean, noTabs: boolean): string {
  return [collapsed ? 'collapsed' : '', empty ? 'empty' : '', noTabs ? 'notabs' : ''].filter(Boolean).join(' ');
}

/** The side panel in #side. */
export class SidePanel {
  private cur: TabId = 'council';
  private sig = '';
  private ups: Updater[] = [];
  private last = -Infinity;
  private lastClick = -Infinity;
  private readonly tabsEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggleEl: HTMLButtonElement | null;
  private readonly wideEl: HTMLButtonElement;   // ⤢ / ⤡: wide and docked (the COLUMNS' panel edge; columns.css)
  private readonly btns = new Map<TabId, { btn: HTMLButtonElement; badge: HTMLElement }>();
  private barKey = '';
  private known: Set<TabId> | null = null;     // revealed tabs the player has already been shown
  private readonly fresh = new Set<TabId>();   // revealed since, not yet visited: NEW sticker
  private built: TabId | null = null;          // the tab the body holds now
  private forced: TabId | null = null;         // a tab opened by a button before the introduction brought it in
  private stateRef: GameState | null = null;
  private readonly steady: ScrollAnchor;   // keeps the pointed row in place across rebuilds
  private readonly control: ControlHold;   // an open dropdown or a dragged slider: rebuilds wait
  private readonly press: PointerHold;     // a press still held in the body (a repeating labour ±): rebuilds wait
  /** The 'choice' anchor names the event card, not a tab section: set by the UI root to unfold and pulse it (true when shown). */
  onChoiceAnchor: (() => boolean) | null = null;
  /** A bar slot or spine icon was tapped, or a tab opens, on a phone: the UI root closes a card standing in the phone's
   *  slot (true when it closed one). */
  onSlotTap: (() => boolean) | null = null;
  /** The layout engine (ui/layout.ts), the one owner of the panel's detent: toggle() asks it, open() routes through it,
   *  and it writes the panel through show(). Set when UI.build() creates it; before that, the panel writes itself. */
  layout: Pick<Layout, 'panelToggle' | 'go' | 'setDetent' | 'detent' | 'host'> | null = null;
  private readonly bodyHome: HTMLElement;   // where the tab buttons stand off the phones: before the body
  private vertical = false;                 // the tab buttons are the DRAWER's spine: the arrows go up and down
  private named = false;                    // the buttons may show their icon alone (the DRAWER's and the DOCK's spine): aria-labels

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.tabsEl = root.querySelector<HTMLElement>('#tabs') ?? root.appendChild(h('nav', { id: 'tabs', role: 'tablist' }));
    this.body = root.querySelector<HTMLElement>('#tab-body') ?? root.appendChild(h('div', { id: 'tab-body', role: 'tabpanel' }));
    this.bodyHome = this.body;
    this.steady = new ScrollAnchor(this.body);
    this.control = new ControlHold(this.body);
    this.press = new PointerHold(this.body);
    this.toggleEl = root.querySelector<HTMLButtonElement>('#side-toggle');
    this.toggleEl?.addEventListener('click', () => { g.sfx('click'); this.toggle(); });
    this.toggleEl?.setAttribute('aria-expanded', 'true');
    // ⤢ beside the toggle: the Tabularium (wide) and back to the Mensa (docked), as the view control's I and M do
    this.wideEl = h('button', { class: 'side-wide', id: 'side-wide', type: 'button', 'aria-label': 'Wide panel (Tabularium · Ledgers)', onclick: () => { g.sfx('click'); this.widen(); } });
    tip(this.wideEl, () => (this.layout?.detent === 'full' ? 'Mensa · Map & ledger: dock the panel   key M' : 'Tabularium · Ledgers: widen the panel   key I'));
    root.insertBefore(this.wideEl, this.toggleEl ? this.toggleEl.nextSibling : root.firstChild);
    this.syncWide('half');
    this.tabsEl.setAttribute('aria-label', 'Panels');
    this.body.addEventListener('pointerdown', () => { this.lastClick = performance.now(); });
    this.tabsEl.addEventListener('keydown', (e) => this.onKey(e));
    this.mirror();
  }

  /** Writes the panel's state on #app (data-panel: panelTokens), with the class or the tab bar it mirrors, and only when
   *  it changed. */
  private mirror(): void {
    const app = this.root.closest<HTMLElement>('#app');
    if (!app) return;
    const c = this.root.classList, v = panelTokens(c.contains('collapsed'), c.contains('empty'), this.tabsEl.firstChild === null);
    if ((app.dataset.panel ?? '') === v) return;
    if (v) app.dataset.panel = v; else delete app.dataset.panel;
  }

  /** The open tab. */
  get current(): TabId {
    return this.cur;
  }

  /** Throttled: reveal changes and NEW stickers, badges, then the open tab's signature diff or its updaters. */
  frame(now: number): void {
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    const g = this.g;
    if (g.state !== this.stateRef) {               // a new or loaded game: nothing is NEW, rebuild from scratch
      this.stateRef = g.state;
      this.known = null;
      this.fresh.clear();
      this.forced = null;
      this.sig = '';
      this.built = null;                           // and from the top of its page, not the old colony's scroll
    }
    safe('tabs', () => this.syncTabs());
    safe('badges', () => this.badges());
    const p = PANELS[this.cur];
    let sig = '';
    safe(`${this.cur} signature`, () => { sig = `${this.cur}|${p.signature(g)}`; });
    if (sig !== this.sig && now - this.lastClick > B.ui.CLICK_GUARD_MS && !this.control.holds() && !this.press.pressed(now)) { this.rebuild(sig); return; }
    if (!this.ups.length) return;
    let mark: ReturnType<ScrollAnchor['capture']> = [];
    safe('anchor', () => { mark = this.steady.capture(); });
    for (const u of this.ups) safe(`${this.cur} updater`, u);
    safe('anchor', () => this.steady.restore(mark));   // a status line that wrapped or a line that appeared above
  }

  /** Opens a tab (and the panel, where layout.go routes it: `from` says who asked, a chip opening part-way; `shift`
   *  with a key: wide on the DOCK and the COLUMNS); an anchor focuses panel state and scrolls to `[data-anchor]`. */
  open(tab: TabId, anchor?: string, from?: OpenFrom, shift = false): void {
    if (anchor === 'choice' && this.onChoiceAnchor?.()) return;
    this.forced = tabShown(this.g.state, tab) ? null : tab;
    if (tab === 'advisors') notePractice(this.g.state, 'advisors');   // the lessons' jobs (§11.13)
    if (tab === 'people') notePractice(this.g.state, 'people');
    // a card in the phone's slot steps aside for any tab that opens (its own buttons, the Breviarium's rows, a lesson),
    // as for a bar slot: else the tab would open behind it, out of sight. Its restore runs first, so the new tab's
    // detent wins. So does the placing for a tab the player asks for (a Breviarium row, a key: as a tap on the bar or the
    // spine), whose panel would stay away behind the banner; a lesson's own tab waits for the placing to end
    if (isPhone(this.layout?.host ?? null)) {
      if (from !== 'lesson' && this.g.view.placing !== null) this.g.cancelPlacing();
      this.onSlotTap?.();
    }
    this.cur = tab;
    this.fresh.delete(tab);
    if (this.layout) this.layout.go({ kind: 'open', tab, from, anchor, shift });
    else this.toggle(true);
    safe('tabs', () => this.syncTabs());
    const p = PANELS[tab];
    if (anchor) safe(`${tab} focus`, () => p.focus?.(anchor));
    let sig = '';
    safe(`${tab} signature`, () => { sig = `${tab}|${p.signature(this.g)}`; });
    this.rebuild(sig, false);
    if (anchor) safe(`${tab} scroll`, () => (p.scrollTo ? p.scrollTo(anchor, this.body) : pulseAnchor(anchor, this.body)));
  }

  /** Collapses or expands the panel (toggles when no argument): collapsed on desktop, a bottom sheet's tab bar on mobile.
   *  Through the layout engine, which keeps the detent (closed, or the last open one) and the camera's insets with it. */
  toggle(open?: boolean): void {
    const on = open ?? this.root.classList.contains('collapsed');
    if (this.layout) this.layout.panelToggle(on);
    else this.show(on);
  }

  /** Writes the panel open or folded (Layout.setDetent; toggle() before the layout exists). `instant`: no slide. */
  show(on: boolean, instant = false): void {
    if (instant) this.root.style.transition = 'none';
    this.root.classList.toggle('collapsed', !on);
    this.mirror();
    this.toggleEl?.setAttribute('aria-expanded', String(on));
    this.toggleEl?.setAttribute('aria-label', on ? 'Hide the panel' : 'Show the panel');
    if (instant) { void this.root.offsetWidth; this.root.style.transition = ''; }   // the folded box is laid out before the slide returns
  }

  /** The panel is open (not folded to its toggle, or to the sheet's tab bar on a phone). */
  get expanded(): boolean {
    return !this.root.classList.contains('collapsed');
  }

  /** How far the tab body is scrolled (the layout keeps it while a card or placing has the phone's sheet aside). */
  get scrollTop(): number {
    return this.body.scrollTop;
  }

  /** Scrolls the tab body back to `top` (Layout.restore), unless the player has moved it since. */
  scrollBack(top: number): void {
    if (this.body.scrollTop < 1) this.body.scrollTop = top;
  }

  /** The host changed (layout.onMount): on a phone the tab buttons stand in #app outside the panel that slides beside
   *  them (the SHEET's bar at its foot, the DRAWER's spine at its right edge: a vertical tab list); anywhere else they go
   *  back to the panel's head. */
  mount(host: Host): void {
    const bar = this.tabsEl, app = this.root.parentElement;
    if (isPhone(host) && app) { if (bar.parentElement !== app) app.insertBefore(bar, this.root.nextSibling); }
    else if (bar.parentElement !== this.root) this.root.insertBefore(bar, this.bodyHome);
    this.vertical = host === 'drawer';
    this.named = host === 'drawer' || host === 'dock';
    bar.setAttribute('aria-orientation', this.vertical ? 'vertical' : 'horizontal');
  }

  /** A tab's button: on a phone the open tab's slot (or spine icon) folds a panel that is up (slotTap); any other press
   *  opens the tab (at its own detent: route). A tap while placing ends the placing first: the player has moved on, and
   *  the panel they saw was closed, so the open tab's slot brings its tab back (where the end of placing restored it),
   *  never folds it. A card in the phone's slot (the context card, the event card: onSlotTap) steps aside for the tab the
   *  same way. On the DOCK and the COLUMNS the open tab's button on a wide pane docks it again (SPEC A §7). */
  private tap(t: TabId): void {
    const L = this.layout;
    if (L && !isPhone(L.host) && t === this.cur && L.detent === 'full') { L.setDetent('half', { user: true }); return; }
    if (L && isPhone(L.host)) {
      const placing = this.g.view.placing !== null;
      if (placing) this.g.cancelPlacing();
      if (this.onSlotTap?.() || placing) {
        if (t === this.cur && L.detent !== 'closed') return;   // the restore put this tab back up
      } else if (slotTap(t, this.cur, L.detent) === 'close') { L.setDetent('closed', { user: true }); return; }
    }
    this.open(t, undefined, 'tab');
  }

  /** ⤢: the panel wide (the Tabularium), or docked again from wide (the player's own move, as the view control's). */
  private widen(): void {
    const L = this.layout;
    if (!L) return;
    L.setDetent(L.detent === 'full' ? 'half' : 'full', { user: true });
    this.syncWide(L.detent);
  }

  /** The UI root calls it as the detent changes: ⤢ pressed while the panel is wide (columns.css draws ⤢ or ⤡, and its
   *  tooltip says which way it goes), and the desktop's tab buttons named while they are its badge spine (spineNames). */
  syncWide(d: Detent | null = this.layout?.detent ?? null): void {
    this.wideEl.setAttribute('aria-pressed', String(d === 'full'));
    this.spineNames(d);
  }

  /** The COLUMNS' tab buttons show their icons alone on the badge spine (closed: columns.css): an aria-label names them
   *  there; docked or wide their name is their own words, the badge and NEW with them, as the desktop's always was. */
  private spineNames(d: Detent | null): void {
    if (this.named) return;   // the DRAWER's and the DOCK's carry theirs always
    const spine = this.layout?.host === 'columns' && d === 'closed';
    for (const [t, { btn }] of this.btns) {
      if (spine) btn.setAttribute('aria-label', `${PANELS[t].label} · ${PANELS[t].sub}`);
      else btn.removeAttribute('aria-label');
    }
  }

  /** Forces a signature check on the next frame (Game.changed). */
  poke(): void {
    this.last = -Infinity;
    this.lastClick = -Infinity;
  }

  /** Reveals tabs; tabs revealed during play wear a NEW sticker until visited. With no tab yet (a new colony, before the
   *  introduction brings the first one) the panel is hidden; the first tab to arrive opens it. */
  private syncTabs(): void {
    const s = this.g.state;
    const revealed = TABS.filter((t) => tabShown(s, t));
    if (!this.known) this.known = new Set(revealed);
    for (const t of revealed) {
      if (this.known.has(t)) continue;
      this.known.add(t);
      if (t !== this.cur) this.fresh.add(t);
    }
    if (this.forced !== null && (this.forced !== this.cur || revealed.includes(this.forced))) this.forced = null;
    const shown = TABS.filter((t) => revealed.includes(t) || t === this.forced);
    if (shown.length > 0 && !shown.includes(this.cur)) {
      this.cur = shown[0];
      this.fresh.delete(this.cur);
    }
    const wasEmpty = this.root.classList.contains('empty');
    this.root.classList.toggle('empty', shown.length === 0);
    this.mirror();
    if (shown.length === 0) this.toggle(false);
    else if (wasEmpty && !isPhone(this.layout?.host ?? null)) this.toggle(true);   // a phone's panel stays closed: the map first
    const key = `${shown.join(',')}|${[...this.fresh].join(',')}|${this.cur}|${+this.vertical}${+this.named}`;
    if (key === this.barKey) return;
    this.barKey = key;
    clear(this.tabsEl);
    this.btns.clear();
    for (const t of shown) {
      const p = PANELS[t];
      const on = t === this.cur;
      const isNew = this.fresh.has(t);
      const badge = h('span', { class: 'badge side-badge', hidden: true });
      const btn = h('button', {
        class: `side-tab${on ? ' on' : ''}${isNew ? ' fresh' : ''}`, role: 'tab', id: `tab-${t}`, type: 'button',
        'aria-selected': String(on), 'aria-controls': 'tab-body', tabindex: on ? '0' : '-1', 'data-tab': t,
        'aria-label': this.named ? `${p.label} · ${p.sub}` : null,   // the DRAWER's and the DOCK's spine show the icon alone (the COLUMNS': spineNames)
        onclick: () => { this.g.sfx('click'); this.tap(t); },
      },
      img(p.icon, 2, 'side-tab-ico'),
      h('span', { class: 'side-tab-text' }, h('span', { class: 'side-tab-label' }, p.label), h('span', { class: 'side-tab-sub' }, p.sub)),
      isNew ? h('span', { class: 'side-new' }, 'NEW') : null, badge);
      tip(btn, `${p.label} · ${p.sub}   key ${p.hotkey}`);
      this.btns.set(t, { btn, badge });
      this.tabsEl.appendChild(btn);
    }
    this.mirror();
    this.spineNames(this.layout?.detent ?? null);
    this.body.setAttribute('aria-labelledby', `tab-${this.cur}`);
  }

  private badges(): void {
    for (const [id, { badge }] of this.btns) {
      const b = PANELS[id].badge?.(this.g) ?? null;
      if (badge.hidden !== !b) badge.hidden = !b;   // (written every frame it set the attribute, and restyled the badge)
      if (!b) continue;
      if (badge.textContent !== b.text) badge.textContent = b.text;
      const cls = `badge side-badge ${b.kind}`;
      if (badge.className !== cls) badge.className = cls;
    }
  }

  /** Rebuilds the open tab; `keepScroll` (a refresh, not a newly opened page) keeps the pointed element in place. A tab
   *  the bar switched to by itself (the open one went away, as Populus does after 'skip the introduction') is a new page
   *  too: it starts at its top, never at the old page's scroll. */
  private rebuild(sig: string, keepScroll = true): void {
    if (this.built !== this.cur) keepScroll = false;
    this.built = this.cur;
    let mark: ReturnType<ScrollAnchor['capture']> = [];
    if (keepScroll) safe('anchor', () => { mark = this.steady.capture(); });
    const top = keepScroll ? this.body.scrollTop : 0;
    this.sig = sig;
    this.ups = [];
    clear(this.body);
    const wrap = h('div', { class: `side-body side-${this.cur}` });
    if (!safe(`${this.cur} build`, () => PANELS[this.cur].build(this.g, wrap, this.ups))) wrap.append(h('div', { class: 'tab-quiet' }, 'Part of this page could not be drawn (see the console).'));
    this.steady.head.style.height = '';
    this.steady.foot.style.height = '';
    this.body.append(this.steady.head, wrap, this.steady.foot);
    this.body.scrollTop = top;
    if (keepScroll) safe('anchor', () => this.steady.restore(mark));
  }

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern): left and right, up and down on the DRAWER's spine. */
  private onKey(e: KeyboardEvent): void {
    const [back, on] = this.vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (e.key !== back && e.key !== on) return;
    const ids = [...this.btns.keys()];
    const i = ids.indexOf(this.cur);
    const next = ids[(i + (e.key === on ? 1 : ids.length - 1)) % ids.length];
    e.preventDefault();
    this.open(next, undefined, 'tab');
    this.btns.get(next)?.btn.focus();
  }
}
