// tests/art.test.ts — every REQUIRED_SPRITES name registered, validateArt() clean, DESIGN §16.3 sizes (ARCHITECTURE §15).
// Headless: registration stores grids and draw functions only, so no canvas is needed here.
import { describe, expect, it } from 'vitest';
import { REQUIRED_SPRITES, registerAllArt } from '../src/render/art/index';
import { hasSprite, spriteNames, spriteSize, validateArt } from '../src/render/sprites';
import { INTEGRATED } from './util';

registerAllArt();

/** Sprites drawn by the housing, civic, portrait and frame groups (G1), with their declared sizes (DESIGN §16.3). */
const G1_SIZES: Record<string, [number, number]> = {
  h_tentoria_0: [32, 20], h_tentoria_1: [32, 20], h_casa_0: [32, 24], h_casa_1: [32, 24],
  h_tegulata_0: [32, 26], h_tegulata_1: [32, 26], h_domusParva_0: [32, 30], h_domusParva_1: [32, 30],
  h_insula_0: [32, 44], h_insula_1: [32, 44], h_insula_aquae: [32, 52],
  h_domus_0: [32, 30], h_domus_1: [32, 30], h_domus_aquae: [32, 30],
  ov_scaffold: [32, 32], ov_cracks: [32, 24], ov_lanterns: [32, 12], ov_pegs: [16, 16], ov_trench: [16, 16],
  b_templum: [64, 72], b_macellum: [64, 56], b_balneum: [64, 52], b_horreum: [64, 40], b_apotheca: [64, 36], b_mansio: [64, 40],
  b_lararium: [32, 28], b_taberna: [32, 28], b_puteus: [32, 22], b_cisterna: [32, 22], b_castellum: [32, 32],
  b_lacus: [32, 24], b_hortus: [32, 24], b_fabrica: [32, 30],
  f_meander: [12, 12], f_seal: [16, 16], f_aquila: [32, 32],
};
const G1_PATTERN = /^(h_|ov_|pt_|f_)/;
const g1Required = REQUIRED_SPRITES.filter((n) => G1_PATTERN.test(n) || n in G1_SIZES);

describe('art (G1: housing, civic, portraits, frames)', () => {
  it('registers every required sprite of its groups', () => {
    expect(g1Required.length).toBe(57);                     // 14 houses, 5 overlays, 14 buildings, 21 portraits, 3 frames
    expect(g1Required.filter((n) => !hasSprite(n))).toEqual([]);
  });

  it('validateArt() is clean (ragged rows, unknown keys, duplicates, fixed sizes)', () => {
    expect(validateArt()).toEqual([]);
  });

  it('uses the declared sizes', () => {
    for (const [name, [w, h]] of Object.entries(G1_SIZES)) expect(spriteSize(name), name).toEqual({ w, h });
    for (const n of g1Required.filter((x) => x.startsWith('pt_'))) expect(spriteSize(n), n).toEqual({ w: 24, h: 24 });
  });

  it('registerAllArt() is idempotent', () => {
    const before = spriteNames().length;
    registerAllArt();
    expect(spriteNames().length).toBe(before);
    expect(validateArt()).toEqual([]);
  });
});

describe.runIf(INTEGRATED)('art (integrated: every group)', () => {
  it('registers every name of the frozen naming table', () => {
    expect(REQUIRED_SPRITES.filter((n) => !hasSprite(n))).toEqual([]);
  });
});
