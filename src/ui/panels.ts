// src/ui/panels.ts — the side panel host: tabs, badges, NEW markers, signature diffing (ARCHITECTURE §13.3, DESIGN §15.3). Owner: WP-I.
// Signature-diff pattern: at most every UI_THROTTLE_MS compute the open tab's signature; rebuild (keeping scroll) when it
// changed, else run the updaters. Never rebuild under the pointer within 300 ms of a click.
// SCAFFOLD: the host works; reveal/NEW stickers use reveal.ts; the tabs are placeholders.
import { TABS } from '../game/types';
import type { TabId } from '../game/types';
import type { Game, Panel, Updater } from './types';
import { clear, h, img } from './dom';
import { tabRevealed } from '../game/reveal';
import { B } from '../game/balance';
import { panel as edicta } from './tabs/edicta';
import { panel as consiliarii } from './tabs/consiliarii';
import { panel as aedificia } from './tabs/aedificia';
import { panel as populus } from './tabs/populus';
import { panel as commercium } from './tabs/commercium';
import { panel as annales } from './tabs/annales';

const CLICK_GUARD_MS = 300;

/** Every tab panel by id. */
export const PANELS: Readonly<Record<TabId, Panel>> = {
  council: edicta, advisors: consiliarii, build: aedificia, people: populus, trade: commercium, annals: annales,
};

/** The side panel in #side. */
export class SidePanel {
  private cur: TabId = 'council';
  private sig = '';
  private ups: Updater[] = [];
  private last = -Infinity;
  private lastClick = -Infinity;
  private readonly tabsEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly btns = new Map<TabId, { btn: HTMLButtonElement; badge: HTMLElement }>();
  private revealedKey = '';

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.tabsEl = root.querySelector<HTMLElement>('#tabs') ?? root.appendChild(h('nav', { id: 'tabs', role: 'tablist' }));
    this.body = root.querySelector<HTMLElement>('#tab-body') ?? root.appendChild(h('div', { id: 'tab-body', role: 'tabpanel' }));
    const toggle = root.querySelector<HTMLButtonElement>('#side-toggle');
    toggle?.addEventListener('click', () => this.toggle());
    this.body.addEventListener('pointerdown', () => { this.lastClick = performance.now(); });
    this.buildTabs();
  }

  /** The open tab. */
  get current(): TabId {
    return this.cur;
  }

  /** Throttled: signature diff of the open tab, badges, reveal changes. */
  frame(now: number): void {
    if (now - this.last < B.time.UI_THROTTLE_MS) return;
    this.last = now;
    const s = this.g.state;
    const revealed = TABS.filter((t) => tabRevealed(s, t));
    const rk = revealed.join(',');
    if (rk !== this.revealedKey) { this.revealedKey = rk; this.buildTabs(); }
    for (const [id, { badge }] of this.btns) {
      const b = PANELS[id].badge?.(this.g) ?? null;
      badge.textContent = b ? b.text : '';
      badge.className = b ? `badge ${b.kind}` : 'badge';
      badge.hidden = !b;
    }
    const p = PANELS[this.cur];
    const sig = p.signature(this.g);
    if (sig !== this.sig && now - this.lastClick > CLICK_GUARD_MS) this.rebuild(sig);
    else for (const u of this.ups) u();
  }

  /** Opens a tab (and the panel), optionally scrolling to an anchor. */
  open(tab: TabId, anchor?: string): void {
    this.cur = tab;
    this.toggle(true);
    for (const [id, { btn }] of this.btns) {
      btn.classList.toggle('on', id === tab);
      btn.setAttribute('aria-selected', String(id === tab));
    }
    this.rebuild(PANELS[tab].signature(this.g), false);
    if (anchor) PANELS[tab].scrollTo?.(anchor, this.body);
  }

  /** Collapses or expands the panel (toggles when no argument). */
  toggle(open?: boolean): void {
    const on = open ?? this.root.classList.contains('collapsed');
    this.root.classList.toggle('collapsed', !on);
  }

  /** Forces a signature check on the next frame. */
  poke(): void {
    this.last = -Infinity;
  }

  private buildTabs(): void {
    clear(this.tabsEl);
    this.btns.clear();
    for (const t of TABS) {
      if (!tabRevealed(this.g.state, t)) continue;
      const p = PANELS[t];
      const badge = h('span', { class: 'badge', hidden: true });
      const btn = h('button', {
        class: t === this.cur ? 'side-tab on' : 'side-tab', role: 'tab', 'aria-selected': String(t === this.cur),
        onclick: () => { this.g.sfx('click'); this.open(t); },
      }, img(p.icon, 1), h('span', { class: 'side-tab-label' }, p.label), h('span', { class: 'side-tab-sub' }, p.sub), badge);
      this.btns.set(t, { btn, badge });
      this.tabsEl.appendChild(btn);
    }
  }

  private rebuild(sig: string, keepScroll = true): void {
    const top = keepScroll ? this.body.scrollTop : 0;
    this.sig = sig;
    this.ups = [];
    clear(this.body);
    PANELS[this.cur].build(this.g, this.body, this.ups);
    this.body.scrollTop = top;
  }
}
