// tests/panels.test.ts — WP-I: side-panel signatures hold only discrete data (ARCHITECTURE §13.3, §14.2 WP-I acceptance).
// Headless: imports the tab modules' signature/badge functions only (no DOM is touched at import or in a signature).
import { describe, expect, it } from 'vitest';
import { TABS } from '../src/game/types';
import type { GameState } from '../src/game/types';
import type { Game } from '../src/ui/types';
import { PANELS, panelTokens } from '../src/ui/panels';
import { emptyRates } from '../src/game/sim';
import { DEFAULT_PREFS } from '../src/game/save';
import { activeAdvisories, renderAdvisory } from '../src/game/advisors/engine';
import { councilReport } from '../src/game/ordo/index';
import { pendingOffers } from '../src/game/ordo/duties';
import { newGame } from '../src/game/state';
import { keepDuties, skipIntro } from '../src/game/actions';
import { view } from '../src/game/sim';
import { placeBuilding } from '../src/game/place';
import { B } from '../src/game/balance';
import { counselSig } from '../src/ui/counsel';
import { remedyKey, savingLine } from '../src/ui/tabs/common';
import { labourKey } from '../src/ui/tabs/labour';
import { fresh, run } from './util';

function fakeGame(s: GameState): Game {
  return { state: s, view: { placing: null, overlay: 'none' }, prefs: DEFAULT_PREFS, rates: emptyRates(), speed: 1, paused: false, mode: 'game', modalOpen: false } as unknown as Game;
}

/** Every discrete fact a panel may legitimately rebuild on; when none changed, no signature may change. */
function discrete(s: GameState): string {
  return JSON.stringify([
    s.rank, s.victory, s.buildings.map((b) => [b.id, b.status, b.owner, b.open, b.prio, b.house?.tier, b.house?.declining, b.house?.pref]),
    s.families.length, s.log.length, s.log[s.log.length - 1]?.text, s.decisions, s.ordo.on, s.ordo.pin, s.ordo.requests, s.ordo.priorities,
    s.ordo.emergency.rations, s.trade.contracts.map((c) => [c.id, c.status, c.pause]), s.trade.caravans.map((c) => c.id), s.trade.merchant,
    activeAdvisories(s).map((a) => [a.rule, a.memo.sev, a.memo.snoozeUntil]), s.guidance.appointed, s.guidance.muted, s.guidance.tips,
    Object.keys(s.guidance.milestoneDays), s.choice?.created, s.gate?.until,
    // the council's agenda (made in runOrdo before startStaked, so it trails a stake's status change by one tick)
    councilReport(s).agenda.map((w) => `${w.type}:${w.state}`),
    // which labour lines show (the builders' line goes the day after the last site stands, when its hands are released)
    labourKey(s),
    // NEW stickers expire NEW_DAYS after the milestone or rank that revealed them
    [...Object.values(s.guidance.milestoneDays), ...Object.values(s.decisions.pathDays)].map((d) => s.day - (d ?? 0) < B.ui.NEW_DAYS),
    // chores learned and not yet answered: Edicta leads with the Mandata and the offer's answer while any wait
    pendingOffers(s),
  ]);
}

function sigs(g: Game): string[] {
  return TABS.map((t) => PANELS[t].signature(g));
}

describe('panel signatures', () => {
  it('every tab has a panel with a Latin label, an English sub-label, an icon and a hotkey', () => {
    for (const t of TABS) {
      const p = PANELS[t];
      expect(p.id).toBe(t);
      expect(p.label.length).toBeGreaterThan(2);
      expect(p.sub.length).toBeGreaterThan(2);
      expect(p.icon).toBe(`i_tab_${t}`);
      expect(p.hotkey).toMatch(/^[A-Z]$/);
    }
    expect(new Set(TABS.map((t) => PANELS[t].hotkey)).size).toBe(TABS.length);
  });

  it('stay stable across ticks unless a discrete fact changed', () => {
    const s = fresh(42);
    const g = fakeGame(s);
    run(s, 3);
    let prev = sigs(g);
    let fp = discrete(s);
    let compared = 0;
    run(s, 120, () => {
      const now = sigs(g);
      const f = discrete(s);
      if (f === fp) { expect(now).toEqual(prev); compared++; }
      prev = now;
      fp = f;
    });
    expect(compared).toBeGreaterThan(20);
  });

  it('ignore continuous values: stocks, progress, morale, needs, prices, skills', () => {
    const s = fresh(7);
    const g = fakeGame(s);
    run(s, 5);
    const before = sigs(g);
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = s.res[r] * 1.37 + 3;
    s.morale = Math.min(100, s.morale + 9);
    s.fed = 0.95;
    s.needs.hunger = [3, 4, 5, 6];
    s.taxAccrued += 12;
    s.counters.coinEma += 1.5;
    s.stats.playMs += 60_000;
    for (const k of Object.keys(s.trade.market) as (keyof typeof s.trade.market)[]) s.trade.market[k] *= 1.1;
    for (const p of s.people) p.skills.agri = (p.skills.agri ?? 0) + 0.3;
    for (const b of s.buildings) if (b.status !== 'done') b.progress = Math.min(0.99, b.progress + 0.2);
    expect(sigs(g)).toEqual(before);
  });

  it('change on decisions, toggles and new log lines', () => {
    const s = fresh(3);
    const g = fakeGame(s);
    const [council, , build, people, , annals] = TABS.map((t) => PANELS[t]);
    const c0 = council.signature(g), b0 = build.signature(g), p0 = people.signature(g), a0 = annals.signature(g);
    s.decisions.edicts.rationes = 'parcae';
    s.decisions.focus = 'copia';
    expect(council.signature(g)).not.toBe(c0);
    s.ordo.on.build = false;
    expect(build.signature(g)).not.toBe(b0);
    s.ordo.on.labour = false;
    expect(people.signature(g)).not.toBe(p0);
    s.log.push({ day: s.day, kind: 'info', text: 'A test line.' });
    expect(annals.signature(g)).not.toBe(a0);
  });

  it('Edicta rebuilds when the duty offer is answered (the Mandata lead the tab only while one waits)', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    const g = fakeGame(s);
    skipIntro(s);   // a colony run by hand past the lessons: every chore learned, none handed over or kept
    expect(pendingOffers(s).length).toBeGreaterThan(1);
    const council = PANELS.council;
    const offered = council.signature(g);
    expect(council.signature(g)).toBe(offered);
    expect(keepDuties(s).ok).toBe(true);   // answered: nothing else about the duties changed
    expect(pendingOffers(s)).toEqual([]);
    expect(council.signature(g)).not.toBe(offered);
  });

  it('badges never throw and keep their shape', () => {
    const s = fresh(42);
    const g = fakeGame(s);
    run(s, 10);
    for (const t of TABS) {
      const b = PANELS[t].badge?.(g) ?? null;
      if (b) {
        expect(['info', 'warn', 'bad', 'gold']).toContain(b.kind);
        expect(b.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('contract form preview', () => {
  it('shows price, trip days and the gain before sending; refuses with a reason', async () => {
    const { preview } = await import('../src/ui/tabs/commercium');
    const s = fresh(42);
    s.rank = 1;
    const g = fakeGame(s);
    const ok = preview(g, { hub: 'durii', mode: 'export', res: 'timber', qty: 40, repeat: false });
    expect(ok.reason).toBeNull();
    expect(ok.lines[0]).toMatch(/den each \(base 3\)/);
    expect(ok.lines[1]).toMatch(/days each way/);
    expect(ok.lines[2]).toMatch(/base price/);
    const refused = preview(g, { hub: 'metellianus', mode: 'import', res: 'wine', qty: 20, repeat: false });
    expect(refused.reason).toMatch(/will not sell us wine/);
    s.rank = 0;
    const closed = preview(g, { hub: 'durii', mode: 'export', res: 'timber', qty: 40, repeat: false });
    expect(closed.reason).toMatch(/does not yet trade with us/);
  });
});

describe('remedy buttons follow the best plot (R15)', () => {
  it('once the Ordo builds on a place remedy\'s tile, the counsel card and Consiliarii signatures change', () => {
    const s = fresh(42);
    const g = fakeGame(s);
    run(s, 5);
    const placeOf = () => {
      for (const a of activeAdvisories(s)) {
        const x = renderAdvisory(s, view(s), a).remedies.find((y) => y.remedy.kind === 'place' && y.remedy.tile !== undefined);
        if (x && x.remedy.kind === 'place') return { a, x, tile: x.remedy.tile as number, type: x.remedy.building };
      }
      return null;
    };
    const before = placeOf();
    expect(before).not.toBeNull();
    if (!before) return;
    const item = { kind: 'advisory', a: before.a } as const;
    const c0 = counselSig(g, item), k0 = remedyKey(s, before.x), p0 = PANELS.advisors.signature(g);
    expect(placeBuilding(s, before.type, before.tile, { owner: 'ordo' }).ok).toBe(true);
    const after = placeOf();
    expect(after?.tile).toBeDefined();
    expect(after?.tile).not.toBe(before.tile);
    expect(counselSig(g, item)).not.toBe(c0);
    if (after) expect(remedyKey(s, after.x)).not.toBe(k0);
    expect(PANELS.advisors.signature(g)).not.toBe(p0);
  });

  it('a remedy key holds no live numbers', () => {
    const s = fresh(42);
    expect(remedyKey(s, { remedy: { kind: 'buyNow', res: 'grain', qty: 37 }, check: { ok: true } })).toBe('buyNow');
    expect(remedyKey(s, { remedy: { kind: 'contract', spec: { hub: 'metellianus', mode: 'import', res: 'grain', qty: 33, repeat: false } }, check: { ok: true } })).toBe('contract');
  });
});

describe('the Ordo\'s saving line (R16)', () => {
  const sv = { cost: { denarii: 250, timber: 100 }, for: 'petition' as const };

  it('says the target is set aside and ready once the stores cover it', () => {
    const s = fresh(42);
    const g = fakeGame(s);
    s.res.denarii = 3600;
    s.res.timber = 290;
    expect(savingLine(g, sv)).toBe('Set aside for the petition: 250 den · 100 timber, ready');
  });

  it('names only what is still lacking, never the whole target', () => {
    const s = fresh(42);
    const g = fakeGame(s);
    s.res.denarii = 3600;
    s.res.timber = 60;
    const line = savingLine(g, sv);
    expect(line).toMatch(/^Saving for the petition: 40 timber \(/);
    expect(line).not.toMatch(/den/);
  });
});

describe('runway display (R59, DESIGN §8.6)', () => {
  it('shows capacity in days under three weeks, weeks under four months, months above', async () => {
    const { fmtRunway } = await import('../src/ui/dom');
    expect(fmtRunway(1)).toBe('1 day');
    expect(fmtRunway(14.7)).toBe('14 days');
    expect(fmtRunway(B.ui.RUNWAY_WEEKS - 0.1)).toBe('20 days');
    expect(fmtRunway(B.ui.RUNWAY_WEEKS)).toBe('3 weeks');
    expect(fmtRunway(42)).toBe('6 weeks');
    expect(fmtRunway(B.ui.RUNWAY_MONTHS - 1)).toBe('17 weeks');
    expect(fmtRunway(B.ui.RUNWAY_MONTHS)).toBe('4 months');
    expect(fmtRunway(164)).toBe('5.5 months');
    expect(fmtRunway(null)).toBe('—');
    expect(fmtRunway(Infinity)).toBe('∞');
  });
});

describe('text slips (R48)', () => {
  it('a sentence that ends on a Roman date keeps one full stop', async () => {
    const { sentence, plural } = await import('../src/ui/dom');
    const { formatRoman } = await import('../src/game/calendar');
    const d = formatRoman(B.time.START_DAY);
    expect(d.endsWith('.')).toBe(true);
    expect(sentence(`You asked for a well on ${d}`)).toBe(`You asked for a well on ${d}`);
    expect(sentence('Hiems in 3 days')).toBe('Hiems in 3 days.');
    expect(plural(1, 'house', 'houses')).toBe('1 house');
  });
});

describe('panelTokens (#app[data-panel], what the stylesheets key on instead of #app:has(#side…))', () => {
  it('names each state that holds, in a fixed order, and nothing when none does', () => {
    expect(panelTokens(false, false, false)).toBe('');
    expect(panelTokens(true, false, false)).toBe('collapsed');
    expect(panelTokens(false, true, false)).toBe('empty');
    expect(panelTokens(false, false, true)).toBe('notabs');
    expect(panelTokens(true, true, true)).toBe('collapsed empty notabs');
    // each a whole token for [data-panel~='…']
    for (const [c, e, n] of [[true, false, true], [false, true, true], [true, true, false]] as const) {
      const toks = panelTokens(c, e, n).split(' ');
      expect(toks.includes('collapsed')).toBe(c);
      expect(toks.includes('empty')).toBe(e);
      expect(toks.includes('notabs')).toBe(n);
    }
  });
});
