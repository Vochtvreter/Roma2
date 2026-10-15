// tests/confirm.test.ts — confirms that are no timing puzzle (DESIGN §15.5): a permanent choice is asked by name in a
// dialog with no timeout (edicta.ts pathAsk for the charter and the paths), and a two-step confirm ignores a second
// press that comes as the other half of a double-click (modals.ts confirmPress). Headless: the pure helpers only (the
// buttons, the dialog and the holds need a browser).
import { describe, expect, it } from 'vitest';
import { PATH_DECISIONS } from '../src/game/types';
import { B } from '../src/game/balance';
import { PATH_DEFS } from '../src/game/data/decisions';
import { RANK_DEFS } from '../src/game/data/ranks';
import { confirmPress } from '../src/ui/modals';
import { pathAsk } from '../src/ui/tabs/edicta';

describe('confirmPress', () => {
  it('arms on the first press, waits through a double-click, runs on a deliberate second press', () => {
    expect(confirmPress(null, 5_000)).toBe('arm');
    expect(confirmPress(5_000, 5_000)).toBe('wait');
    expect(confirmPress(5_000, 5_000 + B.ui.CONFIRM_MIN_MS - 1)).toBe('wait');
    expect(confirmPress(5_000, 5_000 + B.ui.CONFIRM_MIN_MS)).toBe('run');
    expect(confirmPress(5_000, 5_000 + 60_000)).toBe('run');   // no timeout of its own: the button decides when it disarms
  });

  it('a double-click (well under half a second) never confirms; an armed button that drains gives far more than 3 s', () => {
    expect(B.ui.CONFIRM_MIN_MS).toBeGreaterThanOrEqual(400);
    expect(B.ui.CONFIRM_MIN_MS).toBeLessThan(1000);
    expect(B.ui.CONFIRM_MS).toBeGreaterThanOrEqual(8000);
  });
});

describe('pathAsk', () => {
  it('names every permanent choice, says what it does and what the town will show, and that it is for good', () => {
    for (const d of PATH_DECISIONS) {
      for (const o of PATH_DEFS[d].options) {
        const q = pathAsk(d, o.id, d === 'charter' ? null : { denarii: 900, stone: 250 });
        expect(q.title).toContain(o.name);
        expect(q.title.endsWith('?')).toBe(true);
        expect(q.lines).toContain(o.desc);
        if (o.visible) expect(q.lines).toContain(`You will see: ${o.visible}`);
        expect(q.lines[q.lines.length - 1]).toMatch(/^This is for good/);
        expect(q.lines.every((l) => l.length > 0)).toBe(true);
        expect(q.ok.length).toBeGreaterThan(0);
        expect(q.cancel).toBe('Not yet');
      }
    }
  });

  it('the charter is proclaimed, free; a path petitions Rome for its rank and names the fee', () => {
    const charter = pathAsk('charter', 'veterani', null);
    expect(charter.title).toBe('Proclaim Colonia veteranorum?');
    expect(charter.ok).toBe('Proclaim it');
    expect(charter.lines.some((l) => l.includes('fee'))).toBe(false);
    expect(charter.lines).toContain('This is for good: the charter is the first line of your story.');

    const path = pathAsk('path2', 'pietas', { denarii: 900, stone: 250 });
    expect(path.title).toBe(`Petition Rome for ${RANK_DEFS[2].name}: Pietas?`);
    expect(path.kicker).toBe('PETITIO · OPPIDVM');
    expect(path.ok).toBe('Petition Rome');
    expect(path.lines).toContain('Rome takes the fee: 900 den · 250 stone.');
  });
});
