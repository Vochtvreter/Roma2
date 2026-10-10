// src/render/input.ts — pointer, wheel and pinch input on #map (ARCHITECTURE §12.1). Owner: WP-F.
// Coordinates passed to the handlers are CSS px relative to the canvas. The keyboard is handled by ui/keys.ts, which
// calls MapView.panBy / zoomBy (eased glides). A drag releases into a light fling; a new press stops it.

const DRAG_PX = 6;                // press-drag beyond this pans (or drags a tool) instead of clicking
const WHEEL_STEP = 100;           // accumulated deltaY per zoom step
const WHEEL_LINE = 33;            // deltaMode 1 (lines) → px
const PINCH_IN = 1.4;             // accumulated pinch ratio for one step in
const PINCH_OUT = 0.7;            // … and out
const TWO_TAP_MS = 300;           // two-finger tap → cancel
const FLING_WINDOW_MS = 90;       // velocity of the last 90 ms of a drag carries into the fling
const FLING_MIN_CSS = 120;        // CSS px/s below which a release does not fling

/** What a click or tap carried. */
export interface TapInfo { button: 0 | 2; shift: boolean; touch: boolean }

/** Handlers the MapView supplies to Input. */
export interface InputHandlers {
  hover(sx: number, sy: number): void;
  leave(): void;
  pan(dx: number, dy: number): void;
  /** Release of a pan with this velocity (CSS px/s); a press with (0, 0) stops any motion. */
  fling(vx: number, vy: number): void;
  zoom(steps: number, sx: number, sy: number): void;
  tap(sx: number, sy: number, info: TapInfo): void;
  /** A tool drag (road/pave): return true from 'start' to own the drag instead of panning. 'end' commits the path;
   *  'abort' (a second finger joins, or the pointer is cancelled) drops it without laying anything. */
  toolDrag(phase: 'start' | 'move' | 'end' | 'abort', sx: number, sy: number, shift: boolean): boolean;
  cancel(): void;
}

interface Press { id: number; x: number; y: number; lx: number; ly: number; moved: boolean; button: 0 | 2; tool: boolean; touch: boolean }

/** Pointer/wheel/pinch input for one element; `enabled = false` ignores everything (catch-up veil, modals). */
export class Input {
  enabled = true;
  private press: Press | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; mx: number; my: number; t0: number; moved: boolean } | null = null;
  private wheelAcc = 0;
  private trail: { x: number; y: number; t: number }[] = [];
  private readonly off: (() => void)[] = [];

  constructor(private readonly el: HTMLElement, private readonly h: InputHandlers) {
    this.on('contextmenu', (e) => e.preventDefault());
    this.on('pointerdown', (e) => this.down(e as PointerEvent));
    this.on('pointermove', (e) => this.move(e as PointerEvent));
    this.on('pointerup', (e) => this.up(e as PointerEvent));
    this.on('pointercancel', (e) => this.cancelPointer(e as PointerEvent));
    this.on('pointerleave', (e) => { if ((e as PointerEvent).pointerType === 'mouse' && !this.press) this.h.leave(); });
    this.on('wheel', (e) => this.wheel(e as WheelEvent), { passive: false });
    el.style.touchAction = 'none';
  }

  /** Removes every listener. */
  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }

  private on(type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    this.el.addEventListener(type, fn, opts);
    this.off.push(() => this.el.removeEventListener(type, fn, opts));
  }

  private pos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (!this.enabled) return;
    const p = this.pos(e);
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.pointers.set(e.pointerId, p);
    this.h.fling(0, 0);
    if (this.pointers.size === 2) {
      // second finger: a pinch replaces any press (a tool drag in progress is abandoned, never committed)
      if (this.press?.tool) this.h.toolDrag('abort', this.press.lx, this.press.ly, false);
      this.press = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, t0: e.timeStamp, moved: false };
      return;
    }
    if (this.pointers.size > 2) return;
    const button: 0 | 2 = e.button === 2 ? 2 : 0;
    const touch = e.pointerType !== 'mouse';
    const tool = button === 0 && this.h.toolDrag('start', p.x, p.y, e.shiftKey);
    this.press = { id: e.pointerId, x: p.x, y: p.y, lx: p.x, ly: p.y, moved: false, button, tool, touch };
    this.trail = [{ x: p.x, y: p.y, t: e.timeStamp }];
  }

  private move(e: PointerEvent): void {
    if (!this.enabled) return;
    const p = this.pos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const shift = Math.hypot(mx - this.pinch.mx, my - this.pinch.my);
      if (shift > 0) this.h.pan(mx - this.pinch.mx, my - this.pinch.my);
      if (Math.abs(d / this.pinch.d - 1) > 0.05 || shift > DRAG_PX) this.pinch.moved = true;
      this.pinch.mx = mx;
      this.pinch.my = my;
      const ratio = d / this.pinch.d;      // accumulated since the last step: snaps to the next integer level
      if (ratio >= PINCH_IN) { this.h.zoom(1, mx, my); this.pinch.d = d; }
      else if (ratio <= PINCH_OUT) { this.h.zoom(-1, mx, my); this.pinch.d = d; }
      return;
    }
    const pr = this.press;
    if (pr && pr.id === e.pointerId) {
      if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) > DRAG_PX) {
        pr.moved = true;
        if (!pr.tool && pr.button === 0) this.el.style.cursor = 'grabbing';
      }
      if (pr.moved) {
        if (pr.tool) this.h.toolDrag('move', p.x, p.y, e.shiftKey);
        else if (pr.button === 0) this.h.pan(p.x - pr.lx, p.y - pr.ly);
      }
      pr.lx = p.x;
      pr.ly = p.y;
      this.trail.push({ x: p.x, y: p.y, t: e.timeStamp });
      while (this.trail.length > 2 && e.timeStamp - this.trail[0].t > FLING_WINDOW_MS) this.trail.shift();
    }
    if (e.pointerType === 'mouse' || pr?.tool) this.h.hover(p.x, p.y);
  }

  private up(e: PointerEvent): void {
    const p = this.pos(e);
    this.pointers.delete(e.pointerId);
    this.el.style.cursor = '';
    if (this.pinch) {
      if (this.pointers.size < 2) {
        if (this.enabled && !this.pinch.moved && e.timeStamp - this.pinch.t0 < TWO_TAP_MS) this.h.cancel();
        this.pinch = null;
      }
      return;
    }
    const pr = this.press;
    if (!pr || pr.id !== e.pointerId) return;
    this.press = null;
    if (!this.enabled) return;
    if (pr.tool) { this.h.toolDrag('end', p.x, p.y, e.shiftKey); return; }
    if (pr.moved) {
      const a = this.trail[0], dt = (e.timeStamp - a.t) / 1000;
      if (pr.button === 0 && dt > 0.005 && e.timeStamp - this.trail[this.trail.length - 1].t < FLING_WINDOW_MS) {
        const vx = (p.x - a.x) / dt, vy = (p.y - a.y) / dt;
        if (Math.hypot(vx, vy) > FLING_MIN_CSS) this.h.fling(vx, vy);
      }
      return;
    }
    if (pr.button === 2) { this.h.cancel(); return; }
    this.h.tap(p.x, p.y, { button: pr.button, shift: e.shiftKey, touch: pr.touch });
  }

  private cancelPointer(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.el.style.cursor = '';
    if (this.pointers.size < 2) this.pinch = null;
    if (this.press?.id === e.pointerId) {
      if (this.press.tool) this.h.toolDrag('abort', this.press.lx, this.press.ly, false);
      this.press = null;
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.enabled) return;
    const d = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE : e.deltaMode === 2 ? e.deltaY * WHEEL_STEP : e.deltaY;
    if (Math.sign(d) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.wheelAcc += d;
    const p = this.pos(e);
    while (Math.abs(this.wheelAcc) >= WHEEL_STEP) {
      const step = this.wheelAcc > 0 ? -1 : 1;     // wheel down zooms out
      this.wheelAcc += step * WHEEL_STEP;
      this.h.zoom(step, p.x, p.y);
    }
  }
}
