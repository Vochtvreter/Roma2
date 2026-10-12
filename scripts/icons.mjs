// scripts/icons.mjs — paints the app's icons (public/icons/*.png, named in public/manifest.webmanifest and index.html)
// from the game's own pixel art: f_aquila's 32 × 32 rows (src/render/art/frames.ts), each art pixel a whole-number
// square, centred on the chrome's dark ground (#15100d, opaque: iOS fills a transparent icon with black). Run it once
// after the aquila changes and commit the PNGs: `node scripts/icons.mjs`. It loads the art through Vite's SSR loader
// (no browser, no canvas: registration stores the rows only) and writes the PNGs with node's zlib (tests/pwa.test.ts
// checks their sizes, their ground and that every art pixel is a whole square).
import { createServer } from 'vite';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');
const GROUND = [0x15, 0x10, 0x0d];
const ART = 32;
/** Each icon: its file, its square size, and the art's whole-number scale ((size − 32 × scale) / 2 px of ground on each
 *  side). The maskable one keeps the art inside the safe circle (80% of the side) a launcher's mask never cuts. */
const ICONS = [
  { file: 'apple-touch-icon-180.png', size: 180, scale: 5 },
  { file: 'icon-192.png', size: 192, scale: 5 },
  { file: 'icon-512.png', size: 512, scale: 14 },
  { file: 'icon-512-maskable.png', size: 512, scale: 9 },
];

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** An 8-bit RGB PNG (no alpha: every icon is opaque) of `w` × `h` pixels from `rgb` (3 bytes a pixel, rows top down). */
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);   // each row: filter 0 (none), then its pixels
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const vite = await createServer({ root: ROOT, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
try {
  const { registerAllArt } = await vite.ssrLoadModule('/src/render/art/index.ts');
  const { PAL, spriteGrid } = await vite.ssrLoadModule('/src/render/sprites.ts');
  registerAllArt();
  const art = spriteGrid('f_aquila');
  if (!art || art.outline || art.rows.length !== ART) throw new Error('f_aquila is no longer a plain 32 × 32 grid: update scripts/icons.mjs');
  mkdirSync(OUT, { recursive: true });
  for (const { file, size, scale } of ICONS) {
    const off = (size - ART * scale) / 2;
    if (!Number.isInteger(off) || off < 0) throw new Error(`${file}: the art does not centre at ×${scale}`);
    const rgb = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) rgb.set(GROUND, i * 3);
    art.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ' || !PAL[ch]) return;
      const c = hex(PAL[ch]);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) rgb.set(c, ((off + y * scale + dy) * size + off + x * scale + dx) * 3);
    }));
    writeFileSync(join(OUT, file), png(size, size, rgb));
    console.log(`public/icons/${file}: ${size} × ${size}, the aquila at ×${scale}`);
  }
} finally {
  await vite.close();
}
