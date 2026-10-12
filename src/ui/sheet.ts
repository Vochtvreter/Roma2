// src/ui/sheet.ts — the phone SHEET host's own DOM (DESIGN §15.7, ARCHITECTURE §13.10): the grabber strip and the voice
// line's slot at the head of the bottom sheet (#side), the drag, and the slide between the sheet's detents. Owner: WP-H.
// One instance of every widget: on the SHEET the counsel (#counsel) and the ticker (#ticker) move into the voice line's
// slot (the counsel's folded card is the line; in calm the ticker speaks there instead), and the tab buttons become the bar
// under the sheet (panels.ts mount); on any other host they go back where index.html put them, and the grip and the
// empty slot hide (sheet.css).
// Drag only on the grabber strip (touch-action: none there; the tab body keeps its own scroll, the voice line its taps):
// the sheet follows the finger with a transform, comes to rest on the nearest detent (a fling goes on to the next one:
// layout.snapDetent), its height set at rest (sheet.css, from the layout's --sheet-* properties), and only then do the
// camera's insets change (Layout.setDetent). A tap on the grabber cycles closed → half → full → closed. The layout owns
// the detent and the heights; this module moves the box.
import type { Game } from './types';
import type { Detent, Host, Layout, SheetHooks } from './layout';
import { DETENT_NAMES, cycleDetent, snapDetent } from './layout';
import { h } from './dom';

const SLIDE_MS = 220;
const TAP_SLOP = 6;      // px a press may wander and still be a tap
const VELO_MS = 90;      // a release's speed is read over the drag's last 90 ms
const RUBBER = 0.3;      // past the top or bottom detent the sheet follows the finger this much
const REDUCED = '(prefers-reduced-motion: reduce)';
const GRIP = 10;         // the grabber strip of a closed or half sheet (sheet.css; at full it is the 44 px hit area itself)
const NEXT: Readonly<Record<Detent, string>> = { closed: 'tap to open it part-way', half: 'tap to open it fully', full: 'tap to close it' };

/** A node that moves into another host's slot and back: its own parent and next sibling, remembered once (the tool
 *  column re-hosts the overlay bar and the zoom buttons the same way: mapbar.ts). */
export class Home {
  private readonly parent: Node | null;
  private readonly next: Node | null;

  constructor(readonly el: HTMLElement) {
    this.parent = el.parentNode;
    this.next = el.nextSibling;
  }

  /** Puts the node back where it was (before its old next sibling, if that is still there). */
  back(): void {
    const p = this.parent;
    if (!p || this.el.parentNode === p) return;
    p.insertBefore(this.el, this.next && this.next.parentNode === p ? this.next : null);
  }
}

/** The SHEET host's head and slide: the grip and the voice line's slot in #side, for the layout (SheetHooks). */
export class SheetHost implements SheetHooks {
  private readonly grip: HTMLElement;
  private readonly grab: HTMLButtonElement;
  private readonly voice: HTMLElement;
  private readonly counsel: Home;
  private readonly ticker: Home;
  private hostNow: Host | null = null;
  private drag: { id: number; y0: number; h0: number; h: number; moved: boolean; pts: [number, number][] } | null = null;
  private swallow = false;   // the click that ends a drag is not a tap
  private sliding = false;
  private endT = 0;
  private measureAt = 0;     // a frame is booked to measure the head again (the voice line was rebuilt or reworded)

  constructor(private readonly g: Game, private readonly layout: Layout, private readonly side: HTMLElement, counsel: HTMLElement, ticker: HTMLElement) {
    this.counsel = new Home(counsel);
    this.ticker = new Home(ticker);
    this.grab = h('button', { class: 'sheet-grab', id: 'sheet-grab', type: 'button' }, h('i', { 'aria-hidden': 'true' }));
    this.grip = h('div', { class: 'sheet-grip' }, this.grab);
    this.voice = h('div', { class: 'sheet-voice', id: 'sheet-voice' });
    const body = side.querySelector('#tab-body');
    side.insertBefore(this.grip, body);
    side.insertBefore(this.voice, body);
    this.listen();
    layout.onMount((host) => this.mount(host));
    layout.attachSheet(this, [this.grip, this.voice]);
    // the line inside the slot changes height with its words (a title on two rows, the ticker's next line) while the
    // slot itself is held to the closed sheet's height: a change of its contents books a measure on the next frame
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        if (this.measureAt || this.hostNow !== 'sheet') return;
        this.measureAt = requestAnimationFrame(() => { this.measureAt = 0; layout.refresh(); });
      }).observe(this.voice, { childList: true, subtree: true, characterData: true });
    }
    layout.onChange((why) => { if (why === 'detent' || why === 'classes') this.label(); });
    this.label();
  }

  // ───────────────────────────── SheetHooks ─────────────────────────────
  /** All a closed sheet shows: its top border, the grip and the voice line in its slot (the ticker in calm, else the
   *  counsel's folded line: never its unfolded body, which a closed sheet folds). 0 off the SHEET or while the chrome
   *  is hidden. */
  head(): number {
    if (this.hostNow !== 'sheet' || !this.voice.offsetParent) return 0;
    const cs = getComputedStyle(this.voice);
    const line = this.line();
    return Math.ceil(this.side.clientTop + GRIP + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      + (line?.offsetHeight ?? 0));
  }

  /** Slides the sheet from `fromH` to `toH` px tall and leaves it at rest on `to`. The box takes the taller of the two
   *  heights for the slide and moves by a transform alone (no reflow of the tab body per frame), its part below the bar
   *  hidden by the bar; at rest the inline height and transform go, and sheet.css gives the detent's own height. Going
   *  up, the body shows from the start; going down, until the sheet is down. A slide under way starts from where it got. */
  slide(fromH: number, toH: number, to: Detent, instant: boolean): void {
    const st = this.side.style;
    const from = this.sliding ? this.visualH() : fromH;
    window.clearTimeout(this.endT);
    if (instant || Math.abs(from - toH) < 1 || this.hostNow !== 'sheet' || matchMedia(REDUCED).matches) { this.rest(to); return; }
    const hi = Math.max(from, toH);
    if (toH > from) this.side.dataset.rest = to;
    this.sliding = true;
    st.transition = 'none';
    st.height = `${hi}px`;
    st.transform = `translateY(${hi - from}px)`;
    void this.side.offsetHeight;
    st.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2, .8, .2, 1)`;
    st.transform = `translateY(${hi - toH}px)`;
    this.endT = window.setTimeout(() => this.rest(to), SLIDE_MS + 30);
  }

  // ───────────────────────────── internals ─────────────────────────────
  /** The host changed: on the SHEET the counsel and the ticker move into the voice line's slot; elsewhere they go home and
   *  the sheet's inline slide state is dropped. */
  private mount(host: Host): void {
    if (host === this.hostNow) return;
    this.hostNow = host;
    if (host === 'sheet') {
      this.voice.append(this.counsel.el, this.ticker.el);
    } else {
      this.counsel.back();
      this.ticker.back();
      this.drag = null;
      this.rest(null);
    }
  }

  /** The voice line on screen: the ticker's box in calm, else the counsel's folded line (its card's head, or its calm
   *  line before the lessons bring the ticker). */
  private line(): HTMLElement | null {
    const t = this.ticker.el;
    if (t.offsetHeight > 0) return t;
    const c = this.counsel.el;
    return c.querySelector<HTMLElement>('.counsel-head') ?? c.querySelector<HTMLElement>('.counsel-calm') ?? (c.offsetHeight > 0 ? c : null);
  }

  /** The sheet's height on screen now, mid-slide or mid-drag (its foot is the bar's top, whatever its transform). */
  private visualH(): number {
    const s = this.side, app = s.offsetParent as HTMLElement | null;
    const top = s.getBoundingClientRect().top - (app ? app.getBoundingClientRect().top : 0);
    return s.offsetTop + s.offsetHeight - top;
  }

  /** At rest on `to` (null: off the SHEET): no inline height or transform; the body shows unless closed. */
  private rest(to: Detent | null): void {
    window.clearTimeout(this.endT);
    this.sliding = false;
    const st = this.side.style;
    st.transition = 'none';
    st.height = '';
    st.transform = '';
    if (to) this.side.dataset.rest = to;
    else delete this.side.dataset.rest;
    delete this.side.dataset.moving;
    void this.side.offsetHeight;
    st.transition = '';
  }

  /** The grabber's name: where the sheet stands and what a tap does. */
  private label(): void {
    const d = this.layout.detent;
    this.grab.setAttribute('aria-label', `Ledger ${DETENT_NAMES.sheet[d]}: ${NEXT[d]}, or drag it`);
  }

  /** Follows the finger on the grip: from the sheet's height at the press, never past its top or bottom detent but for
   *  a little give. The strip keeps the shape of the detent it left (data-rest) while the body shows (data-moving), so
   *  nothing under the finger jumps. */
  private follow(y: number): void {
    const d = this.drag, hs = this.layout.sheetHeights;
    if (!d || !hs) return;
    let hgt = d.h0 + (d.y0 - y);
    if (hgt > hs.full) hgt = hs.full + (hgt - hs.full) * RUBBER;
    if (hgt < hs.closed) hgt = hs.closed - (hs.closed - hgt) * RUBBER;
    d.h = hgt;
    const hi = Math.max(hs.full, hgt), st = this.side.style;
    window.clearTimeout(this.endT);
    this.sliding = true;
    this.side.dataset.moving = '';   // the body shows while it moves
    st.transition = 'none';
    st.height = `${hi}px`;
    st.transform = `translateY(${hi - hgt}px)`;
  }

  /** The finger let go at `at` (the event's timeStamp): the detent the drag and its speed point at (snapDetent), slid to
   *  from where the sheet is. A finger that stood still before it let go flings nothing (no move came to age the last
   *  quick samples out). */
  private release(fling: boolean, at: number): void {
    const d = this.drag, hs = this.layout.sheetHeights;
    this.drag = null;
    if (!d || !hs) return;
    let v = 0;
    if (fling && d.pts.length > 1) {
      const [t1, y1] = d.pts[d.pts.length - 1], [t0, y0] = d.pts[0];
      if (t1 > t0 && at - t1 <= VELO_MS) v = (y0 - y1) / (t1 - t0);   // px per ms, upwards positive
    }
    this.layout.setDetent(snapDetent(d.h, v, hs, this.layout.offered), { fromH: d.h, user: true });
  }

  private listen(): void {
    const grip = this.grip;
    const busy = (): boolean => this.hostNow !== 'sheet' || this.g.mode !== 'game' || this.side.classList.contains('empty');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || busy() || !this.layout.sheetHeights) return;
      const hs = this.layout.sheetHeights;
      const h0 = this.sliding ? this.visualH() : hs[this.layout.detent];
      this.drag = { id: e.pointerId, y0: e.clientY, h0, h: h0, moved: false, pts: [[e.timeStamp, e.clientY]] };
      try { grip.setPointerCapture(e.pointerId); } catch { /* no capture: the moves still come while over the grip */ }
    });
    grip.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.abs(d.y0 - e.clientY) < TAP_SLOP) return;
      d.moved = true;
      d.pts.push([e.timeStamp, e.clientY]);
      while (d.pts.length > 2 && e.timeStamp - d.pts[0][0] > VELO_MS) d.pts.shift();
      this.follow(e.clientY);
    });
    const end = (e: PointerEvent, fling: boolean): void => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved) { this.drag = null; return; }   // a tap: the click that follows cycles the detent
      this.swallow = true;
      window.setTimeout(() => { this.swallow = false; }, 0);   // the click this release makes, if any, is no tap
      this.release(fling, e.timeStamp);
    };
    grip.addEventListener('pointerup', (e) => end(e, true));
    grip.addEventListener('pointercancel', (e) => end(e, false));
    // a tap (or Enter on the grabber): the next detent round the cycle
    grip.addEventListener('click', () => {
      if (this.swallow) { this.swallow = false; return; }
      if (busy()) return;
      this.g.sfx('click');
      this.layout.setDetent(cycleDetent(this.layout.detent, this.layout.offered), { user: true });
    });
  }
}
