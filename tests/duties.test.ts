// tests/duties.test.ts — the council's duties (DESIGN §10.2, ordo/duties.ts): a colony run by hand learns each duty by
// doing it, hands it to the Ordo or keeps it; the Ordo raises and saves only for what it holds, but for the Lex de
// annona's nets and Govern while away.
import { describe, expect, it } from 'vitest';
import { DUTIES, WORK_DUTIES } from '../src/game/types';
import type { GameState } from '../src/game/types';
import { fresh, run } from './util';
import { newGame } from '../src/game/state';
import { newCtx, tick, view } from '../src/game/sim';
import { bestSlot } from '../src/game/site';
import { applyOnce, askOrdo, handOverAll, place, setDuty, setManualTarget, setOrdo } from '../src/game/actions';
import { granted, learned, pendingOffers, walkMask, wishDuty } from '../src/game/ordo/duties';
import { walkWishes } from '../src/game/ordo/build';
import { councilReport } from '../src/game/ordo/index';
import { deserialize, serialize } from '../src/game/save';
import { LESSONS, skipIntro } from '../src/game/intro';
import { B } from '../src/game/balance';

/** A colony run by hand, past the lessons (every duty learned, none handed over). */
const byHand = (seed = 42): GameState => {
  const s = newGame({ seed, now: 0, intro: true });
  skipIntro(s);
  return s;
};

/** Places a work by the player's hand on the best plot and plays days until it stands. */
function raise(s: GameState, type: 'cisterna' | 'lararium' | 'lignarius' | 'area'): void {
  const slot = bestSlot(s, type, { owner: 'player' })!;
  expect(place(s, type, slot.tile).ok).toBe(true);
  for (let i = 0; i < 200 && !s.buildings.some((b) => b.type === type && b.owner === 'player' && b.status === 'done'); i++) run(s, 1);
}

describe('learning a duty', () => {
  it('is learned by the player\'s own finished work, not a site in hand, nor the Ordo\'s, nor one it raised on request', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    const slot = bestSlot(s, 'lignarius', { owner: 'player' })!;
    expect(place(s, 'lignarius', slot.tile).ok).toBe(true);
    run(s, 1);
    expect(learned(s, 'materials')).toBe(false);                    // not while it rises
    for (let i = 0; i < 200 && !learned(s, 'materials'); i++) run(s, 1);
    expect(learned(s, 'materials')).toBe(true);
    expect(s.log.some((e) => /Materials: the Ordo can take it up/.test(e.text))).toBe(true);
    const t = newGame({ seed: 42, now: 0, intro: true });
    const o = bestSlot(t, 'cisterna', { owner: 'ordo' })!;
    expect(place(t, 'cisterna', o.tile, { owner: 'ordo' }).ok).toBe(true);
    run(t, 80);
    expect(learned(t, 'water')).toBe(false);
  });
  it('teaches staffing by a target set by hand, trade by a contract or a deal, and the plan by a petition granted', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    expect(setManualTarget(s, 'food', 3).ok).toBe(true);
    expect(learned(s, 'labour')).toBe(true);
    expect(learned(s, 'trade')).toBe(false);
    s.rank = 1;
    run(s, 1);
    expect(learned(s, 'plan')).toBe(true);
  });
  it('cannot be handed over before it is learned; once learned it can, and taken back', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    const r = setDuty(s, 'water', true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Raise a well/);
    expect(setOrdo(s, 'build', true).ok).toBe(false);
    raise(s, 'cisterna');
    expect(setDuty(s, 'water', true).ok).toBe(true);
    expect(s.ordo.on.build).toBe(true);
    expect(s.ordo.works).toMatchObject({ water: true, food: false, homes: false });
    expect(setDuty(s, 'water', false).ok).toBe(true);
    expect(s.ordo.on.build).toBe(false);                             // no kind of work left to it
    expect(s.ordo.answered).toEqual(['water']);
  });
  it('lets the Construction toggle hand over every kind of work learned, and take them all back', () => {
    const s = byHand();
    expect(setOrdo(s, 'build', true).ok).toBe(true);
    for (const d of WORK_DUTIES) expect(granted(s, d), d).toBe(true);
    expect(setOrdo(s, 'build', false).ok).toBe(true);
    for (const d of WORK_DUTIES) expect(granted(s, d), d).toBe(false);
  });
});

describe('what the Ordo raises', () => {
  it('walks only the wishes of the duties it holds, and saves for nothing else', () => {
    const s = byHand();
    setDuty(s, 'water', true);
    setDuty(s, 'labour', true);
    run(s, 300);
    for (const b of s.buildings.filter((x) => x.owner === 'ordo')) {
      const d = b.reason ? wishDuty(b.reason) : null;
      expect(d === 'water' || ['survivalFood', 'survivalWater'].includes(b.reason?.code ?? ''), `${b.type} ${b.reason?.code}`).toBe(true);
    }
    const v = view(s);
    for (const e of walkWishes(s, v).list) expect([null, 'water']).toContain(wishDuty(e.wish.reason) ?? (e.wish.survival ? null : 'x'));
    const pending = walkWishes(s, v).pending;
    if (pending) expect(wishDuty(pending.reason)).toBe('water');
  });
  it('names what it would raise among the duties it does not hold, and Apply once places it as the player\'s', () => {
    const s = byHand();
    setDuty(s, 'labour', true);
    let would = councilReport(s).would.build;
    for (let i = 0; i < 200 && !would; i++) { run(s, 1); would = councilReport(s).would.build; }
    expect(would).toBeTruthy();
    const n = s.buildings.length;
    expect(applyOnce(s, 'build').ok).toBe(true);
    const b = s.buildings[s.buildings.length - 1];
    expect(s.buildings.length).toBe(n + 1);
    expect(b.owner).toBe('player');
    expect(b.type).toBe(would!.type);
  });
  it('holds every duty while the player is away with Govern while away, and only those given once back', () => {
    const s = byHand();
    expect(walkMask(s)).not.toBe('all');
    const c = newCtx(true);
    tick(s, c);
    expect(walkMask(s)).not.toBe('all');                             // the absence's mask ends with its tick
    for (let i = 0; i < 400; i++) tick(s, newCtx(true));
    expect(s.buildings.some((b) => b.owner === 'ordo' && b.reason && !['survivalFood', 'survivalWater'].includes(b.reason.code))).toBe(true);
    const t = byHand();
    t.decisions.switches.governAway = false;
    for (let i = 0; i < 400; i++) tick(t, newCtx(true));
    expect(t.buildings.some((b) => b.owner === 'ordo' && b.reason && !['survivalFood', 'survivalWater'].includes(b.reason.code))).toBe(false);
  });
  it('still carries out the player\'s requests whatever it holds', () => {
    const s = byHand();
    setDuty(s, 'water', true);
    expect(askOrdo(s, 'lararium').ok).toBe(true);
    run(s, 30);
    expect(s.buildings.some((b) => b.type === 'lararium' && b.reason?.code === 'request')).toBe(true);
  });
});

describe('the Lex de annona\'s hands', () => {
  it('sends hands to the fields when the grain runs low under staffing by hand, without touching the player\'s targets', () => {
    const s = byHand();
    let low = -1;
    run(s, 80, (st, _c, i) => { if (low < 0 && st.ordo.emergency.hands) low = i; });
    expect(low).toBeGreaterThan(0);
    expect(s.ordo.manual.food).toBe(1);
    expect(s.log.some((e) => /Lex de annona: our stores hold only \d+ days; \d+ more hands/.test(e.text))).toBe(true);
    expect(s.stats.deathsBy.hunger).toBe(0);
  });
  it('sends none with the switch off, nor while the Ordo staffs', () => {
    const s = byHand();
    s.decisions.switches.emergency = false;                          // (the switch shows from M5 on)
    run(s, 60);
    expect(s.log.some((e) => /more hands go to the fields/.test(e.text))).toBe(false);
    const t = fresh(42);
    run(t, 60);
    expect(t.ordo.emergency.hands).toBe(false);
  });
  it('keeps a colony nobody plays alive through its first two years', () => {
    for (const seed of [1, 42]) {
      const s = newGame({ seed, now: 0, intro: true });
      run(s, 730);
      expect(s.stats.deathsBy.hunger + s.stats.deathsBy.thirst, `seed ${seed}`).toBe(0);
    }
  }, 120_000);
});

describe('saves', () => {
  it('keep the duties of a colony run by hand', () => {
    const s = byHand();
    setDuty(s, 'water', true);
    const back = deserialize(serialize(s))!;
    expect(back.ordo.works).toEqual(s.ordo.works);
    expect(back.ordo.learned).toEqual(s.ordo.learned);
    expect(back.ordo.answered).toEqual(s.ordo.answered);
    expect(serialize(back)).toBe(serialize(s));
  });
  it('give a colony from before the duties every duty, learned and answered, held as its toggles say', () => {
    const s = fresh(42);
    s.ordo.on.labour = false;
    const raw = JSON.parse(serialize(s));
    delete raw.ordo.works; delete raw.ordo.learned; delete raw.ordo.answered; delete raw.ordo.emergency.hands;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.ordo.learned).toEqual([...DUTIES]);
    expect(back.ordo.answered).toEqual([...DUTIES]);
    expect(pendingOffers(back)).toEqual([]);                         // nothing is offered anew
    expect(granted(back, 'labour')).toBe(false);
    expect(granted(back, 'water')).toBe(true);
  });
  it('move a lesson under way from before the duties to its place today', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    const raw = JSON.parse(serialize(s));
    delete raw.ordo.works; delete raw.ordo.learned; delete raw.ordo.answered;
    raw.guidance.intro.lesson = 7;                                    // the roll of souls, which the fields teach now
    raw.guidance.intro.ordoHeld = false;
    const back = deserialize(JSON.stringify(raw))!;
    expect(LESSONS[back.guidance.intro.lesson].id).toBe('overlays');
    expect('ordoHeld' in back.guidance.intro).toBe(false);
    raw.guidance.intro.lesson = 1;                                    // the house plot
    expect(LESSONS[deserialize(JSON.stringify(raw))!.guidance.intro.lesson].id).toBe('homes');
  });
});

describe('offers', () => {
  it('offer each learned duty once: handed over or kept, it is answered', () => {
    const s = byHand();
    expect(pendingOffers(s)).toEqual([...DUTIES]);
    setDuty(s, 'labour', true);
    expect(pendingOffers(s)).not.toContain('labour');
    expect(handOverAll(s, ['water', 'food']).ok).toBe(true);
    expect(pendingOffers(s)).toEqual(['homes', 'services', 'materials', 'plan', 'trade']);
    expect(B.duties.START_BUILDERS).toBeGreaterThan(0);
  });
});
