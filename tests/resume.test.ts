// tests/resume.test.ts — a colony comes back as the player left it (DESIGN §2.1, §14): after Continue and the away
// letter it stays paused if the player had paused it, else it runs at their last speed; a button of the letter that opens
// a panel leaves it paused. Headless: resumeAs, opensPanel and resume over a stub Game (App and the letter's DOM need a
// browser); the pause's round trip through prefs is in save.test.ts.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../src/game/save';
import type { Prefs, Remedy, Speed } from '../src/game/types';
import type { Game } from '../src/ui/types';
import { opensPanel, resume, resumeAs } from '../src/ui/dispatch';

/** A stub of App's speed controls (main.ts): setSpeed unpauses and clears prefs.paused, setPaused stores the pause. */
function stub(prefs: Partial<Prefs>) {
  const calls: string[] = [];
  const g = {
    prefs: { ...DEFAULT_PREFS, ...prefs }, paused: true, speed: 1 as Speed,
    setSpeed(sp: Speed): void { calls.push(`speed ${sp}`); this.speed = sp; this.paused = false; this.prefs.speed = sp; this.prefs.paused = false; },
    setPaused(p: boolean): void { calls.push(`paused ${p}`); this.paused = p; this.prefs.paused = p; },
  };
  return { g, game: g as unknown as Game, calls };
}

describe('resumeAs', () => {
  it('runs at the last speed when the player had not paused, stays paused when they had', () => {
    expect(resumeAs({ speed: 10, paused: false })).toBe(10);
    expect(resumeAs({ speed: 20, paused: true })).toBeNull();
    expect(resumeAs({ speed: 1, paused: true })).toBeNull();
  });

  it('a letter closed on a button that opens a panel leaves even a running colony paused', () => {
    expect(resumeAs({ speed: 10, paused: false }, true)).toBeNull();
    expect(resumeAs({ speed: 10, paused: false }, false)).toBe(10);
  });
});

describe('opensPanel', () => {
  it('holds for a tab or the contract form, not for a remedy done at once or on the map', () => {
    const panel: Remedy[] = [
      { kind: 'open', tab: 'council', anchor: 'petition' },
      { kind: 'contract', spec: { hub: 'narbo', mode: 'import', res: 'grain', qty: 100, repeat: true } },
    ];
    const elsewhere: Remedy[] = [
      { kind: 'assign', cat: 'food', n: 2 }, { kind: 'priority', cat: 'water', days: 30 }, { kind: 'relief' },
      { kind: 'place', building: 'horreum' }, { kind: 'overlay', overlay: 'aqua' }, { kind: 'building', op: 'center', id: 1 },
    ];
    for (const r of panel) expect(opensPanel(r), r.kind).toBe(true);
    for (const r of elsewhere) expect(opensPanel(r), r.kind).toBe(false);
  });
});

describe('resume (Continue and the away letter)', () => {
  it('a running colony goes on at the last speed (20× in ?dev included)', () => {
    const { g, game, calls } = stub({ speed: 20, paused: false });
    resume(game);
    expect(calls).toEqual(['speed 20']);
    expect(g.paused).toBe(false);
    expect(g.speed).toBe(20);
  });

  it('a paused colony stays paused, and the pause stays stored for the next reload', () => {
    const { g, game, calls } = stub({ speed: 10, paused: true });
    resume(game);
    expect(calls).toEqual(['paused true']);
    expect(g.paused).toBe(true);
    expect(g.prefs).toMatchObject({ speed: 10, paused: true });   // the next speed chosen is still 10×
  });

  it('a panel button of the letter pauses a running colony, stored like the player\'s own pause', () => {
    const { g, game, calls } = stub({ speed: 5, paused: false });
    resume(game, true);
    expect(calls).toEqual(['paused true']);
    expect(g.paused).toBe(true);
    expect(g.prefs).toMatchObject({ speed: 5, paused: true });
  });
});
