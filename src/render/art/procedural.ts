// src/render/art/procedural.ts — registers the procedural art: seasonal fields and olive rows (fields.ts), forum stages,
// Capitolium and crowns (forum.ts), walls, gates, aqueduct, bridge and milestone (walls.ts), theatrum and thermae
// domes (domes.ts). Owner: WP-G (art, part 2). Everything is painted lazily on the first sprite() call.
import { registerGrid } from './brush';
import { ager, olivetum } from './fields';
import { FORUM_H, FORUM_W, forumStages } from './forum';

const SEASONS = [0, 1, 2, 3] as const;

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerProcedural(): void {
  // fields: the base name shows high summer (golden wheat, the Build-card look); @0..3 follow the seasons
  registerGrid('b_ager', 48, 48, () => ager(1), { outline: false });
  registerGrid('b_olivetum', 48, 48, () => olivetum(1), { outline: false });
  for (const s of SEASONS) {
    registerGrid(`b_ager@${s}`, 48, 48, () => ager(s), { outline: false });
    registerGrid(`b_olivetum@${s}`, 48, 48, () => olivetum(s), { outline: false });
  }
  for (const [name, build] of Object.entries(forumStages())) registerGrid(name, FORUM_W, FORUM_H, build, { outline: false });
}
