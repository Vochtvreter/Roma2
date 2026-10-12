// tests/voice.test.ts — what waits on the player and the one action each item offers (DESIGN §15.7): the Breviarium's
// "Awaiting you" (ui/tray.ts) and the phone voice line's chip (counsel.ts voiceAction). Headless: counsel.ts touches no
// DOM at import, and these helpers are pure over the state.
import { describe, expect, it } from 'vitest';
import type { AdvisoryMemo, GameState, Remedy, RuleId, Severity } from '../src/game/types';
import type { Game } from '../src/ui/types';
import { awaitAction, awaitingItems, pickCounsel, remedyChip, voiceAction } from '../src/ui/counsel';
import type { AwaitItem, CounselItem, RenderedRemedy } from '../src/ui/counsel';
import { checkRemedy } from '../src/game/advisors/remedies';
import { DEFAULT_PREFS } from '../src/game/save';
import { emptyRates } from '../src/game/sim';
import { newGame } from '../src/game/state';
import { skipIntro } from '../src/game/actions';
import { pendingOffers } from '../src/game/ordo/duties';
import { LESSONS } from '../src/game/intro';
import { fresh } from './util';

function fakeGame(s: GameState): Game {
  return { state: s, view: { placing: null, overlay: 'none' }, prefs: DEFAULT_PREFS, rates: emptyRates(), speed: 1, paused: false, mode: 'game', modalOpen: false } as unknown as Game;
}

/** A quiet colony: no advisory, no dispatch, the charter already chosen (else Rome would hear it from the first day). */
function quiet(seed = 42): GameState {
  const s = fresh(seed);
  s.guidance.advisories = {};
  s.choice = null;
  s.decisions.paths.charter = 'veterani';
  return s;
}

/** Raises an advisory by hand: the rule's own remedies are rendered from these params. */
function raise(s: GameState, rule: RuleId, sev: Severity, params: Record<string, number | string>): void {
  const memo: AdvisoryMemo = { rule, active: true, sev, since: s.day, lowerSince: null, params, flips: [] };
  s.guidance.advisories[rule] = memo;
}

const RUNOUT = { R: 4, cons: 10, need: 10, fix: 0, pot: 6, prod: 6 };   // the wells could not cover it: another well first
const DECLINING = { n: 2, need: '', d: 5 };                              // homes declining, no lapsed need: the Domus overlay only

describe('awaitingItems', () => {
  it('is empty in a quiet colony', () => {
    expect(awaitingItems(quiet())).toEqual([]);
  });

  it('orders Periculum, the dispatch, Cave, the chores to answer, then the petition', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    skipIntro(s);   // every chore learned, none answered; Edicta on the bar
    s.guidance.advisories = {};
    raise(s, 'aedilis.declining', 2, DECLINING);
    raise(s, 'aquarum.water.runout', 3, RUNOUT);
    s.choice = { event: 'veterans', kicker: 'NVNTIVS', title: 'Veterans at the gate', text: '', options: [], defaultIndex: 0, created: s.day, expires: s.day + 20 } as unknown as GameState['choice'];
    const items = awaitingItems(s);
    expect(items.map((x) => (x.kind === 'advisory' ? `${x.kind}:${x.a.memo.sev}` : x.kind)))
      .toEqual(['advisory:3', 'event', 'advisory:2', 'offer', 'petition']);
    const offer = items.find((x) => x.kind === 'offer');
    expect(offer?.kind === 'offer' && offer.duties).toEqual(pendingOffers(s));
    const ev = items.find((x) => x.kind === 'event');
    expect(ev).toMatchObject({ title: 'Veterans at the gate', expires: s.day + 20 });
  });

  it('leaves out Monitum, Nota and the Opportunitas, and the petition while Edicta is not yet on the bar', () => {
    const s = quiet();
    raise(s, 'aquarum.water.runout', 1, RUNOUT);
    raise(s, 'augur.petition', 1, { rank: 1, lacking: '', eta: 0 });
    expect(awaitingItems(s)).toEqual([]);
    const lessons = newGame({ seed: 42, now: 0, intro: true });   // lesson I: the charter is Rome's to hear, Edicta not shown
    expect(awaitingItems(lessons).some((x) => x.kind === 'petition')).toBe(false);
    skipIntro(lessons);
    expect(awaitingItems(lessons).some((x) => x.kind === 'petition')).toBe(true);
  });

  it('keeps a chore learned in lesson I waiting until the lessons bring the Mandata (lesson IV), as the card and Edicta do', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    s.ordo.learned = ['labour'];   // lesson I's manual labour target learns the chore (ordo/actions.ts setManualTarget)
    expect(pendingOffers(s)).toEqual(['labour']);
    const offered = (): boolean => awaitingItems(s).some((x) => x.kind === 'offer');
    expect(offered()).toBe(false);
    s.guidance.intro.lesson = LESSONS.findIndex((l) => l.brings.includes('mandates'));   // the Ordo's lesson: hand it one
    s.guidance.intro.done = false;
    expect(offered()).toBe(true);
    const later = newGame({ seed: 42, now: 0, intro: true });
    later.ordo.learned = ['labour'];
    skipIntro(later);
    expect(awaitingItems(later).some((x) => x.kind === 'offer')).toBe(true);
  });
});

describe('remedyChip', () => {
  const s = quiet();
  const ok = { ok: true } as const;
  const no = { ok: false, code: 'unaffordable', reason: 'Too dear.' } as const;
  const well: Remedy = { kind: 'place', building: 'puteus', tile: 4321 };
  const ask: Remedy = { kind: 'ask', building: 'puteus' };
  const hands: Remedy = { kind: 'assign', cat: 'water', n: 2 };
  const domus: Remedy = { kind: 'overlay', overlay: 'domus' };
  const r = (remedy: Remedy, label: string, check: RenderedRemedy['check'] = ok): RenderedRemedy => ({ remedy, label, check });
  const rows: { name: string; list: RenderedRemedy[]; first: boolean; want: { label: string; remedy: Remedy } | null }[] = [
    { name: 'a place remedy is Place', list: [r(well, 'Place a well')], first: false, want: { label: 'Place', remedy: well } },
    { name: 'ask runs the place remedy of the same building, at its tile', list: [r(ask, 'Ask the Ordo'), r(well, 'Place a well')], first: false, want: { label: 'Place', remedy: well } },
    { name: 'ask alone places the building', list: [r(ask, 'Ask the Ordo')], first: false, want: { label: 'Place', remedy: { kind: 'place', building: 'puteus' } } },
    { name: 'the voice line skips hands for the building', list: [r(hands, 'Put 2 at the wells'), r(well, 'Place a well')], first: false, want: { label: 'Place', remedy: well } },
    { name: 'a row offers the first remedy, hands', list: [r(hands, 'Put 2 at the wells'), r(well, 'Place a well')], first: true, want: { label: 'Put 2 at the wells', remedy: hands } },
    { name: 'no spatial remedy: no voice chip', list: [r(domus, 'Show the Domus overlay')], first: false, want: null },
    { name: 'no spatial remedy: the row offers the overlay', list: [r(domus, 'Show the Domus overlay')], first: true, want: { label: 'Show the Domus overlay', remedy: domus } },
    { name: 'nothing to offer', list: [], first: true, want: null },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const chip = remedyChip(row.list, row.first, s);
      if (!row.want) { expect(chip).toBeNull(); return; }
      expect(chip).toMatchObject({ kind: 'remedy', label: row.want.label, remedy: row.want.remedy });
    });
  }

  it('carries the check of the remedy it runs: a place remedy checked afresh, any other as rendered', () => {
    const place = remedyChip([r(well, 'Place a well', no)], false, s);
    const fresh = checkRemedy(s, well);
    expect(place).toMatchObject({ ok: fresh.ok, reason: fresh.ok ? '' : fresh.reason });
    expect(remedyChip([r(hands, 'Put 2 at the wells', no)], true, s)).toMatchObject({ ok: false, reason: 'Too dear.' });
    expect(remedyChip([r(hands, 'Put 2 at the wells', ok)], true, s)).toMatchObject({ ok: true, reason: '' });
  });
});

describe('voiceAction', () => {
  it('names one chip per kind of item', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    const lesson = pickCounsel(fakeGame(s));
    expect(lesson.kind).toBe('lesson');
    const first = LESSONS[0];
    expect(voiceAction(lesson, s)).toEqual(first.tab || first.target ? { kind: 'lesson', label: 'Show me', lesson: first.id } : null);
    const table: [CounselItem | AwaitItem, ReturnType<typeof voiceAction>][] = [
      [{ kind: 'offer', duties: ['food'] }, { kind: 'open', label: 'Review', tab: 'council', anchor: 'mandates' }],
      [{ kind: 'event', title: 'Veterans at the gate', expires: s.day + 9 }, { kind: 'event', label: 'Read' }],
      [{ kind: 'petition', decision: 'charter', rank: null, affordable: true }, { kind: 'open', label: 'Petition', tab: 'council', anchor: 'petition' }],
      [{ kind: 'calm' }, null],
      [{ kind: 'lesson', l: first, index: 0, done: true, nudge: false, stuck: false }, null],   // the breather: Begin now is the card's
    ];
    for (const [item, want] of table) expect(voiceAction(item, s)).toEqual(want);
  });

  it('places the remedy of a Periculum or Cave with a building remedy, and offers none for gentler or non-spatial counsel', () => {
    const s = quiet();
    raise(s, 'aquarum.water.runout', 3, RUNOUT);
    const peril = awaitingItems(s)[0];
    expect(peril.kind).toBe('advisory');
    const chip = voiceAction(peril, s);
    expect(chip).toMatchObject({ kind: 'remedy', label: 'Place' });
    expect(chip?.kind === 'remedy' && chip.remedy.kind).toBe('place');
    expect(awaitAction(peril, s)).toEqual(chip);   // the well is its first remedy too
    raise(s, 'aquarum.water.runout', 1, RUNOUT);   // a Monitum: the card's to show, not a chip
    const monitum = { kind: 'advisory', a: { rule: 'aquarum.water.runout', advisor: 'aquarum', memo: s.guidance.advisories['aquarum.water.runout']! } } as const;
    expect(voiceAction(monitum, s)).toBeNull();
    raise(s, 'aedilis.declining', 2, DECLINING);   // Cave, but its only remedy is an overlay
    const cave = awaitingItems(s).find((x) => x.kind === 'advisory' && x.a.rule === 'aedilis.declining')!;
    expect(voiceAction(cave, s)).toBeNull();
    expect(awaitAction(cave, s)).toMatchObject({ kind: 'remedy', remedy: { kind: 'overlay', overlay: 'domus' } });
  });
});
