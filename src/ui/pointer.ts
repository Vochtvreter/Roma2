// src/ui/pointer.ts — which pointer the player is using now (DESIGN §15.7). A finger or a pen taps a plot to preview it
// and confirms with Place; a mouse clicks to act and has hover. That is decided per press from PointerEvent.pointerType,
// never from the device's primary pointer alone: a touch laptop, a Surface or an iPad with a trackpad has both, and the
// player may switch between them mid-game. A capture listener on window sees every press before the widget it lands on,
// so a click handler reading lastTouch() reads the pointer of its own click. Owner: WP-H.

let touched = false;         // the last pointer was a finger or a pen
let seen = false;            // any pointer at all yet (before one, the primary pointer stands in)
let watching = false;

/** Starts tracking the last pointer type (idempotent; no DOM work at import, so headless tests can import callers). */
export function watchPointer(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const note = (e: PointerEvent): void => { touched = e.pointerType !== 'mouse'; seen = true; };
  window.addEventListener('pointerdown', note, true);
  window.addEventListener('pointermove', note, true);
}

function media(q: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(q).matches;
}

/** True when the last pointer used was a finger or a pen (false before any press). */
export function lastTouch(): boolean {
  watchPointer();
  return touched;
}

/** The device's primary pointer is coarse (a phone, a tablet). */
export function primaryCoarse(): boolean {
  return media('(pointer: coarse)');
}

/** A two-step confirm's armed label in the hand's own word: 'Click again…' reads 'Tap again…' after a finger's press
 *  (read at arm time, in the press's own click handler: lastTouch is that press). */
export function pressWord(label: string): string {
  return lastTouch() ? label.replace(/^Click\b/, 'Tap') : label;
}

/** True when the player is touching now: the last press was a finger or a pen; before any press, a coarse primary pointer. */
export function touchInput(): boolean {
  watchPointer();
  return seen ? touched : primaryCoarse();
}

/** A fine pointer is attached (a mouse or a trackpad, also on a tablet): keyboard shortcuts are worth showing. */
export function finePointer(): boolean {
  return media('(any-pointer: fine)');
}
