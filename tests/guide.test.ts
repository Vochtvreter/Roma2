// tests/guide.test.ts — the mentor's tip graph and engine, the first days with seed 42, the DESIGN §11.12 beat sheet
// with WP-J's decision bot (INTEGRATED), and the hints (ARCHITECTURE §14.2 WP-E, §15). Owner: WP-E.
import { describe, expect, it } from 'vitest';
import { TIPS } from '../src/game/types';
import type { GameState, TipId } from '../src/game/types';
import { INTEGRATED, fresh, run } from './util';
import { elapsed } from '../src/game/calendar';
import { newCtx, tick, view } from '../src/game/sim';
import { GUIDE, dismissTip, mentorKicker, nextTip, pruneGuide } from '../src/game/guide';
import { benefitLine, howToGetMore, outputChain } from '../src/game/hints';

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
  it('holds the 20 tips once each, welcome first, every `after` an earlier tip', () => {
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
  it('shows welcome first, then vitals from elapsed 2 once welcome is read', () => {
    const s = fresh(42);
    expect(nextTip(s)?.id).toBe('welcome');
    run(s, 2);
    expect(nextTip(s)?.id).toBe('welcome');
    expect(dismissTip(s, 'welcome').ok).toBe(true);
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
    expect(GUIDE[0].text(fresh(42))).toMatch(/^I am Decimus Cassius, once primus pilus\. The Ordo runs Castra Valeria/);
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
