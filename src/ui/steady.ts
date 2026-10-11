// src/ui/steady.ts — keeps what the player points at in place while the colony changes around it. Owner: WP-I.
// ScrollAnchor: a scrolling list that is rebuilt or re-measured keeps the element under the mouse (else the first one in
// view) where it was, borrowing blank room above or below while the mouse rests there. PointerHold: a widget defers
// structural rebuilds while the mouse rests on it, except as the answer to the player's own click. Ratchet: a widget's
// box only grows while it is on screen, so a shorter number or date never pulls its neighbours across.
import { h } from './dom';
import { B } from '../game/balance';

/** Elements a scroll anchor can find again after a rebuild: section anchors and list rows with a stable key. */
const KEYED = '[data-key],[data-anchor]';
/** After a click inside a held widget, rebuilds go through for this long: the click's own consequence shows at once. */
const RELEASE_MS = 2000;

function keyOf(el: Element): string | null {
  const k = (el as HTMLElement).dataset;
  return k.key !== undefined ? `key:${k.key}` : k.anchor !== undefined ? `anchor:${k.anchor}` : null;
}

function find(box: HTMLElement, key: string): HTMLElement | null {
  const i = key.indexOf(':');
  const attr = key.slice(0, i) === 'key' ? 'data-key' : 'data-anchor';
  return box.querySelector<HTMLElement>(`[${attr}="${CSS.escape(key.slice(i + 1))}"]`);
}

/** Where keyed elements sat in the scroller's viewport, nearest first (the pointed row, its section, the first in view). */
export type ScrollMark = { key: string; y: number }[];

/** Scroll anchoring for a container that is cleared and rebuilt (the side panel's tab body). */
export class ScrollAnchor {
  /** Blank room borrowed above and below the content while the mouse rests in the box. */
  readonly head = h('div', { class: 'steady-pad', 'aria-hidden': 'true' });
  readonly foot = h('div', { class: 'steady-pad', 'aria-hidden': 'true' });
  private over = false;
  private x = 0;
  private y = 0;

  constructor(private readonly box: HTMLElement) {
    const track = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      this.over = true;
      this.x = e.clientX;
      this.y = e.clientY;
    };
    box.addEventListener('pointerenter', track);
    box.addEventListener('pointermove', track);
    box.addEventListener('pointerleave', () => { this.over = false; this.settle(); });
  }

  /** Records where the pointed element (and its keyed ancestors) and the first element in view sit. */
  capture(): ScrollMark {
    const box = this.box;
    const top = box.getBoundingClientRect().top;
    const out: ScrollMark = [];
    const add = (el: Element | null): void => {
      for (let e = el?.closest(KEYED); e && box.contains(e) && e !== box; e = e.parentElement?.closest(KEYED) ?? null) {
        const key = keyOf(e);
        if (key && !out.some((m) => m.key === key)) out.push({ key, y: e.getBoundingClientRect().top - top });
      }
    };
    if (this.over) {
      const at = document.elementFromPoint(this.x, this.y);
      if (at && box.contains(at)) add(at);
    }
    for (const el of box.querySelectorAll(KEYED)) {
      if (el.getBoundingClientRect().top >= top - 1) { add(el); break; }
    }
    return out;
  }

  /** Scrolls so the first mark still present sits where it was. While the mouse rests in the box, room the content no
   *  longer fills is borrowed (blank above or below) rather than letting the target slide; it is given back on leave. */
  restore(mark: ScrollMark): void {
    const box = this.box;
    this.head.style.height = '';
    this.foot.style.height = '';
    let el: HTMLElement | null = null;
    let y = 0;
    for (const m of mark) {
      el = find(box, m.key);
      if (el) { y = m.y; break; }
    }
    if (!el) return;
    let want = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - y;
    let head = 0;
    if (want < 0) {
      if (this.over) head = -want;
      want = 0;
    }
    if (head) this.head.style.height = `${head}px`;
    // Scroll offsets snap to whole (device) pixels while rows are fractions of one tall: scroll up to the next whole
    // offset and let the head pad take up the remainder, so the target lands exactly where it was, not a pixel off.
    const to = Math.ceil(want);
    const max = box.scrollHeight - box.clientHeight;
    if (to > max && this.over) this.foot.style.height = `${to - max}px`;
    if (box.scrollTop !== to) box.scrollTop = to;
    const rest = box.scrollTop - want;
    if (rest > 0.001 && rest < 1) this.head.style.height = `${head + rest}px`;
  }

  /** Gives back borrowed room (the mouse left, or a different page opened). */
  settle(): void {
    if (!this.head.style.height && !this.foot.style.height) return;
    const mark = this.capture();
    this.restore(mark);
  }
}

/** Tracks the mouse resting on a widget and the player's clicks in it. */
export class PointerHold {
  private over = false;
  private downAt = -Infinity;

  constructor(el: HTMLElement) {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.over = true; });
    el.addEventListener('pointerleave', () => { this.over = false; });
    el.addEventListener('pointerdown', () => { this.downAt = performance.now(); });
  }

  /** True while a rebuild must wait: just after a click (it would swap the button being pressed), or while the mouse
   *  rests on the widget and has not clicked lately (the player is reading it or aiming at it). */
  holds(now = performance.now()): boolean {
    const since = now - this.downAt;
    if (since < B.ui.CLICK_GUARD_MS) return true;
    return this.over && since > RELEASE_MS;
  }

  /** Lets the next rebuild through at once (the widget's own controls: fold, collapse). */
  release(): void {
    this.downAt = performance.now() - B.ui.CLICK_GUARD_MS;
  }
}

/** Tracks a form control the player is working inside a widget: a focused <select> (its list may be open: a rebuild
 *  would tear it shut under the mouse) or a slider being dragged. A pick or a let-go ends the hold. */
export class ControlHold {
  private el: Element | null = null;

  constructor(root: HTMLElement) {
    root.addEventListener('focusin', (e) => { if (e.target instanceof HTMLSelectElement) this.el = e.target; });
    root.addEventListener('pointerdown', (e) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') this.el = e.target; });
    const letGo = (e: Event): void => { if (e.target === this.el) this.el = null; };
    root.addEventListener('change', letGo);
    root.addEventListener('focusout', letGo);
    window.addEventListener('pointerup', () => { if (this.el instanceof HTMLInputElement) this.el = null; }, true);
    window.addEventListener('pointercancel', () => { if (this.el instanceof HTMLInputElement) this.el = null; }, true);
  }

  /** True while a rebuild must wait (a control replaced by its own widget no longer counts). */
  holds(): boolean {
    return !!this.el?.isConnected;
  }
}

/** Grow-only widths: each element keeps the widest box it has had, until reset (a resize or a new layout). */
export class Ratchet {
  private readonly els = new Set<HTMLElement>();
  private readonly mq: MediaQueryList | null;

  /** `off`: a media query under which nothing is held (layouts that share out a row's width themselves). */
  constructor(off?: string) {
    this.mq = off && typeof matchMedia === 'function' ? matchMedia(off) : null;
    if (typeof window !== 'undefined') window.addEventListener('resize', () => this.reset());
  }

  /** Widens each element's floor to its current width (call after the frame's text writes). */
  hold(els: Iterable<HTMLElement>): void {
    if (this.mq?.matches) return;
    for (const el of this.els) if (!el.isConnected) this.els.delete(el);
    const widths: [HTMLElement, number][] = [];   // read every width before the first write: one layout, not one each
    for (const el of els) if (el.isConnected) widths.push([el, Math.ceil(el.getBoundingClientRect().width)]);
    for (const [el, w] of widths) {
      this.els.add(el);
      if (w > (parseFloat(el.style.minWidth) || 0)) el.style.minWidth = `${w}px`;
    }
  }

  /** Drops every floor. */
  reset(): void {
    for (const el of this.els) el.style.minWidth = '';
    this.els.clear();
  }
}
