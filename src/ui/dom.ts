// src/ui/dom.ts — DOM helpers: h, img, scrollWithin (scrolling into view), number formatting, cost chips, tooltips (ARCHITECTURE §13.4). Owner: S (scaffold).
// Game text is data: never use innerHTML or title= with it; build with h() (text nodes) and tip().
import { RESOURCES } from '../game/types';
import type { Cost, GameState, ResId } from '../game/types';
import { RESOURCE_DEFS } from '../game/data/resources';
import { B } from '../game/balance';
import { spriteURL } from '../render/sprites';
import { resIcon } from '../render/art/index';

/** Anything h() accepts as a child; arrays nest; null/undefined/false are skipped. */
export type Kid = Node | string | number | null | undefined | false | Kid[];
/** class, id, style (string | object), data-*, aria-*, role, type, value, disabled, hidden, on<event> handlers … */
export type Attrs = Record<string, unknown>;

const MINUS = '−';
const WEEK = 7;
const MONTH = 30;   // B.ui.RUNWAY_MONTHS = 120 days reads as 4 months
const TIP_DELAY_MS = 80;
const LONG_PRESS_MS = 450;
const TIP_MARGIN = 8;
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'indeterminate', 'tabIndex', 'readOnly', 'multiple']);

function append(el: Node, kid: Kid): void {
  if (kid === null || kid === undefined || kid === false) return;
  if (Array.isArray(kid)) { for (const k of kid) append(el, k); return; }
  el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}

/** Scrolls one scroll box so `el` (inside it) shows: its top 8 px below the box's top ('start'), or only as far as needed
 *  ('nearest'). Never scrollIntoView, which scrolls every scrollable ancestor too: #app included, which then slid the
 *  whole interface up and took the HUD off the screen (a pulse while the sheet was moved aside for placing). */
export function scrollWithin(box: HTMLElement, el: HTMLElement, block: 'start' | 'nearest' = 'start', smooth = false): void {
  const PAD = 8;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  const y = r.top - b.top + box.scrollTop;   // the element's offset within the box's scrolled content
  let top: number | null = y - PAD;
  if (block === 'nearest') {
    if (r.top >= b.top + PAD && r.bottom <= b.bottom - PAD) top = null;                // in view already
    else if (r.top >= b.top + PAD) top = Math.min(y - PAD, y + r.height - box.clientHeight + PAD);   // below: bring its foot up
  }
  if (top === null) return;
  box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

/** Creates an element with attributes, styles, listeners and children (text children are text nodes, never HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class' || k === 'className') {
        el.className = String(v);
      } else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else if (typeof v === 'object') {
          for (const [p, pv] of Object.entries(v as Record<string, unknown>)) {
            if (pv === undefined || pv === null || pv === false) continue;
            if (p.startsWith('--') || p.includes('-')) el.style.setProperty(p, String(pv));
            else (el.style as unknown as Record<string, string>)[p] = String(pv);
          }
        }
      } else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
      } else if (PROPS.has(k)) {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  for (const kid of kids) append(el, kid);
  return el;
}

/** A pixelated <img> of a sprite (spriteURL at an integer scale, default 2), alt ''. */
export function img(spriteName: string, scale = 2, cls?: string): HTMLImageElement {
  return h('img', { src: spriteURL(spriteName, scale), class: cls ? `pix ${cls}` : 'pix', alt: '', draggable: 'false' });
}

/** Removes every child of an element. */
export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function sign(n: number, s: string): string {
  return n < 0 ? MINUS + s : s;
}

/** < 10: one decimal unless integer; < 10,000: integer with separators; else 12.5k (1.2M); true minus sign. */
export function fmt(n: number): string {
  if (Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n < 0 ? MINUS + '∞' : '∞';
  const a = Math.abs(n);
  if (a < 10) {
    const r = Math.round(a * 10) / 10;
    if (r === 0) return '0';
    return sign(n, Number.isInteger(r) ? String(r) : r.toFixed(1));
  }
  if (a < 10_000) return sign(n, Math.round(a).toLocaleString('en-US'));
  if (a < 1_000_000) return sign(n, (Math.round(a / 100) / 10).toString().replace(/\.0$/, '') + 'k');
  return sign(n, (Math.round(a / 100_000) / 10).toString().replace(/\.0$/, '') + 'M');
}

/** A daily rate: '+17/d', '−6.2/d' (true minus), '±0/d'. */
export function fmtRate(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.05) return '±0/d';
  return (n > 0 ? '+' : '') + fmt(n) + '/d';
}

/** Days: '47 d', '∞' (infinite or ≥ 10,000), '—' (null). */
export function fmtDays(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n) || n >= 10_000) return '∞';
  return `${Math.max(0, Math.floor(n))} d`;
}

/** A capacity or room in time (DESIGN §8.6): '14 days' under three weeks, '6 weeks' under four months, '4.2 months'
 *  above; '∞' (infinite or ≥ 10,000), '—' (null). Only for capacity and room: days on hand stay in days (fmtDays). */
export function fmtRunway(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n) || n >= 10_000) return '∞';
  const d = Math.max(0, n);
  if (d < B.ui.RUNWAY_WEEKS) {
    const k = Math.floor(d);
    return `${k} ${k === 1 ? 'day' : 'days'}`;
  }
  if (d < B.ui.RUNWAY_MONTHS) return `${Math.round(d / WEEK)} weeks`;
  return `${fmt(d / MONTH)} months`;
}

/** A cost as text in resource order: '50 den · 20 timber'. */
export function fmtCost(c: Cost): string {
  const parts: string[] = [];
  for (const r of RESOURCES) {
    const n = c[r];
    if (!n) continue;
    parts.push(`${fmt(n)} ${r === 'denarii' ? 'den' : RESOURCE_DEFS[r].name.toLowerCase()}`);
  }
  return parts.length ? parts.join(' · ') : 'free';
}

/** Cost chips with resource icons; a chip is red (.bad) where stock − reserved is short. */
export function costEl(s: GameState, c: Cost, reserved?: Cost): HTMLElement {
  const el = h('span', { class: 'cost' });
  for (const r of RESOURCES) {
    const n = c[r];
    if (!n) continue;
    const short = s.res[r] - (reserved?.[r] ?? 0) < n;
    const chip = h('span', { class: short ? 'chip bad' : 'chip' }, img(resIcon(r as ResId), 1, 'chip-ico'), fmt(n));
    tip(chip, () => `${RESOURCE_DEFS[r].name}: need ${fmt(n)}, have ${fmt(s.res[r])}${reserved?.[r] ? ` (${fmt(reserved[r] ?? 0)} reserved)` : ''}`);
    el.appendChild(chip);
  }
  return el;
}

/** Ends a sentence with a full stop unless it already has one: a Roman date ends in its own ('Kal. Apr.'). */
export function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** '1 house' / '3 houses' (the number formatted with fmt). */
export function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/** Real-time equivalent of a number of game days at a speed: '≈ 12 s at 2×'. */
export function realTime(days: number, speed: number): string {
  const sp = speed > 0 ? speed : 1;
  const sec = Math.max(0, days / sp);
  let t: string;
  if (sec < 60) t = `${Math.round(sec)} s`;
  else if (sec < 3600) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    t = s ? `${m} min ${s} s` : `${m} min`;
  } else {
    const hr = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    t = m ? `${hr} h ${m} min` : `${hr} h`;
  }
  return `≈ ${t} at ${sp}×`;
}

// ───────────────────────────── tooltips ─────────────────────────────
type TipContent = string | (() => Node | string);
const tips = new WeakMap<Element, { content: TipContent; wide: boolean }>();
let tipEl: HTMLElement | null = null;
let current: Element | null = null;
let showTimer = 0;
let pinned = false;
let swallowClick = false;   // a long press pinned a tooltip: the click its release fires must not also work the control

/** Attaches a tooltip (text or a builder) to an element; returns the element. */
export function tip(el: HTMLElement, content: string | (() => Node | string), opts?: { wide?: boolean }): HTMLElement {
  tips.set(el, { content, wide: !!opts?.wide });
  return el;
}

function tipTarget(node: EventTarget | null): Element | null {
  let el = node instanceof Element ? node : null;
  while (el && !tips.has(el)) el = el.parentElement;
  return el;
}

function render(target: Element): boolean {
  const t = tips.get(target);
  if (!tipEl || !t) return false;
  clear(tipEl);
  const c = typeof t.content === 'function' ? t.content() : t.content;
  if (c === '') return false;
  append(tipEl, c);
  tipEl.classList.toggle('wide', t.wide);
  return true;
}

function place(x: number, y: number): void {
  if (!tipEl) return;
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let left = x + 14, top = y + 16;
  if (left + r.width > window.innerWidth - TIP_MARGIN) left = x - r.width - 10;
  if (top + r.height > window.innerHeight - TIP_MARGIN) top = y - r.height - 10;
  tipEl.style.left = `${Math.max(TIP_MARGIN, left)}px`;
  tipEl.style.top = `${Math.max(TIP_MARGIN, top)}px`;
}

/** Hides the tooltip (and unpins a touch card). */
function hide(): void {
  window.clearTimeout(showTimer);
  current = null;
  pinned = false;
  if (tipEl) { tipEl.hidden = true; tipEl.classList.remove('pinned'); }
}

/** The #tooltip singleton: 80 ms hover delay; touch long-press 450 ms pins a card with ✕; edge-aware. */
export function initTooltips(): void {
  tipEl = document.getElementById('tooltip');
  if (!tipEl) return;
  tipEl.hidden = true;
  let lx = 0, ly = 0;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || pinned) return;
    lx = e.clientX; ly = e.clientY;
    const t = tipTarget(e.target);
    if (t !== current) {
      window.clearTimeout(showTimer);
      current = t;
      if (tipEl) tipEl.hidden = true;
      if (t) showTimer = window.setTimeout(() => { if (current === t && t.isConnected && render(t)) place(lx, ly); }, TIP_DELAY_MS);
    } else if (t && tipEl && !tipEl.hidden) place(lx, ly);
  });
  // a new press (seen first, on the window's capture phase): whatever an earlier long press left behind no longer applies
  window.addEventListener('pointerdown', () => { swallowClick = false; }, true);
  document.addEventListener('pointerdown', (e) => {
    if (pinned && tipEl && e.target instanceof Node && tipEl.contains(e.target)) return;
    if (e.pointerType === 'mouse') { hide(); return; }
    hide();
    const t = tipTarget(e.target);
    if (!t) return;
    const x = e.clientX, y = e.clientY;
    showTimer = window.setTimeout(() => {
      if (!t.isConnected || !render(t) || !tipEl) return;
      pinned = true;
      swallowClick = true;
      current = t;
      tipEl.classList.add('pinned');
      const close = h('button', { class: 'tip-close', 'aria-label': 'Close', onclick: () => hide() }, '✕');
      tipEl.prepend(close);
      place(x, y);
    }, LONG_PRESS_MS);
  });
  // holding a control for its tooltip (How to play teaches it for touch) must not also press it: iOS fires the click
  window.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', () => { swallowClick = false; }, true);
  const cancelPress = (): void => { if (!pinned) window.clearTimeout(showTimer); };
  document.addEventListener('pointerup', cancelPress);
  document.addEventListener('pointercancel', cancelPress);
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', () => { if (!pinned) hide(); }, true);
}

/** Escapes text for the rare place HTML is assembled (prefer h()). */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
