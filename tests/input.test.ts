// tests/input.test.ts — map input (ARCHITECTURE §12.1): a second finger or a cancelled pointer abandons a road/pave
// drag without committing it (REVIEW R07); a one-finger drag still commits. Headless: a fake element stands in for #map.
import { describe, expect, it } from 'vitest';
import { Input } from '../src/render/input';
import type { InputHandlers } from '../src/render/input';

type Listener = (e: unknown) => void;

/** The smallest element Input needs: listeners, a bounding box at the origin, pointer capture and a style. */
function fakeEl(): { el: HTMLElement; fire: (type: string, e: Record<string, unknown>) => void } {
  const on = new Map<string, Listener[]>();
  const el = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (t: string, f: Listener) => { on.set(t, [...(on.get(t) ?? []), f]); },
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: () => undefined,
  } as unknown as HTMLElement;
  const fire = (type: string, e: Record<string, unknown>): void => {
    for (const f of on.get(type) ?? []) f({ pointerType: 'touch', button: 0, shiftKey: false, timeStamp: 0, preventDefault: () => undefined, ...e });
  };
  return { el, fire };
}

/** Handlers that own every tool drag and record its phases. */
function recorder(): { h: InputHandlers; phases: string[] } {
  const phases: string[] = [];
  const nop = (): void => undefined;
  const h: InputHandlers = {
    hover: nop, leave: nop, pan: nop, fling: nop, zoom: nop, tap: nop, cancel: nop,
    toolDrag: (phase) => { phases.push(phase); return true; },
  };
  return { h, phases };
}

describe('input: tool drags', () => {
  it('a second finger (pinch) aborts a road drag and never commits it', () => {
    const { el, fire } = fakeEl();
    const { h, phases } = recorder();
    new Input(el, h);
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 0 });
    fire('pointerdown', { pointerId: 2, clientX: 140, clientY: 100, timeStamp: 40 });
    for (let k = 1; k <= 5; k++) {
      fire('pointermove', { pointerId: 1, clientX: 100 - k * 10, clientY: 100, timeStamp: 40 + k * 16 });
      fire('pointermove', { pointerId: 2, clientX: 140 + k * 10, clientY: 100, timeStamp: 40 + k * 16 });
    }
    fire('pointerup', { pointerId: 1, clientX: 50, clientY: 100, timeStamp: 200 });
    fire('pointerup', { pointerId: 2, clientX: 190, clientY: 100, timeStamp: 200 });
    expect(phases).toEqual(['start', 'abort']);
  });

  it('a cancelled pointer aborts the drag', () => {
    const { el, fire } = fakeEl();
    const { h, phases } = recorder();
    new Input(el, h);
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    fire('pointermove', { pointerId: 1, clientX: 130, clientY: 100, timeStamp: 16 });
    fire('pointercancel', { pointerId: 1, clientX: 130, clientY: 100, timeStamp: 32 });
    expect(phases).toEqual(['start', 'move', 'abort']);
  });

  it('a one-finger drag still commits on release', () => {
    const { el, fire } = fakeEl();
    const { h, phases } = recorder();
    new Input(el, h);
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    fire('pointermove', { pointerId: 1, clientX: 130, clientY: 100, timeStamp: 16 });
    fire('pointerup', { pointerId: 1, clientX: 130, clientY: 100, timeStamp: 32 });
    expect(phases).toEqual(['start', 'move', 'end']);
  });
});
