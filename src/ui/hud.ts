// src/ui/hud.ts — the HUD bar (DESIGN §15.2): brand, vital tablets, coin, souls, spirits, dignitas, resource strip, date,
// speed and menu. Owner: WP-H. Built once; numbers are patched in place every UI tick; tooltips are lazy (hud-tips.ts).
// The chips and material cells only grow (steady.ts Ratchet): a shorter figure or date never shuffles its neighbours.
import type { ResId, Speed, UnlockRef } from '../game/types';
import type { Game } from './types';
import type { IntroPart } from '../game/intro';
import { clear, fmt, fmtRate, h, img, tip } from './dom';
import { Vitals } from './vitals';
import { caps } from './tipkit';
import { Ratchet } from './steady';
import { STRIP_RES, coinTip, dateTip, dignitasTip, moraleTip, netRate, resourceTip, seasonFrac, soulsTip } from './hud-tips';
import { openMenu, openRename } from './modals';
import { census } from '../game/census';
import { forecast } from '../game/forecast';
import { dignitas } from '../game/civic';
import { resourceRevealed } from '../game/reveal';
import { isUnlocked } from '../game/decisions';
import { aucYear, formatRoman, seasonOf, SEASON_NAMES, toRoman } from '../game/calendar';
import { RANK_DEFS } from '../game/data/ranks';
import { B } from '../game/balance';
import { faceIcon, resIcon } from '../render/art/index';
import { spriteURL } from '../render/sprites';
import { present, shows } from './intro';
import { introRunning } from '../game/intro';

const DEV = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search);
const SPEEDS: readonly Speed[] = [...(B.time.SPEEDS as readonly Speed[]), ...(DEV ? [B.time.DEV_SPEED as Speed] : [])];
const FLASH_MS = 600;
const FLASH_MIN = 10;          // a stock jump of max(10, 25%) flashes its chip
const FLASH_SHARE = 0.25;
const CAP_SHOW = 0.9;           // the store's cap shows beside the amount once it is 90% full
const COIN_WARN = B.advisors.RULES.COIN_RUNOUT[2];   // "lasts N d" once the Quaestor would speak (Monitum)
const LAUREL_CREST: UnlockRef = { kind: 'cosmetic', id: 'laurelCrest', label: 'A laurel on the crest' };

type Up = () => void;

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

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.vitals = new Vitals(g);
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
    this.root.append(this.brand(), this.vitals.el, ...chips, h('div', { class: 'hud-break' }), date, this.strip, this.speed(), this.menu());
    this.update();
  }

  /** Refreshes every number (throttled by the UI root). */
  update(): void {
    for (const [el, part] of this.parts) present(this.g, el, shows(this.g, part));
    this.vitals.update();
    for (const u of this.up) u();
    this.updateStrip();
    this.ratchet.hold([...this.chips, ...(Array.from(this.strip.children) as HTMLElement[])]);
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
    const el = h('div', { class: 'hud-chip hud-coin', role: 'group', 'aria-label': 'Coin' }, img(resIcon('denarii'), 2), h('div', { class: 'hud-stack' }, n, sub));
    tip(el, () => coinTip(g), { wide: true });
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
    const el = h('div', { class: 'hud-chip hud-souls', role: 'group', 'aria-label': 'Souls and beds' },
      img('i_souls', 2), h('div', { class: 'hud-stack' }, n, h('div', { class: 'hud-stages' }, segs)));
    tip(el, () => soulsTip(g), { wide: true });
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
    const el = h('div', { class: 'hud-chip hud-morale', role: 'group', 'aria-label': 'Spirits' }, face, n);
    tip(el, () => moraleTip(g), { wide: true });
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
    const el = h('div', { class: 'hud-chip hud-dignitas', role: 'group', 'aria-label': 'Dignitas' }, img('i_laurel', 2), n);
    tip(el, () => dignitasTip(g), { wide: true });
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
    // while the lessons run (§11.13), only what the taught works cost: timber and stone
    const shown = STRIP_RES.filter((r) => (resourceRevealed(s, r) || s.res[r] > 0) && (!introRunning(s) || r === 'timber' || r === 'stone'));
    const key = shown.join(',');
    if (key !== this.stripKey) {
      this.stripKey = key;
      clear(this.strip);
      for (const r of shown) {
        const el = h('div', { class: 'hud-res', role: 'listitem', dataset: { res: r } }, img(resIcon(r), 2),
          h('div', { class: 'hud-stack' }, h('span', { class: 'hud-res-n num' }, h('b'), h('small', { class: 'hud-res-cap' })), h('span', { class: 'hud-res-r num' })));
        tip(el, () => resourceTip(g, r), { wide: true });
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
    const el = h('div', { class: 'hud-date', role: 'group', 'aria-label': 'Date' }, ico,
      h('div', { class: 'hud-stack' }, main, sub, h('div', { class: 'hud-seasonbar' }, bar)));
    tip(el, () => dateTip(g), { wide: true });
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

  private speed(): HTMLElement {
    const g = this.g;
    const pause = h('button', { class: 'hud-sp', 'aria-label': 'Pause (Space)', onclick: () => { g.sfx('click'); g.togglePause(); } }, '❚❚');
    const btns = SPEEDS.map((sp, i) => h('button', {
      class: 'hud-sp num', 'aria-label': `Speed ${sp}× (key ${i + 1})`, onclick: () => { g.sfx('click'); g.setSpeed(sp); },
    }, `${sp}×`));
    tip(pause, 'Pause or resume (Space). Open dialogs pause the colony too.');
    this.up.push(() => {
      // until their lesson only pause and 1× show (§11.13): the first works are raised at the pace of reading
      const fast = shows(g, 'speed');
      btns.forEach((b, i) => { if (i > 0) present(g, b, fast); });
      pause.classList.toggle('on', g.paused);
      pause.setAttribute('aria-pressed', String(g.paused));
      btns.forEach((b, i) => {
        const on = !g.paused && g.speed === SPEEDS[i];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
    return h('div', { class: 'hud-speed', id: 'speed', role: 'group', 'aria-label': 'Speed' }, pause, btns);
  }

  private menu(): HTMLElement {
    const g = this.g;
    return h('button', { class: 'hud-menu', 'aria-label': 'Menu (Esc)', onclick: () => { g.sfx('click'); openMenu(g); } }, '☰');
  }
}
