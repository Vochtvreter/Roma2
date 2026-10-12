// src/ui/hud.ts — the HUD bar (DESIGN §15.2): brand, vital tablets, coin, souls, spirits, dignitas, resource strip, date,
// speed and menu. Owner: WP-H. Built once; numbers are patched in place every UI tick; tooltips are lazy (hud-tips.ts).
// The chips and material cells only grow (steady.ts Ratchet): a shorter figure or date never shuffles its neighbours.
// Every figure (data-fig: the tablets, coin, souls, spirits, dignitas, date, a material) opens the Breviarium there on a
// tap or click (onFigure → tray.ts); a mouse still has the hover cards, but not one that would drop over the open tray.
// On a portrait phone (the SHEET host) the same elements make one 52 px row (hud.css): the tablets with their strips, coin
// over souls, the speed pair [❚❚][1× ▾] whose ▾ opens the speeds as a popover (a Back and Esc layer), and the menu. On a
// landscape phone (the DRAWER host) one 44 px row of the tablets (days and trend), coin, souls, spirits, the date, the
// speed pair and the menu: as the width runs out the date, then spirits, souls, coin, Aqua and Grain step out of the row
// (priority+: fit), into the Breviarium, which holds every figure anyway. On a tablet (the DOCK host) one 56 px row: the
// full tablets with their labels, trends and strips, coin over souls, spirits, and from 960 px wide dignitas, the date and
// the materials; then the view control, the five speeds and the menu. As the width runs out the date, dignitas and the
// materials step into the Breviarium, the speeds fold into the [❚❚][1× ▾] pair, the view control keeps its icons alone,
// then spirits, coin and souls, Aqua and Grain go (fitDock). The view control (Urbs · Mensa · Tabularium: the panel
// folded, docked or wide; layout.ts VIEWS) stands on the DOCK and on the desktop COLUMNS, the current view labelled: in
// the DOCK's row, and on the COLUMNS at the top-left of the map (mountView), so the desktop's row stays as it was.
import type { ResId, Speed, UnlockRef } from '../game/types';
import type { Game } from './types';
import type { IntroPart } from '../game/intro';
import { clear, fmt, fmtRate, h, img, tip } from './dom';
import { Vitals } from './vitals';
import { caps } from './tipkit';
import { Ratchet } from './steady';
import { coinTip, dateTip, dignitasTip, moraleTip, netRate, resourceTip, seasonFrac, soulsTip, stripShown } from './hud-tips';
import { openMenu, openRename } from './modals';
import { BACK_RANK, registerBack } from './history';
import { census } from '../game/census';
import { forecast } from '../game/forecast';
import { dignitas } from '../game/civic';
import { isUnlocked } from '../game/decisions';
import { aucYear, formatRoman, seasonOf, SEASON_NAMES, toRoman } from '../game/calendar';
import { RANK_DEFS } from '../game/data/ranks';
import { B } from '../game/balance';
import { faceIcon, resIcon } from '../render/art/index';
import { spriteURL } from '../render/sprites';
import { present, shows } from './intro';
import { VIEWS, currentDetent, currentHost, moveDetent, priorityDrops } from './layout';
import type { Host, View } from './layout';

const DEV = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search);
const SPEEDS: readonly Speed[] = [...(B.time.SPEEDS as readonly Speed[]), ...(DEV ? [B.time.DEV_SPEED as Speed] : [])];
const FLASH_MS = 600;
const FLASH_MIN = 10;          // a stock jump of max(10, 25%) flashes its chip
const FLASH_SHARE = 0.25;
const CAP_SHOW = 0.9;           // the store's cap shows beside the amount once it is 90% full
const COIN_WARN = B.advisors.RULES.COIN_RUNOUT[2];   // "lasts N d" once the Quaestor would speak (Monitum)
const LAUREL_CREST: UnlockRef = { kind: 'cosmetic', id: 'laurelCrest', label: 'A laurel on the crest' };
const PAIR_W = 88;      // the speed pair [❚❚][1× ▾]: two 44 px buttons (dock.css), what a folded speed group still takes
const DOCK_GAP = 4;     // the DOCK row's gap after each item (dock.css: a right margin, so a hidden item leaves none)

type Up = () => void;

/** The HUD figure an event landed on (data-fig), if any. */
function figureOf(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? t.closest<HTMLElement>('[data-fig]') : null;
}

/** Marks a HUD element as a figure that opens the Breviarium at `fig` (keyboard: focusable, Enter). */
function figure(el: HTMLElement, fig: string): HTMLElement {
  el.dataset.fig = fig;
  el.tabIndex = 0;
  el.setAttribute('aria-controls', 'tray');
  el.setAttribute('aria-expanded', 'false');
  return el;
}

/** Restarts an element's flash animation. */
function flash(el: HTMLElement): void {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  window.setTimeout(() => el.classList.remove('flash'), FLASH_MS);
}

/** Swaps an <img>'s sprite only when the name changes. */
function spriteSwap(el: HTMLImageElement, scale: number): (name: string) => void {
  let cur = '';
  return (name) => { if (name !== cur) { cur = name; el.src = spriteURL(name, scale); } };
}

/** The HUD in #hud. */
export class Hud {
  private readonly vitals: Vitals;
  private readonly up: Up[] = [];
  private readonly strip = h('div', { class: 'hud-strip', role: 'list', 'aria-label': 'Materials' });
  private stripKey = '';
  private readonly last: Partial<Record<ResId, number>> = {};
  private coinEl: HTMLElement | null = null;
  private readonly chips: HTMLElement[] = [];      // coin, souls, spirits, dignitas, date: widths held by the ratchet
  private readonly parts: [HTMLElement, IntroPart][] = [];   // chips the introduction brings in (ui/intro.ts)
  private readonly ratchet = new Ratchet('(max-width: 899px)');   // the phone rows share out their width themselves
  private speedEl: HTMLElement | null = null;
  private popOpen = false;                         // the phone's speed popover is open
  private readonly drops: HTMLElement[] = [];      // the DRAWER's row, in the order its figures step out (fit)
  private dockDrops: HTMLElement[][] = [];         // the DOCK's figures that step out (fitDock), each list one column
  private fitKey = '';                             // what the row was fitted for: its width and its figures' words
  private viewEl: HTMLElement | null = null;       // the view control (#view-ctl)
  private viewBtns: { v: View; b: HTMLButtonElement; label: HTMLElement }[] = [];
  /** A figure was tapped or clicked: the UI root opens the Breviarium there (tray.ts). */
  onFigure: ((fig: string, el: HTMLElement, viaKey: boolean) => void) | null = null;
  /** True for a figure whose hover card holds its tongue: the Breviarium is open beneath it (and shows the same). */
  quiet: (el: HTMLElement) => boolean = () => false;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.vitals = new Vitals(g, (el) => this.quiet(el));
    root.addEventListener('click', (e) => {
      const f = figureOf(e.target);
      if (f) this.onFigure?.(f.dataset.fig ?? '', f, false);
    });
    root.addEventListener('keydown', (e) => {
      const f = figureOf(e.target);
      if (e.key !== 'Enter' || !f || f !== e.target) return;
      e.preventDefault();
      this.onFigure?.(f.dataset.fig ?? '', f, true);
    });
    // the speed popover is a layer: Back and Esc close it first; a press anywhere else closes it too
    registerBack({ rank: BACK_RANK.popover, open: () => this.popOpen, close: () => this.popover(false) });
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', (e) => {
        if (this.popOpen && !(e.target instanceof Node && this.speedEl?.contains(e.target))) this.popover(false);
      }, true);
    }
    const strip = this.strip;
    strip.addEventListener('wheel', (e) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      strip.scrollLeft += e.deltaY || e.deltaX;
      e.preventDefault();
    }, { passive: false });
    strip.addEventListener('scroll', () => this.markMore());
  }

  /** Fades the strip's right edge while more materials hide past it. */
  private markMore(): void {
    const s = this.strip;
    s.classList.toggle('more', s.scrollWidth - s.scrollLeft - s.clientWidth > 2);
  }

  /** Builds the HUD once. */
  build(): void {
    clear(this.root);
    this.up.length = 0;
    this.ratchet.reset();
    const chips = [this.coin(), this.souls(), this.spirits(), this.dignitas()];
    const date = this.date();
    this.chips.splice(0, this.chips.length, ...chips, date);
    this.parts.splice(0, this.parts.length, [chips[0], 'coin'], [chips[1], 'souls'], [chips[2], 'souls'], [chips[3], 'dignitas'], [this.strip, 'materials']);
    this.root.append(this.brand(), this.vitals.el, ...chips, h('div', { class: 'hud-break' }), date, this.strip, this.view(), this.speed(), this.menu());
    const tablets = Array.from(this.vitals.el.children) as HTMLElement[];   // Grain, then Aqua
    this.drops.splice(0, this.drops.length, date, chips[2], chips[1], chips[0], ...[...tablets].reverse());
    // the DOCK: the date, dignitas and the materials first (the speeds' fold and the view's label come between: fitDock),
    // then spirits, coin with souls (one column), Aqua and Grain
    this.dockDrops = [[date], [chips[3]], [this.strip], [chips[2]], [chips[0], chips[1]], [tablets[1]], [tablets[0]]];
    this.fitKey = '';
    this.update();
  }

  /** Refreshes every number (throttled by the UI root). */
  update(): void {
    for (const [el, part] of this.parts) present(this.g, el, shows(this.g, part));
    this.vitals.update();
    for (const u of this.up) u();
    this.updateStrip();
    this.ratchet.hold([...this.chips, ...(Array.from(this.strip.children) as HTMLElement[])]);
    this.syncView();   // (and the row's fit)
  }

  /** The DRAWER's one row, priority+ (hud.css): with every figure back in, as many step out (hud-drop) in their order
   *  (the date, spirits, souls, coin, Aqua, Grain) as the row needs to fit its width (priorityDrops); the speed pair and
   *  the menu always stay. Fitted again only when the row's width or its figures' words change; off the DRAWER every
   *  figure is back (the DOCK fits its own row: fitDock). */
  private fit(): void {
    const els = this.drops, host = currentHost();
    if (host === 'dock') { this.fitDock(); return; }
    if (host !== 'drawer') { if (this.fitKey) this.unfit(); return; }
    const key = `drawer|${this.root.clientWidth}|${els.map((el) => `${+el.hidden}${el.textContent}`).join('|')}`;
    if (key === this.fitKey) return;
    this.unfit();
    this.fitKey = key;
    const gap = parseFloat(getComputedStyle(this.root).columnGap) || 0;
    const n = priorityDrops(this.root.scrollWidth, this.root.clientWidth, els.map((el) => (el.hidden ? 0 : el.offsetWidth + gap)));
    for (let i = 0; i < n; i++) els[i].classList.add('hud-drop');
  }

  /** Every figure back in the row, the speeds unfolded, the view control labelled. */
  private unfit(): void {
    this.fitKey = '';
    for (const el of [...this.drops, ...this.dockDrops.flat()]) el.classList.remove('hud-drop');
    this.speedEl?.classList.remove('fold');
    this.viewEl?.classList.remove('bare');
    for (const el of Array.from(this.strip.children)) el.classList.remove('hud-cut');
  }

  /** The DOCK's one row, priority+ (dock.css): with everything back in, as many steps are taken in their order as the
   *  row needs to fit its width (priorityDrops): the date, dignitas and the materials step into the Breviarium; the five
   *  speeds fold into the [❚❚][1× ▾] pair (its popover holds them); the view control keeps its icons alone; then spirits,
   *  coin with souls, Aqua and Grain step out. The menu always stays. Then the materials' cells that the strip cannot
   *  show whole step out from the last (.hud-cut). Fitted again only when the row's width, its figures' words or the
   *  view in use change. */
  private fitDock(): void {
    const sp = this.speedEl, view = this.viewEl;
    if (!sp || !view) return;
    const cols = this.dockDrops;
    const label = this.viewBtns.find((x) => x.b.classList.contains('on'))?.label ?? null;
    const speeds = sp.querySelectorAll('.hud-sp:not([hidden])').length;
    const key = `dock|${this.root.clientWidth}|${cols.map((c) => c.map((el) => `${+el.hidden}${el.textContent}`).join('+')).join('|')}|${label?.textContent ?? ''}|${+view.hidden}|${speeds}`;
    if (key === this.fitKey) return;
    this.unfit();
    this.fitKey = key;
    const w = (c: HTMLElement[]): number => { const m = Math.max(0, ...c.map((el) => (el.hidden ? 0 : el.offsetWidth))); return m ? m + DOCK_GAP : 0; };
    const steps: { save: number; take: () => void }[] = [
      ...cols.slice(0, 3).map((c) => ({ save: w(c), take: () => { for (const el of c) el.classList.add('hud-drop'); } })),
      { save: Math.max(0, sp.offsetWidth - PAIR_W), take: () => sp.classList.add('fold') },
      { save: !view.hidden && label ? label.offsetWidth + DOCK_GAP : 0, take: () => view.classList.add('bare') },
      ...cols.slice(3).map((c) => ({ save: w(c), take: () => { for (const el of c) el.classList.add('hud-drop'); } })),
    ];
    const n = priorityDrops(this.root.scrollWidth, this.root.clientWidth, steps.map((x) => x.save));
    for (let i = 0; i < n; i++) steps[i].take();
    if (!sp.classList.contains('fold') && this.popOpen) this.popover(false);   // unfolded: the speeds lie in the row again
    // the materials whole or not at all: the cells that would run past the strip's edge (a stock cut mid-number reads as
    // another number) step into the Breviarium too, from the last, the first always kept
    const st = this.strip, cells = Array.from(st.children) as HTMLElement[];
    if (st.offsetParent && !st.classList.contains('hud-drop')) {
      for (let i = cells.length - 1; i > 0 && st.scrollWidth > st.clientWidth + 1; i--) cells[i].classList.add('hud-cut');
    }
    this.markMore();
  }

  /** The view control's state: the view in use pressed (and labelled, dock.css, hud.css); none before the panel has a
   *  tab to show (a new colony: the lessons bring the first). The UI root calls it as the detent changes too. */
  syncView(): void {
    const el = this.viewEl;
    if (!el) return;
    present(this.g, el, !document.getElementById('side')?.classList.contains('empty'));
    const d = currentDetent() ?? 'half';
    for (const x of this.viewBtns) {
      const on = x.v.detent === d;
      if (x.b.classList.contains('on') !== on) { x.b.classList.toggle('on', on); x.b.setAttribute('aria-pressed', String(on)); }
    }
    this.fit();
  }

  /** Puts the view control where the host shows it (UI.build: Layout.onMount): in the HUD before the speeds on the DOCK
   *  (and hidden in the phones' rows); on the desktop COLUMNS at the top-left of the map beside the left column
   *  (columns.css; the A-desk-columns mockup), so the HUD's row and its materials strip stay as they were. */
  mountView(host: Host): void {
    const el = this.viewEl, app = this.root.parentElement;
    if (!el || !app) return;
    if (host === 'columns') { if (el.parentElement !== app) app.insertBefore(el, this.root.nextSibling); }
    else if (el.parentElement !== this.root) this.root.insertBefore(el, this.speedEl);
    this.fitKey = '';
  }

  /** Closes the phone's speed popover (a host change: the speeds lie in the row again). */
  closePopover(): void {
    this.popover(false);
  }

  /** Opens or closes the phone's speed popover. */
  private popover(open: boolean): void {
    if (this.popOpen === open) return;
    this.popOpen = open;
    this.speedEl?.classList.toggle('open', open);
    this.speedEl?.querySelector('.hud-sp-cur')?.setAttribute('aria-expanded', String(open));
  }

  /** Flashes the coin chip (Kalends taxes, caravans). */
  flashCoin(): void {
    if (this.coinEl) flash(this.coinEl);
  }

  private brand(): HTMLElement {
    const g = this.g;
    const rename = (): void => { g.sfx('click'); openRename(g); };
    const name = h('button', { class: 'hud-name', 'aria-label': 'Rename the colony', onclick: rename });
    const rank = h('span', { class: 'hud-rank' });
    const title = h('span', { class: 'hud-title' });
    const stars = h('span', { class: 'hud-stars' });
    // the laurel crest (Res Gestae: 500 souls): a victor's wreath hung on the aquila's standard
    const laurel = img('i_laurel', 2);
    Object.assign(laurel.style, { position: 'absolute', left: '8px', top: '16px', width: '24px', height: '24px', pointerEvents: 'none' });
    laurel.hidden = true;
    const el = h('div', { class: 'hud-brand' },
      h('button', { class: 'hud-aquila', 'aria-label': 'Rename the colony', onclick: rename, style: { position: 'relative' } }, img('f_aquila', 1), laurel),
      h('div', { class: 'hud-brand-text' }, name, h('div', { class: 'hud-rankline' }, rank, title, stars)));
    tip(el, () => {
      const s = g.state, r = RANK_DEFS[s.rank];
      return `${s.name} · ${r.name}, governed by the ${r.title}${s.legacy ? ` · Legacy ${s.legacy}: +${s.legacy * 10}% output` : ''}. Click to rename.`;
    });
    this.up.push(() => {
      const s = g.state;
      const r = RANK_DEFS[s.rank];
      if (name.textContent !== s.name) name.textContent = s.name;
      rank.textContent = caps(r.name);
      title.textContent = r.title;
      stars.textContent = s.legacy > 0 ? '★'.repeat(Math.min(5, s.legacy)) + (s.legacy > 5 ? String(s.legacy) : '') : '';
      const crest = isUnlocked(s, LAUREL_CREST);
      if (laurel.hidden === crest) laurel.hidden = !crest;
    });
    return el;
  }

  private coin(): HTMLElement {
    const g = this.g;
    const n = h('span', { class: 'hud-n num' });
    const sub = h('span', { class: 'hud-sub num' });
    const el = figure(h('div', { class: 'hud-chip hud-coin', role: 'group', 'aria-label': 'Coin' }, img(resIcon('denarii'), 2), h('div', { class: 'hud-stack' }, n, sub)), 'coin');
    tip(el, () => (this.quiet(el) ? '' : coinTip(g)), { wide: true });
    this.coinEl = el;
    this.up.push(() => {
      const s = g.state;
      const f = forecast(s).coin;
      n.textContent = fmt(s.res.denarii);
      const left = f.runout !== null ? Math.max(0, f.runout - s.day) : null;
      const lasts = left !== null && left < COIN_WARN ? left : null;
      sub.textContent = lasts !== null ? `lasts ${lasts} d` : `${f.net30 > 0.05 ? '▲' : f.net30 < -0.05 ? '▼' : '■'} ${fmtRate(f.net30)}`;
      sub.classList.toggle('bad', lasts !== null);
      sub.classList.toggle('good', lasts === null && f.net30 > 0.05);
    });
    return el;
  }

  private souls(): HTMLElement {
    const g = this.g;
    const n = h('span', { class: 'hud-n num' });
    const segs = [0, 1, 2, 3].map((i) => h('i', { class: `hud-stage st${i}` }));
    const el = figure(h('div', { class: 'hud-chip hud-souls', role: 'group', 'aria-label': 'Souls and beds' },
      img('i_souls', 2), h('div', { class: 'hud-stack' }, n, h('div', { class: 'hud-stages' }, segs))), 'souls');
    tip(el, () => (this.quiet(el) ? '' : soulsTip(g)), { wide: true });
    this.up.push(() => {
      const c = census(g.state);
      n.textContent = `${c.pop}/${c.beds}`;
      el.classList.toggle('warn', c.freeBeds < 2);
      const tot = Math.max(1, c.pop);
      c.byStage.forEach((v, i) => { segs[i].style.flexGrow = String(v / tot); });
    });
    return el;
  }

  private spirits(): HTMLElement {
    const g = this.g;
    const n = h('span', { class: 'hud-n num' });
    const face = img(faceIcon(65), 2);
    const swap = spriteSwap(face, 2);
    const el = figure(h('div', { class: 'hud-chip hud-morale', role: 'group', 'aria-label': 'Spirits' }, face, n), 'spirits');
    tip(el, () => (this.quiet(el) ? '' : moraleTip(g)), { wide: true });
    this.up.push(() => {
      const m = g.state.morale;
      n.textContent = String(Math.round(m));
      swap(faceIcon(m));
      el.classList.toggle('bad', m < 35);
    });
    return el;
  }

  private dignitas(): HTMLElement {
    const g = this.g;
    const n = h('span', { class: 'hud-n num' });
    const el = figure(h('div', { class: 'hud-chip hud-dignitas', role: 'group', 'aria-label': 'Dignitas' }, img('i_laurel', 2), n), 'dignitas');
    tip(el, () => (this.quiet(el) ? '' : dignitasTip(g)), { wide: true });
    this.up.push(() => {
      const d = Math.round(dignitas(g.state).value);
      n.textContent = String(d);
      const next = RANK_DEFS[g.state.rank + 1];
      el.classList.toggle('gold', !!next && d >= next.dignitas);
    });
    return el;
  }

  private updateStrip(): void {
    const g = this.g;
    const s = g.state;
    const shown = stripShown(s);
    const key = shown.join(',');
    if (key !== this.stripKey) {
      this.stripKey = key;
      clear(this.strip);
      for (const r of shown) {
        const el = figure(h('div', { class: 'hud-res', role: 'listitem', dataset: { res: r } }, img(resIcon(r), 2),
          h('div', { class: 'hud-stack' }, h('span', { class: 'hud-res-n num' }, h('b'), h('small', { class: 'hud-res-cap' })), h('span', { class: 'hud-res-r num' }))), 'materials');
        tip(el, () => (this.quiet(el) ? '' : resourceTip(g, r)), { wide: true });
        this.strip.appendChild(el);
      }
    }
    const capsNow = census(s).caps;
    for (const child of Array.from(this.strip.children)) {
      const el = child as HTMLElement;
      const r = el.dataset.res as ResId;
      const v = s.res[r];
      const prev = this.last[r];
      if (prev !== undefined && Math.abs(v - prev) > Math.max(FLASH_MIN, prev * FLASH_SHARE)) flash(el);
      this.last[r] = v;
      const net = netRate(g, r);
      const n = el.querySelector('.hud-res-n b');
      const cap = el.querySelector('.hud-res-cap');
      const rate = el.querySelector('.hud-res-r');
      if (n) n.textContent = fmt(v);
      if (cap) cap.textContent = v >= capsNow[r] * CAP_SHOW ? `/${fmt(capsNow[r])}` : '';
      if (rate) {
        rate.textContent = fmtRate(net);
        rate.className = `hud-res-r num${net > 0.05 ? ' good' : net < -0.05 ? ' bad' : ''}`;
      }
      el.classList.toggle('full', v >= capsNow[r] - 0.5);
      el.classList.toggle('empty', v < 1 && net < 0);
    }
    this.markMore();
  }

  private date(): HTMLElement {
    const g = this.g;
    const main = h('span', { class: 'hud-date-main' });
    const sub = h('span', { class: 'hud-sub' });
    const bar = h('i');
    const ico = img('i_season_0', 2, 'hud-season');
    const swap = spriteSwap(ico, 2);
    const el = figure(h('div', { class: 'hud-date', role: 'group', 'aria-label': 'Date' }, ico,
      h('div', { class: 'hud-stack' }, main, sub, h('div', { class: 'hud-seasonbar' }, bar))), 'date');
    tip(el, () => (this.quiet(el) ? '' : dateTip(g)), { wide: true });
    this.up.push(() => {
      const d = g.state.day;
      const se = seasonOf(d);
      main.textContent = formatRoman(d);
      sub.textContent = `AUC ${toRoman(aucYear(d))} · ${SEASON_NAMES[se]}`;
      bar.style.width = `${Math.round(seasonFrac(d) * 100)}%`;
      bar.className = `s${se}`;
      swap(`i_season_${se}`);
    });
    return el;
  }

  /** Pause and the speeds in #speed (lesson VII's target). In a row as they always were; on a portrait phone the pair
   *  [❚❚][1× ▾]: pause, and the speed in use, whose ▾ opens the speeds as a popover (their box lays out in the row
   *  elsewhere: display: contents, hud.css). One set of buttons either way: the keys and the lesson find the same ones. */
  private speed(): HTMLElement {
    const g = this.g;
    const pause = h('button', { class: 'hud-sp hud-sp-pause', 'aria-label': 'Pause (Space)', onclick: () => { g.sfx('click'); g.togglePause(); } }, '❚❚');
    const btns = SPEEDS.map((sp, i) => h('button', {
      class: 'hud-sp num', 'aria-label': `Speed ${sp}× (key ${i + 1})`, onclick: () => { g.sfx('click'); g.setSpeed(sp); this.popover(false); },
    }, `${sp}×`));
    const pop = h('div', { class: 'hud-sp-pop', id: 'speed-pop', role: 'group', 'aria-label': 'Speeds' }, btns);
    const curN = h('span', { class: 'num' }, '1×');
    const caret = h('span', { class: 'hud-sp-caret', 'aria-hidden': 'true' }, '▾');
    // before the speed lesson it is the 1× button it always was (resume at the pace of reading); after, it opens the five
    const cur = h('button', { class: 'hud-sp hud-sp-cur', 'aria-label': 'Speed: choose one', 'aria-expanded': 'false', 'aria-controls': 'speed-pop',
      onclick: () => {
        g.sfx('click');
        if (shows(g, 'speed')) this.popover(!this.popOpen);
        else g.setSpeed(SPEEDS[0]);
      } }, curN, caret);
    tip(pause, 'Pause or resume (Space). Open dialogs pause the colony too.');
    tip(cur, () => (shows(g, 'speed') ? 'Choose a speed (keys 1 to 4).' : 'Resume at 1×.'));
    this.up.push(() => {
      // until their lesson only pause and 1× show (§11.13): the first works are raised at the pace of reading
      const fast = shows(g, 'speed');
      btns.forEach((b, i) => { if (i > 0) present(g, b, fast); });
      present(g, caret, fast);
      if (!fast && this.popOpen) this.popover(false);
      pause.classList.toggle('on', g.paused);
      pause.setAttribute('aria-pressed', String(g.paused));
      btns.forEach((b, i) => {
        const on = !g.paused && g.speed === SPEEDS[i];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const now = `${g.speed}×`;
      if (curN.textContent !== now) curN.textContent = now;
      cur.classList.toggle('on', !g.paused);
    });
    this.speedEl = h('div', { class: 'hud-speed', id: 'speed', role: 'group', 'aria-label': 'Speed' }, pause, pop, cur);
    return this.speedEl;
  }

  /** The view control (#view-ctl; DESIGN §15.7, SPEC A graft 1): three segments, the map, the split and the ledger,
   *  for the views Urbs · City, Mensa · Map & ledger and Tabularium · Ledgers (the panel folded, docked, wide; keys C, M
   *  and I), the one in use pressed and labelled. On the DOCK and the COLUMNS (hud.css, dock.css); hidden on a phone. */
  private view(): HTMLElement {
    const g = this.g;
    this.viewBtns = VIEWS.map((v) => {
      const label = h('span', { class: 'hud-view-label' }, v.latin);
      const b = h('button', { class: 'hud-view-btn', type: 'button', 'aria-label': `${v.latin} · ${v.en}`, 'aria-pressed': 'false', dataset: { view: v.detent },
        onclick: () => { g.sfx('click'); moveDetent(v.detent); this.syncView(); } }, img(v.icon, 2, 'hud-view-ico'), label);
      tip(b, `${v.latin} · ${v.en}   key ${v.key.toUpperCase()}`);
      return { v, b, label };
    });
    this.viewEl = h('div', { class: 'hud-view', id: 'view-ctl', role: 'group', 'aria-label': 'View' }, this.viewBtns.map((x) => x.b));
    return this.viewEl;
  }

  private menu(): HTMLElement {
    const g = this.g;
    // #hud-menu: on a phone's sheet it is also the Annales' way in (a menu row; layout.ts REVEAL)
    return h('button', { class: 'hud-menu', id: 'hud-menu', 'aria-label': 'Menu (Esc)', onclick: () => { g.sfx('click'); openMenu(g); } }, '☰');
  }
}
