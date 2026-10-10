// tests/art-g2.test.ts — WP-G2's art groups (rural, procedural, nature, actors, icons): registration and palette checks.
// Headless: registration stores grids and draw functions only, and the procedural grids are built without a canvas.
import { describe, expect, it } from 'vitest';
import { hasSprite, spriteSize, validateArt } from '../src/render/sprites';
import { registerAllArt } from '../src/render/art/index';
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

  it('registers the seasonal fields and oaks', () => {
    for (const base of ['b_ager', 'b_olivetum', 'n_oak_0', 'n_oak_1', 'n_oak_2'])
      for (const k of [0, 1, 2, 3]) expect(hasSprite(`${base}@${k}`), `${base}@${k}`).toBe(true);
  });
});
