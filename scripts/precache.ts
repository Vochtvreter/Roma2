// scripts/precache.ts — the build step of the service worker (public/sw.js, ARCHITECTURE §13.11). Owner: WP-H.
// vite.config.ts runs swPlugin() on `vite build`: once the build is written (dist/, the public folder copied in), it lists
// the build's files (precacheFiles), hashes their bytes into a build id (buildId), and writes both into dist/sw.js
// (swSource). So every build that changes any file is a new worker, and a new worker replaces the old cache; a build
// with the same bytes is the same worker (nothing to update). The pure parts are tested in tests/pwa.test.ts.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** The worker's own file, never precached by itself. */
export const SW_FILE = 'sw.js';

/** A font file's name without its content hash and extension ('assets/silkscreen-latin-400-normal'). */
const fontStem = (f: string): string => f.replace(/-[^-/]*\.woff2?$/, '');

/** What the worker precaches of a build's files (pure; posix paths relative to the build's folder, sorted): everything
 *  but the worker itself and source maps, and a font's .woff where the same face stands beside it as .woff2 (each has
 *  its own hash; every browser that runs this game reads woff2, and a woff one still asks for is cached as fetched). */
export function precacheFiles(files: readonly string[]): string[] {
  const list = [...new Set(files.map((f) => f.split(sep).join('/')))];
  const woff2 = new Set(list.filter((f) => f.endsWith('.woff2')).map(fontStem));
  return list.filter((f) => f !== SW_FILE && !f.endsWith('.map') && !(f.endsWith('.woff') && woff2.has(fontStem(f)))).sort();
}

/** The build id (pure): 12 hex digits of a SHA-256 over each precached file's path and the hash of its bytes, in order. */
export function buildId(entries: readonly { file: string; bytes: Uint8Array }[]): string {
  const h = createHash('sha256');
  for (const e of [...entries].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    h.update(e.file);
    h.update('\0');
    h.update(createHash('sha256').update(e.bytes).digest());
  }
  return h.digest('hex').slice(0, 12);
}

const BUILD_LINE = /^const BUILD = '[^'\n]*';$/m;
const PRECACHE_LINE = /^const PRECACHE = \[[^\]\n]*\];$/m;

/** public/sw.js with its build id and precache list written in (pure). Throws when either line is missing, so a worker
 *  that no longer carries them never ships as the never-updating 'dev' one. */
export function swSource(template: string, build: string, files: readonly string[]): string {
  if (!BUILD_LINE.test(template) || !PRECACHE_LINE.test(template)) throw new Error(`${SW_FILE}: the BUILD or PRECACHE line is missing`);
  if (!/^[0-9a-z-]+$/.test(build)) throw new Error(`${SW_FILE}: a build id of letters and digits, not ${build}`);
  return template.replace(BUILD_LINE, `const BUILD = '${build}';`).replace(PRECACHE_LINE, `const PRECACHE = ${JSON.stringify(files)};`);
}

/** Every file under `dir`, as posix paths relative to it. */
function walk(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, root) : [relative(root, p).split(sep).join('/')];
  });
}

/** The Vite plugin (build only): writes the build id and the precache list into the built sw.js. */
export function swPlugin(): Plugin {
  let out = 'dist';
  return {
    name: 'castra-sw',
    apply: 'build',
    configResolved(c) { out = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const sw = join(out, SW_FILE);
      if (!existsSync(sw)) throw new Error(`${SW_FILE} is missing from ${out}: it is public/${SW_FILE}`);
      const files = precacheFiles(walk(out));
      const id = buildId(files.map((file) => ({ file, bytes: readFileSync(join(out, file)) })));
      writeFileSync(sw, swSource(readFileSync(sw, 'utf8'), id, files));
    },
  };
}
