// tests/history.test.ts — Back in a game (DESIGN §15.8): the pure decision of src/ui/history.ts. Back closes the open
// layer of the highest rank (the Esc chain: a modal › placing › the selection); with nothing open the first Back warns
// and a second one within LEAVE_MS leaves. Headless: backStep and rearm only (the popstate wiring needs a browser).
import { describe, expect, it } from 'vitest';
import { BACK_RANK, LEAVE_MS, backStep, rearm } from '../src/ui/history';

const L = (rank: number, open: boolean) => ({ rank, open });

describe('backStep', () => {
  it('closes the open layer of the highest rank, whatever the order they were registered in', () => {
    const layers = [L(BACK_RANK.selection, true), L(BACK_RANK.modal, true), L(BACK_RANK.placing, true)];
    expect(backStep(layers, 0, -Infinity)).toEqual({ kind: 'close', layer: 1 });
    layers[1].open = false;
    expect(backStep(layers, 0, -Infinity)).toEqual({ kind: 'close', layer: 2 });
    layers[2].open = false;
    expect(backStep(layers, 0, -Infinity)).toEqual({ kind: 'close', layer: 0 });
  });

  it('a later layer slots between the ranks; on a tie the first registered closes first', () => {
    const tray = 70;
    expect(backStep([L(BACK_RANK.placing, true), L(tray, true), L(BACK_RANK.modal, false)], 0, -Infinity)).toEqual({ kind: 'close', layer: 1 });
    expect(backStep([L(tray, true), L(tray, true)], 0, -Infinity)).toEqual({ kind: 'close', layer: 0 });
  });

  it('with nothing open: warn first, leave on a second Back within LEAVE_MS, warn again after it', () => {
    const none = [L(BACK_RANK.modal, false), L(BACK_RANK.placing, false)];
    expect(backStep(none, 10_000, -Infinity)).toEqual({ kind: 'warn' });
    expect(backStep([], 10_000, -Infinity)).toEqual({ kind: 'warn' });
    expect(backStep(none, 10_000 + LEAVE_MS - 1, 10_000)).toEqual({ kind: 'leave' });
    expect(backStep(none, 10_000 + LEAVE_MS, 10_000)).toEqual({ kind: 'warn' });
    // an open layer always closes first, even while a warning stands
    expect(backStep([L(BACK_RANK.placing, true)], 10_001, 10_000)).toEqual({ kind: 'close', layer: 0 });
  });
});

describe('rearm', () => {
  it('keeps the sentinel off while a warning stands, so the second Back is the browser\'s own', () => {
    expect(rearm(10_000, -Infinity, false)).toBe(true);              // no warning: the guard is up
    expect(rearm(10_000 + LEAVE_MS - 1, 10_000, false)).toBe(false); // the warning stands: Back leaves
    expect(rearm(10_000 + LEAVE_MS, 10_000, false)).toBe(true);      // it lapsed: the guard is back
  });

  it('a layer opened while the warning stands puts the guard back at once (Back closes it first)', () => {
    expect(rearm(10_001, 10_000, true)).toBe(true);
  });
});
