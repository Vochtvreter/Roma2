// src/ui/panels.ts — the side panel host: tabs, badges, NEW markers, signature diffing (ARCHITECTURE §13.3, DESIGN §15.3). Owner: WP-I.
// Signature-diff pattern (Hearthlands): at most every UI_THROTTLE_MS compute the open tab's signature; when it changed,
// clear and rebuild, else run the updaters. Never rebuild under the pointer within 300 ms of a click, nor while a
// dropdown is focused (its list may be open) or a slider is being dragged. Either way the
// element under the mouse (else the first in view) keeps its place on screen (steady.ts): a works row finishing or a
// caravan coming home never slides the card the player is about to click.
import { TABS } from '../game/types';
import type { GameState, TabId } from '../game/types';
import type { Game, Updater } from './types';
import type { TabPanel } from './tabs/common';
import { clear, h, img, scrollWithin, tip } from './dom';
import { tabShown } from './intro';
import { notePractice } from '../game/actions';
import { ControlHold, ScrollAnchor } from './steady';
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
  private readonly btns = new Map<TabId, { btn: HTMLButtonElement; badge: HTMLElement }>();
  private barKey = '';
  private known: Set<TabId> | null = null;     // revealed tabs the player has already been shown
  private readonly fresh = new Set<TabId>();   // revealed since, not yet visited: NEW sticker
  private built: TabId | null = null;          // the tab the body holds now
  private forced: TabId | null = null;         // a tab opened by a button before the introduction brought it in
  private stateRef: GameState | null = null;
  private readonly steady: ScrollAnchor;   // keeps the pointed row in place across rebuilds
  private readonly control: ControlHold;   // an open dropdown or a dragged slider: rebuilds wait
  /** The 'choice' anchor names the event card, not a tab section: set by the UI root to unfold and pulse it (true when shown). */
  onChoiceAnchor: (() => boolean) | null = null;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.tabsEl = root.querySelector<HTMLElement>('#tabs') ?? root.appendChild(h('nav', { id: 'tabs', role: 'tablist' }));
    this.body = root.querySelector<HTMLElement>('#tab-body') ?? root.appendChild(h('div', { id: 'tab-body', role: 'tabpanel' }));
    this.steady = new ScrollAnchor(this.body);
    this.control = new ControlHold(this.body);
    this.toggleEl = root.querySelector<HTMLButtonElement>('#side-toggle');
    this.toggleEl?.addEventListener('click', () => { g.sfx('click'); this.toggle(); });
    this.toggleEl?.setAttribute('aria-expanded', 'true');
    this.tabsEl.setAttribute('aria-label', 'Panels');
    this.body.addEventListener('pointerdown', () => { this.lastClick = performance.now(); });
    this.tabsEl.addEventListener('keydown', (e) => this.onKey(e));
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
    if (sig !== this.sig && now - this.lastClick > B.ui.CLICK_GUARD_MS && !this.control.holds()) { this.rebuild(sig); return; }
    if (!this.ups.length) return;
    let mark: ReturnType<ScrollAnchor['capture']> = [];
    safe('anchor', () => { mark = this.steady.capture(); });
    for (const u of this.ups) safe(`${this.cur} updater`, u);
    safe('anchor', () => this.steady.restore(mark));   // a status line that wrapped or a line that appeared above
  }

  /** Opens a tab (and the panel); an anchor focuses panel state and scrolls to `[data-anchor]`. */
  open(tab: TabId, anchor?: string): void {
    if (anchor === 'choice' && this.onChoiceAnchor?.()) return;
    this.forced = tabShown(this.g.state, tab) ? null : tab;
    if (tab === 'advisors') notePractice(this.g.state, 'advisors');   // the lessons' jobs (§11.13)
    if (tab === 'people') notePractice(this.g.state, 'people');
    this.cur = tab;
    this.fresh.delete(tab);
    this.toggle(true);
    safe('tabs', () => this.syncTabs());
    const p = PANELS[tab];
    if (anchor) safe(`${tab} focus`, () => p.focus?.(anchor));
    let sig = '';
    safe(`${tab} signature`, () => { sig = `${tab}|${p.signature(this.g)}`; });
    this.rebuild(sig, false);
    if (anchor) safe(`${tab} scroll`, () => (p.scrollTo ? p.scrollTo(anchor, this.body) : pulseAnchor(anchor, this.body)));
  }

  /** Collapses or expands the panel (toggles when no argument): collapsed on desktop, a bottom sheet's tab bar on mobile. */
  toggle(open?: boolean): void {
    const on = open ?? this.root.classList.contains('collapsed');
    this.root.classList.toggle('collapsed', !on);
    this.toggleEl?.setAttribute('aria-expanded', String(on));
    this.toggleEl?.setAttribute('aria-label', on ? 'Hide the panel' : 'Show the panel');
  }

  /** The panel is open (not folded to its toggle, or to the sheet's tab bar on a phone). */
  get expanded(): boolean {
    return !this.root.classList.contains('collapsed');
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
    if (shown.length === 0) this.toggle(false);
    else if (wasEmpty) this.toggle(true);
    const key = `${shown.join(',')}|${[...this.fresh].join(',')}|${this.cur}`;
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
        onclick: () => { this.g.sfx('click'); this.open(t); },
      },
      img(p.icon, 2, 'side-tab-ico'),
      h('span', { class: 'side-tab-text' }, h('span', { class: 'side-tab-label' }, p.label), h('span', { class: 'side-tab-sub' }, p.sub)),
      isNew ? h('span', { class: 'side-new' }, 'NEW') : null, badge);
      tip(btn, `${p.label} · ${p.sub}   key ${p.hotkey}`);
      this.btns.set(t, { btn, badge });
      this.tabsEl.appendChild(btn);
    }
    this.body.setAttribute('aria-labelledby', `tab-${this.cur}`);
  }

  private badges(): void {
    for (const [id, { badge }] of this.btns) {
      const b = PANELS[id].badge?.(this.g) ?? null;
      badge.hidden = !b;
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

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern). */
  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const ids = [...this.btns.keys()];
    const i = ids.indexOf(this.cur);
    const next = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    e.preventDefault();
    this.open(next);
    this.btns.get(next)?.btn.focus();
  }
}
