// tests/guide.test.ts — the mentor's tip graph and engine, the first days with seed 42, the DESIGN §11.12 beat sheet
// with WP-J's decision bot (INTEGRATED), and the hints (ARCHITECTURE §14.2 WP-E, §15). Owner: WP-E.
import { describe, expect, it } from 'vitest';
import { DUTIES, TIPS } from '../src/game/types';
import type { GameState, TipId } from '../src/game/types';
import { INTEGRATED, dryHouse, fresh, run } from './util';
import { elapsed } from '../src/game/calendar';
import { newCtx, tick, view } from '../src/game/sim';
import { GUIDE, dismissTip, mentorKicker, nextTip, pruneGuide } from '../src/game/guide';
import { anOrdinal, benefitLine, howToGetMore, outputChain } from '../src/game/hints';
import { B } from '../src/game/balance';
import { newGame } from '../src/game/state';
import { bestSlot } from '../src/game/site';
import { handOverAll, keepDuties, place, setDuty, setManualTarget } from '../src/game/actions';
import { granted, learned, pendingOffers } from '../src/game/ordo/duties';
import { deserialize, serialize } from '../src/game/save';
import { INTRO_TIPS, LESSONS, beginNextLesson, currentLesson, introRunning, introStep, introduced, notePractice, plainWork, skipIntro, skipLesson, taughtWorks } from '../src/game/intro';
import type { IntroPart, IntroStep } from '../src/game/intro';

/** Plays `days` days; a tip is read (dismissed) the day after it first shows. Returns the elapsed day each tip showed. */
function play(s: GameState, days: number, step?: (s: GameState) => void): Partial<Record<TipId, number>> {
  const shown: Partial<Record<TipId, number>> = {};
  for (let i = 0; i < days; i++) {
    step?.(s);
    tick(s, newCtx());
    const t = nextTip(s);
    if (!t) continue;
    if (shown[t.id] === undefined) shown[t.id] = elapsed(s);
    else if (!step) dismissTip(s, t.id);
  }
  return shown;
}

describe('tip graph', () => {
  it('holds every tip once, welcome first, every `after` an earlier tip', () => {
    expect(GUIDE.map((g) => g.id).sort()).toEqual([...TIPS].sort());
    expect(new Set(GUIDE.map((g) => g.id)).size).toBe(GUIDE.length);
    expect(GUIDE[0].id).toBe('welcome');
    for (const [i, g] of GUIDE.entries()) {
      if (g.after) expect(GUIDE.findIndex((x) => x.id === g.after)).toBeGreaterThanOrEqual(0);
      if (g.after) expect(GUIDE.findIndex((x) => x.id === g.after)).not.toBe(i);
      if (g.id !== 'welcome') expect(g.after).toBeDefined();
    }
  });
  it('marks the four urgent tips and points each tip at a target or a tab', () => {
    expect(GUIDE.filter((g) => g.urgent).map((g) => g.id)).toEqual(['starving', 'thirst', 'event', 'petition']);
    for (const g of GUIDE) if (g.id !== 'welcome') expect(g.target ?? g.tab).toBeDefined();
  });
});

describe('tip engine', () => {
  it('shows welcome first, then vitals once welcome is read and a breather has passed', () => {
    const s = fresh(42);
    expect(nextTip(s)?.id).toBe('welcome');
    run(s, 2);
    expect(nextTip(s)?.id).toBe('welcome');
    expect(dismissTip(s, 'welcome').ok).toBe(true);
    expect(s.guidance.tipDay).toBe(s.day);
    expect(nextTip(s)).toBeNull();                                   // nothing new straight after a tip is read
    run(s, B.intro.GAP - 1);
    expect(nextTip(s)).toBeNull();
    run(s, 1);
    expect(nextTip(s)?.id).toBe('vitals');
    expect(dismissTip(s, 'nope' as TipId).ok).toBe(false);
  });
  it('prunes tips whose `until` holds and puts an urgent dispatch tip first', () => {
    const s = fresh(42);
    s.decisions.paths.charter = 'veterani';
    pruneGuide(s);
    expect(s.guidance.tips).toContain('charter');
    dismissTip(s, 'welcome');
    s.choice = { event: 'legatus', kicker: '', title: 'The Legate writes', text: '', defaultIndex: 0, created: s.day, expires: s.day + 30, options: [{ label: 'Agree', note: '', key: 'a' }] };
    expect(nextTip(s)?.id).toBe('event');
    expect(nextTip(s)?.text(s)).toMatch(/cautious path: Agree\. 30 days remain\./);
  });
  it('keeps tips the player has not earned yet (R13): build, trade, and the urgent starving and thirst', () => {
    const s = fresh(42);
    run(s, 1);
    expect(s.guidance.tips).not.toContain('starving');               // founding grain is above 20 days: "not now", not "never"
    expect(s.guidance.tips).not.toContain('thirst');
    // a site the Ordo raised for an "Ask the Ordo" request is the player's, but not the player's own hand
    const site = { ...s.buildings.find((b) => b.type === 'puteus')!, id: s.nextId++, owner: 'player' as const, reason: { code: 'request' as const, params: { type: 'puteus' } } };
    s.buildings.push(site);
    s.rank = 1;
    s.trade.contracts.push({ id: s.nextId++, hub: 'durii', mode: 'export', res: 'timber', qty: 40, repeat: true, owner: 'ordo', status: 'idle', trips: 0, created: s.day });
    pruneGuide(s);
    expect(s.guidance.tips).not.toContain('build');
    expect(s.guidance.tips).not.toContain('trade');
    s.buildings.push({ ...site, id: s.nextId++, reason: undefined });
    s.trade.contracts.push({ ...s.trade.contracts[0], id: s.nextId++, owner: 'player' });
    pruneGuide(s);
    expect(s.guidance.tips).toContain('build');
    expect(s.guidance.tips).toContain('trade');
    // the starving tip still comes when the children go hungry and the grain runs low
    dismissTip(s, 'welcome');
    s.needs.hunger = [60, 10, 10, 10];
    s.res.grain = 30;
    s.day++;                                                          // the forecast is made once a day
    expect(nextTip(s)?.id).toBe('starving');
  });
  it('raises the away tip after offline ticks and changes the kicker when the mentor dies', () => {
    const s = fresh(42);
    const away = GUIDE.find((g) => g.id === 'away')!;
    expect(away.when(s)).toBe(false);
    tick(s, newCtx(true));
    expect(away.when(s)).toBe(true);
    expect(mentorKicker(s)).toBe('DECIMVS CASSIVS ADVISES');
    s.counters.mentorDiedDay = s.day;
    expect(mentorKicker(s)).toBe('FROM THE NOTES OF DECIMVS CASSIVS');
  });
  it('writes every tip from state without holes', () => {
    for (const s of [fresh(42), run(fresh(3), 200)]) {
      for (const g of GUIDE) expect(g.text(s)).not.toMatch(/undefined|NaN|\[object/);
    }
    // the welcome names the colony (F17: the camp is run by hand, the Ordo carries what is mastered)
    expect(GUIDE[0].text(fresh(42))).toMatch(/^I am Decimus Cassius, once primus pilus\. Castra Valeria is yours to run by hand/);
  });
  it('shows welcome on day 1 and vitals before day 10 when each tip is read (seed 42)', () => {
    const shown = play(fresh(42), 30);
    expect(shown.welcome).toBe(1);
    expect(shown.vitals).toBeLessThan(10);
    expect(shown.ordo).toBeGreaterThan(shown.vitals!);
  });
});

describe.runIf(INTEGRATED)('the first ten minutes (DESIGN §11.12, seed 42, decision bot)', () => {
  it('follows the beat sheet', async () => {
    const path = './autoplayer';
    const { makeBot } = (await import(/* @vite-ignore */ path)) as { makeBot(kind: 'decision', seed: number): { step(s: GameState): void } };
    const s = fresh(42);
    const bot = makeBot('decision', 42);
    const raised: Record<string, number> = {};
    const cleared: Record<string, number> = {};
    const shown = play(s, 300, (x) => {
      bot.step(x);
      for (const [id, m] of Object.entries(x.guidance.advisories)) {
        if (m?.active && raised[id] === undefined) raised[id] = elapsed(x);
        if (m && !m.active && raised[id] !== undefined && cleared[id] === undefined) cleared[id] = elapsed(x);
      }
    });
    expect(shown.welcome).toBeLessThanOrEqual(1);
    expect(shown.vitals).toBeLessThan(10);
    expect(raised['aquarum.aestas.forecast']).toBeLessThanOrEqual(3);          // day 2: the first advisory
    expect(cleared['aquarum.aestas.forecast']).toBeLessThanOrEqual(45);        // the cistern is finished
    expect(shown.charter).toBeGreaterThanOrEqual(10);
    expect(s.guidance.appointed).toContain('augur');                          // Kal. Sept.
    expect(s.buildings.some((b) => b.type === 'horreum' && b.status === 'done')).toBe(true);
  });
});

describe('the opening lessons (DESIGN §11.13)', () => {
  const PARTS: IntroPart[] = ['ticker', 'portraits', 'souls', 'coin', 'materials', 'goals', 'dignitas', 'overlays', 'speed',
    'catalog', 'mandates', 'edicts', 'council', 'advisors', 'build', 'people', 'annals'];
  const lessoned = (seed = 42): GameState => newGame({ seed, now: 0, intro: true });
  /** Plays `ms` of real time in one go (the UI loop calls introStep every frame) and returns what changed. */
  const play = (s: GameState, ms: number): IntroStep => { s.stats.playMs += ms; return introStep(s); };
  const breather = (s: GameState): number => LESSONS[s.guidance.intro.lesson].breather * 1000;
  /** Skips lessons until `id` is the current one. */
  const toLesson = (s: GameState, id: string): void => {
    while (currentLesson(s)?.lesson.id !== id) { skipLesson(s); play(s, breather(s)); }
  };
  /** Places a work by the player's hand on the best plot and plays days until it stands. */
  const raise = (s: GameState, type: 'cisterna' | 'area'): void => {
    const slot = bestSlot(s, type, { owner: 'player' })!;
    expect(place(s, type, slot.tile).ok).toBe(true);
    for (let i = 0; i < 120 && !s.buildings.some((b) => b.type === type && b.owner === 'player' && b.status === 'done'); i++) run(s, 1);
  };

  it('leaves a colony without lessons as it was: every part shows and the Ordo holds every duty', () => {
    const s = fresh(42);
    expect(introRunning(s)).toBe(false);
    for (const p of PARTS) expect(introduced(s, p), p).toBe(true);
    expect(s.ordo.on.build).toBe(true);
    for (const d of DUTIES) { expect(granted(s, d), d).toBe(true); expect(learned(s, d), d).toBe(true); }
  });
  it('founds a colony run by hand on the map, the vitals, the date, pause and 1×, with the roll of souls for the first job', () => {
    const s = lessoned();
    expect(currentLesson(s)?.lesson.id).toBe('fields');
    for (const p of PARTS) expect(introduced(s, p), p).toBe(p === 'people');
    expect(introduced(s, 'trade')).toBe(true);                       // not a lesson's: Vicus reveals it
    for (const d of DUTIES) expect(granted(s, d), d).toBe(false);
    expect(s.ordo.learned).toEqual([]);
    expect(s.ordo.manual).toMatchObject({ water: 2, food: 1, builders: B.duties.START_BUILDERS });   // the founders stay at their posts
  });
  it('ends the first job when the player has put hands on the fields, and that teaches staffing', () => {
    const s = lessoned();
    expect(LESSONS[0].progress!(s)).toBe(`Hands on the fields: 1 of ${B.intro.FIELD_HANDS}`);
    expect(setManualTarget(s, 'food', B.intro.FIELD_HANDS).ok).toBe(true);
    expect(learned(s, 'labour')).toBe(true);
    expect(introStep(s)).toBeNull();                                 // the hands go to the fields with the next day
    run(s, 1);
    expect(introStep(s)).toBe('done');
  });
  it('ends a building job when the work stands, not when it is staked, and shows how far it has come', () => {
    const s = lessoned();
    toLesson(s, 'water');
    const slot = bestSlot(s, 'cisterna', { owner: 'player' })!;
    place(s, 'cisterna', slot.tile);
    expect(introStep(s)).toBeNull();
    expect(currentLesson(s)!.lesson.progress!(s)).toMatch(/^(Staked|Planned|Rising · \d+%)/);
    run(s, 3);
    raise(s, 'cisterna');
    expect(introStep(s)).toBe('done');
    expect(learned(s, 'water')).toBe(true);
  });
  it('waits a breather of real time after a job, never game days; "Begin now" skips the wait', () => {
    const s = lessoned();
    toLesson(s, 'water');
    raise(s, 'cisterna');
    expect(introStep(s)).toBe('done');
    run(s, 400);                                                     // a year of game days at any speed brings nothing
    expect(introStep(s)).toBeNull();
    expect(currentLesson(s)?.lesson.id).toBe('water');
    expect(play(s, breather(s) - 1)).toBeNull();
    expect(play(s, 1)).toBe('next');
    expect(currentLesson(s)?.lesson.id).toBe('homes');
    expect(introduced(s, 'souls')).toBe(true);
    s.res.timber = Math.max(s.res.timber, 20);                        // the idle year's renovations spent the camp's timber
    raise(s, 'area');
    introStep(s);
    expect(beginNextLesson(s).ok).toBe(true);
    expect(currentLesson(s)?.lesson.id).toBe('ordo');
  });
  it('counts a job only when the player does it: not a cistern the Ordo raises, nor one it raised on request', () => {
    const s = lessoned();
    toLesson(s, 'water');
    const slot = bestSlot(s, 'cisterna', { owner: 'ordo' })!;
    expect(place(s, 'cisterna', slot.tile, { owner: 'ordo' }).ok).toBe(true);
    run(s, 60);
    expect(s.buildings.some((b) => b.type === 'cisterna' && b.owner === 'ordo' && b.status === 'done')).toBe(true);
    expect(introStep(s)).toBeNull();
    expect(learned(s, 'water')).toBe(false);
    raise(s, 'cisterna');
    expect(introStep(s)).toBe('done');
  });
  it('lets a player stuck on a job skip that step, and nothing else', () => {
    const s = lessoned();
    expect(skipLesson(s).ok).toBe(true);
    expect(introStep(s)).toBeNull();                                 // the breather starts now
    play(s, breather(s));
    expect(currentLesson(s)?.lesson.id).toBe('water');
    expect(s.ordo.on.build).toBe(false);
    expect(s.ordo.learned).toEqual([]);
  });
  it('raises nothing the Ordo does not hold; its lesson offers the duties learned, and one handed over is the job', () => {
    const s = lessoned();
    run(s, 100, () => { introStep(s); });
    // only what the Lex de annona raises against famine or drought (a well when Aestas dries a well too few)
    for (const b of s.buildings.filter((x) => x.owner === 'ordo')) expect(['survivalFood', 'survivalWater']).toContain(b.reason?.code);
    expect(s.stats.deathsBy.hunger + s.stats.deathsBy.thirst).toBe(0);   // the Lex de annona sends hands to the fields
    expect(s.log.some((e) => /Lex de annona: our stores hold only/.test(e.text))).toBe(true);
    toLesson(s, 'water');
    raise(s, 'cisterna');
    toLesson(s, 'ordo');
    expect(introduced(s, 'mandates')).toBe(true);
    expect(pendingOffers(s)).toEqual(['water']);
    expect(introStep(s)).toBeNull();
    expect(setDuty(s, 'food', true).ok).toBe(false);                 // not learned: nothing to hand over
    expect(setDuty(s, 'water', true).ok).toBe(true);
    expect(introStep(s)).toBe('done');
    expect(s.ordo.on.build).toBe(true);
    expect(granted(s, 'water')).toBe(true);
    expect(granted(s, 'food')).toBe(false);
  });
  it('ends the Ordo\'s lesson as well when the player keeps every duty', () => {
    const s = lessoned();
    setManualTarget(s, 'food', 4);
    toLesson(s, 'ordo');
    expect(pendingOffers(s)).toEqual(['labour']);
    expect(keepDuties(s).ok).toBe(true);
    expect(introStep(s)).toBe('done');
    expect(granted(s, 'labour')).toBe(false);
    expect(pendingOffers(s)).toEqual([]);
  });
  it('brings every part, at most three a lesson, one lesson at a time; the reward\'s part once the job is done', () => {
    const s = lessoned();
    const seen = new Set<IntroPart>();
    for (const [i, l] of LESSONS.entries()) {
      expect(s.guidance.intro.lesson).toBe(i);
      expect(l.brings.length).toBeLessThanOrEqual(3);
      for (const p of l.brings) { expect(introduced(s, p), p).toBe(true); expect(seen.has(p), p).toBe(false); seen.add(p); }
      for (const p of l.rewardBrings ?? []) expect(introduced(s, p), `${p} before the job`).toBe(false);
      for (const p of PARTS) if (!seen.has(p) && !(l.rewardBrings ?? []).includes(p)) expect(introduced(s, p), `${p} in ${l.id}`).toBe(false);
      expect(skipLesson(s).ok).toBe(true);
      for (const p of l.rewardBrings ?? []) { expect(introduced(s, p), p).toBe(true); seen.add(p); }
      play(s, l.breather * 1000);
    }
    expect(introRunning(s)).toBe(false);
    for (const p of PARTS) expect(introduced(s, p), p).toBe(true);
    for (const t of INTRO_TIPS) expect(s.guidance.tips).toContain(t);   // what the lessons taught is not told twice
  });
  it('offers in Aedificia only the works the lessons have asked for, until the full list opens with its lesson', () => {
    const s = lessoned();
    expect(taughtWorks(s)).toEqual([]);
    toLesson(s, 'water');
    expect(taughtWorks(s)).toEqual(['cisterna']);
    expect(introduced(s, 'catalog')).toBe(false);
    skipLesson(s); play(s, breather(s));
    expect(taughtWorks(s)).toEqual(['cisterna', 'area']);
    for (const id of ['cisterna', 'area'] as const) expect(plainWork(id)).toBeTruthy();
    toLesson(s, 'works');
    expect(introduced(s, 'catalog')).toBe(true);
    expect(introStep(s)).toBeNull();
    raise(s, 'cisterna');                                            // a work already taught does not end it
    expect(introStep(s)).toBeNull();
    const slot = bestSlot(s, 'puteus', { owner: 'player' })!;
    expect(place(s, 'puteus', slot.tile).ok).toBe(true);
    expect(introStep(s)).toBe('done');
  });
  it('skips at once: every part shows, every duty is learned and offered, the tips the lessons teach are read', () => {
    const s = lessoned();
    expect(skipIntro(s).ok).toBe(true);
    expect(introRunning(s)).toBe(false);
    expect(s.ordo.on.build).toBe(false);                             // the player knows the camp: theirs to hand over
    expect(s.ordo.learned).toEqual([...DUTIES]);
    expect(pendingOffers(s)).toEqual([...DUTIES]);
    expect(handOverAll(s).ok).toBe(true);
    for (const d of DUTIES) expect(granted(s, d), d).toBe(true);
    for (const p of PARTS) expect(introduced(s, p), p).toBe(true);
    for (const t of INTRO_TIPS) expect(s.guidance.tips).toContain(t);
    expect(s.guidance.tips).not.toContain('aestas');
  });
  it('quiets the mentor\'s tips while the lessons run, but not the urgent ones', () => {
    const s = lessoned();
    run(s, 20);
    expect(nextTip(s)).toBeNull();                                   // vitals, ordo …: the lessons have the card
    s.choice = { event: 'legatus', kicker: '', title: 'The Legate writes', text: '', defaultIndex: 0, created: s.day, expires: s.day + 30, options: [{ label: 'Agree', note: '', key: 'a' }] };
    expect(nextTip(s)?.id).toBe('event');
  });
  it('keeps the lessons and the duties through a save, and never trusts a lesson begun in the future', () => {
    const s = lessoned();
    notePractice(s, 'speed');
    setManualTarget(s, 'food', 3);
    s.guidance.intro.at = s.stats.playMs + 1e9;
    const back = deserialize(serialize(s))!;
    expect(back.guidance.intro.lesson).toBe(0);
    expect(back.guidance.intro.practice).toEqual(['speed']);
    expect(back.guidance.intro.at).toBeLessThanOrEqual(back.stats.playMs);
    expect(back.ordo.on.build).toBe(false);
    expect(back.ordo.learned).toEqual(['labour']);
    expect(back.ordo.works).toEqual(s.ordo.works);
  });
  it('says each lesson in a few words: a reason and an imperative, a short job, a short payoff', () => {
    const s = lessoned();
    const words = (x: string): number => x.split(/\s+/).filter(Boolean).length;
    for (const l of LESSONS) {
      for (const text of [l.text(s), l.reward, l.job]) expect(text).not.toMatch(/undefined|NaN|\[object/);
      expect(words(l.text(s)), l.id).toBeLessThanOrEqual(14);
      expect(words(l.job), l.id).toBeLessThanOrEqual(5);
      expect(words(l.reward), l.id).toBeLessThanOrEqual(16);
    }
  });
});

describe('hints', () => {
  it('tells how to get more grain from the registry, the markets and the live colony', () => {
    const s = run(fresh(42), 2);
    const lines = howToGetMore(s, 'grain', view(s));
    expect(lines[0]).toMatch(/^Fields: 6 a day for each of 6 hands, best in Aestas \(×1\.3\)\.$/);
    expect(lines).toContain('Idle hands forage 0.3 a day each.');
    expect(lines.some((l) => /^You have a field \(\d+ of 6 hands\)\. Next: (staff \d+ more, or )?raise a 2nd \(50 den, 20 timber\)\.$/.test(l))).toBe(true);
    expect(howToGetMore(s, 'wine', view(s)).join(' ')).toMatch(/would sell it once our caravans reach it/);
    expect(benefitLine('horreum')).toBe('+4,000 safe grain storage');
  });
  it('puts the spoken article before an ordinal: a 2nd, an 8th, an 11th, an 18th, an 80th, a 100th', () => {
    const said = [2, 3, 7, 8, 11, 12, 18, 21, 80, 88, 100, 110, 800, 1800, 11000, 18000].map(anOrdinal);
    expect(said).toEqual(['a 2nd', 'a 3rd', 'a 7th', 'an 8th', 'an 11th', 'a 12th', 'an 18th', 'a 21st', 'an 80th', 'an 88th', 'a 100th',
      'a 110th', 'an 800th', 'a 1800th', 'an 11000th', 'an 18000th']);
    const s = run(fresh(42), 2);
    const ager = s.buildings.filter((b) => b.type === 'ager');
    for (let k = 0; k < 6; k++) s.buildings.push({ ...ager[0], id: 9000 + k });   // seven fields: "raise an 8th"
    expect(howToGetMore(s, 'grain', view(s)).some((l) => / raise an 8th \(/.test(l))).toBe(true);
  });
  it('teaches timber from the woods a free road fells (§3.7)', () => {
    const s = run(fresh(42), 2);
    const lines = howToGetMore(s, 'timber', view(s));
    expect(lines[0]).toMatch(/^Lumber camp: /);
    expect(lines).toContain('Lay a road through the woods (free): the felled trees go to the stores, up to 100 timber a pace.');
    expect(howToGetMore(s, 'stone', view(s)).join(' ')).not.toMatch(/road through the woods/);
  });
  it('says when a full store\'s building is not yet granted (R03)', () => {
    const s = run(fresh(42), 2);
    s.res.timber = 300;
    expect(howToGetMore(s, 'timber', view(s)).at(-1)).toBe('The stores are full (300 of 300): a warehouse adds room. Rome grants it to a Vicus.');
    s.rank = 1;
    expect(howToGetMore(s, 'timber', view(s)).at(-1)).toBe('The stores are full (300 of 300): a warehouse adds room.');
  });
  it('names a shrine in the wants tip only when a shrine is what the first waiting house wants (R03)', () => {
    const wants = GUIDE.find((g) => g.id === 'wants')!;
    const s = fresh(42);
    dryHouse(s);                                                        // a home that waits, beyond the founders' well
    let checked = 0;
    run(s, 900, (st, _c, i) => {
      if (i % 30 !== 0 || !wants.when(st)) return;
      const text = wants.text(st);
      const religion = /the first wants a shrine/.test(text);
      expect(/A shrine within \d+ steps/.test(text)).toBe(religion);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });
  it('shows the output chain with hands, per hand and the day\'s total', () => {
    const s = run(fresh(42), 2);
    const chain = outputChain(s, s.buildings.find((b) => b.type === 'ager')!);
    expect(chain[0].label).toBe('Hands');
    expect(chain[0].value).toMatch(/^\d of 6$/);
    expect(chain[1]).toEqual({ label: 'Per hand', value: '6' });
    expect(chain[chain.length - 1].value).toMatch(/modii a day$/);
    expect(outputChain(s, s.buildings.find((b) => b.type === 'principia')!)).toEqual([]);
  });
});
