// tests/art-g2.test.ts — WP-G2's art groups (rural, procedural, nature, actors, icons): registration and palette checks.
// Headless: registration stores grids and draw functions only, and the procedural grids are built without a canvas.
import { describe, expect, it } from 'vitest';
import { hasSprite, spriteSize, validateArt } from '../src/render/sprites';
import { REQUIRED_SPRITES, registerAllArt } from '../src/render/art/index';
import { checkGrid, gridBuilders } from '../src/render/art/brush';

registerAllArt();

describe('WP-G2 art', () => {
  it('validateArt() reports nothing for the registered sprites', () => {
    expect(validateArt()).toEqual([]);
  });

  it('every procedural grid builds at its declared size with PAL keys only', () => {
    const bad: string[] = [];
    for (const [name, b] of gridBuilders()) {
      bad.push(...checkGrid(name, b.w, b.h, b.build()));
      const s = spriteSize(name);
      if (s.w !== b.w || s.h !== b.h) bad.push(`${name}: registered ${s.w}×${s.h}, built ${b.w}×${b.h}`);
    }
    expect(bad).toEqual([]);
  });

  it('registers every required name of the G2 groups (rural, procedural, nature, actors, icons)', () => {
    const rural = /^b_(ager|olivetum|venatio|pabulatio|lignarius|lapicidina|figlina|caementarium|fodina|officina|theatrum|thermae)(_logs)?(@\d)?$/;
    const mine = REQUIRED_SPRITES.filter((n) => /^(p_|n_|l_|a_|i_)/.test(n) || rural.test(n));
    expect(mine.length).toBeGreaterThan(150);
    expect(mine.filter((n) => !hasSprite(n))).toEqual([]);
  });

  it('keeps the fixed sizes of §12.3 and DESIGN §16.3', () => {
    const want: Record<string, [number, number]> = {
      b_ager: [48, 48], b_olivetum: [48, 48], b_lapicidina: [48, 40], b_venatio: [32, 26], b_pabulatio: [32, 22],
      b_lignarius: [32, 26], b_figlina: [32, 28], b_caementarium: [32, 26], b_fodina: [32, 28], b_officina: [32, 30],
      b_theatrum: [64, 56], b_thermae: [64, 64], p_forum_0: [144, 152], p_capitolium_4: [144, 96], p_crown_imperium: [32, 24],
      l_bridge: [16, 16], n_milestone: [6, 10], a_person_idle: [7, 10], a_child_idle: [5, 6], a_legionary_0: [9, 12],
      a_oxcart_0: [20, 12], a_mules_0: [24, 12], a_wagon_0: [24, 14], a_vettent: [16, 10], i_denarii: [12, 12],
    };
    for (const [n, [w, h]] of Object.entries(want)) expect(spriteSize(n), n).toEqual({ w, h });
  });

  it('registers the seasonal fields and oaks', () => {
    for (const base of ['b_ager', 'b_olivetum', 'n_oak_0', 'n_oak_1', 'n_oak_2'])
      for (const k of [0, 1, 2, 3]) expect(hasSprite(`${base}@${k}`), `${base}@${k}`).toBe(true);
  });
});
