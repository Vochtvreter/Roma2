// src/render/linear.ts — streets, roads, walls, gates, fossa, aqueduct, via (ARCHITECTURE §12.2). Owner: WP-F.
// SCAFFOLD (debug): roads as flat dirt/paved tiles with an edge, walls and gates as coloured tiles, aqueduct routes as a
// blue line. WP-F replaces this with the procedural autotile and the l_* sprites.
import type { GameState, Rect } from '../game/types';
import { W, getMap } from '../game/map';
import { derived } from '../game/derived';
import { TILE } from './camera';
import { MAP_COLORS } from './terrain';

const WALL_TIMBER = '#8a6b4a';
const WALL_STONE = '#b8a582';
const GATE = '#c99a3b';
const AQUEDUCT = '#3d7fa6';

/** Draws dirt and paved road tiles in view (world-px transform applied). */
export function drawRoads(g: CanvasRenderingContext2D, s: GameState, vis: Rect): void {
  const road = derived(s).road;
  for (let y = vis.y; y < vis.y + vis.h; y++)
    for (let x = vis.x; x < vis.x + vis.w; x++) {
      const r = road[y * W + x];
      if (!r) continue;
      g.fillStyle = r === 2 ? MAP_COLORS.pavedEdge : MAP_COLORS.dirtEdge;
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      g.fillStyle = r === 2 ? MAP_COLORS.paved : MAP_COLORS.dirt;
      g.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
    }
}

/** Draws the castrum wall ring (palisade, murus from Oppidum) and its gates, and aqueduct routes. */
export function drawWalls(g: CanvasRenderingContext2D, s: GameState, vis: Rect): void {
  const sv = getMap(s.seed).survey;
  const wallCol = s.rank >= 2 ? WALL_STONE : WALL_TIMBER;
  for (let y = vis.y; y < vis.y + vis.h; y++)
    for (let x = vis.x; x < vis.x + vis.w; x++) {
      const w = sv.wall[y * W + x];
      if (!w) continue;
      g.fillStyle = '#1d1410';
      g.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
      g.fillStyle = w === 2 ? GATE : wallCol;
      g.fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6);
    }
  g.strokeStyle = AQUEDUCT;
  g.lineWidth = 3;
  for (const b of s.buildings) {
    if (!b.route || b.route.length < 2) continue;
    g.beginPath();
    b.route.forEach((t, k) => {
      const cx = (t % W) * TILE + TILE / 2, cy = Math.floor(t / W) * TILE + TILE / 2;
      if (k === 0) g.moveTo(cx, cy); else g.lineTo(cx, cy);
    });
    g.stroke();
  }
}
