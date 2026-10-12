// src/ui/sheet.ts — the sliding panel's own DOM (DESIGN §15.7, ARCHITECTURE §13.10): the grabber and the voice line's slot
// of the panel (#side), the drag, and the slide between its detents; the portrait SHEET's and the landscape DRAWER's, one
// set of nodes arranged two ways (sheet.css, drawer.css), and the tablet DOCK's head and slide (dock.css). Owner: WP-H.
// One instance of every widget: on a phone the counsel (#counsel) and the ticker (#ticker) move into the voice line's slot
// (the counsel's folded card is the line; in calm the ticker speaks there instead), and the tab buttons become the SHEET's
// bar or the DRAWER's spine (panels.ts mount); on any other host they go back where index.html put them, and the grip and
// the empty slot hide. The slot heads the panel (#side, before the tab body), but on the DRAWER, while the pane is closed,
// it stands afloat at the bottom-left of the map (a child of #app): slide() puts it there for its detent, before the
// layout measures the free map.
// Drag only on the grabber: the SHEET's strip at its top (it follows the finger up and down), the DRAWER's at the pane's
// left edge (sideways; there only its handle's tap cycles); touch-action: none there (the tab body keeps its own scroll,
// the voice line its taps). The panel follows the finger, comes to rest on the nearest detent (a fling goes on to the
// next one: layout.snapDetent over the layout's extents: the SHEET's heights, the DRAWER's widths), its size set at rest
// (from the layout's --sheet-* and --drawer-* properties); the camera's insets change only once a detent is chosen,
// never with the finger, and then to that detent's rect from the slide's start, so the camera's glide runs with the
// slide (Layout.setDetent; on every host). A tap on the grabber cycles closed → half → full → closed. The layout owns
// the detent and the extents; this module moves the box.
// The DOCK is no phone (no grabber, no drag: its view control, spine and keys move it), but its pane slides sideways the
// DRAWER's way between its widths (layout.dockWidths: the spine, docked, wide), and the same slot heads it: there it
// holds the left column folded in, the Res Gestae panel (#objective, in its one-line form) over the counsel line, while
// the ticker stays on the map; folded to the spine, dock.css floats the head top-right over the map. The desktop COLUMNS'
// panel slides the same way between its widths (layout.columnsWidths: the badge spine, today's 380 px, wide), its slot
// empty (the left column keeps the Res Gestae and the counsel).
import type { Game } from './types';
import type { Detent, Host, Layout, SheetHooks } from './layout';
import { DETENT_NAMES, cycleDetent, isPhone, snapDetent } from './layout';
import { h } from './dom';

const SLIDE_MS = 220;
const TAP_SLOP = 6;      // px a press may wander and still be a tap
const VELO_MS = 90;      // a release's speed is read over the drag's last 90 ms
const RUBBER = 0.3;      // past the top or bottom detent the panel follows the finger this much
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

/** The phone hosts' head and slide: the grip and the voice line's slot in #side, for the layout (SheetHooks). On the SHEET
 *  the panel's extent is its height and it slides up and down; on the DRAWER the pane's width, and it slides sideways. */
export class SheetHost implements SheetHooks {
  private readonly grip: HTMLElement;
  private readonly grab: HTMLButtonElement;
  private readonly voice: HTMLElement;
  private readonly body: HTMLElement | null;
  private readonly app: HTMLElement | null;
  private readonly counsel: Home;
  private readonly ticker: Home;
  private readonly objective: Home;
  private hostNow: Host | null = null;
  private drag: { id: number; p0: number; e0: number; e: number; moved: boolean; pts: [number, number][] } | null = null;
  private swallow = false;   // the click that ends a drag is not a tap
  private sliding = false;
  private endT = 0;
  private measureAt = 0;     // a frame is booked to measure the head again (the voice line was rebuilt or reworded)

  constructor(private readonly g: Game, private readonly layout: Layout, private readonly side: HTMLElement, counsel: HTMLElement, ticker: HTMLElement,
    objective: HTMLElement) {
    this.counsel = new Home(counsel);
    this.ticker = new Home(ticker);
    this.objective = new Home(objective);
    this.app = side.parentElement;
    this.grab = h('button', { class: 'sheet-grab', id: 'sheet-grab', type: 'button' }, h('i', { 'aria-hidden': 'true' }));
    this.grip = h('div', { class: 'sheet-grip' }, this.grab);
    this.voice = h('div', { class: 'sheet-voice', id: 'sheet-voice' });
    this.body = side.querySelector<HTMLElement>('#tab-body');
    side.insertBefore(this.grip, this.body);
    side.insertBefore(this.voice, this.body);
    this.listen();
    layout.onMount((host) => this.mount(host));
    layout.attachSheet(this, [this.grip, this.voice]);
    // the line inside the slot changes height with its words (a title on two rows, the ticker's next line) while the
    // slot itself is held to the closed sheet's height: a change of its contents books a measure on the next frame (on
    // the DRAWER the floating line's height bounds the free map above it)
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        if (this.measureAt || !isPhone(this.hostNow)) return;
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

  /** The panel moves now: under the finger (a drag) or sliding to a detent. The layout counts no cover meanwhile, so the
   *  map a drag down from full uncovers is drawn live, not the frame the cover left on the canvas. */
  moving(): boolean {
    return this.sliding;
  }

  /** The DRAWER's voice line while it stands afloat on the map (the pane closed), or the DOCK's head while it floats
   *  top-right over the map (the pane at rest on its spine, or with no tab yet: dock.css), else null. */
  floating(): HTMLElement | null {
    if (this.hostNow === 'dock') return this.side.dataset.rest === 'closed' || this.side.classList.contains('empty') ? this.voice : null;
    return this.hostNow === 'drawer' && this.voice.parentElement === this.app ? this.voice : null;
  }

  /** Slides the panel from `fromH` to `toH` (its extent: the SHEET's height, the DRAWER's or the DOCK pane's width) and
   *  leaves it at rest on `to`; the voice line goes where `to` wants it first (placeVoice). The box takes the larger of
   *  the two extents for the slide and moves by a transform alone (no reflow of the tab body per frame): the sheet's part
   *  below the bar hidden by the bar, the pane's right of the spine under the spine (the DOCK's off #app's right edge); at
   *  rest the inline size and transform go, and the CSS gives the detent's own. Opening, the body shows from the start
   *  (data-rest names the detent it goes to); closing, until the panel is away. A slide under way starts from where it
   *  got. */
  slide(fromH: number, toH: number, to: Detent, instant: boolean): void {
    this.placeVoice(to);
    const st = this.side.style, x = this.sideways();
    const from = this.sliding ? this.visualE() : fromH;
    window.clearTimeout(this.endT);
    if (instant || Math.abs(from - toH) < 1 || !this.slides() || matchMedia(REDUCED).matches) { this.rest(to); return; }
    const hi = Math.max(from, toH);
    if (toH > from) this.side.dataset.rest = to;
    this.sliding = true;
    st.transition = 'none';
    if (x) st.width = `${hi}px`; else st.height = `${hi}px`;
    st.transform = this.shift(hi - from);
    void this.side.offsetHeight;
    st.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2, .8, .2, 1)`;
    st.transform = this.shift(hi - toH);
    this.endT = window.setTimeout(() => this.rest(to), SLIDE_MS + 30);
  }

  // ───────────────────────────── internals ─────────────────────────────
  /** The panel slides between its extents on this host: the phones' sheet and drawer, the DOCK's pane, the COLUMNS'
   *  panel (its spine, docked and wide widths). */
  private slides(): boolean {
    return this.hostNow !== null;
  }

  /** The panel slides sideways (its extent a width): the DRAWER's pane, the DOCK's and the COLUMNS'; the SHEET goes up
   *  and down. */
  private sideways(): boolean {
    return this.hostNow !== null && this.hostNow !== 'sheet';
  }

  /** The host changed: on a phone the counsel and the ticker move into the voice line's slot; on the DOCK the Res Gestae
   *  panel and the counsel (the left column folded into the pane's head), the ticker going home to the map; elsewhere
   *  they go home (the counsel before the Res Gestae: each goes back before its old next sibling, the Res Gestae's being
   *  the counsel), the slot back to the panel's head, and the panel's inline slide state is dropped (the layout then
   *  rests it on its detent, in the new host's shape). A phone's Res Gestae is the Breviarium's (tray.ts mounts after
   *  this): it is taken from here there. */
  private mount(host: Host): void {
    if (host === this.hostNow) return;
    this.hostNow = host;
    this.drag = null;
    this.rest(null);
    if (isPhone(host)) {
      this.voice.append(this.counsel.el, this.ticker.el);
      this.placeVoice(this.layout.detent);
    } else if (host === 'dock') {
      this.ticker.back();
      this.voice.append(this.objective.el, this.counsel.el);
      this.placeVoice(null);
    } else {
      this.counsel.back();
      if (this.objective.el.parentElement === this.voice) this.objective.back();
      this.ticker.back();
      this.placeVoice(null);
    }
  }

  /** The voice line's place for detent `to`: afloat at the bottom-left of the map while the DRAWER's pane is closed, or
   *  has no tab to show yet (a child of #app, beside #side), else at the panel's head (before the tab body). */
  private placeVoice(to: Detent | null): void {
    const app = this.app, v = this.voice;
    if (this.hostNow === 'drawer' && (to === 'closed' || this.side.classList.contains('empty')) && app) {
      if (v.parentElement !== app) app.insertBefore(v, this.side);
    } else if (v.parentElement !== this.side) this.side.insertBefore(v, this.body && this.body.parentElement === this.side ? this.body : null);
  }

  /** The slide's transform: down for the SHEET, right for the DRAWER's and the DOCK's pane, by `d` px. */
  private shift(d: number): string {
    return this.sideways() ? `translateX(${d}px)` : `translateY(${d}px)`;
  }

  /** The voice line on screen: the ticker's box in calm, else the counsel's folded line (its card's head, or its calm
   *  line before the lessons bring the ticker). */
  private line(): HTMLElement | null {
    const t = this.ticker.el;
    if (t.offsetHeight > 0) return t;
    const c = this.counsel.el;
    return c.querySelector<HTMLElement>('.counsel-head') ?? c.querySelector<HTMLElement>('.counsel-calm') ?? (c.offsetHeight > 0 ? c : null);
  }

  /** The panel's extent on screen now, mid-slide or mid-drag: the SHEET's height (its foot is the bar's top, whatever
   *  its transform), the DRAWER's or the DOCK pane's width (its right edge is the spine's left, or #app's). */
  private visualE(): number {
    const s = this.side, app = s.offsetParent as HTMLElement | null, r = s.getBoundingClientRect(), a = app?.getBoundingClientRect();
    if (this.sideways()) return s.offsetLeft + s.offsetWidth - (r.left - (a ? a.left : 0));
    return s.offsetTop + s.offsetHeight - (r.top - (a ? a.top : 0));
  }

  /** At rest on `to` (null: off the phones): no inline size or transform; the body shows unless closed. */
  private rest(to: Detent | null): void {
    window.clearTimeout(this.endT);
    this.sliding = false;
    const st = this.side.style;
    st.transition = 'none';
    st.height = '';
    st.width = '';
    st.transform = '';
    if (to) this.side.dataset.rest = to;
    else delete this.side.dataset.rest;
    delete this.side.dataset.moving;
    void this.side.offsetHeight;
    st.transition = '';
  }

  /** The grabber's name: where the panel stands and what a tap does. */
  private label(): void {
    const d = this.layout.detent, host = this.hostNow && isPhone(this.hostNow) ? this.hostNow : 'sheet';
    this.grab.setAttribute('aria-label', `Ledger ${DETENT_NAMES[host][d]}: ${NEXT[d]}, or drag it`);
  }

  /** The finger's place along the drag's axis: up the SHEET, leftwards along the DRAWER (both grow the panel). */
  private at(e: PointerEvent): number {
    return this.hostNow === 'drawer' ? e.clientX : e.clientY;
  }

  /** Follows the finger on the grip: from the panel's extent at the press, never past its largest or smallest detent but
   *  for a little give. The SHEET keeps its full height and moves by a transform, the strip keeping the shape of the
   *  detent it left (data-rest) while the body shows (data-moving), so nothing under the finger jumps; the DRAWER's pane
   *  takes the finger's width itself (its right edge stays on the spine). */
  private follow(p: number): void {
    const d = this.drag, hs = this.layout.extents;
    if (!d || !hs) return;
    let e = d.e0 + (d.p0 - p);
    if (e > hs.full) e = hs.full + (e - hs.full) * RUBBER;
    if (e < hs.closed) e = hs.closed - (hs.closed - e) * RUBBER;
    d.e = e;
    const st = this.side.style;
    window.clearTimeout(this.endT);
    this.sliding = true;
    this.side.dataset.moving = '';   // the body shows while it moves
    st.transition = 'none';
    if (this.hostNow === 'drawer') {
      st.width = `${Math.max(0, Math.round(e))}px`;
      st.transform = 'none';
    } else {
      const hi = Math.max(hs.full, e);
      st.height = `${hi}px`;
      st.transform = this.shift(hi - e);
    }
  }

  /** The finger let go at `at` (the event's timeStamp): the detent the drag and its speed point at (snapDetent), slid to
   *  from where the panel is. A finger that stood still before it let go flings nothing (no move came to age the last
   *  quick samples out). */
  private release(fling: boolean, at: number): void {
    const d = this.drag, hs = this.layout.extents;
    this.drag = null;
    if (!d || !hs) return;
    let v = 0;
    if (fling && d.pts.length > 1) {
      const [t1, p1] = d.pts[d.pts.length - 1], [t0, p0] = d.pts[0];
      if (t1 > t0 && at - t1 <= VELO_MS) v = (p0 - p1) / (t1 - t0);   // px per ms, growing the panel positive
    }
    this.layout.setDetent(snapDetent(d.e, v, hs, this.layout.offered), { fromH: d.e, user: true });
  }

  private listen(): void {
    const grip = this.grip;
    const busy = (): boolean => !isPhone(this.hostNow) || this.g.mode !== 'game' || this.side.classList.contains('empty');
    grip.addEventListener('pointerdown', (e) => {
      const hs = this.layout.extents;
      if (e.button !== 0 || busy() || !hs) return;
      const e0 = this.sliding ? this.visualE() : hs[this.layout.detent];
      const p = this.at(e);
      this.drag = { id: e.pointerId, p0: p, e0, e: e0, moved: false, pts: [[e.timeStamp, p]] };
      try { grip.setPointerCapture(e.pointerId); } catch { /* no capture: the moves still come while over the grip */ }
    });
    grip.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const p = this.at(e);
      if (!d.moved && Math.abs(d.p0 - p) < TAP_SLOP) return;
      d.moved = true;
      d.pts.push([e.timeStamp, p]);
      while (d.pts.length > 2 && e.timeStamp - d.pts[0][0] > VELO_MS) d.pts.shift();
      this.follow(p);
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
    // a tap (or Enter on the grabber): the next detent round the cycle. On the DRAWER only the handle's: its strip runs the
    // pane's whole height for a sideways drag, and a tap beside the handle (meant for the map or the pane) is no command
    grip.addEventListener('click', (e) => {
      if (this.swallow) { this.swallow = false; return; }
      if (busy()) return;
      if (this.hostNow === 'drawer' && !(e.target instanceof Element && this.grab.contains(e.target))) return;
      this.g.sfx('click');
      this.layout.setDetent(cycleDetent(this.layout.detent, this.layout.offered), { user: true });
    });
  }
}
