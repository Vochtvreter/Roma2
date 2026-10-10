// src/ui/hud.ts — the HUD bar: brand, vital tablets, coin, souls, spirits, resources, date, speed, menu (DESIGN §15.2). Owner: WP-H.
// SCAFFOLD: every element with live numbers; dignitas, stage bars, flashes and rich tooltips are WP-H's.
import { RESOURCES } from '../game/types';
import type { ResId, Speed } from '../game/types';
import type { Game } from './types';
import { clear, fmt, fmtRate, h, img, tip } from './dom';
import { Vitals } from './vitals';
import { openMenu, openRename } from './modals';
import { census } from '../game/census';
import { forecast } from '../game/forecast';
import { resourceRevealed } from '../game/reveal';
import { aucYear, formatRoman, formatRomanLong, formatModern, seasonOf, SEASON_NAMES, toRoman } from '../game/calendar';
import { RANK_DEFS } from '../game/data/ranks';
import { RESOURCE_DEFS } from '../game/data/resources';
import { B } from '../game/balance';
import { faceIcon, resIcon } from '../render/art/index';

const SPEEDS: readonly Speed[] = B.time.SPEEDS as readonly Speed[];
const STRIP: readonly ResId[] = RESOURCES.filter((r) => r !== 'denarii' && r !== 'grain' && r !== 'water');

const caps = (s: string): string => s.toUpperCase().replace(/U/g, 'V');

function net(g: Game, r: ResId): number {
  let p = 0, c = 0;
  for (const v of Object.values(g.rates.prod[r])) p += v ?? 0;
  for (const v of Object.values(g.rates.cons[r])) c += v ?? 0;
  return p - c;
}

/** The HUD in #hud. */
export class Hud {
  private readonly vitals: Vitals;
  private readonly up: (() => void)[] = [];
  private stripKey = '';
  private readonly strip = h('div', { class: 'hud-strip' });

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.vitals = new Vitals(g);
  }

  /** Builds the HUD once. */
  build(): void {
    const g = this.g;
    clear(this.root);
    this.up.length = 0;
    const name = h('button', { class: 'hud-name', onclick: () => openRename(g) }, '');
    const rank = h('span', { class: 'hud-rank kicker' }, '');
    const brand = h('div', { class: 'hud-brand' }, img('f_aquila', 1, 'hud-aquila'), h('div', null, name, h('div', null, rank)));
    this.up.push(() => {
      name.textContent = g.state.name;
      const r = RANK_DEFS[g.state.rank];
      rank.textContent = `${caps(r.name)} · ${r.title}`;
    });

    const coin = h('span', { class: 'num' }), coinSub = h('span', { class: 'hud-sub num' });
    const coinEl = h('div', { class: 'hud-chip hud-coin' }, img(resIcon('denarii'), 2), coin, coinSub);
    tip(coinEl, () => `Coin in the aerarium (taxes accrue daily, paid on the Kalends). Accrued: ${fmt(g.state.taxAccrued)}.`);
    this.up.push(() => {
      const f = forecast(g.state).coin;
      coin.textContent = fmt(g.state.res.denarii);
      const lasts = f.runout !== null ? f.runout - g.state.day : null;
      coinSub.textContent = lasts !== null ? `lasts ${lasts} d` : fmtRate(f.net30);
      coinSub.classList.toggle('bad', lasts !== null);
    });

    const souls = h('span', { class: 'num' });
    const soulsEl = h('div', { class: 'hud-chip hud-souls' }, img('i_souls', 2), souls);
    tip(soulsEl, () => { const c = census(g.state); return `${c.pop} souls · ${c.beds} beds · ${c.homeless} homeless · Rome's roll ${c.roll}`; });
    this.up.push(() => {
      const c = census(g.state);
      souls.textContent = `${c.pop} / ${c.beds}`;
      soulsEl.classList.toggle('warn', c.freeBeds < 2);
    });

    const morale = h('span', { class: 'num' });
    const face = img(faceIcon(65), 2);
    const moraleEl = h('div', { class: 'hud-chip hud-morale' }, face, morale);
    tip(moraleEl, 'Spirits (laetitia), 0–100.');
    let faceName = '';
    this.up.push(() => {
      const m = g.state.morale;
      morale.textContent = String(Math.round(m));
      const f = faceIcon(m);
      if (f !== faceName) { faceName = f; face.replaceWith(img(f, 2)); }
    });

    this.up.push(() => this.updateStrip());

    const date = h('span', { class: 'hud-date-main' }), year = h('span', { class: 'hud-sub' });
    const dateEl = h('div', { class: 'hud-date' }, date, year);
    tip(dateEl, () => `${formatRomanLong(g.state.day)} · ${formatModern(g.state.day)}`);
    this.up.push(() => {
      const d = g.state.day;
      date.textContent = formatRoman(d);
      year.textContent = `AUC ${toRoman(aucYear(d))} · ${SEASON_NAMES[seasonOf(d)]}`;
    });

    const pause = h('button', { class: 'btn small hud-speed-btn', 'aria-label': 'Pause', onclick: () => { g.sfx('click'); g.togglePause(); } }, '❚❚');
    const speedBtns = SPEEDS.map((sp) => h('button', { class: 'btn small hud-speed-btn', onclick: () => { g.sfx('click'); g.setSpeed(sp); } }, `${sp}×`));
    this.up.push(() => {
      pause.classList.toggle('on', g.paused);
      speedBtns.forEach((b, i) => b.classList.toggle('on', !g.paused && g.speed === SPEEDS[i]));
    });
    const menu = h('button', { class: 'btn small hud-menu', 'aria-label': 'Menu', onclick: () => { g.sfx('click'); openMenu(g); } }, '☰');

    this.root.append(brand, this.vitals.el, coinEl, soulsEl, moraleEl, this.strip, dateEl,
      h('div', { class: 'hud-speed' }, pause, speedBtns), menu);
    this.update();
  }

  private updateStrip(): void {
    const g = this.g;
    const shown = STRIP.filter((r) => resourceRevealed(g.state, r));
    const key = shown.join(',');
    if (key !== this.stripKey) {
      this.stripKey = key;
      clear(this.strip);
      for (const r of shown) {
        const el = h('div', { class: 'hud-res', dataset: { res: r } }, img(resIcon(r), 2), h('span', { class: 'num hud-res-n' }));
        tip(el, () => `${RESOURCE_DEFS[r].name} (${RESOURCE_DEFS[r].latin}) · ${fmt(g.state.res[r])} of ${fmt(census(g.state).caps[r])} · ${fmtRate(net(g, r))}`);
        this.strip.appendChild(el);
      }
    }
    const caps2 = census(g.state).caps;
    for (const el of this.strip.children) {
      const r = (el as HTMLElement).dataset.res as ResId;
      const n = el.querySelector('.hud-res-n');
      if (n) n.textContent = `${fmt(g.state.res[r])}`;
      el.classList.toggle('full', g.state.res[r] >= caps2[r] - 0.5);
    }
  }

  /** Refreshes every number (throttled by the UI root). */
  update(): void {
    for (const u of this.up) u();
    this.vitals.update();
  }
}
