# Castra Valeria: a Roman city-builder

It is the Kalends of April, AUC 800. Twenty-four souls of six legionary families pitch their tents inside a fresh
earth-and-timber rampart on a river bend at the frontier, and you are the *Praefectus castrorum*.

You lay out the colony: house plots, wells, fields, granaries, shrines and markets, later baths, an aqueduct and a
theatre, all on the surveyed Roman grid. At first you run the camp by hand: who works where, what is raised, what is
traded. Every chore you have done yourself becomes a duty you may hand to the **Ordo Decurionum**, the town council,
which then does it every day, also while you are away, and the ticker says *why*: the colony comes to run itself as you
master it. The Ordo keeps it alive and growing, but plays it safe.
Six **advisors** count the days of grain and water, name what is wrong and what would grow the town faster, and offer
one-click remedies; a Praefectus who acts on them, raises the council's works before it gets to them and makes the town
splendid (Rome sends settlers faster to a beautiful town) grows the colony 2½–3 times as fast as the Ordo alone.
The veteran **Decimus Cassius** teaches the colony one system at a time, each with a small job you do yourself.
Grow from **Castra** through Vicus, Oppidum and Municipium to **Colonia**, watch tents become *casae*, *insulae* and
atrium *domus*, and dedicate the **Capitolium**.

**Play in the browser: <https://vochtvreter.github.io/Roma2/>**

## How to play

1. **Found a new colony** on the title screen, read the Legate's letter and press **Raise the standard**. Decimus
   Cassius then teaches the colony one system at a time, each with a small job you do yourself: put hands on the
   fields, raise a cistern, lay out a house plot, then hand one of those chores to the Ordo. Played before? **Skip the
   introduction** on the letter.
2. Watch the two tablets at the top: **Grain** and **Water** in *days on hand*, with the year ahead beneath. Aestas
   (summer) dries the wells and Hiems (winter) starves the fields: fill the cisterns in Ver and the horrea before the
   Kalends of December.
3. Set the council's course in **Edicta**: proclaim the founding charter, pick a focus and edicts. When every
   requirement is met, petition Rome for the next rank and choose one of three permanent paths.
4. Build what you like from **Aedificia**: a glowing plot shows where a work fits, and gold means a bonus. Your works
   are raised before the Ordo's. Each kind of work you raise yourself (water, food, homes, services, materials) is a
   duty you can then hand to the Ordo in **Edicta → Mandata**, or keep; staffing and trade too. Take a duty back
   whenever you like. Answer an advisor's remedy with one click.
5. Close the tab whenever you like. Time away passes at half speed (up to five years), and the Ordo writes you a
   letter, the *Litterae Ordinis*, about what happened and what it decided in your name.

The town does not keep the plan it was founded on. Its people wear the roads they walk into highways; as a Colonia it
rings the whole town with a stone wall, and once that stands the old camp's rampart is torn down and its ditch filled,
so the camp becomes the inner city and its wall line new house plots; the aqueduct's water goes where it matters, and
the Ordo now and then fills in a well the fountains made needless or buys out a block of homes for a temple, rehousing
every family (DESIGN §3.9). You may lay out the town wall yourself from Municipium: click the camp's wall.

There is no game over. A dedicated Capitolium puts the colony in the *Fasti coloniarum* on the title screen, and the
next colony starts with a Legacy bonus.

### Controls

| Keyboard | |
|---|---|
| `Space` | pause / resume |
| `1` `2` `3` `4` | speed 1×, 2×, 5×, 10× |
| `E` `V` `B` `P` `T` `L` | Edicta, Consiliarii (advisors), Aedificia (build), Populus, Commercium (trade), Annales, once revealed |
| `C` `M` `I` | on a desktop or a tablet: *Urbs* (the panel folded to its icons), *Mensa* (map and ledger), *Tabularium* (the ledgers wide) |
| `Shift` + `E` … `L` | on a desktop or a tablet: that panel, wide (on a phone, the same as the letter alone) |
| `O` / `Shift+O` | next map overlay (Aqua, Domus, Officia, Dignitas loci, Terra) / overlay off |
| `R` | lay a road |
| `W` `A` `S` `D` or arrows | pan |
| `+` `−` | zoom |
| `H` | back to the forum |
| `Esc` | close a window, the Breviarium or a popover, cancel placing, clear the selection, step the panel back (a phone's sheet or drawer down one step; a wide panel, or a tablet's folded spine, back to docked), or open the menu |

With a mouse: click a building or the ground to inspect it, click a glowing plot to place, `Shift`-click to place
more, right-click to cancel. On a touch screen: drag to pan, pinch to zoom, tap to inspect, tap a plot and then
**Place**, hold a control for its tooltip, tap with two fingers to cancel. **Menu → How to play** shows the same, for
the hands your screen has (the keys with a mouse, the gestures on a touch screen, both on a tablet with a trackpad).

**Menu → Text size** chooses *Normal* or *Large* (every letter a quarter larger; nothing in the game is drawn under
12 px either way). The choice belongs to this browser, not to the save, and is kept when you reload.

### Saves

The game saves by itself every 20 seconds, when you switch away and when you leave. The colony lives only in this
browser's `localStorage`, and Safari forgets sites left unvisited for a week, so keep a copy now and then with
**Menu → Export / Import**; **Import a save** on the title screen brings it back. One browser tab plays the colony at a
time: when another tab continues it, the first one steps back to the title. **Menu → Storage** says whether the browser
has promised to keep it (persistent storage).

### Install as an app

The game is an installable web app: **Share → Add to Home Screen** in Safari on an iPhone or iPad, **Install app** (or
*Add to Home screen*) in Chrome on Android, the install button in the address bar of Chrome or Edge on a desktop. It
opens full-window with the aquila as its icon, and once it has loaded it starts without a network (a service worker
keeps the game's files; a launch with a network runs the newest version). On Android, **Menu → Full screen**
hides the browser's bars in a tab too.

**Saves in the app and in Safari.** On an iPhone or iPad the Home Screen app keeps its own storage, apart from
Safari's, so a colony you began in Safari is not in it. To bring it over: in Safari, open the game and press
**Menu → Copy save for the Home Screen app**; then open the app from the Home Screen and press **Bring your colony from
Safari** on its title (it reads the clipboard; if the browser will not let it, paste the text into the box that opens
and press Load). The app keeps its own storage for good (Safari's one-week rule does not apply to it, and it asks the
browser to keep it), so play on there and keep exporting a copy now and then. On Android and on a desktop an installed
app shares the browser's storage: nothing to bring over, and neither button shows there.

## Hosting on GitHub Pages

`.github/workflows/deploy.yml` builds the site and publishes it on every push to `main`; it can also be run by hand
from the Actions tab. One-time setup in the repository:

**Settings → Pages → Build and deployment → Source = GitHub Actions**

With "Deploy from a branch" Pages would serve the raw `index.html`, and `/src/main.ts` would 404. The build uses a
relative base (`./`), so it works under the `/Roma2/` sub-path or any other: the manifest, the icons and the service
worker (`sw.js`, whose scope is the app's folder) are all addressed relatively. Everything is static and client-only:
there is no server and there are no network calls at runtime beyond the game's own files. Every sprite is drawn in code
and every sound is synthesized.

## Development

Node 22 and npm:

```sh
npm install
npm run dev        # open the printed URL; add ?dev for window.skip(days), window.away(minutes) and the 20× key 5
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | typecheck, then build the static site into `dist/` |
| `npm run preview` | serve the built `dist/` locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | the Vitest suite (what CI runs), including the balance opening rows; it leaves out the timing budgets |
| `npm run perf` | the wall-clock budgets of `tests/perf.test.ts`: a tick ≤ 1.5 ms median at 600 souls, a five-year absence ≤ 6 s, map generation ≤ 40 ms. Run it on a quiet machine; `PERF_SLACK=2` loosens them |
| `npm run balance` | the full balance-bot run to the Capitolium on five seeds (`BAL_FULL=1`, slow) |
| `npm run trace` | a tuning table per seed every 300 days: rank, souls, houses by tier, stores, coin, morale |
| `npm run economy` | the economy ledger per rank: coin in and out by source, stores at their cap, spills, idle hands, builders' capacity used, tool kits, Rome's favour, and the whole game's coin earned, spent and unspent (`docs/ECONOMY_REVIEW.md`) |
| `node scripts/icons.mjs` | paint the app icons (`public/icons/`) from the aquila sprite again, after the art changes |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm test` and `npm run build` on every push and
pull request.

### Project layout

| Path | What lives there |
|---|---|
| `src/main.ts` | the app: the fixed-step loop (its clock in `src/game/loop.ts`), speeds, autosave, offline catch-up, title and game modes |
| `src/game/` | the deterministic simulation, with no DOM, wall clock or ambient randomness: `sim.ts` (one tick), people, housing, economy, construction, events, trade, `save.ts` and `offline.ts` |
| `src/game/ordo/`, `src/game/advisors/` | the council that governs, and the six advisors with their rules and remedies |
| `src/game/data/`, `src/game/balance.ts` | content registries (buildings, tiers, ranks, paths, hubs, names) and every tuning number |
| `src/game/world/` | seeded terrain and river, the castrum site, auto-roads and aqueduct routes |
| `src/render/` | the canvas map view, overlays, minimap and input; `render/art/` draws every sprite in code |
| `src/ui/`, `src/styles/` | HUD, side panels (`ui/tabs/`), inspector, advisor card, letters, title screen and keyboard; the layout engine (`ui/layout.ts`: size classes, the four hosts and their detents) and the sliding panel (`ui/sheet.ts`), the Breviarium (`ui/tray.ts`), Back (`ui/history.ts`), the focus row, Text size and the installed app's checks (`ui/platform.ts`); the CSS, one sheet per host (`sheet.css`, `drawer.css`, `dock.css`, `columns.css`) |
| `public/`, `scripts/` | the favicon, the web app manifest, the icons and the offline worker (`sw.js`); the icon painter and the worker's build step (`scripts/precache.ts`, run by `vite.config.ts`) |
| `tests/` | Vitest suites and the autoplayer bots behind the balance, trace and perf runs |
| `docs/` | `DESIGN.md` (content and numbers) and `ARCHITECTURE.md` (the code contract); `ECONOMY_REVIEW.md`, a proposal under review |

## Credits

- The idea and the Roman calendar come from the author's *rome* prototype.
- Engine techniques, code-drawn sprites and the UI construction come from the author's *IdleSettlement*
  (*Hearthlands*).
- Fonts: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) and
  [Silkscreen](https://fonts.google.com/specimen/Silkscreen), both under the SIL Open Font License, bundled via
  @fontsource.
