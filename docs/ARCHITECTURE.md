# CASTRA VALERIA — Architecture and implementation contract

This is the contract that 10 parallel agents implement. `docs/DESIGN.md` holds every number and every piece of content; this file holds the **names, types, files, signatures, rules and work packages**. Read DESIGN.md §0–§11 before writing sim code, §15–§16 before writing UI or art.

Rules of the contract:
- **Frozen after the scaffold**: `src/game/types.ts`, `src/game/actions.ts`, every exported signature listed in §8, the DOM ids in §13.1, the `Game` interface, the sprite naming convention (§12.3). Changing any of them needs the integrator's approval and an update of this file.
- **One owner per file.** Work packages own disjoint files (§14). You may *read* any file; you may only *edit* your own. Cross-package needs go through the frozen signatures.
- **Numbers live in data**: `src/game/balance.ts` (constants, `B`) and `src/game/data/*.ts` (registries). Nothing numeric is inlined in sim logic except 0, 1 and array indices.

---

## 1. Purpose and constraints
- Static, client-only web game for **GitHub Pages**: Vite + TypeScript (strict), relative base `./`, no server, no runtime network calls, no service worker. Saves in `localStorage` with text export/import.
- **No external image assets**: every sprite is authored in code (string grids + parametric draw functions), rasterised once and cached. Fonts are bundled via @fontsource. Sounds are synthesized with WebAudio.
- **Deterministic simulation**: seeded RNG stored in the save; offline catch-up is literally N ticks.
- Target size ≈ 15.5k lines of TS/CSS (core) + ≈ 1.5k stretch, including tests.

---

## 2. Tech stack and tooling

### 2.1 `package.json`
```json
{
  "name": "castra-valeria",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "perf": "PERF=1 vitest run --reporter=verbose",
    "balance": "BAL_FULL=1 vitest run tests/balance.test.ts --reporter=verbose",
    "trace": "vitest run tests/trace.test.ts --reporter=verbose"
  },
  "devDependencies": {
    "@types/node": "^22.20.5",
    "typescript": "^5.9.3",
    "vite": "^8.3.4",
    "vitest": "^5.0.3"
  },
  "dependencies": {
    "@fontsource/pixelify-sans": "^5.3.0",
    "@fontsource/silkscreen": "^5.3.0"
  }
}
```
(The same versions the author's IdleSettlement repo builds with.) No other runtime dependency may be added.

### 2.2 `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true, "isolatedModules": true, "skipLibCheck": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests"]
}
```
`isolatedModules` forbids `const enum`; use `as const` objects (see `T`, `F` in types.ts).

### 2.3 `vite.config.ts`
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
// Wall-clock budgets (tests/perf.test.ts) are unreliable on shared CI runners: `npm test` leaves them out and
// `npm run perf` (PERF=1) runs only them, budgets unchanged.
const PERF = !!process.env.PERF;
const PERF_TEST = 'tests/perf.test.ts';
// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: {
    testTimeout: 60_000,
    include: PERF ? [PERF_TEST] : configDefaults.include,
    exclude: PERF ? configDefaults.exclude : [...configDefaults.exclude, PERF_TEST],
  },
});
```

### 2.4 GitHub Actions
`.github/workflows/ci.yml`
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```
`.github/workflows/deploy.yml`
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
Only pushes to `main` (and manual runs) start the deploy, so a branch push never enters the `pages` concurrency group and cannot cancel a main deploy in flight; a newer deploy waits for the running one. README must state the one-time setup: **Settings → Pages → Source = GitHub Actions** (with "Deploy from a branch" the site serves raw `index.html` and `/src/main.ts` 404s).

### 2.5 Other files
- `.gitignore`: `node_modules dist *.log .DS_Store coverage test-results`.
- `public/favicon.svg`: a 16×16 pixel aquila in SVG `<rect>`s.
- **localStorage keys** (namespaced — every repo of one GitHub user shares the `username.github.io` origin): `castravaleria.save.v1`, `castravaleria.prefs.v1`, `castravaleria.fasti.v1`, `castravaleria.owner.v1` (the tab playing the save, §11.4) and `castravaleria.exported.v1` (when a copy was last exported). Every access is wrapped in `try/catch`.
- `?dev` query: exposes `window.cv = app`, `window.skip(days)`, key 5 = 20×, "DEV" in the title footer. Nothing else differs.

---

## 3. Directory layout, owners and line budgets

Owner codes: **S** scaffold, **A** world & placement, **B** simulation core, **C** Ordo, **D** progression/events/trade/persistence, **E** guidance, **F** render core, **G** art, **H** UI shell, **I** UI panels, **J** tests & balance. Budgets are core lines (stretch in parentheses).

```
index.html                         S
package.json tsconfig.json vite.config.ts .gitignore README.md   S
.github/workflows/ci.yml deploy.yml                              S
public/favicon.svg                 S
src/main.ts                        H   App implements Game: loop, speeds, autosave, catch-up, title/game mode   (350)
src/game/                          pure simulation — no DOM, no render, no ui imports
  types.ts                         S   frozen types (§4)                                         (620)
  balance.ts                       S→J constants object B (§7)                                    (260)
  rng.ts                           S   Rng, hash2, hashStr, withRng                               (70)
  calendar.ts                      S   Julian calendar, Roman dates, seasons (§6)                 (170)
  fx.ts                            S   effect bus fx/fxAdd/fxBreakdown                            (110)
  memo.ts                          S   epoch counters, memo helper, invalidate, action fx queue   (70)
  state.ts                         S   newGame, founding roster, log, pay/refund helpers          (260)
  data/resources.ts                S   RESOURCE_DEFS                                              (60)
  data/buildings.ts                S   BUILDING_DEFS (29 rows, DESIGN §5)                        (480)
  data/housing.ts                  S   HOUSE_TIERS defs, NEED meta (icons, labels)                (110)
  data/decisions.ts                S   FOCUS_DEFS, EDICT_DEFS, PATH_DEFS, SETTING_DEFS, SWITCH_DEFS (330)
  data/ranks.ts                    S   RANK_DEFS                                                  (80)
  data/hubs.ts                     S   HUB_DEFS, MERCHANT_NAMES                                   (70)
  data/names.ts                    S   praenomina, female forms, gentes pools, colony names       (90)
  data/advisors.ts                 S   ADVISOR_DEFS                                               (40)
  survey.ts                        S→A castrum plan, blocks, plots, rings, masks (§8.2)           (260)
  map.ts                           A   terrain generation + guarantees (scaffold ships a toy map)  (420)
  derived.ts                       A   structural derived data                                    (260)
  coverage.ts                      A   road-BFS coverage + desirability                           (260)
  place.ts                         A   canPlace, placeBuilding, roads, aqueduct route, demolish   (480)
  site.ts                          A   siteMultAt, siteScore, bestSlot                            (300)
  economy.ts                       B   the one formula module: production, consumption, storage   (520)
  census.ts                        B   census memo                                                (170)
  people.ts                        B   names, jobs assignment, aging, births, deaths, marriage, immigration (460)
  housing.ts                       B   needs, evolution, renovation, decline, goods                (360)
  construction.ts                  B   works queue, stakes, plans, Capitolium                      (300)
  civic.ts                         B   morale, dignitas, taxes, upkeep, Kalends ledger             (230)
  forecast.ts                      B   Forecast and the 12-month prospectus                        (200)
  sim.ts                           S→B tick order, view(), emptyRates                              (140)
  ordo/index.ts                    C   runOrdo, councilReport                                      (90)
  ordo/labour.ts                   C   planLabour, manualPlan                                      (330)
  ordo/build.ts                    C   wish list, agenda, requests                                 (360)
  ordo/trade.ts                    C   trade automation                                            (150)
  ordo/goods.ts                    C   oil/wine plan: lean-season reserve, projection, shortfall    (130)
  ordo/emergency.ts                C   Lex de annona ladder; hands to the fields under manual labour (150)
  ordo/duties.ts                   C   duties: learned by hand, handed over, the wish walk's mask   (170)
  ordo/saving.ts                   C   savingFor, reserved, canSpend                               (90)
  ordo/actions.ts                  C   askOrdo, pinBuild, setOrdo, setManualTarget, applyOnce, setLabourPriority, setDuty, handOverAll, keepDuties (130)
  ordo/reasons.ts                  C   reason templates                                            (110)
  decisions.ts                     D   focus/edicts/settings/switches/paths, petitions, rankUp     (320)
  objectives.ts                    D   MILESTONES, checkObjectives, counters                       (200)
  reveal.ts                        D   reveal predicates, teaser                                   (110)
  intro.ts                         E   the opening lessons: jobs, real-time pacing, parts shown    (180)
  events.ts                        D   EVENT_DEFS, festivals, rolls, choices, gate                 (520)
  trade.ts                         D   prices, market, caravans, contracts, merchant               (380)
  save.ts                          D   serialize, migrations, prefs, fasti, export/import          (190)
  offline.ts                       D   offlineRun, report                                          (150)
  advisors/engine.ts               E   evaluation, hysteresis, ordering, render, hush/mute        (260)
  advisors/rules-annonae.ts        E   rules 1–6                                                   (230)
  advisors/rules-aquarum.ts        E   rules 7–10                                                  (150)
  advisors/rules-fabrum.ts         E   rules 11–13                                                 (150)
  advisors/rules-quaestor.ts       E   rules 14–16                                                 (120)
  advisors/rules-aedilis.ts        E   rules 17–20                                                 (180)
  advisors/rules-augur.ts          E   rules 21–22                                                 (60)
  advisors/remedies.ts             E   checkRemedy, applyRemedy, remedyLabel                       (170)
  guide.ts                         E   GUIDE tips engine                                           (200)
  hints.ts                         E   "how to get more", benefit lines                            (120)
  actions.ts                       S   frozen dispatcher of all player actions (§8.7)             (40)
src/render/
  sprites.ts                       S   PAL, raster, sprite, spriteURL, mirror, outline, compose, validateArt, registerArt, registerDraw (220)
  camera.ts                        F   camera, zoom, screen↔world                                  (110)
  input.ts                         F   pointer/keys/wheel/pinch                                    (170)
  terrain.ts                       F   chunk painter, seasons, forest layer                        (330)
  view.ts                          F   MapView: frame, draw list, picking, fx routing              (420)
  buildings.ts                     F   building/house draw dispatch, rise(), states, overlays on sprites (300)
  linear.ts                        F   streets, roads, walls, gates, fossa, aqueduct, via          (240)
  placement.ts                     F   ghost, valid slots, coverage preview, laurel                (220)
  overlays.ts                      F   5 overlays as 1 px/tile layers                              (180)
  minimap.ts                       F   minimap                                                     (90)
  actors.ts                        F   walkers, carts, caravans, merchant, veterans, animals       (360)
  particles.ts                     F   particles and fx → burst mapping                            (190)
  art/housing.ts                   G   6 tiers × 2 variants + aquae + overlays                     (330)
  art/civic.ts                     G   temple, macellum, baths, horrea, apotheca, mansio, plot buildings (420)
  art/rural.ts                     G   rural buildings                                             (260)
  art/procedural.ts                G   forum stages, Capitolium, theatrum, thermae domes, fields, olive rows, aqueduct, walls, gates (420)
  art/nature.ts                    G   trees, stumps, rocks, reeds, ruins, lucus, altar            (140)
  art/actors.ts                    G   people, carts, wagon, tents, animals                        (180)
  art/icons.ts                     G   12×12 icons                                                 (230)
  art/portraits.ts                 G   6 advisors × 3 moods + mentor                               (220)
  art/frames.ts                    G   meander, seal, aquila, logo                                 (80)
  art/index.ts                     G   registerAllArt, sprite-name helpers (§12.3)                 (90)
src/ui/
  dom.ts                           S   h, img, fmt*, costEl, tip, initTooltips (long-press), esc   (200)
  types.ts                         S   Game, Panel, Prefs re-export, PlacingState re-export        (80)
  index.ts                         H   UI root: builds widgets, update loop, log→toast, fx        (230)
  intro.ts                         H   shows/hides the parts the lessons bring; arrival glow       (40)
  hud.ts                           H   brand, chips, resource strip, date, view control, speed (pair + popover), menu; figures → tray (290)
  vitals.ts                        H   grain/water tablets + 12-month strip; strip, card and chart helpers the tray shares (200)
  tray.ts                          H   the Breviarium: Awaiting you, Res Gestae, essentials, ledgers, materials, the Ordo; the wide pane's column (420)
  focusrow.ts                      H   the focus row of the DOCK and the COLUMNS: data-focus rows, one listener, the map's answer (pure resolution) (130)
  objective.ts                     H   Res Gestae panel, CTA, danger chips                         (130)
  counsel.ts                       H   portrait strip + one counsel card; awaitingItems, voiceAction (pure) (430)
  ticker.ts                        H   merged Ordo/Acta ticker                                     (80)
  toasts.ts                        H   toasts                                                      (60)
  banner.ts                        H   rank / stage banners                                        (60)
  modals.ts                        H   modal stack, menu, export/import, how-to-play, rename       (240)
  dispatch.ts                      H   parchment letters: founding, away report, victory           (200)
  title.ts                         H   title screen, Fasti                                         (150)
  audio.ts                         H   synthesized sfx                                             (130)
  keys.ts                          H   global keyboard                                             (80)
  history.ts                       H   layers Back and Esc close (registerBack), the Back sentinel (110)
  pointer.ts                       H   the pointer in use: lastTouch, touchInput, finePointer      (50)
  layout.ts                        H   size classes, hosts, detents, route, reveal; data-* on #app, free rect → view insets (§13.10) (420)
  panels.ts                        I   side panel host, tabs, badges, NEW markers, signatures      (170)
  tabs/edicta.ts                   I   Decisions tab                                               (330)
  tabs/consiliarii.ts              I   Advisors tab                                                (160)
  tabs/aedificia.ts                I   Build tab                                                   (300)
  tabs/populus.ts                  I   People tab                                                  (240)
  tabs/commercium.ts               I   Trade tab                                                   (260)
  tabs/annales.ts                  I   Chronicle tab                                               (150)
  inspector.ts                     I   house/building/block/tile inspector                         (280)
  choice.ts                        I   event card                                                  (110)
src/styles/
  index.css                        S   @imports in fixed order; fonts imported in main.ts
  tokens.css                       S   :root tokens (DESIGN §16.1)                                 (60)
  base.css hud.css left.css map-ui.css modals.css title.css mobile.css      H                 (1,050)
  tray.css sheet.css drawer.css dock.css columns.css (the hosts: phone sheet, landscape drawer, tablet dock, desktop columns)   H
  panels.css tabs.css inspector.css                                         I                 (560)
tests/
  util.ts                          S   fresh(), run(), ctx(), helpers                              (80)
  smoke.test.ts calendar.test.ts data.test.ts                               S                 (160)
  map.test.ts placement.test.ts coverage.test.ts                             A                 (330)
  sim.test.ts housing.test.ts construction.test.ts                           B                 (380)
  ordo.test.ts                                                               C                 (220)
  progression.test.ts events.test.ts trade.test.ts save.test.ts              D                 (380)
  advisors.test.ts guide.test.ts                                             E                 (260)
  art.test.ts                                                                G                 (50)
  camera.test.ts layout.test.ts sheet.test.ts voice.test.ts focusrow.test.ts   F H            (500)
  autoplayer.ts balance.test.ts contract.test.ts determinism.test.ts perf.test.ts trace.test.ts   J   (900)
```
Approximate total: game 11.0k incl. data, render 4.4k, ui 4.3k incl. CSS, tests 2.6k → ≈ 22k if every budget is maxed, so **budgets are ceilings, not targets**; aim for ≈ 70% of each (≈ 15.5k). Files stay under ~600 lines; split if needed (new files must stay within the owner's directory prefix and be listed in the PR note).

---

## 4. `src/game/types.ts` (complete; implement exactly)

```ts
// src/game/types.ts — FROZEN after the scaffold.

// ───────────────────────────── ids ─────────────────────────────
export const RESOURCES = ['denarii', 'grain', 'water', 'timber', 'stone', 'tiles', 'concrete', 'ore', 'iron', 'tools', 'oil', 'wine'] as const;
export type ResId = (typeof RESOURCES)[number];
export type Res = Record<ResId, number>;
export type Cost = Partial<Record<ResId, number>>;
export const TRADE_RES = ['grain', 'timber', 'stone', 'tiles', 'iron', 'oil', 'wine'] as const;
export type TradeRes = (typeof TRADE_RES)[number];
export type Essential = 'grain' | 'water';

export const BUILDINGS = [
  'area', 'principia', 'capitolium',
  'ager', 'venatio', 'pabulatio', 'olivetum', 'horreum', 'apotheca',
  'puteus', 'cisterna', 'castellum', 'lacus',
  'lignarius', 'lapicidina', 'figlina', 'caementarium', 'fodina', 'officina', 'fabrica',
  'taberna', 'macellum', 'mansio', 'lararium', 'templum', 'balneum', 'thermae', 'theatrum', 'hortus',
] as const;
export type BuildingId = (typeof BUILDINGS)[number];
export type PlaceClass = 'plot' | 'half' | 'block' | 'rural' | 'fixed';
export type BuildCat = 'domus' | 'annona' | 'aqua' | 'materia' | 'officinae' | 'mercatus' | 'religio' | 'salus' | 'ornamenta' | 'civitas';
export type SiteRule = 'none' | 'fertile' | 'woods' | 'wood' | 'rocky' | 'clay' | 'ore' | 'scrubHills' | 'via' | 'nearCastellum' | 'fixed';

export const HOUSE_TIERS = ['tentoria', 'casa', 'tegulata', 'domusParva', 'insula', 'domus'] as const;
export type HouseTierId = (typeof HOUSE_TIERS)[number];
export type HousePref = 'auto' | 'insula' | 'domus';

export const RANK_IDS = ['castra', 'vicus', 'oppidum', 'municipium', 'colonia'] as const;
export type RankId = (typeof RANK_IDS)[number];
export type RankIndex = 0 | 1 | 2 | 3 | 4;

export const SEASONS = ['ver', 'aestas', 'autumnus', 'hiems'] as const;
export type SeasonId = (typeof SEASONS)[number];
export type SeasonIndex = 0 | 1 | 2 | 3;
export type Quad = [number, number, number, number];          // per season or per stage

export const STAGES = ['child', 'youth', 'adult', 'elder'] as const;
export type StageId = (typeof STAGES)[number];
export type StageIndex = 0 | 1 | 2 | 3;

export const SKILLS = ['agri', 'aqua', 'silva', 'lapis', 'ferrum', 'fabri', 'officium'] as const;
export type SkillId = (typeof SKILLS)[number];

export const LABOR_CATS = ['water', 'food', 'materials', 'industry', 'services', 'builders'] as const;
export type LaborCat = (typeof LABOR_CATS)[number];

export const LAYERS = ['water', 'fountain', 'shrine', 'temple', 'market', 'macellum', 'baths', 'culture'] as const;
export type CoverageLayerId = (typeof LAYERS)[number];

export const NEEDS = ['street', 'water', 'fed', 'religion', 'market', 'temple', 'desirability', 'baths', 'macellum', 'oil', 'wine', 'rank', 'materials'] as const;
export type NeedId = (typeof NEEDS)[number];

export const FOCUSES = ['concordia', 'copia', 'materia', 'mercatura', 'urbs'] as const;
export type FocusId = (typeof FOCUSES)[number];
export const EDICTS = ['rationes', 'tributum', 'opera', 'hospites', 'horae', 'nundinae', 'feriae', 'silvae', 'aquae'] as const;
export type EdictId = (typeof EDICTS)[number];
export const SETTINGS = ['spareBeds', 'grainReserve', 'builderShare', 'waterReserve', 'tradeReserve', 'renovation', 'treasuryFloor'] as const;
export type SettingId = (typeof SETTINGS)[number];
export const SWITCHES = ['emergency', 'governAway'] as const;
export type SwitchId = (typeof SWITCHES)[number];
export const PATH_DECISIONS = ['charter', 'path1', 'path2', 'path3', 'path4'] as const;
export type PathDecisionId = (typeof PATH_DECISIONS)[number];
export const PATH_OPTIONS = [
  'veterani', 'agricolae', 'mercatores', 'canabae', 'pagus', 'coloni', 'arsFabrilis', 'pietas', 'viaMilitaris',
  'iusLatii', 'annonaPublica', 'aquaeSalutares', 'iuppiter', 'aeternitas', 'imperium',
] as const;
export type PathOptionId = (typeof PATH_OPTIONS)[number];
export const ORDO_AREAS = ['labour', 'build', 'trade'] as const;
export type OrdoArea = (typeof ORDO_AREAS)[number];

export const ADVISORS = ['annonae', 'aquarum', 'fabrum', 'quaestor', 'aedilis', 'augur'] as const;
export type AdvisorId = (typeof ADVISORS)[number];
export const RULES = [
  'annonae.grain.runout', 'annonae.famine', 'annonae.hiems.forecast', 'annonae.mess', 'annonae.storage', 'annonae.goods',
  'aquarum.water.runout', 'aquarum.aestas.forecast', 'aquarum.access', 'aquarum.aqueduct',
  'fabrum.labour', 'fabrum.stalled', 'fabrum.capitolium',
  'quaestor.coin', 'quaestor.contract', 'quaestor.merchant',
  'aedilis.evolve', 'aedilis.declining', 'aedilis.beds', 'aedilis.morale',
  'augur.choice', 'augur.petition',
] as const;
export type RuleId = (typeof RULES)[number];
export const TIPS = [
  'welcome', 'starving', 'thirst', 'event', 'petition', 'vitals', 'ordo', 'charter', 'counsel', 'speed',
  'build', 'aestas', 'wants', 'autumn', 'edicts', 'reins', 'trade', 'fork', 'aqueduct', 'away',
] as const;
export type TipId = (typeof TIPS)[number];
export const MILESTONE_IDS = [
  'firstWork', 'charter', 'fed30', 'horreum', 'hiems', 'pop50', 'stabilitas', 'vicus', 'caravan', 'tegulae',
  'pop150', 'oppidum', 'templum', 'fork', 'iron60', 'municipium', 'aqua', 'pop500', 'colonia', 'capitolium',
  'pop1200', 'allT3', 'sixHubs', 'saturnalia10',
] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];
export const EVENTS = [
  'veterani', 'legatus', 'mutuum', 'pestilentia', 'robigo', 'siccitas', 'annonaRomae',
  'ignis', 'inundatio', 'frigus', 'latrones', 'nuptiae', 'augurium', 'messis', 'mercator', 'coloni',
] as const;
export type EventId = (typeof EVENTS)[number];
export const FESTIVALS = ['parilia', 'robigalia', 'floralia', 'ludiRomani', 'saturnalia', 'lustrum'] as const;
export type FestivalId = (typeof FESTIVALS)[number];
export const HUBS = ['metellianus', 'durii', 'silvanum', 'narbo', 'massilia', 'augusta'] as const;
export type HubId = (typeof HUBS)[number];
export const TABS = ['council', 'advisors', 'build', 'people', 'trade', 'annals'] as const;
export type TabId = (typeof TABS)[number];
export const OVERLAYS = ['none', 'aqua', 'domus', 'officia', 'desir', 'terra'] as const;
export type OverlayId = (typeof OVERLAYS)[number];
export type ToolId = 'pin' | 'road' | 'pave' | 'reserve' | 'demolish';
export type SectionId = 'focus' | 'edicts' | 'settings' | 'switches' | 'manual' | 'story';
export type Severity = 0 | 1 | 2 | 3;                     // Nota, Monitum, Cave, Periculum
export type Owner = 'start' | 'player' | 'ordo';
export type GateId = 'praetoria' | 'decumana' | 'principalisN' | 'principalisS';

// ───────────────────────────── terrain ─────────────────────────────
export const T = { grass: 0, meadow: 1, loam: 2, scrub: 3, forest: 4, dense: 5, hills: 6, rock: 7, crag: 8, river: 9 } as const;
export type Terrain = (typeof T)[keyof typeof T];
export const F = { none: 0, clay: 1, ore: 2, fons: 3, lucus: 4, ruins: 5 } as const;
export type Feature = (typeof F)[keyof typeof F];

export interface Rect { x: number; y: number; w: number; h: number }

export interface Block {
  id: number;                    // index in Survey.blocks
  ring: 0 | 1 | 2;               // 0 = castrum interior
  bx: number; by: number;        // block grid coords (castrum interior bx 0..5, by 0..3)
  x: number; y: number;          // top-left map tile of the 4×4 block
  masked: boolean;               // river/crag/rock/lucus/ruins/>4 loam/off-map
  reserved: 'forum' | 'capitolium' | null;
  district: 'praetentura' | 'latera' | 'retentura' | 'canabae';
  touchesVia: boolean;           // a block side lies on the via/decumanus line
  touchesForum: boolean;
}
export interface Survey {
  ix: number; iy: number;        // castrum interior origin tile (castrum coords 0,0)
  viaDir: 'E' | 'W';             // side of the Porta Praetoria
  castrum: Rect;                 // interior + wall + fossa (39 × 29)
  interior: Rect;                // 31 × 21
  forum: Rect;                   // 9 × 9
  capitolium: Rect;              // 9 × 4 (Area Capitolina)
  blocks: Block[];
  blockAt: Int16Array;           // tile → block id or −1
  street: Uint8Array;            // 1 = survey street-line tile (rings 0–2, not masked water)
  streetRing: Int8Array;         // ring of the street tile (0..2) or −1
  wall: Uint8Array;              // 1 wall, 2 gate
  fossa: Uint8Array;             // 1 = ditch tile
  gates: { id: GateId; tile: number }[];
  via: number[];                 // via tiles from the Porta Praetoria outward to the map edge
  bridge: number[];              // via tiles that are bridge (over river)
  sacredWay: number[];           // cardo tiles inside the Area Capitolina (never streets)
}
export interface WorldMap {
  seed: number; W: number; H: number;
  terrain: Uint8Array;           // Terrain per tile
  feature: Uint8Array;           // Feature per tile
  elev: Float32Array; moist: Float32Array;
  woodMax: Float32Array;         // initial timber per tile (0 if not wooded)
  vein: Float32Array;            // ore quality (0 if no ore)
  waterTable: Uint8Array;        // 1 = on the water table
  riverDist: Uint8Array;         // Chebyshev distance to river, capped at 255
  fontes: number[];              // spring tiles
  startAger: { x: number; y: number };
  survey: Survey;
}

// ───────────────────────────── effects ─────────────────────────────
export const MUL_KEYS = [
  'grainUse', 'waterUse', 'tax', 'marketTax', 'labour', 'builders', 'renovation',
  'fields', 'hunting', 'forage', 'olives', 'wells', 'rain', 'timber', 'quarry', 'industry',
  'immigration', 'births', 'veterans', 'merchants', 'tradePrice', 'tripDays', 'bandits',
  'horreaCap', 'disease', 'blight', 'regrow', 'toolDays', 'festivalCost', 'templeDignitas', 'dignitas',
  'capWork', 'capMat', 'castellumCost', 'lacusCost', 'petitionFee',
] as const;
export type MulKey = (typeof MUL_KEYS)[number];
export const ADD_KEYS = [
  'morale', 'hiemsMorale', 'shrineRadius', 'marketRadius', 'bathsRadius', 'caravanSlots',
  'lowCap', 'insulaCap', 'care', 'hiemsFields', 'fama',
] as const;
export type AddKey = (typeof ADD_KEYS)[number];
export interface Effects { mul?: Partial<Record<MulKey, number>>; add?: Partial<Record<AddKey, number>> }

// ───────────────────────────── data definitions ─────────────────────────────
export interface ResourceDef { id: ResId; name: string; latin: string; unit: string; baseCap: number; trade: number | null; icon: string; desc: string }

export interface ServiceDef { layer: CoverageLayerId; radius: number }
export interface BuildingDef {
  id: BuildingId; name: string; latin: string; desc: string; benefit: string; hint: string;
  cat: BuildCat;
  place: PlaceClass[];                       // allowed placement classes (e.g. puteus: ['plot','rural'])
  size: [number, number];                    // rural footprint w,h (urban classes imply 2×2/4×2/4×4)
  cost: Cost; work: number; rank: RankIndex;
  perTile?: { cost: Cost; work: number };    // castellum aqueduct route
  slots: number; labor: LaborCat | null; skill: SkillId | null;
  output?: { res: ResId; perWorker: number };
  inputs?: Partial<Record<ResId, number>>;   // per worker-day (processing)
  passive?: { res: ResId; perDay: number };
  seasons?: Quad;                            // output season multipliers [Ver, Aestas, Autumnus, Hiems]
  fxKey?: MulKey;                            // output effect key (fields, hunting, …)
  service?: ServiceDef[];
  storage?: Cost;
  waterDraw?: number;                        // baths, per day
  upkeep: number;
  desir: [value: number, range: number];
  dignitas: number;
  rule: SiteRule;
  tool: boolean;                             // eligible for tool kits
  maxCount?: number;
}
export interface HouseTierDef {
  id: HouseTierId; level: 0 | 1 | 2 | 3 | 4; name: string; latin: string;
  beds: number; tax: number; needs: NeedId[]; desirMin: number | null;
  renovation: Cost; rank: RankIndex; dignitas: number; patrician: boolean;
  desir: [number, number];                   // the house's own desirability influence
}
export interface RankDef {
  index: RankIndex; id: RankId; name: string; title: string;
  fee: Cost; dignitas: number;               // petition fee and dignitas threshold (to ENTER this rank)
  ceiling: number; territory: number; rings: number[]; immRate: number; subsidy: number;
  unlocks: BuildingId[]; hubs: HubId[]; forumStage: number;
}
export interface DecisionOption { id: string; name: string; desc: string; fx: Effects; visible?: string }
export interface EdictDef { id: EdictId; name: string; latin: string; prompt: string; options: DecisionOption[]; initial: string; unlock: MilestoneId; situational: string }
export interface PathDef { id: PathDecisionId; name: string; prompt: string; grants: RankIndex; options: (DecisionOption & { id: PathOptionId })[] }
export interface FocusDef { id: FocusId; name: string; latin: string; desc: string; plan: [BuildingId, number][]; split: Partial<Record<LaborCat, number>> }
export interface SettingDef { id: SettingId; name: string; latin: string; desc: string; min: number; max: number; step: number; initial: number; unit: string; unlock: MilestoneId }
export interface SwitchDef { id: SwitchId; name: string; desc: string; initial: boolean }
export interface HubQuirk { buy?: number | 'refused'; sell?: number | 'refused' }
export interface HubDef { id: HubId; name: string; desc: string; days: number; buy: number; sell: number; quirks: Partial<Record<TradeRes, HubQuirk>>; rank: RankIndex }
export interface AdvisorDef { id: AdvisorId; office: string; name: string; domain: string; order: number; portrait: string }
export type UnlockRef =
  | { kind: 'edict'; id: EdictId } | { kind: 'setting'; id: SettingId } | { kind: 'switch'; id: SwitchId }
  | { kind: 'tool'; id: ToolId } | { kind: 'overlay'; id: OverlayId } | { kind: 'section'; id: SectionId }
  | { kind: 'cosmetic'; id: string; label: string } | { kind: 'victory' };
export interface MilestoneDef { id: MilestoneId; text: string; hint: string; progress(s: GameState): [number, number]; unlocks: UnlockRef[]; postVictory?: boolean }
export interface GuideStep {
  id: TipId; title: string; text(s: GameState): string;
  when(s: GameState): boolean; after?: TipId; until?(s: GameState): boolean;
  target?: string; tab?: TabId; urgent?: boolean;
}

// ───────────────────────────── people ─────────────────────────────
export const BUILDER = -1;                    // Person.work value while on construction
export interface Person {
  id: number; prae: string; gens: string;     // gens stored in masculine form ('Valerius')
  ord?: number; cog?: string; female: boolean;
  born: number;                               // absolute game day
  family: number; spouse: number | null; mother: number | null; father: number | null;
  home: number | null;                        // house building id
  work: number | null;                        // building id, BUILDER, or null (idle/not working)
  skills: Partial<Record<SkillId, number>>;
  vet?: boolean; sickUntil?: number; widowedDay?: number; homelessSince?: number; arrived?: number;
}
export interface Family { id: number; gens: string; head: number; home: number | null }

// ───────────────────────────── buildings ─────────────────────────────
export type SiteStatus = 'plan' | 'staked' | 'building' | 'done';
export type NoteCode = 'river' | 'loam' | 'fields' | 'forum' | 'woods' | 'rock' | 'clay' | 'vein' | 'quarryNear' | 'mineNear' | 'district' | 'covers' | 'unblocks' | 'felling' | 'water' | 'via';
export interface SiteNote { code: NoteCode; value?: number }
export interface HouseState {
  tier: HouseTierId; pref: HousePref;
  okDays: number; badDays: number; recoverDays: number;
  declining: boolean; declineDays: number;
  renovating: { until: number; to: HouseTierId } | null;
  oil: number; wine: number;                  // supply EMA 0..1
}
export interface Building {
  id: number; type: BuildingId; x: number; y: number;   // top-left tile
  owner: Owner; status: SiteStatus;
  placed: number;                             // day placed
  progress: number;                           // 0..1
  work: number;                               // total work incl. felling and aqueduct route
  paid: boolean;                              // cost paid (false only for 'plan')
  order: number;                              // works-queue order (lower first)
  open: boolean; prio: 0 | 1 | 2;             // staffing enabled; priority low/normal/high
  reason?: Reason; notes?: SiteNote[];
  house?: HouseState;
  doneDay?: number; toolUntil?: number; vein?: number; youngUntil?: number;
  idleUntil?: number; bonus?: number; bonusUntil?: number; damagedUntil?: number;
  route?: number[];                           // castellum: aqueduct tiles, fons first
  matUsed?: Cost;                             // capitolium: gradual materials consumed
  unpaid?: boolean;                           // upkeep unpaid today
}

// ───────────────────────────── Ordo, decisions, guidance ─────────────────────────────
export type ReasonCode =
  | 'request' | 'pin' | 'survivalFood' | 'survivalWater' | 'aestasWater' | 'hiemsStore' | 'storageFull' | 'beds'
  | 'waterAccess' | 'evolve' | 'rank' | 'materials' | 'luxury' | 'focusPlan' | 'beauty' | 'capitolium'
  | 'needWater' | 'needFood' | 'reserveTopup' | 'requiredService' | 'builderShare' | 'monument' | 'pendingInput'
  | 'winterStock' | 'tools' | 'luxuryStaff' | 'serviceFull' | 'focusSplit' | 'leftover' | 'priority'
  | 'deficitImport' | 'luxuryImport' | 'wishImport' | 'surplusExport' | 'merchantDeal'
  | 'emergencyRations' | 'emergencyWater' | 'emergencyImport' | 'relief' | 'saving';
export interface Reason { code: ReasonCode; params: Record<string, number | string> }

export interface DecisionState {
  focus: FocusId;
  edicts: Record<EdictId, string>;
  edictLock: Partial<Record<EdictId, number>>;      // first day the edict may change again
  paths: Partial<Record<PathDecisionId, PathOptionId>>;
  pathDays: Partial<Record<PathDecisionId, number>>;
  settings: Record<SettingId, number>;
  switches: Record<SwitchId, boolean>;
}
export interface OrdoState {
  on: Record<OrdoArea, boolean>;
  manual: Record<LaborCat, number>;                  // manual labour targets per category
  requests: { type: BuildingId; day: number }[];    // "Ask the Ordo", max 3
  pin: BuildingId | null;
  reserved: number[];                                // reserved block ids (sorted)
  priorities: { cat: LaborCat; until: number }[];    // temporary "X first for N days"
  emergency: { rations: 'none' | 'parcae' | 'arctae'; waterPause: boolean; lastImport: number; lastRelief: number; freeReliefYear: number; hands: boolean };
  works: Record<WorkDuty, boolean>;                  // the kinds of work the Ordo may raise (with on.build), DESIGN §10.2
  learned: DutyId[];                                 // duties the player has done by hand (DUTIES order)
  answered: DutyId[];                                // learned duties handed over or kept: the counsel offers the rest
}
export interface Metric { label: string; value: number; unit: 'days' | 'houses' | 'den' | 'pct' | 'souls' }
export interface AdvisoryMemo {
  rule: RuleId; active: boolean; sev: Severity; since: number;
  lowerSince: number | null;                          // day the evaluated severity first fell below sev
  params: Record<string, number | string>; metric?: Metric;
  snoozeUntil?: number; flips: number[];             // days it was raised or cleared (last 60 days)
  snoozeSev?: Severity;                               // severity when hushed: the hush outlives a clear, and only a graver one breaks it
}
export interface GuidanceState {
  advisories: Partial<Record<RuleId, AdvisoryMemo>>;
  muted: RuleId[]; appointed: AdvisorId[];
  tips: TipId[];                                      // seen tip ids
  tipDay: number;                                     // the day a tip was last read ("Understood"); NEVER before the first
  tipAt: number;                                      // stats.playMs then, or when the lessons ended: the card spaces tips B.intro.TIP_GAP_S real seconds apart
  objective: number;                                  // index into MILESTONES
  milestoneDays: Partial<Record<MilestoneId, number>>;
  intro: IntroState;                                  // the opening lessons (DESIGN §11.13)
}
export interface IntroState {
  lesson: number;                                     // index into LESSONS; -1 when none runs (finished, skipped, older colonies, bots)
  done: boolean;                                      // the lesson's job is done: its breather runs
  at: number;                                         // stats.playMs when the lesson began or, once done, when its job was done
  practice: PracticeId[];                             // UI-noted jobs this lesson ('speed' | 'overlay' | 'advisors' | 'people' | 'edict')
}

// ───────────────────────────── trade, events ─────────────────────────────
export type PauseCode = 'reserve' | 'stock' | 'denarii' | 'storage' | 'refused';
export interface ContractSpec { hub: HubId; mode: 'export' | 'import'; res: TradeRes; qty: number; repeat: boolean }
export interface Contract extends ContractSpec {
  id: number; owner: 'player' | 'ordo'; status: 'idle' | 'travelling' | 'paused';
  pause?: PauseCode; reason?: Reason; trips: number; created: number;
}
export interface Caravan {
  id: number; contract: number | null; hub: HubId; mode: 'export' | 'import'; res: TradeRes; qty: number;
  value: number;                                     // denarii paid (import) or to be received (export)
  depart: number; arrive: number;                    // arrive = return day
  kind: 'contract' | 'emergency' | 'relief';
}
export interface MerchantOffer { id: number; kind: 'buy' | 'sell'; res: TradeRes; qty: number; price: number; taken: boolean; declined?: boolean }   // taken: closed (struck, or declined when declined is set)
export interface Merchant { name: string; arrived: number; until: number; offers: MerchantOffer[] }
export interface TradeState {
  market: Record<TradeRes, number>; contracts: Contract[]; caravans: Caravan[];
  merchant: Merchant | null; lastMerchant: number; hubsTraded: HubId[]; debt: number;
}
export interface ChoiceOption { label: string; note: string; key: string; cost?: Cost; gain?: Cost }
export interface PendingChoice {
  event: EventId; kicker: string; title: string; text: string;
  options: ChoiceOption[]; defaultIndex: number;
  created: number; expires: number;
  data?: Record<string, number | string>;
}
export interface GateParty { families: { family: Family; people: Person[] }[]; until: number }
export interface Modifier {
  id: string; label: string; until: number; fx: Effects; benign: boolean;
  source: EventId | FestivalId | 'emergency' | 'stage' | 'legatus';
}

// ───────────────────────────── log, stats ─────────────────────────────
export type LogKind = 'info' | 'good' | 'bad' | 'build' | 'birth' | 'death' | 'ordo' | 'trade' | 'event' | 'advisor' | 'rank' | 'milestone' | 'ledger' | 'emergency' | 'fasti';
export type LogTag = 'highlight' | 'decided';
export interface LogEntry { day: number; kind: LogKind; text: string; tags?: LogTag[]; ref?: number }
export type DeathCause = 'age' | 'hunger' | 'thirst' | 'fever' | 'fire' | 'other';
export interface Counters {
  fedStreak: number; stabStreak: number; ironMade: number; tilesMade: number; caravansReturned: number;
  festivalsKept: Partial<Record<FestivalId, number>>; robigaliaYear: number;
  lastArrivalBlocked: number; lastBirthBlocked: number;
  renovWindow: { start: number; count: number };
  lastChoiceDay: number; lastHarmfulDay: number; lastFireDay: number;
  coinEma: number;                                   // 30-day EMA of net denarii/day (accrual basis)
  mentorDiedDay: number | null;
}
export interface Stats {
  births: number; deaths: number; deathsBy: Record<DeathCause, number>;
  immigrants: number; emigrants: number; peakPop: number;
  built: number; builtBy: Partial<Record<BuildingId, number>>;
  evolved: number; evolvedBy: Partial<Record<HouseTierId, number>>; devolved: number;
  denariiTaxed: number; playMs: number; startedAt: number; victoryDay: number | null;
}

// ───────────────────────────── the save ─────────────────────────────
export interface GameState {
  version: number; seed: number; rng: number; nextId: number;
  name: string; day: number; legacy: number; legacyBonus: number;
  rank: RankIndex; victory: boolean; defeat: boolean;
  res: Res; taxAccrued: number;
  people: Person[];                                  // living, sorted by id
  families: Family[];                                // sorted by id
  buildings: Building[];                             // sorted by id
  roads: number[]; paved: number[];                  // sorted tile indices (paved ⊆ roads)
  wood: Record<number, number>;                      // sparse: forest tiles below their max
  needs: { hunger: Quad; thirst: Quad };             // per stage group, 0..100
  fed: number;                                       // fed index (30-day EMA), 0..1
  morale: number;
  decisions: DecisionState; ordo: OrdoState; trade: TradeState;
  choice: PendingChoice | null; gate: GateParty | null;
  eventDays: Partial<Record<EventId, number>>;       // last day each event fired
  modifiers: Modifier[];
  guidance: GuidanceState;
  counters: Counters; stats: Stats;
  log: LogEntry[];                                   // capped at B.LOG_CAP (400)
  lastSave: number;                                  // wall-clock ms written by save.ts; never read by the sim
}

// ───────────────────────────── tick context ─────────────────────────────
export type RateSource =
  | BuildingId | 'eating' | 'drinking' | 'idleForage' | 'renovation' | 'construction' | 'capitolium'
  | 'upkeep' | 'taxes' | 'marketTax' | 'subsidy' | 'trade' | 'merchant' | 'rot' | 'evaporation' | 'spill'
  | 'festival' | 'event' | 'baths' | 'relief' | 'debt' | 'felling' | 'goods';
export interface Rates {
  prod: Record<ResId, Partial<Record<RateSource, number>>>;
  cons: Record<ResId, Partial<Record<RateSource, number>>>;
}
export type FxEvent =
  | { kind: 'built'; id: number }
  | { kind: 'evolved'; id: number; tier: HouseTierId }
  | { kind: 'declined'; id: number }
  | { kind: 'birth'; home: number | null }
  | { kind: 'death'; home: number | null }
  | { kind: 'arrive'; family: number; n: number; home: number | null }
  | { kind: 'leave'; n: number }
  | { kind: 'caravanOut'; caravan: number; hub: HubId }
  | { kind: 'caravanIn'; caravan: number; hub: HubId; denarii: number }
  | { kind: 'taxes'; amount: number }
  | { kind: 'rank'; rank: RankIndex }
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'fire'; id: number }
  | { kind: 'stage'; id: number; stage: number }
  | { kind: 'season'; season: SeasonIndex }
  | { kind: 'event'; id: EventId }
  | { kind: 'advisory'; rule: RuleId; sev: Severity }
  | { kind: 'ordoPlaced'; id: number }
  | { kind: 'victory' };
export interface TickContext { fx: FxEvent[]; rates: Rates; offline: boolean }

// ───────────────────────────── derived views (memoised, never saved) ─────────────────────────────
export interface Derived {
  buildingAt: Int32Array;            // tile → building id (0 = none); includes sites and plans
  road: Uint8Array;                  // 0 none, 1 dirt, 2 paved
  pomerium: Uint8Array;              // 1 = tile of an active (current-rank ring) unmasked block or active street
  territory: Uint8Array;             // 1 = inside current territory
  reservedTile: Uint8Array;          // 1 = reserved (aqueduct route under construction, Area Capitolina)
  plotOwner: Int32Array;             // (blockId*4 + plot) → building id or 0
  counts: Partial<Record<BuildingId, number>>;   // finished buildings
  all: Partial<Record<BuildingId, number>>;      // including plans and sites
  houses: number[];                  // finished house ids (area with house state), sorted
  sites: number[];                   // unfinished (plan/staked/building) ids in works order
  castellumActive: boolean;
  stepsToForum: Int16Array;          // road-BFS steps from the forum's road ring (−1 unreachable)
}
export interface Coverage {
  layers: Record<CoverageLayerId, Uint8Array>;   // per tile: 1 = covered road tile
  houseMask: Map<number, number>;                // house id → bitmask over LAYERS (bit i = LAYERS[i])
  key: string;
}
export interface Census {
  day: number; pop: number; byStage: Quad; adults: number;
  workforce: number;                 // able workers (adults + elders < 65, not patricii, not sick)
  idle: number[];                    // ids of able workers without work, sorted
  beds: number; freeBeds: number; homeless: number; roll: number;
  need: Record<Essential, number>;   // per day at current portions
  groupNeed: { grain: Quad; water: Quad };
  caps: Res; horreaCap: number;
  slots: Record<number, number>;     // building id → effective slots (closed/unfinished = 0)
  staffed: Record<number, number>;
  catSlots: Record<LaborCat, number>; catStaffed: Record<LaborCat, number>;
  houses: number; byTier: Record<HouseTierId, number>; declining: number; patricii: number;
}
export interface MonthCell { month: number; year: number; season: SeasonIndex; minDoh: number; endStock: number }
export interface CrunchForecast { season: SeasonIndex; startsIn: number; lowestDoh: number; lowestDay: number; emptyDay: number | null; needInStore: number }
export interface EssentialForecast {
  stock: number; cap: number; need: number;
  prod: number; cons: number; net: number; net3: number;      // today and 3-day average net
  doh: number; runout: number | null; room: number;
  maxPotential: number; structural: boolean;
  months: MonthCell[];                                          // 12 cells from the current month
  lowestDoh: number; lowestDay: number;
  crunch: CrunchForecast | null;                                // Hiems for grain, Aestas for water (next or current)
}
export interface Forecast { day: number; grain: EssentialForecast; water: EssentialForecast; coin: { stock: number; net30: number; runout: number | null } }
export interface SimView { readonly d: Derived; readonly c: Census; readonly f: Forecast; readonly cov: Coverage }

export interface LabourLine { cat: LaborCat; target: number; have: number; slots: number; reason: Reason }
export interface LabourPlan { perBuilding: Record<number, number>; builders: number; lines: LabourLine[] }
export interface WishView {
  type: BuildingId; state: 'staked' | 'building' | 'saving' | 'waiting' | 'proposed';
  reason: Reason; lacking?: Cost; eta?: number; siteId?: number; tile?: number;
}
export interface CouncilReport {
  day: number; labour: LabourLine[]; agenda: WishView[];
  saving: { cost: Cost; for: 'petition' | 'plan' | 'pin' | 'request' | 'wish' } | null;
  trade: { contract: number; reason: Reason }[];
  would: { labour: Partial<Record<LaborCat, number>>; build: WishView | null; trade: Reason | null };
  ticker: Reason[];
}

// ───────────────────────────── advisors ─────────────────────────────
export interface AdvisoryEval { rule: RuleId; severity: Severity; metric?: Metric; params: Record<string, number | string> }
export interface AdvisorRule {
  id: RuleId; advisor: AdvisorId; supersedes?: RuleId[];
  evaluate(s: GameState, v: SimView): AdvisoryEval | null;               // pure, in-tick, cheap
  clear?(s: GameState, v: SimView, memo: AdvisoryMemo): boolean;           // hysteresis release (default: metric beyond threshold × 1.25)
  title(s: GameState, a: AdvisoryMemo): string;                             // render-time
  text(s: GameState, v: SimView, a: AdvisoryMemo): string;                  // render-time; may name people and places
  remedies(s: GameState, v: SimView, a: AdvisoryMemo): Remedy[];            // render-time; 1–3
}
export interface ActiveAdvisory { rule: RuleId; advisor: AdvisorId; memo: AdvisoryMemo }
export type Remedy =
  | { kind: 'ask'; building: BuildingId }
  | { kind: 'place'; building: BuildingId; tile?: number }
  | { kind: 'priority'; cat: LaborCat; days: number }
  | { kind: 'assign'; cat: LaborCat; n: number }
  | { kind: 'edict'; edict: EdictId; option: string }
  | { kind: 'setting'; setting: SettingId; value: number }
  | { kind: 'switch'; sw: SwitchId; value: boolean }
  | { kind: 'focus'; focus: FocusId }
  | { kind: 'contract'; spec: ContractSpec }
  | { kind: 'buyNow'; res: TradeRes; qty: number }
  | { kind: 'relief' }
  | { kind: 'toggleOrdo'; area: OrdoArea; on: boolean }
  | { kind: 'building'; op: 'open' | 'close' | 'prioritise' | 'center'; id: number }
  | { kind: 'open'; tab: TabId; anchor?: string }
  | { kind: 'overlay'; overlay: OverlayId; layer?: CoverageLayerId };

// ───────────────────────────── results ─────────────────────────────
export type PlaceFail =
  | 'offMap' | 'outsideTerritory' | 'castrum' | 'reserved' | 'notInPomerium' | 'notOnSlot' | 'occupied'
  | 'street' | 'road' | 'water' | 'crag' | 'sacred' | 'terrain' | 'futureRing' | 'noRoad'
  | 'noCastellum' | 'noFons' | 'needsVia' | 'rankLocked' | 'maxCount';
export type FailCode =
  | PlaceFail | PauseCode
  | 'locked' | 'unaffordable' | 'window' | 'notReady' | 'chosen' | 'invalid' | 'notFound' | 'notOwner'
  | 'manualOnly' | 'ordoOnly' | 'full' | 'noSlots' | 'noChoice';
export type ActionResult = { ok: true; id?: number } | { ok: false; code: FailCode; reason: string };
export type PlaceCheck =
  | { ok: true; x: number; y: number; mult: number; notes: SiteNote[]; fell: number; cost: Cost; work: number; warn?: string; route?: number[] }
  | { ok: false; code: PlaceFail; reason: string };
export interface PlaceOpts { owner?: Owner; replaceId?: number; noStake?: boolean; reason?: Reason; ignoreCost?: boolean }

// ───────────────────────────── offline, prefs ─────────────────────────────
export interface Snapshot { day: number; pop: number; rank: RankIndex; morale: number; res: Res; grainDoh: number; waterDoh: number; births: number; deaths: number; immigrants: number; emigrants: number; built: number; evolvedBy: Partial<Record<HouseTierId, number>>; builtBy: Partial<Record<BuildingId, number>> }
export interface AwayReport {
  awayMs: number; daysPlanned: number; days: number;
  before: Snapshot; after: Snapshot;
  decided: string[]; highlights: LogEntry[];
  lowest: { grain: { doh: number; day: number }; water: { doh: number; day: number } };
  awaiting: { petition: RankIndex | null; advisories: RuleId[] };
}
export interface OfflineRun { days: number; progress(): number; step(n: number): boolean; report(): AwayReport }
export type Speed = 1 | 2 | 5 | 10 | 20;
export interface Prefs { sound: boolean; volume: number; speed: Speed; tips: boolean; slowForNews: boolean; pauseOnCritical: boolean }
export interface FastiEntry { name: string; seed: number; legacy: number; founded: number; dedicated: number | null; peakPop: number; paths: PathOptionId[]; playMs: number }
```

**Invariants**: `people`, `families`, `buildings`, `contracts`, `caravans` are kept sorted by id (append new ids, never reorder). `roads`/`paved` stay sorted unique. `wood` keys are tile indices (JSON turns them into strings; read with `Number(k)` and iterate sorted). Building ids start at 1 (`buildingAt` uses 0 = none).

---

## 5. Dependency rules
- `src/game/**` imports only `src/game/**`. No DOM, no `window`, no canvas, no `src/render`, no `src/ui`. No `Math.random`, `Date`, `performance` anywhere in `src/game` (a test greps for them). Only `save.ts` may touch `localStorage`; it receives `now` as a parameter.
- `src/render/**` imports `src/game/**` for **reading** (state, data, derived, coverage, calendar, sprite-name helpers) and `src/render/**`. It never mutates game state and never imports `src/ui`.
- `src/ui/**` imports `src/game/**` (reads; **mutates only through `src/game/actions.ts`** and `advisors/remedies.applyRemedy`), `src/render/sprites.ts` (icons via `spriteURL`), `src/render/art/index.ts` (sprite-name helpers only), `import type` from `src/render/view.ts`, and `src/ui/**`. It talks to the map only through the `Game` interface (`game.view`).
- `src/main.ts` may import anything.
- `tests/**` import `src/game/**` and `tests/**` only (headless; no DOM). Single exception: `tests/art.test.ts` imports `src/render/sprites.ts` and `src/render/art/**`, which must therefore do **no canvas work at import time** (registration stores grids and draw functions; rasterising happens on the first `sprite()` call).
- Within `src/game`, the import graph must stay acyclic at module-evaluation time: data and types have no imports except `types.ts`; `balance.ts` imports nothing. Cross-module calls inside functions are fine.

---

## 6. Calendar algorithm (`src/game/calendar.ts`, scaffold)
Port of rome's `state/calendar.ts` with one fix (inclusive counting before the Ides).
- `day 0` = 1 January AUC 800. Month lengths `[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]`; February has 29 days when `isLeapAuc(y)`: `AD = y − 753; AD > 0 && AD % 4 === 0`.
- `dateOf(day)`: walk whole years (365/366) then months; memoise the start day of each year in an array.
- Nones = 7 and Ides = 15 in March, May, July, October; otherwise 5 and 13.
- Short form `formatRoman(day)` with abbreviations `Ian. Feb. Mart. Apr. Mai. Iun. Iul. Aug. Sept. Oct. Nov. Dec.`:
  - d = 1 → `Kal. {M}`; d = Nones → `Non. {M}`; d = Ides → `Id. {M}`;
  - d = Nones − 1 → `pridie Non. {M}`; d = Ides − 1 → `pridie Id. {M}`; d = last day → `pridie Kal. {next M}`;
  - d < Nones → `a.d. {toRoman(Nones − d + 1)} Non. {M}`; d < Ides → `a.d. {toRoman(Ides − d + 1)} Id. {M}` (rome used `Ides − d`; fixed); otherwise `a.d. {toRoman(len − d + 2)} Kal. {next M}`.
  - With `{year: true}` append ` AUC {toRoman(y)}` (e.g. `AUC DCCC`).
- `formatRomanFull(day)` gives `Kalendae Apriles`, `Nonae Apriles`, `Idibus Aprilibus` for the three named days (genitive/ablative tables from rome), else the short form. `formatRomanLong(day)` spells numbers (*ante diem quartum Nonas Apriles*). `formatModern(day)` → `2 April AD 47`.
- `seasonOf(day)`: months 3–5 → 0 Ver, 6–8 → 1 Aestas, 9–11 → 2 Autumnus, 12/1/2 → 3 Hiems. `nextSeasonStart(day, season?)` returns the absolute day of the next Kal. Mart./Iun./Sept./Dec. (of that season if given). `isKalends(day)` ⇔ day of month = 1.
- Test: day 90 → `Kal. Apr.`; day 92 → `a.d. IV Non. Apr.`; day 102 → `pridie Id. Apr.`; day 101 → `a.d. III Id. Apr.`; day 151 → `Kal. Iun.`; day 334 → `Kal. Dec.`; day 425 → `Kal. Mart.` of AUC 801 (leap).

---

## 7. `src/game/balance.ts` (scaffold transcribes DESIGN; WP-J tunes)
One exported `as const` object `B`, grouped. Every number in DESIGN.md that is not part of a data registry lives here under these names (add keys freely inside your group; do not rename existing ones):
```ts
export const B = {
  LOG_CAP: 400,
  time:    { START_DAY: 90, SPEEDS: [1, 2, 5, 10], DEV_SPEED: 20, DT_CLAMP: 0.1, MAX_STEPS: 8, AUTOSAVE_S: 20,
             OFFLINE_RATE: 0.5, OFFLINE_MAX_DAYS: 1825, OFFLINE_MIN_MS: 60_000, SLICE_MS: 30, SLICE_DAYS: 10, UI_THROTTLE_MS: 200 },
  map:     { W: 112, H: 84, TILE: 16, PITCH: 5, INTERIOR_W: 31, INTERIOR_H: 21, FOSSA: 3, ROAD_MAX: 40, AQUEDUCT_MAX: 70,
             CASTELLUM_REACH: 18, FARM_SITES_MIN: 25, LOAM_MASK: 4 },
  people:  { NEED: [0.6, 0.85, 1, 0.75], YOUTH: 12, ADULT: 16, ELDER: 55, RETIRE: 65, BIRTH_RATE: 0.09, FERTILE: [16, 42],
             MARRY_P: 1 / 400, MARRY_MAX: 2, MARRY_M: [18, 50], MARRY_F: [16, 45], REMARRY_DAYS: 180, POP_CAP: 1500,
             HOMELESS_LEAVE: 20, EMIGRATE_MORALE: 25, EMIGRATE_P: 0.02,
             HAZARD: { infant: 0.04, child: 0.006, adult: 0.004, a: 0.01, mid: 55, scale: 7.5, care: 0.35 },
             STARVE_P: 0.012, THIRST_P: 0.015, OFFLINE_STARVE: 0.4, SKILL_XP: 0.004, SKILL_BONUS: 0.04, SKILL_MAX: 10,
             SKILL_LIFETIME: 20, ELDER_OUT: 0.7, HOUSEHOLD_MIX: [0.7, 0.2, 0.1] },
  needs:   { FULL: [-5, -6], HIGH: [-2, -2], HOLD: 0.6, WORSEN: [5, 7], BAND: [25, 50, 75], FED_ALPHA: 1 / 30, FED_MIN: 0.9 },
  economy: { MULT_CAP: 2.5, PROD_BASE: 0.85, PROD_MORALE: 0.3, TOOL_MULT: 1.2, TOOL_DAYS: 120, TOOL_TARGET: 0.5,
             IDLE_FORAGE: 0.3, IDLE_BUILD: 0.3, COIN_ALPHA: 1 / 30, SHED_ROT: 0.003, EVAPORATION: 0.002, OFF_TABLE: 0.6, UNPAID: 0.5,
             PORTIONS: { largae: 1.15, plenae: 1, parcae: 0.85, arctae: 0.7 },
             WOOD: { REPLANT: 0.003, NATURAL: 0.0005, HIEMS: 0.25, MATURE: 0.5, STUMP: 0.25, FELL_WORK: 1 / 12, CATCHMENT: 4, MIN: 40 } },
  housing: { CHECK_EVERY: 5, OK_DAYS: 15, RENOVATE_DAYS: 8, DECLINE_AFTER: 20, RECOVER_DAYS: 10, DROP_AFTER: 60,
             OFFLINE_DECLINE_STOP: 55, THROTTLE_WINDOW: 10, THROTTLE_PER: 8, DESIR_DOMUS: 10,
             GOODS: { oil: 0.05, wine: 0.05 }, SUPPLY_ALPHA: 0.1, SUPPLIED: 0.8, AQUAE_BEDS: 6, AQUAE_TAX: 1.3, DESIR_CLAMP: [-20, 30] },
  morale:  { BASE: 50, START: 65, ALPHA: 0.05, GRAIN_TERMS: [[30, 5], [15, 2], [7, -3], [0, -10]],
             RATION_TERMS: { largae: 6, plenae: 0, parcae: -6, arctae: -14 }, SHORT: 20, TIER: 2, RELIGION: 8, BATHS: 5,
             CULTURE: 6, HOMELESS: 20, DECLINING: 10, DEATHS: 2, DEATHS_CAP: 12, LEGACY: 2, LABELS: [75, 50, 30] },
  construction: { STAKE_DAYS: 5, FULL_REFUND_DAYS: 5, REFUND_CANCEL: 0.75, REFUND_DEMOLISH: 0.25,
             CAP_CREW: 64, CAP_WORK: 320_000, CAP_STAGES: [0.25, 0.5, 0.75, 1],
             CAP_MAT: { stone: 24_000, concrete: 9_000, tiles: 4_000, iron: 1_800, denarii: 160_000 } },
  ordo:    { BUILD_EVERY: 2, TRADE_EVERY: 10, TRADE_OFFSET: 5, SITES_PER: 40, SITES_MAX: 4, FOOD_CAP: 0.75, FOOD_CAP_HUNGRY: 0.9,
             BUILDERS_MIN: 2, BUILDERS_MAX: 0.3, WATER_BASE: 1.05, WATER_LOW: 1.2, WATER_THIRST: 1.5, WATER_PREFILL: 1.3,
             FOOD_LOW: 1.2, FOOD_HUNGRY: 2, FOOD_HIEMS: 1.4, FOOD_FULL: 0.85, WINTER_FILL: 1.35, REQUESTS_MAX: 3,
             REQUEST_DAYS: 180, TOOLS_PER: 0.5, LUXURY: 1.2, EVOLVE_MIN: 2, EVOLVE_MIN_BLOCK: 3,
             EXPORT_CAP: 0.95, EXPORT_CAP_MERCATURA: 0.6, IMPORT_RUNWAY: 90, MERCHANT_RUNWAY: 60, WISH_WAIT: 40, CARGO: 80,
             LUXURY_RUNWAY: 60, GOODS_FLOOR: 15 },
  emergency: { PARCAE: 12, ARCTAE: 6, LIFT: 25, WATER_PAUSE: 8, WATER_RESUME: 15, IMPORT_AT: 8, IMPORT_DAYS: 20,
             IMPORT_COOLDOWN: 90, RELIEF_STRUCT: 10, RELIEF_LOW: 6, RELIEF_DAYS: 30, RELIEF_ARRIVE: 5, RELIEF_PRICE: 2,
             RELIEF_REPAY: 0.25, RELIEF_COOLDOWN: 365 },
  events:  { START: 300, CHANCE: 1 / 40, CHOICE_GAP: 200, HARMFUL_GAP: 120, CHOICE_DAYS: 30, RELIEF_DAYS: 15,
             CLAMP_RES: 0.3, CLAMP_POP: 0.05, MERCHANT_P: 0.012, MERCHANT_GAP: 60, MERCHANT_STAY: 30,
             BANDIT_P: 0.08, BANDIT_DAYS: 12, BANDIT_LOSS: 0.3, VETERAN_STAY: 30 },
  trade:   { REVERT: 0.02, IMPACT: 0.0015, CLAMP: [0.6, 1.6], CARGO_PER_DAY: 40, MIN_LEG: 3,
             MERCHANT_BUY: 0.85, MERCHANT_SELL: 1.15, MERCHANT_QTY: [10, 60], MERCHANT_SELL_QTY: [10, 80] },
  advisors:{ CLEAR: 1.25, DOWNGRADE_DAYS: 3, MIN_LIFE: 3, HUSH_DAYS: 30, FLAP_WINDOW: 60, FLAP_MAX: 2, BELL_S: 30 },
} as const;
```
The values above are the tuned ones (the balance pass changed `BIRTH_RATE` 0.2 → 0.09, `CAP_WORK` 160,000 → 320,000, `CAP_MAT.denarii` 40,000 → 160,000 and `EXPORT_CAP` 0.8 → 0.95); `balance.ts` holds many more keys inside these groups and is the reference.
Rank-specific numbers (ceiling, territory, rings, immigration rate, subsidy, fees, dignitas thresholds, forum stage) live in `data/ranks.ts`; per-building numbers in `data/buildings.ts`; per-tier numbers in `data/housing.ts`; prices, hubs and seasonal targets in `data/hubs.ts`.

---

## 8. Module contracts (exports, signatures, one-line contracts)

### 8.1 Scaffold modules (implemented fully by the scaffold)

**`rng.ts`**
```ts
export class Rng {
  constructor(public state: number);
  next(): number;                                            // mulberry32 → [0, 1)
  range(min: number, max: number): number;
  int(min: number, maxIncl: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: { w: number; v: T }[]): T | null;       // ignores w ≤ 0; null if none
  shuffle<T>(arr: T[]): T[];                                 // in place
}
export function hash2(x: number, y: number, seed?: number): number;      // stateless [0, 1); terrain, sprite variants, walkers
export function hashStr(s: string): number;
export function withRng<T>(s: GameState, fn: (r: Rng) => T): T;          // for actions outside the tick; writes back s.rng
```
mulberry32: `t = (state = (state + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296`. The game stream starts at `seed ^ 0x9e3779b9`; map generation uses `new Rng(seed ^ 0x51ed27)` and `hash2`.

**`calendar.ts`** — §6: `dateOf`, `dayOf`, `isLeapAuc`, `daysInMonth`, `seasonOf`, `nextSeasonStart`, `seasonStartOf`, `seasonDay`, `isKalends`, `nonesOf`, `idesOf`, `toRoman`, `formatRoman`, `formatRomanFull`, `formatRomanLong`, `formatModern`, `aucYear`, `elapsed(s)`, constants `MONTH_ABBR`, `SEASON_NAMES`.

**`fx.ts`**
```ts
export function fx(s: GameState, key: MulKey): number;                // product of every active source (default 1)
export function fxAdd(s: GameState, key: AddKey): number;             // sum (default 0)
export function fxSources(s: GameState): { label: string; fx: Effects }[];   // chosen path options, current edict options, active modifiers
export function fxBreakdown(s: GameState, key: MulKey | AddKey): { label: string; value: number }[];
```
Memoised per state on the signature `paths + edicts + active modifier ids`. Focus contributes nothing. Legacy and emergency portions are *not* in fx (economy applies them).

**`memo.ts`**
```ts
export function invalidate(s: GameState): void;          // structure changed (buildings, roads, rank, reserved blocks, staffing open/closed): bumps struct and census epochs
export function touchPeople(s: GameState): void;         // people, homes or jobs changed: bumps the census epoch
export function structEpoch(s: GameState): number;
export function censusEpoch(s: GameState): number;
export function memo<T>(s: GameState, slot: string, key: string | number, compute: () => T): T;   // one cached value per (state, slot)
export function pushActionFx(e: FxEvent): void;          // fx raised by player actions between ticks
export function drainActionFx(): FxEvent[];
```
Epoch counters live in a `WeakMap<GameState, …>` (never saved; a reloaded state starts fresh). Memoised values must be pure functions of the state.

**`state.ts`**
```ts
export function newGame(opts: { seed: number; legacy?: number; legacyBonus?: number; name?: string; now: number }): GameState;   // DESIGN §18.1
export function foundingRoster(day: number, nextId: () => number): { people: Person[]; families: Family[] };   // DESIGN §6.2
export function nextId(s: GameState): number;
export function log(s: GameState, kind: LogKind, text: string, tags?: LogTag[], ref?: number): void;   // trims to B.LOG_CAP
export function canAfford(s: GameState, cost: Cost, reserved?: Cost): boolean;
export function pay(s: GameState, cost: Cost): void;
export function refund(s: GameState, cost: Cost, frac: number): void;
export function addCost(a: Cost, b: Cost): Cost;
export function scaleCost(c: Cost, k: number): Cost;
export function missing(s: GameState, cost: Cost, reserved?: Cost): Cost;   // what is short
export function getBuilding(s: GameState, id: number): Building | undefined;   // binary search on id
export function getPerson(s: GameState, id: number): Person | undefined;
export function emptyRes(): Res;
```
`newGame` builds: the map (`getMap`), the six start tentoria plots and the start puteus on the plots of DESIGN §18.1 (direct insertion, status `done`, owner `start`), the principia, the ager at `map.startAger`, all castrum interior street tiles + gate tiles + the via (`roads`), the roster with homes and jobs, defaults for decisions (focus `concordia`, edicts at `initial`, settings at `initial`, switches on), Ordo (all on; `manual` = 0s), trade (market 1.0), guidance (appointed annonae/aquarum/fabrum), counters, stats, the opening log line. `s.rng = (seed ^ 0x9e3779b9) | 0`.

**Data** (`src/game/data/*.ts`) — transcriptions of DESIGN tables:
| File | Exports |
|---|---|
| `resources.ts` | `RESOURCE_DEFS: Record<ResId, ResourceDef>` |
| `buildings.ts` | `BUILDING_DEFS: Record<BuildingId, BuildingDef>`, `BUILD_ORDER: BuildingId[]`, `CAT_LABELS: Record<BuildCat, {latin: string; english: string}>`, `TOOL_ORDER: BuildingId[]` |
| `housing.ts` | `TIER_DEFS: Record<HouseTierId, HouseTierDef>`, `NEED_META: Record<NeedId, {label: string; icon: string}>`, `LAYER_META: Record<CoverageLayerId, {label: string; color: string}>` |
| `decisions.ts` | `FOCUS_DEFS`, `EDICT_DEFS`, `PATH_DEFS`, `SETTING_DEFS`, `SWITCH_DEFS` (Records keyed by id) |
| `ranks.ts` | `RANK_DEFS: RankDef[]` (index 0..4) |
| `hubs.ts` | `HUB_DEFS: Record<HubId, HubDef>`, `TRADE_BASE: Record<TradeRes, number>`, `SEASON_TARGET: Record<TradeRes, Quad>`, `MERCHANT_NAMES: string[]` |
| `names.ts` | `PRAENOMINA: string[]` (rome's 36), `DAUGHTER_COG: string[]` (`''`, Secunda, Tertia, Quarta, Quinta), `GENTES_FOUNDING`, `GENTES_VETERAN`, `GENTES_IMMIGRANT`, `COLONY_NAMES`, `feminine(gens: string): string` (`-ius → -ia`, `-us → -a`) |
| `advisors.ts` | `ADVISOR_DEFS: Record<AdvisorId, AdvisorDef>`, `MENTOR: {name: string; title: string}` |

**`actions.ts`** — §8.7. **`sim.ts`** skeleton — §9 (the scaffold writes the order with calls to the stubs; WP-B owns it afterwards).

### 8.2 World and placement (WP-A)

**`map.ts`**
```ts
export const W: number; export const H: number;
export const idx: (x: number, y: number) => number;      // y * W + x
export function tx(i: number): number; export function ty(i: number): number; export function inBounds(x: number, y: number): boolean;
export function getMap(seed: number): WorldMap;           // pure; cache of the last 4 seeds; DESIGN §3.3 incl. guarantees and retries
export function isFertile(t: Terrain): boolean;           // grass, meadow, loam, scrub
export function fertility(t: Terrain): number;            // 1.0, 1.1, 1.25, 0.75; 0 otherwise
export function woodAt(s: GameState, i: number): number;  // s.wood[i] ?? map.woodMax[i]
export function isWooded(s: GameState, i: number): boolean;   // woodMax > 0 && woodAt ≥ 25% of woodMax
export function distToRect(i: number, r: Rect): number;   // Chebyshev distance (0 inside)
```
The scaffold ships a **toy map** (`getMap` returns it for every seed until WP-A lands): grass everywhere; river columns x 92–93 (3 wide below y 42) with loam within 2; castrum interior origin `(36, 28)`, `viaDir 'W'`, via along y 38 to x 0; forest x 4–22, y 4–24 (dense where 8 ≤ x ≤ 18, 8 ≤ y ≤ 20); hills x 76–88, y 60–80 with rock x 80–84, y 64–70; ore (82,72), (83,72), (82,73) quality 1.1; fons (86, 78); clay on west-bank tiles with y % 3 == 0; scrub x 10–30, y 60–78; lucus (20, 50); `startAger (40, 60)`. It satisfies every guarantee of DESIGN §3.3 so other packages can test.

**`survey.ts`** (scaffold writes; WP-A owns afterwards)
```ts
export function computeSurvey(map: Omit<WorldMap, 'survey'>, ix: number, iy: number, viaDir: 'E' | 'W'): Survey;
export function plotOrigin(b: Block, plot: 0 | 1 | 2 | 3): { x: number; y: number };   // 0 TL, 1 TR, 2 BL, 3 BR
export function halfOrigin(b: Block, half: 0 | 1): { x: number; y: number };           // 0 top (plots 0,1), 1 bottom (2,3)
export function blockStreets(sv: Survey, b: Block): number[];                            // its 4 perimeter street sides (incl. corners)
export function activeRings(rank: RankIndex): number[];
export function isActiveBlock(sv: Survey, b: Block, rank: RankIndex): boolean;           // !masked && !reserved && ring active
```
Geometry (castrum coordinates relative to `(ix, iy)`): street lines at x ∈ {0, 5, …, 30}, y ∈ {0, 5, …, 20}; interior blocks `bx 0..5, by 0..3` at `(ix + 5bx + 1, iy + 5by + 1)`; forum = blocks (2..3, 1..2) plus the streets between = rect `(ix+11, iy+6, 9, 9)`; Area Capitolina = blocks (2..3, 0) + `sacredWay` (ix+15, iy+1..4) = rect `(ix+11, iy+1, 9, 4)`; wall ring at offset −1 (x = ix−1 / ix+31, y = iy−1 / iy+21) with gates at the 4 street ends `(ix−1, iy+10)`, `(ix+31, iy+10)`, `(ix+15, iy−1)`, `(ix+15, iy+21)`; fossa = Chebyshev offsets 2..4 outside the interior except the 4 gate causeways; castrum rect `(ix−4, iy−4, 39, 29)`. Outside the castrum the same pitch continues: ring 1 = block coords with `bx ∈ {−2, 7}` (by −2..5) or `by ∈ {−2, 5}` (bx −1..6); ring 2 = `bx ∈ {−3, 8}` (by −3..6) or `by ∈ {−3, 6}` (bx −2..7); blocks at bx −1/6 or by −1/4 overlap the wall/fossa and do not exist. Street tiles of rings are the pitch lines bounding ring blocks (outside the castrum rect). Via = the decumanus line (`y = iy+10`) from the Porta Praetoria gate outward to the map edge; river tiles on it are `bridge`. Masking and districts: DESIGN §3.4–3.5.

**`derived.ts`**
```ts
export function derived(s: GameState): Derived;                       // memo(s, 'derived', structEpoch)
export function sizeOf(type: BuildingId, cls: PlaceClass): [number, number];   // plot 2×2, half 4×2, block 4×4, rural def.size, principia 9×9, capitolium 9×4
export function footprintOf(b: Pick<Building, 'type' | 'x' | 'y'>, s: GameState): number[];
export function classAt(s: GameState, type: BuildingId, x: number, y: number): PlaceClass;   // plot/half/block if on an active block, else rural
export function ringOf(x: number, y: number, w: number, h: number): { tiles: number[]; corner: boolean[] };   // clockwise
export function blockOfTile(s: GameState, i: number): Block | null;
export function roadNeighbors(s: GameState, b: Building): number[];   // built road tiles N4-adjacent to the footprint
```

**`coverage.ts`**
```ts
export function effectiveRadius(s: GameState, b: Building, layer: CoverageLayerId): number;   // DESIGN §5.2 activity rule + fxAdd radius bonuses; 0 when inactive/unpaid-halved
export function coverage(s: GameState): Coverage;                     // BFS per layer over built roads; memo on structEpoch + effective-radius key
export function houseHas(s: GameState, houseId: number, layer: CoverageLayerId): boolean;
export function previewCoverage(s: GameState, type: BuildingId, x: number, y: number): { layer: CoverageLayerId; tiles: Uint8Array; houses: number[] }[];   // as if built and fully staffed
export function desirability(s: GameState): Float32Array;             // per tile, memo on structEpoch
export function houseDesir(s: GameState, houseId: number): number;    // average over its 4 tiles
export function previewDesir(s: GameState, type: BuildingId, x: number, y: number): { tile: number; v: number }[];
export function tierShiftDesir(s: GameState, b: Building, from: HouseTierId, to: HouseTierId): Map<number, number>;   // a house's rise, per tile
```

**`place.ts`** — the placement pipeline. `canPlace` runs these checks **in order** and returns the **first** failure with exactly this code and reason:

| # | Check | Code | Reason |
|---|---|---|---|
| 1 | footprint inside the map | `offMap` | Beyond the surveyed land. |
| 2 | `def.rank ≤ s.rank` | `rankLocked` | Rome grants this to a {Rank}. |
| 3 | `maxCount` not reached | `maxCount` | Only {n} may be raised. |
| 4 | not `principia`/`capitolium` | `reserved` | Reserved by the groma. |
| 5 | urban: slot is in an active block | `castrum` / `notInPomerium` / `terrain` / `notOnSlot` | The walls and ditch stay clear. / Outside the pomerium: become a {Rank} to survey these blocks. / The surveyors left this block to the fields. / Choose a surveyed plot. |
| 6 | urban: block not forum/capitolium, plots free | `reserved` / `occupied` | Reserved by the groma. / That plot is taken. |
| 7 | rural: each tile in territory, not castrum, not survey street, not road, not active block, not reserved | `outsideTerritory` / `castrum` / `street` / `road` / `notInPomerium` / `reserved` | Too far for our people to walk each day. / Inside the castrum only surveyed plots. / The survey keeps this line for a street. / A road runs here. / Inside the pomerium only urban works. / Reserved for the aqueduct. |
| 8 | rural, owner `ordo`: not on an unmasked future-ring block | `futureRing` | Surveyed for the canabae. |
| 9 | terrain: no river, crag, lucus, ruins; rock and ore only for lapicidina/fodina | `water` / `crag` / `sacred` / `terrain` | The river. / Too steep to build. / Sacred ground: the gods would not forgive it. / An iron vein: keep it for a mine. |
| 10 | not occupied by another building | `occupied` | Something already stands here. |
| 11 | site rule | `terrain` / `needsVia` / `noCastellum` / `noFons` | Fields need seven fertile tiles. · Needs ten wooded tiles nearby. · No standing timber within 4 tiles. · Needs hills or rock. · Must touch a clay bank. · Must stand on an iron vein. · Olives need dry slopes. / Must touch the via. / No castellum within 18 paces. / No spring can be reached. |
| 12 | rural: an auto-road exists | `noRoad` | No road can reach it. |
On success it returns `mult`, `notes`, felling yield `fell`, total `cost` and `work` (incl. route for a castellum), and a `warn` (player on a future-ring block; or *"Need 12 more stone (≈ 4 days at our quarry's pace)"* when unaffordable — not a failure).
```ts
export function snapSlot(s: GameState, type: BuildingId, tile: number): { x: number; y: number } | null;
export function canPlace(s: GameState, type: BuildingId, tile: number, opts?: PlaceOpts): PlaceCheck;
export function validSlots(s: GameState, type: BuildingId, owner: Owner): Map<number, number>;   // origin tile → mult; memo on type+owner+structEpoch
export function placeBuilding(s: GameState, type: BuildingId, tile: number, opts?: PlaceOpts): ActionResult;
export function demolish(s: GameState, id: number): ActionResult;
export function buildRoad(s: GameState, tiles: number[]): ActionResult;
export function pave(s: GameState, tiles: number[]): ActionResult;
export function toggleReserveBlock(s: GameState, blockId: number): ActionResult;
export function roadPathFor(s: GameState, footprint: number[]): number[] | null;   // new tiles only
export function streetsForBlock(s: GameState, blockId: number): number[];           // new tiles only
export function routeAqueduct(s: GameState, x: number, y: number): { fons: number; tiles: number[] } | null;
export function ceremonyPaving(s: GameState, what: 'castrumAxes' | 'via'): void;    // called by rankUp / Via militaris
```
`placeBuilding`: validates; with `replaceId` first cancels that Ordo stake at 100%; affordable → pays and creates the site (`status` = `staked` for owner `ordo` unless `noStake`, else `building`); unaffordable → owner `player` makes a `plan`, owner `ordo` fails `unaffordable`. Then fells forest under rural footprints (timber to stores, `s.wood[i] = 0`, work += stock × FELL_WORK), lays streets (urban) or the auto-road (rural) instantly and free, sets `reason`/`notes`, sets `order` = next id, appends the building (ids ascending), logs (Ordo placements: kind `ordo` with the reason text), and calls `invalidate(s)`. `house` state is created when an `area` completes.

**`site.ts`**
```ts
export function siteMultAt(s: GameState, type: BuildingId, x: number, y: number): { mult: number; notes: SiteNote[] };   // DESIGN §5.1 adjacency formulas
export function siteMult(s: GameState, b: Building): number;          // memo per building on structEpoch (+ forest change bucket)
export function siteScore(s: GameState, type: BuildingId, x: number, y: number, purpose?: ReasonCode): { score: number; notes: SiteNote[] };   // DESIGN §10.5
export function bestSlot(s: GameState, type: BuildingId, opts?: { owner?: Owner; purpose?: ReasonCode }): { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null;   // over validSlots; ties by lowest tile; memo on type+owner+purpose+epochs
```

### 8.3 Simulation core (WP-B)

**`economy.ts`** — the one formula module (tick, forecast, Ordo and tooltips all call it)
```ts
export function portion(s: GameState): number;                        // edict portion overridden by emergency rations (the lower wins)
export function needPerDay(s: GameState, res: Essential, c?: Census): number;
export function seasonMult(s: GameState, type: BuildingId, season: SeasonIndex): number;   // data seasons + hiemsFields for ager
export function workerMult(s: GameState, b: Building, p: Person): number;                // capped part: min(MULT_CAP, site × skill × tool × productivity × fx × legacy)
export function workerOutput(s: GameState, b: Building, p: Person, season: SeasonIndex): number;   // full formula DESIGN §8.1
export function buildingRate(s: GameState, b: Building, season: SeasonIndex, mode: 'current' | 'full'): Partial<Res>;   // net per day (inputs negative); 'full' = all slots at the building's current average worker
export function maxPotential(s: GameState, res: Essential, season: SeasonIndex): number;   // best assignment of the workforce to existing producers (food cap applied) + passive
export function caps(s: GameState): Res;
export function horreaCap(s: GameState): number;
export function produce(s: GameState, ctx: TickContext, rng: Rng): void;   // water first, then food, passive, processing with per-worker reservations and the water/grain floors, idle forage, skill XP, forest draw; writes rates.prod
export function consume(s: GameState, ctx: TickContext): void;             // tiered rationing per resource, hunger/thirst per group, fed EMA, Watch-band log; writes rates.cons
export function storage(s: GameState, ctx: TickContext): void;             // caps (spill), shed rot, evaporation, forest regrowth
export function issueTools(s: GameState, ctx: TickContext): void;
```
**`census.ts`**
```ts
export function census(s: GameState): Census;                    // memo on day + censusEpoch + structEpoch
export function ageOf(p: Person, day: number): number;
export function stageOf(p: Person, day: number): StageIndex;
export function canWork(s: GameState, p: Person): boolean;       // adult or elder < 65, not patrician, not sick
export function isPatrician(s: GameState, p: Person): boolean;   // home is a domus
export function houseBeds(s: GameState, b: Building): number;    // tier beds + lowCap/insulaCap + aquae; half when damaged
export function residents(s: GameState, houseId: number): Person[];
```
**`people.ts`**
```ts
export function personName(p: Person): string;                   // 'Marcus II Valerius', 'Valeria Secunda', 'Valeria Prisca'
export function assignJobs(s: GameState, plan: LabourPlan): void; // sticky; fill empty slots with the best-skilled idle; builders = plan.builders; touchPeople
export function peopleDay(s: GameState, ctx: TickContext, rng: Rng): void;   // stage-change logs, deaths (hazard, starvation, thirst, fever), widowing, marriages (gens buckets), births, homeless timers, emigration, mentor death
export function immigrationDay(s: GameState, ctx: TickContext, rng: Rng): void;   // one Bernoulli roll; roll and beds respected
export function splendour(s: GameState): number;                     // dignitas of the works the Ordo leaves to the player: gardens, paved streets (DESIGN §6.6)
export function renownFactor(s: GameState): number;                  // Rome's favour: min(RENOWN.MAX, 1 + RENOWN.K × splendour per home); ×1 for a colony kept by the Ordo alone
export function makeFamily(s: GameState, rng: Rng, kind: 'couple' | 'craftsman' | 'widow' | 'veteran', gentes: readonly string[]): { family: Family; people: Person[] };
export function settleFamily(s: GameState, ctx: TickContext, fam: { family: Family; people: Person[] }): boolean;   // house in the most free beds nearest the forum; fx arrive
export function rehouse(s: GameState): void;
export function gainSkill(p: Person, skill: SkillId, amount: number): void;   // respects SKILL_MAX and SKILL_LIFETIME
```
**`housing.ts`**
```ts
export function nextTier(s: GameState, b: Building): HouseTierId | null;     // T3 → insula/domus by preference and desirability
export function unmetNeeds(s: GameState, b: Building, tier: HouseTierId): NeedId[];   // in the tier's need order
export function crowds(s: GameState, b: Building, to: HouseTierId): { id: number; short: number }[];   // neighbours the rise would push below their tier (DESIGN §7.2)
export function firstWant(s: GameState, b: Building): NeedId | null;
export function housesUnlockedBy(s: GameState, type: BuildingId, x: number, y: number): number[];
export function houseTax(s: GameState, b: Building): number;                   // per resident per day incl. declining ×0.5 and aquae
export function isAquae(s: GameState, b: Building): boolean;
export function renovationPool(s: GameState, v: SimView): Cost;
export function housingDay(s: GameState, ctx: TickContext): void;              // slot checks, renovation start/finish, decline/recover/drop (offline: no drop)
export function goodsDay(s: GameState, ctx: TickContext): void;                // oil/wine delivery and supply EMAs
export function goodsTier(s: GameState, b: Building): HouseTierId | null;      // the tier whose goods a house draws (T4; a stone house waiting only on them)
export function goodsDemand(s: GameState): { oil: number; wine: number; servedOil: number; servedWine: number };   // daily draw at full supply
export function setHousePref(s: GameState, id: number, pref: HousePref): ActionResult;
```
**`construction.ts`**
```ts
export function worksQueue(s: GameState): Building[];                 // unfinished: player-owned first, then order, then id
export function startStaked(s: GameState): void;                      // staked → building after STAKE_DAYS
export function payPlans(s: GameState, ctx: TickContext): void;       // plans become sites when the stock covers them (ignores reservations except the petition fee)
export function constructionDay(s: GameState, ctx: TickContext): void;   // builder work along the queue; Capitolium crew cap and gradual materials; stages; completions → status done, house state, fx built/stage, invalidate, log, stats
export function capitoliumStage(b: Building): 0 | 1 | 2 | 3 | 4;
export function capitoliumFlow(s: GameState): { stage: number; eta: number | null; bottleneck: ResId | 'crew' | null; rate: number; need: number; supply: number; demand: number } | null;   // rate/need in work units; supply/demand the bottleneck material per day (0 when the crew binds)
export function startCapitolium(s: GameState): void;                 // creates the Capitolium site on the Area Capitolina
export function cancelSite(s: GameState, id: number): ActionResult;   // 100% within FULL_REFUND_DAYS and no work, else 75%; plans refund nothing (unpaid)
export function prioritise(s: GameState, id: number): ActionResult;
export function setOpen(s: GameState, id: number, open: boolean): ActionResult;
export function setPrio(s: GameState, id: number, prio: 0 | 1 | 2): ActionResult;
```
**`civic.ts`**
```ts
export function moraleTarget(s: GameState, v: SimView): { value: number; terms: { label: string; value: number }[] };
export function moraleDay(s: GameState, v: SimView): void;
export function dignitas(s: GameState): { value: number; groups: { works: number; homes: number; roads: number; deeds: number; fama: number } };   // memo on day
export function taxesDay(s: GameState, ctx: TickContext): void;       // accrue taxes + market tax, subsidy paid daily; coinEma
export function upkeepDay(s: GameState, ctx: TickContext): void;      // pay or mark unpaid
export function kalendsDay(s: GameState, ctx: TickContext): void;     // pay accrued taxes (relief-debt share first), ledger log line, fx taxes
```
**`forecast.ts`**
```ts
export function forecast(s: GameState): Forecast;                     // memo on day + epochs; pure; DESIGN §11.11
export function projectEssential(s: GameState, res: Essential): EssentialForecast;
```
**`sim.ts`**
```ts
export function tick(s: GameState, ctx: TickContext): void;           // §9
export function view(s: GameState): SimView;                          // lazy getters: derived, census, forecast, coverage
export function emptyRates(): Rates;
export function newCtx(offline?: boolean): TickContext;
export function previewRates(s: GameState): Rates;                    // one throwaway tick on structuredClone(s) (HUD after load)
```

### 8.4 The Ordo (WP-C)
```ts
// ordo/index.ts
export function runOrdo(s: GameState, ctx: TickContext, rng: Rng, v: SimView): LabourPlan;   // emergency (daily) → labour (daily) → requests (daily) → build (day % 2 == 0) → trade (day % 10 == 5); respects toggles; offline + governAway runs manual areas
export function councilReport(s: GameState): CouncilReport;          // last report (module WeakMap; never saved); an empty report before the first tick
export function ordoActive(s: GameState, area: OrdoArea, offline: boolean): boolean;
// ordo/labour.ts
export function planLabour(s: GameState, v: SimView): LabourPlan;    // DESIGN §10.4, a Reason per line
export function manualPlan(s: GameState, v: SimView): LabourPlan;    // category targets → buildings (High first, then nearest the forum)
// ordo/build.ts
export function ordoBuild(s: GameState, ctx: TickContext, v: SimView): void;   // DESIGN §10.5 (cadence, concurrency, stakes, savingFor, take/ready/pending)
export function processRequests(s: GameState, ctx: TickContext, v: SimView): void;   // places requests and the pin (player sites, no stake, fx ordoPlaced)
export function wishList(s: GameState, v: SimView, n: number): WishView[];      // pure; the Agenda and the "would" ghost
export function keptBlocks(s: GameState): readonly { rect: Rect; for: BuildingId }[];   // blocks kept free for a temple/bathhouse/market hall to come, the theatrum, the thermae (DESIGN §10.5)
// ordo/goods.ts
export function goodsPlan(s: GameState, v: SimView, res: 'oil' | 'wine', own?: boolean): GoodsPlan;   // demand, presses by season, lean-season reserve, export keep, projection low/empty day, shortfall (memo per day)
// ordo/trade.ts
export function ordoTrade(s: GameState, ctx: TickContext, v: SimView): void;   // DESIGN §10.7
export function ordoTradeWould(s: GameState, v: SimView): Reason | null;
export function luxuryCaravans(s: GameState, v: SimView, res: 'oil' | 'wine'): { need: number; short: number };   // standing imports the projection lacks
// ordo/emergency.ts
export function emergencyDay(s: GameState, ctx: TickContext, v: SimView): void; // DESIGN §8.7 steps 1–4 (step 4 calls events.triggerRelief)
// ordo/saving.ts
export function savingFor(s: GameState, v: SimView): { cost: Cost; for: 'petition' | 'plan' | 'pin' | 'request' | 'wish' } | null;
export function reserved(s: GameState, v: SimView): Cost;           // saving target + next 30 days of Capitolium materials
export function canSpend(s: GameState, cost: Cost, v: SimView, opts?: { survival?: boolean }): boolean;   // stock − reserved ≥ cost and denarii stay ≥ treasury floor (survival ignores both)
// ordo/actions.ts
export function askOrdo(s: GameState, type: BuildingId): ActionResult;     // max 3; needs Ordo construction on
export function pinBuild(s: GameState, type: BuildingId | null): ActionResult;
export function setOrdo(s: GameState, area: OrdoArea, on: boolean): ActionResult;
export function setManualTarget(s: GameState, cat: LaborCat, n: number): ActionResult;   // manual labour only
export function applyOnce(s: GameState, area: OrdoArea): ActionResult;    // labour: copy the Ordo plan into manual targets; build: place wish #1 as a player site; trade: create the would-be contract
export function setLabourPriority(s: GameState, cat: LaborCat, days: number): ActionResult;
// ordo/reasons.ts
export function reasonText(r: Reason): string;                        // full sentence for tooltips/Annales
export function reasonShort(r: Reason): string;                       // ticker fragment
```

### 8.5 Progression, events, trade, persistence (WP-D)
```ts
// decisions.ts
export function edictOption(s: GameState, id: EdictId): string;
export function settingValue(s: GameState, id: SettingId): number;   // the initial value until unlocked
export function switchOn(s: GameState, id: SwitchId): boolean;
export function edictWindow(s: GameState, id: EdictId): { open: boolean; next: number };   // next = nextSeasonStart after a change
export function setFocus(s: GameState, f: FocusId): ActionResult;
export function setEdict(s: GameState, id: EdictId, option: string): ActionResult;        // 'locked' / 'window' failures with reasons
export function setSetting(s: GameState, id: SettingId, value: number): ActionResult;
export function setSwitch(s: GameState, id: SwitchId, on: boolean): ActionResult;
export function renameColony(s: GameState, name: string): ActionResult;
export function nextPath(s: GameState): PathDecisionId | null;
export function petitionNeeds(s: GameState, v: SimView): { decision: PathDecisionId; rank: RankIndex | null; needs: { label: string; met: boolean }[]; ready: boolean; fee: Cost; affordable: boolean } | null;
export function choosePath(s: GameState, decision: PathDecisionId, option: PathOptionId): ActionResult;   // pays fee × fx(petitionFee), records, rankUp, Colonia → startCapitolium; pushActionFx
export function rankUp(s: GameState, rank: RankIndex): void;          // rings/territory (invalidate), ceremony paving, log, fx rank
export function isUnlocked(s: GameState, ref: UnlockRef): boolean;
// objectives.ts
export const MILESTONES: MilestoneDef[];                              // DESIGN §9.4, in order
export function checkObjectives(s: GameState, ctx: TickContext): void; // loops; logs; fx milestone
export function currentMilestone(s: GameState): MilestoneDef | null;
export function milestoneDone(s: GameState, id: MilestoneId): boolean;
export function updateCounters(s: GameState, v: SimView): void;       // fedStreak, stabStreak
// reveal.ts
export function tabRevealed(s: GameState, tab: TabId): boolean;
export function resourceRevealed(s: GameState, res: ResId): boolean;
export function sectionRevealed(s: GameState, sec: SectionId): boolean;
export function overlayRevealed(s: GameState, o: OverlayId): boolean;
export function toolRevealed(s: GameState, t: ToolId): boolean;
export function buildingVisible(s: GameState, type: BuildingId): boolean;   // hidden when ≥ 2 ranks ahead
export function nextTeaser(s: GameState): { label: string; at: string } | null;
// events.ts
export function eventsDay(s: GameState, ctx: TickContext, rng: Rng, v: SimView): void;   // festivals, gate expiry, choice expiry (default), random roll with pacing rules
export function chooseOption(s: GameState, index: number): ActionResult;  // the player answers the pending card
export function fireEvent(s: GameState, ctx: TickContext, rng: Rng, v: SimView, id: EventId): boolean;   // starts one event now if its conditions hold (used by eventsDay and tests)
export function triggerRelief(s: GameState, ctx: TickContext, v: SimView): void;   // relief card (offline: auto-accept)
export function banditCheck(s: GameState, ctx: TickContext, rng: Rng, caravan: Caravan): void;
// trade.ts
export function price(s: GameState, hub: HubId, res: TradeRes, side: 'buy' | 'sell'): number | null;   // null = refused
export function tripDays(s: GameState, hub: HubId, qty: number): number;   // one-way
export function caravanSlots(s: GameState): number;
export function slotsInUse(s: GameState): number;
export function hubOpen(s: GameState, hub: HubId): boolean;
export function tradeDay(s: GameState, ctx: TickContext, rng: Rng, v: SimView): void;   // market drift, returns, dispatch of idle contracts, merchant arrival/departure
export function createContract(s: GameState, spec: ContractSpec, owner?: 'player' | 'ordo', reason?: Reason): ActionResult;
export function cancelContract(s: GameState, id: number): ActionResult;
export function resumeContract(s: GameState, id: number): ActionResult;
export function checkDispatch(s: GameState, c: ContractSpec, v: SimView): ActionResult;   // typed pause codes
export function takeOffer(s: GameState, offerId: number): ActionResult;
export function declineOffer(s: GameState, offerId: number): ActionResult;   // turns an offer down: closed for good, as if struck
export function buyNow(s: GameState, res: TradeRes, qty: number): ActionResult;   // emergency purchase from the cheapest open hub, arrives after its one-way days
export function emergencyImport(s: GameState, ctx: TickContext, qty: number): boolean;
// save.ts
export const SAVE_VERSION = 1;
export const KEYS: { save: 'castravaleria.save.v1'; prefs: 'castravaleria.prefs.v1'; fasti: 'castravaleria.fasti.v1' };
export const MIGRATIONS: Record<number, (raw: any) => any>;          // version n → n+1
export const DEFAULT_PREFS: Prefs;
export function serialize(s: GameState): string;
export function deserialize(json: string): GameState | null;          // migrate, sanitise numbers, fill defaults; null if unusable
export function saveGame(s: GameState, now: number): boolean;
export function loadGame(): GameState | null;
export function hasSave(): boolean;
export function clearSave(): void;
export function exportText(s: GameState): string;                     // 'CV1:' + base64(UTF-8 JSON)
export function importText(text: string): GameState | null;
export function loadPrefs(): Prefs;
export function savePrefs(p: Prefs): void;
export function loadFasti(): FastiEntry[];
export function addFasti(e: FastiEntry): void;
// offline.ts
export function offlineDays(awayMs: number): number;                   // min(OFFLINE_MAX_DAYS, floor(awayMs / 1000 × OFFLINE_RATE))
export function offlineRun(s: GameState, awayMs: number): OfflineRun | null;   // null below OFFLINE_MIN_MS
export function simulateOffline(s: GameState, awayMs: number): AwayReport | null;
```

### 8.6 Guidance (WP-E)
```ts
// advisors/engine.ts
export const RULE_DEFS: AdvisorRule[];                                // in RULES order; one file per advisor
export function advisorsDay(s: GameState, ctx: TickContext, v: SimView): void;   // evaluate, hysteresis (DESIGN §11.4), supersede, flips, appoint, log new ≥ Cave or raised, fx advisory
export function activeAdvisories(s: GameState, opts?: { forCard?: boolean }): ActiveAdvisory[];   // sorted; forCard drops hushed, muted and Nota
export function renderAdvisory(s: GameState, v: SimView, a: ActiveAdvisory): { title: string; text: string; remedies: { remedy: Remedy; label: string; check: ActionResult }[] };
export function advisorMood(s: GameState, id: AdvisorId): 0 | 1 | 2;
export function appointAdvisors(s: GameState): void;
export function hush(s: GameState, rule: RuleId): ActionResult;     // not for Periculum
export function mute(s: GameState, rule: RuleId): ActionResult;     // Nota only
export function unmute(s: GameState, rule: RuleId): ActionResult;
// advisors/remedies.ts
export function checkRemedy(s: GameState, r: Remedy): ActionResult;   // never throws; disabled-with-reason
export function applyRemedy(s: GameState, r: Remedy): ActionResult;   // sim remedies through actions; UI remedies return ok (the UI executes them)
export function isUiRemedy(r: Remedy): boolean;                       // place, open, overlay, contract, building:center
export function remedyLabel(s: GameState, r: Remedy): string;
// advisors/util.ts (shared with the Ordo: the advice and the work it asks for read the same slot)
export function serveSlot(s: GameState, type: BuildingId, owner: 'ordo' | 'player', need: NeedId, ids: readonly number[], skip?: ReadonlySet<number>): { tile: number; k: number } | null;   // the slot serving the most waiting houses
export function liftSlot(s: GameState, owner: 'ordo' | 'player', ids: readonly number[], skip?: ReadonlySet<number>): { tile: number; k: number; lift: number } | null;   // the garden lifting the most of them
// guide.ts
export const GUIDE: GuideStep[];                                      // DESIGN §11.7 in priority order
export function pruneGuide(s: GameState): void;
export function nextTip(s: GameState): GuideStep | null;            // a tip not urgent also waits B.intro.GAP days after the last one read
export function dismissTip(s: GameState, id: TipId): ActionResult;  // records guidance.tipDay and tipAt
export function mentorKicker(s: GameState): string;                   // 'DECIMVS CASSIVS ADVISES' / 'FROM THE NOTES OF DECIMVS CASSIVS'
// intro.ts (DESIGN §11.13; what the player is shown; reveal.ts is unchanged; the duties are ordo/duties.ts)
export const LESSONS: readonly Lesson[];                              // { id, title, text, job, done, progress?, brings, rewardBrings?, reward, breather, tab?, anchor?, target? }
export const INTRO_TIPS: readonly TipId[];                            // the tips the lessons teach: read when they end or are skipped
export function introRunning(s: GameState): boolean;                 // guidance.intro.lesson ≥ 0 (newGame({ intro: true }) only)
export function introduced(s: GameState, part: IntroPart): boolean;  // the current or an earlier lesson brought it (a reward part once its job is done)
export function currentLesson(s: GameState): { lesson: Lesson; index: number; done: boolean } | null;
export function introStep(s: GameState): 'done' | 'next' | 'end' | null;   // every frame (main.ts): job → done; breather of stats.playMs → next
export function notePractice(s: GameState, p: PracticeId): ActionResult;   // UI-noted jobs: a speed chosen, an overlay opened, the advisors heard
export function beginNextLesson(s: GameState): ActionResult;         // "Begin now"
export function skipLesson(s: GameState): ActionResult;              // "Skip this step" (after B.intro.STUCK_S)
export function skipIntro(s: GameState): ActionResult;               // every lesson: Skip the lessons, Hide tips, tips off on entering, the Founding Dispatch link; every duty learned
// ordo/duties.ts (DESIGN §10.2)
export const DUTY_DEFS: Record<DutyId, DutyDef>;                      // { latin, name, does, learn, done }
export function granted(s: GameState, d: DutyId): boolean;            // labour/trade: ordo.on[d]; a kind of work: ordo.on.build && ordo.works[d]
export function wishDuty(r: Reason): WorkDuty | null;                 // the duty a wish is raised under (null: request, pin)
export function walkMask(s: GameState): string;                       // 'all' (every duty held, or away with Govern while away) or the held kinds + 'e' (Lex de annona)
export function dutiesDay(s: GameState, fx?: (e: FxEvent) => void): void;   // end of the tick: finished works by hand teach their duty; a petition the plan
export function pendingOffers(s: GameState): DutyId[];               // learned, not held, not answered: the counsel's offer
// hints.ts
export function howToGetMore(s: GameState, res: ResId, v: SimView): string[];   // generated from BUILDING_DEFS and HUB_DEFS + a live line
export function benefitLine(type: BuildingId): string;
export function outputChain(s: GameState, b: Building): { label: string; value: string }[];   // DESIGN §8.1 inspector chain
```

### 8.7 The action API (`src/game/actions.ts`, frozen dispatcher)
UI, bot and remedies mutate state **only** through these (plus `applyRemedy`). Every action returns `ActionResult`, never throws, logs what it changed, and calls `invalidate`/`touchPeople` as needed. Actions needing randomness use `withRng`; actions raising visuals use `pushActionFx`.
```ts
export { placeBuilding as place, demolish, buildRoad, pave, toggleReserveBlock } from './place';
export { cancelSite, prioritise, setOpen, setPrio } from './construction';
export { setHousePref } from './housing';
export { askOrdo, pinBuild, setOrdo, setManualTarget, applyOnce, setLabourPriority } from './ordo/actions';
export { setFocus, setEdict, setSetting, setSwitch, choosePath, renameColony } from './decisions';
export { chooseOption } from './events';
export { createContract, cancelContract, resumeContract, takeOffer, declineOffer, buyNow } from './trade';
export { hush, mute, unmute } from './advisors/engine';
export { dismissTip } from './guide';
export { beginNextLesson, notePractice, skipIntro, skipLesson } from './intro';
```

---

## 9. The daily tick (`src/game/sim.ts`) — exact order

The scaffold writes this function verbatim against the stubs; WP-B owns the file afterwards and may only add the private `housekeeping` details listed in step 1. **Reordering any step needs the integrator.**
```ts
export function tick(s: GameState, ctx: TickContext): void {
  const rng = new Rng(s.rng);
  const coin0 = s.res.denarii + s.taxAccrued;
  // 1 · calendar and housekeeping
  s.day += 1;
  housekeeping(s, ctx);          // drop modifiers with until ≤ day; drop Ordo requests older than REQUEST_DAYS and
                                 // priorities with until ≤ day; if the day is Kal. Mart./Iun./Sept./Dec. push fx {season}
  const v = view(s);             // live view: every getter re-reads its memo, so it is never stale after invalidate()
  // 2 · the council decides (emergency → labour → requests → build (even days) → trade (day % 10 == 5))
  const plan = runOrdo(s, ctx, rng, v);
  assignJobs(s, plan);
  // 3 · sites
  startStaked(s);                // staked ≥ STAKE_DAYS → building
  payPlans(s, ctx);              // player plans become sites when affordable
  // 4 · economy
  produce(s, ctx, rng);          // water → food → passive → processing → idle forage; skill XP; forest draw
  issueTools(s, ctx);
  consume(s, ctx);               // rationing (children first), hunger/thirst, fed EMA
  storage(s, ctx);               // spill over caps, shed rot (×2 Aestas), evaporation, forest regrowth
  goodsDay(s, ctx);              // oil and wine to T4 houses
  // 5 · works and homes
  constructionDay(s, ctx);       // builders along worksQueue(); Capitolium crew cap and materials; completions;
                                 // Capitolium completion sets s.victory, stats.victoryDay, fx victory
  housingDay(s, ctx);            // houses with id % CHECK_EVERY == day % CHECK_EVERY: needs, evolution, renovation, decline
  // 6 · people
  peopleDay(s, ctx, rng);        // aging logs, deaths, widowing, marriages, births, homeless, emigration
  immigrationDay(s, ctx, rng);   // Rome's roll, one Bernoulli roll
  // 7 · civic
  moraleDay(s, v);
  taxesDay(s, ctx);              // accrue; subsidy paid daily
  upkeepDay(s, ctx);             // pay or mark unpaid
  if (isKalends(s.day)) kalendsDay(s, ctx);
  // 8 · the world outside
  tradeDay(s, ctx, rng, v);      // market drift, caravan returns (banditCheck), dispatch, merchant
  eventsDay(s, ctx, rng, v);     // festivals, gate party expiry, choice expiry → default, random roll
  // 9 · bookkeeping and counsel
  updateCounters(s, v);
  checkObjectives(s, ctx);
  advisorsDay(s, ctx, v);        // appoints advisors, evaluates the 24 rules with hysteresis
  pruneGuide(s);
  s.stats.peakPop = Math.max(s.stats.peakPop, s.people.length);
  s.counters.coinEma += B.economy.COIN_ALPHA * ((s.res.denarii + s.taxAccrued - coin0) - s.counters.coinEma);
  s.rng = rng.state;
}
```
Rules around the tick:
- **One RNG stream per tick**, passed down in this order. A function that may draw randomness draws it in sorted-id order of the entities it visits. Functions without an `rng` parameter must not draw (ask the integrator to add one).
- **Structural changes inside the tick** (Ordo placements, completions, demolition by fire, rank-up from a path choice) call `invalidate(s)`; job/home/people changes call `touchPeople(s)`. Later steps automatically see fresh `derived`/`census`/`coverage` through `v`.
- **`ctx.rates`** is fresh per tick (`newCtx()`); producers write `rates.prod[res][source]`, consumers `rates.cons[res][source]` as positive numbers. The sim never reads yesterday's rates.
- **`ctx.fx`** collects visual events; it is empty and ignored offline. Advisories, logs and counters are the sim's memory, never `ctx.fx`.
- **Actions between ticks** (player, bot, remedies) mutate `s` directly through `actions.ts`, using `withRng` and `pushActionFx`. `main.ts` drains `drainActionFx()` once per frame.
- **`view(s)`** returns `{ get d() { return derived(s) }, get c() { return census(s) }, get f() { return forecast(s) }, get cov() { return coverage(s) } }`; nothing is computed until read.
- **Budget**: ≤ 1.5 ms median per tick at pop 600 in node (`perf.test.ts`). Forecast (12 months) is computed at most once per day (memo on day + epochs); coverage BFS only when `structEpoch` or an effective radius changes; `validSlots` only when the Ordo actually builds.

---

## 10. Determinism rules (tested by `determinism.test.ts` and `contract.test.ts`)
1. `src/game/**` contains no `Math.random`, `Date`, `performance`, `setTimeout`, `crypto` (grep test). Wall-clock time enters only as a `now` parameter (`newGame`, `saveGame`, `offlineRun`'s `awayMs`).
2. Randomness comes only from the tick's `rng`, `withRng(s, …)` in actions, `new Rng(seed ^ 0x51ed27)` in map generation, and the stateless `hash2`/`hashStr`. Render and UI may use `Math.random` for cosmetic particles only; walkers use `hash2` so a reload looks the same.
3. **Iteration order** comes from sorted arrays (`people`, `buildings`, `families`, contracts, caravans by id; `roads` by tile) and from the frozen id arrays (`RESOURCES`, `BUILDINGS`, `LABOR_CATS`, …). Never drive logic by `Object.keys` of a record, `for…in`, or a `Set`/`Map` whose insertion order depends on history. Tie-breaks are explicit: lowest id, then lowest tile.
4. **GameState is plain JSON**: no typed arrays, `Map`, `Set`, class instances, functions, `undefined` values, `NaN` or `±Infinity`. Optional fields are omitted, not set to `undefined`. Typed arrays live only in memoised derived data. A `noNaN` walker runs in every bot test.
5. **Memo purity**: every memoised value is a pure function of `s` and is keyed on the epochs that cover its inputs. Module-level caches (`getMap` seed cache, `councilReport`'s last report, `validSlots`) never change sim outcomes. Anything the Ordo must remember between days lives in `s.ordo`.
6. **Offline = online minus the listed differences**: the only branch on `ctx.offline` are the DESIGN §14 differences, each implemented in exactly one place (events, people death factors, housing decline stop, merchants, governAway in `ordoActive`, relief auto-accept, fx discard). UI prefs (`slowForNews`, `pauseOnCritical`, speed) never reach the sim.
7. **No rounding of state for storage**: the save is the exact state, so *save → load → continue* equals *never saving*. Rounding is display-only (`fmt*`).
8. Floating-point determinism is guaranteed per JS engine (tests run in node/V8). Use `Math.exp`, `Math.pow`, `Math.sqrt` freely; never compare floats for equality in game logic (use thresholds).
9. Tests: two 2,000-day runs of one seed serialise identically; *save → load → continue* equals the uninterrupted run; `simulateOffline(s, 200_000)` equals 100 ticks with `ctx.offline = true`; 24 h away = 1,825 days.

---

## 11. Persistence and offline catch-up (`save.ts`, `offline.ts`, `main.ts`)

### 11.1 Save format
- `serialize(s)` = `JSON.stringify(s)`. Expected size ≤ 600 KB at pop 1,500 (well under the 5 MB origin quota). Written to `castravaleria.save.v1` by `saveGame(s, now)`, which sets `s.lastSave = now` first. Every storage access is wrapped in `try/catch`; a failed write returns `false` and `main.ts` shows one toast: *"Could not save: storage is full or blocked. Use Menu → Export."*
- `SAVE_VERSION = 1`; `s.version` is written by `newGame`. The key's `.v1` suffix only changes if the format becomes incompatible (it should never).

### 11.2 Load, migration, sanitising
`deserialize(json)`:
1. `JSON.parse` in `try`; not an object or no numeric `version` → `null`.
2. `version > SAVE_VERSION` → `null` (title explains: *"This save was made by a newer version."*).
3. While `version < SAVE_VERSION`: `raw = MIGRATIONS[version](raw)` (each migration sets the next version).
4. **Fill defaults**: deep-merge missing object keys from `newGame({ seed: raw.seed, now: 0 })` (objects only; arrays are kept as saved). New ids added to `EDICTS`/`SETTINGS`/`SWITCHES`/`RULES` therefore appear with their initial values.
5. **Sanitise**: non-finite numbers in `res`, `needs`, `morale`, `fed`, counters → 0 (and clamp to ranges); unknown building types, ids, edict options, path options, hubs → dropped or reset to initial; arrays re-sorted by id and de-duplicated; `home`/`work`/`spouse` pointing at missing entities → `null`; people over `POP_CAP` are not trimmed.
6. Fatal (no principia, map seed not a number, people not an array) → `null`.

Unreadable save on Continue: the title shows the reason and an **Export raw save** button (the raw string in the export textarea); **Found a new colony** asks for the two-click confirm before overwriting.

**Rule for every later shape change**: bump `SAVE_VERSION`, add `MIGRATIONS[n]`, add a round-trip test from a hand-written v(n) object in `save.test.ts`. During the build (before 1.0) shape changes go through the integrator and rely on step 4.

### 11.3 Prefs, Fasti, export/import
- `castravaleria.prefs.v1`: `Prefs` JSON; `DEFAULT_PREFS = { sound: true, volume: 0.7, speed: 1, tips: true, slowForNews: true, pauseOnCritical: false }`. `speed` is the last chosen speed (a continued game resumes paused, then at this speed after the away report).
- `castravaleria.fasti.v1`: `FastiEntry[]`, newest first, max 50. `addFasti` is called once at dedication (victory). A new colony after a victory gets `legacy = previous legacy + 1` and `legacyBonus += 0.05` if *Imperium* was chosen; abandoning a colony adds nothing.
- Export: `'CV1:' + base64(UTF-8 JSON)` (TextEncoder + chunked `btoa`). Import accepts the prefixed text, bare base64 or raw JSON; runs `deserialize`; on success replaces the game after a two-click confirm, saves, and attaches the view. On failure: *"That text is not a Castra Valeria save."*

### 11.4 Autosave (main.ts)
Every `AUTOSAVE_S` (20 s) of real time in game mode (not during catch-up, not on the title); on `visibilitychange → hidden` (also records `hiddenAt`); on `pagehide`; immediately after a path choice, victory, import and new game; on **Save** and **Save & quit** in the menu. Automatic saves warn once when storage refuses; **Save** and **Save & quit** report every failure, and a Save & quit that cannot save offers the export text instead of dropping the colony.

**One tab owns the save.** Each page draws a random id and writes it to `castravaleria.owner.v1` (`claimSave`) when it enters a game. Every save checks `ownsSave` first; a tab that lost the claim (a `storage` event, a return to the tab, a page restored from the back-forward cache, or its next autosave) switches to the title at once and never saves or catches up its stale copy; its Continue plays the stored colony there instead. After a throw in the loop the clock stops and nothing more is saved over the last good save.

### 11.5 Offline catch-up
```ts
// offline.ts
export function offlineDays(awayMs: number): number {
  return Math.min(B.time.OFFLINE_MAX_DAYS, Math.floor((awayMs / 1000) * B.time.OFFLINE_RATE));
}
export function offlineRun(s: GameState, awayMs: number): OfflineRun | null {
  if (awayMs < B.time.OFFLINE_MIN_MS) return null;
  const days = offlineDays(awayMs); if (days < 1) return null;
  const before = snapshot(s);                       // census pop, res, DoH, stats counters
  const lowest = { grain: { doh: Infinity, day: s.day }, water: { doh: Infinity, day: s.day } };
  const decided: string[] = []; const highlights: LogEntry[] = [];
  let done = 0, stopped = false;
  return {
    days,
    progress: () => done / days,
    step(n) {                                        // true when finished
      for (let i = 0; i < n && done < days && !stopped; i++) {
        const won = s.victory;
        tick(s, newCtx(true)); done++;
        track(lowest, s);                            // DoH = stock / census(s).need, per essential
        collect(s, decided, highlights);             // today's log entries: 'decided' → decided (≤ 12 lines; repeats, digits aside, fold into one
                                                     // line with a count; when full the oldest 'ordo'/'trade' line goes first), 'highlight' → highlights (≤ 40, newest kept)
        if (!won && s.victory) stopped = true;       // stop early on victory
      }
      return done >= days || stopped;
    },
    report: () => ({ awayMs, daysPlanned: days, days: done, before, after: snapshot(s), decided, highlights, lowest,
                     awaiting: { petition: readyPetitionRank(s),   // a ready petition is not listed again as augur.petition
                                 advisories: activeAdvisories(s, { forCard: true }).filter(a => petition === null || a.rule !== 'augur.petition').slice(0, 3).map(a => a.rule) } }),
  };
}
export function simulateOffline(s: GameState, awayMs: number): AwayReport | null;   // runs to completion synchronously
```
`main.ts` flow:
1. **Continue**: `awayMs = max(0, now − s.lastSave)`; **tab return**: `awayMs = now − hiddenAt`. Absences < 60 s simulate nothing (the rAF accumulator clamp drops the gap).
2. `run = offlineRun(s, awayMs)`; if non-null → mode `catchup`: the veil *"Anni transeunt… — the years pass"* with a progress bar and **[Skip]**; each frame runs `run.step(B.time.SLICE_DAYS)` repeatedly until `SLICE_MS` (30 ms) of the frame is used; the map, HUD and date redraw from the live state; input is blocked by the veil; fx are discarded; **Skip** calls `run.step(run.days)`.
3. When finished: `report = run.report()`; save; mode `game` (paused); if `report.days ≥ 1` open the **Litterae Ordinis** dispatch (DESIGN §14); closing it resumes at `prefs.speed`. A Capitolium dedicated during the absence (`wonWhileAway`) replays the lost `victory` fx, so the Victory dispatch opens over the letter and the Fasti entry is written.
   A colony still on `START_DAY` (the founding letter not yet answered) is never caught up: Continue shows the founding letter again.
4. `previewRates(s)` refreshes the HUD ledger after a load (the last tick's rates are not saved).

---

## 12. Renderer contract (`src/render/**`, WP-F core, WP-G art)

### 12.1 Coordinates, canvas and camera
- World pixels: `TILE = 16` per tile; tile `i` covers world px `[tx(i)·16, +16) × [ty(i)·16, +16)`. The map is 1,792 × 1,344 world px.
- `#map` is a full-viewport canvas with backing size = CSS size × `devicePixelRatio`; `imageSmoothingEnabled = false` for sprites. **Device pixels per world pixel** `scale = max(1, round(level × dpr))` with `ZOOM_LEVELS = [1, 2, 3, 4]` (CSS px per world px); default level from the free map's shorter side (3, or 2 under 700 CSS px), centred on the forum in the free rect. Camera clamps so ≥ 25% of the free rect (the viewport less the UI's insets) always shows map.
```ts
// camera.ts (F)
export const ZOOM_LEVELS: readonly number[];
export interface Camera { x: number; y: number; level: number; scale: number; vw: number; vh: number }   // x,y = world px at the viewport centre; vw,vh device px
export function makeCamera(): Camera;
export function worldToScreen(c: Camera, wx: number, wy: number): { sx: number; sy: number };   // device px
export function screenToWorld(c: Camera, sx: number, sy: number): { wx: number; wy: number };
export function clampCamera(c: Camera, insets?: Insets): void;                // ≥ 25% of the FREE rect stays on the map
export function visibleTiles(c: Camera, margin?: number): Rect;
// insets (device px the UI covers on each side of the canvas; the free rect is the canvas less these)
export interface Insets { top: number; right: number; bottom: number; left: number }
export function freeCentre(c: Camera, insets: Insets): { sx: number; sy: number };          // device px
export function centerOnFree(c: Camera, wx: number, wy: number, insets: Insets): void;      // (wx, wy) at the free centre (unclamped)
export function ensureVisibleDelta(c: Camera, worldRect: { x: number; y: number; w: number; h: number }, insets: Insets, marginPx: number): { dx: number; dy: number };
export function defaultLevel(cssSize: number): number;   // 3, or 2 below ZOOM_SMALL_W: fed min(free width, free height)
```
- **Insets** (tests/camera.test.ts at DPR 1, 2, 2.625, 3): the canvas stays full-bleed under the UI and never resizes between panel states. The UI (layout.ts) tells the view what it covers; centring, the ± zoom anchor, the clamp, the minimap rectangle and `ensureVisibleDelta` (the least move that brings a rect inside the free rect, `marginPx` clear of its edges; 0 when it is inside; a rect too big is only moved until it fills it) use the free rect. Insets that leave no free rect fall back to the whole viewport. `x, y` stay the world px at the canvas centre, so `screenToWorld`/`worldToScreen`, picking, the fling and drawing never see the insets.
- `input.ts` (F): pointer events on `#map`. Left button: press-drag > 6 CSS px pans, otherwise a click; right button / Esc → cancel; wheel accumulates `deltaY` and steps one level per 100 units around the cursor; two pointers → pinch (accumulated ratio, snaps to the nearest level at ≥ ×1.4 / ≤ ×0.7). Touch while placing a building: a tap previews (ghost + verdict via `onPlacementPreview`), the banner's **Place** button confirms. Keyboard is not handled here (H's `keys.ts` calls `panBy`/`zoomBy`).

### 12.2 Frame and draw order (`view.ts`)
`frame()` is called every animation frame by `main.ts`. Order:
1. **Terrain chunks**: 4 × 3 offscreen canvases of 28 × 28 tiles, baked per season (ground colours DESIGN §16.2, hash dither ±8% on 20% of pixels, river ripples and foam, clay banks, ore speckles, springs, fossa, survey chalk lines with peg dots for unbuilt active streets). Rebaked on season change (2 s crossfade from the old set), rank change (rings) and `structEpoch` changes that touch streets. Forest is **not** baked (trees are objects).
2. **Ground layer** (per frame, culled): roads (dirt / paved autotile with kerbs, drawn by `linear.ts`), forum pavement, field furrows and olive rows of rural buildings (these sprites are drawn here, before y-sorting), staked/planned footprints (chalk outline, pegs).
3. **Overlay** (if active): the overlay's 1 px/tile canvas scaled up **with smoothing on** at 45% alpha.
4. **Placement under-layer**: glowing valid slots, coverage preview on road tiles, desirability footprint.
5. **Y-sorted objects** (by footprint bottom, then x): buildings and houses (via `buildingSprite`), walls and gates, aqueduct spans, trees/stumps/rocks/reeds/ruins, walkers and carts.
6. **Status marks** above objects: scaffolds and `rise()`, cracked plaster (declining), CLAVSVM plank (closed), unpaid coin, unstaffed pip, Ordo seal on fresh Ordo sites, plan ⌛, want cues (level ≥ 2 only; the first unmet need): a want pip (≤ 8 px, in the colour of the need's icon) inside every wanting house's own roof box, and the full want bubble only over the selected or hovered house (a bubble over every house covers the facade of the house to its north); no want cues while the Domus overlay shows them; ↑ arrows during placement. Then the overlay's marks: houses tinted and outlined in their overlay colour over their sprites (Domus, Aqua), the want icon of one-need houses, ✕ on dry houses, red rings on unstaffed services.
7. **Particles and floating text**.
8. **Placement ghost**: sprite at 60% alpha snapped to the slot, red tint + ✕ when invalid, gold *+NN%* when `mult ≥ 1.05`, felling yield, laurel marker on the Ordo's best slot.
9. **Selection/hover outlines** and `flash()` rectangles.

Culling: tiles and objects outside `visibleTiles(margin 4)` are skipped. Budget: ≤ 6 ms per frame at 1,100 × 800, level 2, 600 buildings, 220 walkers.

**`rise()`** (buildings.ts): an unfinished site draws trench lines at progress 0, then the finished sprite clipped from the bottom to `h × progress` plus the scaffold overlay (tiled for footprints wider than 32 px); dust puffs every 2 s while work is applied. Capitolium: stage sprite of the current completed stage plus `rise()` of the next.

### 12.3 Sprite system and naming (frozen)
`src/render/sprites.ts` (scaffold):
```ts
export const PAL: Readonly<Record<string, string>>;      // DESIGN §16.2 (Hearthlands keys + Roman keys u v a i s F I N O Q M V Z X; k = #1d1410, K = #3b2a25); '.' and ' ' are transparent
export type Grid = readonly string[];                    // equal-length rows of PAL keys
export function registerArt(name: string, rows: Grid, opts?: { outline?: boolean }): void;      // lazy; no canvas work at import
export function registerDraw(name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): void;   // procedural, lazy
export function sprite(name: string): HTMLCanvasElement; // rasterised once and cached; unknown name → 16×16 magenta/black checker (warns once)
export function hasSprite(name: string): boolean;
export function spriteSize(name: string): { w: number; h: number };
export function spriteURL(name: string, scale?: number): string;   // cached PNG data URL for <img> (integer scale, default 2)
export function tinted(name: string, map: Record<string, string>): HTMLCanvasElement;   // recolour placeholder keys (S tunic, A hair, U trousers); cached
export function mirror(c: HTMLCanvasElement): HTMLCanvasElement;
export function outline(c: HTMLCanvasElement, color?: string): HTMLCanvasElement;
export function compose(w: number, h: number, parts: { name: string; x: number; y: number }[]): HTMLCanvasElement;
export function alphaMask(name: string): Uint8Array;     // for pixel-accurate picking
export function validateArt(): string[];                 // ragged rows, unknown keys, duplicate names, size mismatches — no canvas needed
export function spriteNames(): string[];
```
**Naming convention** (WP-G registers every name; WP-F and the UI reference only these):

| Group | Names |
|---|---|
| Houses | `h_<tier>_<0\|1>` for the 6 tiers (variant = `hash2(x, y) < 0.5 ? 0 : 1`) · `h_insula_aquae` · `h_domus_aquae` |
| Buildings | `b_<buildingId>` for the 26 types other than `area`, `principia`, `capitolium`; optional seasonal variants `b_<id>@<0..3>` (`ager` and `olivetum` must have all four) · `b_lignarius_logs` (log pile, scales with stock) |
| Forum and Capitolium | `p_forum_<0..4>` (144 × 152 incl. overhang) · `p_capitolium_<1..4>` (144 × 96) · `p_crown_<iuppiter\|aeternitas\|imperium>` (32 × 24) · `n_altar` (before it begins) |
| Building overlays | `ov_scaffold` 32×32 · `ov_cracks` 32×24 · `ov_lanterns` 32×12 · `ov_pegs` 16×16 · `ov_trench` 16×16 |
| Linear | `l_vallum_<h\|v\|c>` · `l_murus_<h\|v\|c>` (16 × 24) · `l_gate_<timber\|stone>_<h\|v>` (48 × 40) · `l_aqua_<ew\|ns\|pier>` (16 × 28) · `l_bridge` · `n_milestone` 6×10 (roads are procedural in `linear.ts`) |
| Nature | `n_oak_<0..2>` with `@<season>` variants · `n_pine` · `n_cypress` · `n_stump` · `n_rock_<0\|1>` · `n_reeds` · `n_ruins` · `n_lucus` · `n_spring` |
| Actors | `a_person_<idle\|walk0\|walk1\|work>` · `a_child_<idle\|walk0\|walk1>` · `a_elder_<…>` · `a_patrician_<…>` · `a_legionary_<0\|1>` · `a_priest_<0\|1>` · `a_oxcart_<0\|1>` · `a_mules_<0\|1>` · `a_wagon_<0\|1>` · `a_vettent` · `a_ox_<0\|1>` · `a_bird_<0\|1>` · `a_sheep` · `a_fish` |
| Icons 12×12 | `i_<resId>` (12) · `i_face_<0..4>` · `i_laurel` · `i_season_<0..3>` · `i_want_<needId>` (13) · `i_seal` · `i_plan` · `i_stake` · `i_closed` · `i_unpaid` · `i_unstaffed` · `i_request` · `i_souls` · `i_beds` · `i_tab_<tabId>` (6) · `i_tool_<toolId>` (5) · `i_ov_<overlayId>` (5, not `none`) · `i_star` · `i_view_<closed|half|full>` (3: the view control) |
| Portraits 24×24 | `pt_<advisorId>_<0\|1\|2>` (calm/concerned/alarmed) · `pt_mentor` · `pt_mentor_notes` · `pt_silhouette` |
| Frames | `f_meander` 12×12 · `f_seal` 16×16 · `f_aquila` 32×32 |

`src/render/art/index.ts` (G) exports the helpers everyone uses:
```ts
export const REQUIRED_SPRITES: readonly string[];        // every name above, expanded (tested by art.test.ts)
export function registerAllArt(): void;                  // idempotent; main.ts calls it once at boot
export function seasonal(name: string, season: SeasonIndex): string;   // name@season if registered, else name
export function houseSprite(tier: HouseTierId, aquae: boolean, x: number, y: number): string;
export function buildingSprite(s: GameState, b: Building, season: SeasonIndex): string;     // finished look of any building
export function resIcon(r: ResId): string; export function wantIcon(n: NeedId): string;
export function faceIcon(morale: number): string;       // 5 moods at 20/40/60/80
export function portrait(a: AdvisorId | 'mentor' | 'notes' | 'silhouette', mood?: 0 | 1 | 2): string;
```
Anchoring: a building sprite is centred horizontally on its footprint and bottom-aligned to the footprint's bottom edge (overhanging upward); actors are anchored at their feet. Light from the top-left; 1 px `k` outline on every object (`outline: true` default for buildings and actors).

### 12.4 `MapView` (view.ts, F) — the only render object the UI touches
```ts
export type PlacingState =
  | { kind: 'building'; type: BuildingId; replaceId?: number; at?: number }   // at: pre-positioned origin tile (remedies)
  | { kind: 'road' } | { kind: 'pave' } | { kind: 'reserve' } | { kind: 'demolish' };
export interface ViewCallbacks {
  onHover(tile: number | null, buildingId: number | null): void;
  onClick(tile: number, buildingId: number | null, e: { button: 0 | 2; shift: boolean }): void;
  onDrag(kind: 'road' | 'pave', tiles: number[], done: boolean): void;      // L-shaped path preview; done on release
  onCancel(): void;                                                          // right-click / two-finger tap while placing
  onPlacementPreview(check: PlaceCheck | null, tile: number | null): void;   // banner + inspector verdict (desktop hover, touch tap)
}
export class MapView {
  constructor(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement | null, cb: ViewCallbacks);
  attach(s: GameState): void;                         // new/loaded game: drop caches, rebuild chunks, centre on the forum
  frame(dtMs: number, s: GameState, speed: number, paused: boolean): void;
  handleFx(events: FxEvent[], s: GameState): void;    // §12.6
  resize(): void;
  panBy(dxCss: number, dyCss: number): void;
  centerOn(target: number | Rect, level?: number): void;   // a tile, or the middle of a tile rect, at the free-rect centre
  centerOnForum(): void;
  zoomBy(steps: number, anchor?: { sx: number; sy: number }): void;   // the player's own: default anchor = the free-rect centre
  setZoom(level: number): void;
  setInsets(css: { top: number; right: number; bottom: number; left: number }, opts?: { host?: boolean }): void;   // CSS px (ui/layout.ts)
  freeRect(): { left: number; top: number; right: number; bottom: number };   // canvas CSS px: the canvas less the insets
  mapRect(): { left: number; top: number; width: number; height: number };    // the canvas box relative to #app (add to screenRect)
  ensureVisible(target: number | Rect, marginCss?: number): { dx: number; dy: number };   // eased glide (Motion.glide); the target's screen shift
  readonly placing: PlacingState | null;
  startPlacing(p: PlacingState, s: GameState): void;  // auto-selects the matching overlay (§12.5), remembers the previous one
  cancelPlacing(): void;                              // restores the previous overlay
  readonly overlay: OverlayId; readonly overlayLayer: CoverageLayerId;
  setOverlay(o: OverlayId, layer?: CoverageLayerId): void;   // 'officia' keeps its last layer (default 'shrine')
  readonly selected: number | null;
  select(id: number | null): void;
  flash(tile: number, w: number, h: number, ms?: number): void;
  tileAt(sxCss: number, syCss: number): number | null;
  pickBuilding(sxCss: number, syCss: number): number | null;   // y-sorted sprites back to front with alphaMask, then derived.buildingAt
  screenOf(tile: number): { x: number; y: number } | null;     // CSS px, for anchoring DOM
  screenRect(x: number, y: number, w: number, h: number): { left: number; top: number; right: number; bottom: number };   // canvas CSS px
  buildingRect(id: number): { left: number; top: number; right: number; bottom: number } | null;
  buildingTiles(id: number): Rect | null;             // its footprint as a tile rect
  titleDrift(dtMs: number, s: GameState): void;       // slow diagonal pan used behind the title
  setInputEnabled(on: boolean): void;                 // off under the catch-up veil and modals
}
```
Camera and the UI: every coordinate in and out is canvas CSS px; `mapRect()` places them in `#app`. `setInsets` never recentres, but clamps at once to the new free rect (at a map edge a wider free rect moves the limit: the step comes with the panel's slide, not with the next drag); with `host: true` (the layout changed shape) the default level is chosen again from the free map unless the player zoomed by hand since `attach`. `attach` picks the default level from min(free width, free height) (phones, landscape phones, docked tablets: 2), except on the COLUMNS host, where `setInsets({ canvasZoom: true })` keeps the canvas-width rule (desktops and 1366×768 laptops: 3) and centres the forum in the free rect. `startPlacing` with `at` glides the ghost into the free map (which ends above the placing banner) by the least it needs (`ensureVisible`, 64 px clear), never when it is there already. The inspector's popup (inspector.ts) glides a pinned target clear only when the UI covers it, when picked and again on a layout change (`Layout.onChange`): `ensureVisible` into the free rect, then `dodge()` (pure, tests/layout.test.ts) clear of what floats over it (the map's tools, the ticker, a phone's band of cards); a target already in view never moves.

Placement flow (`placement.ts`, F): `startPlacing({kind: 'building'})` computes `validSlots(s, type, 'player')` and `bestSlot(s, type, { owner: 'player' })` once (and again when `structEpoch` changes). On hover: `snapSlot` → `canPlace(s, type, tile, { owner: 'player', replaceId })` → ghost, verdict, bonus, felling yield; for water/service buildings `previewCoverage` (covered road tiles tinted, ↑ on `housesUnlockedBy`); with the *desir* overlay `previewDesir`. The view never mutates state: clicks go to `cb.onClick`, and `main.ts` runs `actions.place` (§13.2 `placeAt`). Road tool: press-drag builds an L-shaped path (horizontal first, Shift = vertical first) shown with cost; release → `cb.onDrag('road', tiles, true)` → `actions.buildRoad`. Pave: the same over built roads. Reserve: click a block → `actions.toggleReserveBlock`. Demolish: the first click marks the building red (*"Click again to demolish"*, 3 s), the second calls `actions.demolish`.

### 12.5 Overlays (`overlays.ts`, F)
Each overlay is a 112 × 84 canvas (1 px per tile) rebuilt when its key changes (`structEpoch` + overlay id + layer + `day / 5` for *domus*), drawn by `view.ts` at 45% alpha and mirrored on the minimap. Sources and colours:

| Overlay | Reads | Colours |
|---|---|---|
| `aqua` | `coverage().layers.water/fountain`, `map.waterTable`, castellum reach 18 | water `#9fd4f0`, fountain `#3d7fa6`, water-table stipple `#62b0d6`, ✕ (`i_want_water`) on dry houses |
| `domus` | houses: `unmetNeeds(next tier)`, `declining` | all met `#9ccc5a`, one missing `#f2c94c` + `wantIcon`, two+ `#e5554a`, declining `#806b57` pulsing |
| `officia` | `coverage().layers[layer]`, unstaffed services | `LAYER_META[layer].color`, unstaffed ring `#e5554a` |
| `desir` | `desirability()` | −20 `#e5554a` → 0 `#806b57` → +30 `#9ccc5a`; contour marks at 0 and 10 |
| `terra` | `map.terrain/feature/vein/woodMax`, `woodAt`, fertility | fertility straw `#d9c27a` → gold `#f2c94c`, hills `#a99a62`, rock `#9a968a`, ore by quality `#c0623f`, clay `#b5651d`, timber density green alpha, springs `#62b0d6` |

Auto-selection while placing: water buildings → `aqua`; service buildings → `officia` with their first service layer; rural buildings → `terra`; `area` → `domus`; `hortus` → `desir`; others keep the current overlay.

### 12.6 FxEvent → visuals (`particles.ts`, `actors.ts`, F)
| FxEvent | On the map |
|---|---|
| `built` | dust burst, 6 gold stars, pennant 3 s, flash footprint |
| `evolved` | scaffold flash, floating *"+{tier name}"* |
| `declined` | grey dust puff (the cracks overlay then persists while declining) |
| `birth` / `death` | small gold sparkle / grey wisp over the home (if any) |
| `arrive` | an ox-cart and the family walk in along the via to the home |
| `leave` | n walkers leave along the via |
| `caravanOut` / `caravanIn` | mule train out / in along the via; on return gold coins at the forum |
| `taxes` | gold coins rise over the forum |
| `rank` | a legionary column marches in along the via; plough ox traces the new ring's line |
| `milestone` | gold sparkle over the forum |
| `fire` | smoke and flame particles on the building for 10 s |
| `stage` | Capitolium dust and flash |
| `season` | terrain crossfade (2 s) |
| `ordoPlaced` | groma pegs pop and the Ordo seal flashes |
| `victory` | gold bursts and rose petals over the Capitolium |
| `event`, `advisory` | nothing on the map (UI only) |

Particles are capped at 600 (300 when `matchMedia('(pointer: coarse)')`). Walkers (`actors.ts`) are visual only: `min(220, pop / 4)` (120 on touch) sampled people walk home ↔ work along the road graph (BFS cached per `structEpoch`), chosen by `hash2(personId, day)`; tunic colour by labour category of the job (water `#62b0d6`, food `#d9a35b`, materials `#8a6b4a`, industry `#55565e`, services `#9e2f25`, builders `#c0623f`, none `#bba58b`); patricians in white togas; children and elders by stage.

### 12.7 Minimap (`minimap.ts`, F)
`#minimap` canvas, CSS 224 × 168 (2 px per tile, backing × dpr): terrain colour per tile, buildings as footprint colours, roads, the active overlay, the viewport rectangle (the free rect: the map the UI leaves in view). Redrawn at most every 500 ms. Click or drag → the point to the free-rect centre. Hidden below 1,100 px and while placing.

---

## 13. UI contract (`src/ui/**`, WP-H shell, WP-I panels)

### 13.1 `index.html` (scaffold writes exactly; ids frozen)
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#15100d" />
  <title>Castra Valeria</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
</head>
<body>
  <div id="app">
    <canvas id="map" aria-label="Map of the colony"></canvas>
    <header id="hud"></header>
    <div id="tray"></div>
    <aside id="left">
      <section id="objective"></section>
      <section id="counsel"></section>
      <section id="inspector"></section>
    </aside>
    <div id="choice"></div>
    <div id="toasts" aria-live="polite"></div>
    <div id="banner"></div>
    <div id="place-banner"></div>
    <div id="ticker"></div>
    <div id="map-tools">
      <div id="overlay-bar"></div>
      <canvas id="minimap"></canvas>
      <div id="zoom-ctl"></div>
    </div>
    <nav id="map-col"></nav>
    <aside id="side">
      <button id="side-toggle" aria-label="Toggle panel"></button>
      <nav id="tabs" role="tablist"></nav>
      <div id="tab-body" role="tabpanel"></div>
    </aside>
  </div>
  <div id="title-screen" hidden></div>
  <div id="modal-root"></div>
  <div id="tooltip" role="tooltip" hidden></div>
  <div id="veil" hidden></div>
  <script type="module" src="./src/main.ts"></script>
</body>
</html>
```
Ids are only ever added: `#tray` (the Breviarium, tray.ts) came with the phone HUD; on the phone hosts (SHEET, DRAWER)
the `#objective` node itself moves into it and back to `#left` on any other host (one instance of every widget). `#map-col`
(the phones' tool column, mapbar.ts `MapColumn`) came with the phone sheet. On the phone hosts nodes move, never copy
(§13.10): `#counsel` and `#ticker` into the voice line, `#tabs` out of `#side` into `#app` (the SHEET's bar at its foot,
the DRAWER's spine at its right edge), `#overlay-bar` into the Mappae popover and `#zoom-ctl` into `#map-col`; on the
DRAWER the voice line's slot itself stands in `#app` (afloat on the map) while the pane is closed. Any other host puts
each back where this file has it. Ids made in code: `#sheet-grab` and `#sheet-voice` (the grabber and the voice line's
slot, sheet.ts, at the head of `#side`), `#map-via`, `#map-mappae`, `#via-pop`, `#mappae-pop` (the column's buttons and
popovers), `#hud-menu` (the HUD's ☰), `#speed`, `#speed-pop`, `#vital-grain`, `#vital-water` and the tab buttons
`#tab-<id>`. P3 (the DRAWER) added `#safe-box` (layout.ts, a child of `<body>`: fixed, invisible, inset by the safe
areas: the window the size classes are read from, §13.10). P4 (the DOCK) added `#view-ctl` (the HUD's view control,
hud.ts); on the DOCK `#objective` and `#counsel` move into `#sheet-voice` at the head of `#side` (the left column folded
in), `#ticker` stays home, and from 960 px wide the wide pane takes `#tray` as its first child (tray.ts `column`).
P5 (the desktop COLUMNS) added `#side-wide` (⤢, panels.ts: a child of `#side` after `#side-toggle`); on the COLUMNS
`#view-ctl` stands in `#app` (at the top-left of the map), and the wide panel takes `#tray` as its first child too.
DOM ownership: **H** fills `#hud`, `#tray`, `#objective`, `#counsel`, `#toasts`, `#banner`, `#place-banner`, `#ticker`, `#map-tools` (overlay bar and zoom buttons; the minimap canvas is drawn by F), `#map-col`, the phones' grabber and voice line in `#side` (sheet.ts), `#title-screen`, `#modal-root`, `#tooltip`, `#veil`. **I** fills `#side` (toggle, tabs, body), `#inspector`, `#choice`. Z-order is DESIGN §15.1 (set in CSS by the owner of each element).

### 13.2 `Game` (`src/ui/types.ts`, scaffold; implemented by `App` in `src/main.ts`, H)
```ts
import type { MapView, PlacingState } from '../render/view';   // type-only imports from render are allowed in src/ui
export type Mode = 'title' | 'game' | 'catchup';
export type SfxName = 'click' | 'place' | 'build' | 'birth' | 'death' | 'discover' | 'event' | 'error' | 'victory'
  | 'coin' | 'cornu' | 'lyre' | 'tink' | 'crackle' | 'splash' | 'tintinnabulum' | 'gate';
export type InspectTarget = { kind: 'building'; id: number } | { kind: 'tile'; tile: number } | { kind: 'block'; block: number };
export interface Game {
  readonly state: GameState;          // in title mode: the save (or a fresh seed) drifting behind the title
  readonly view: MapView;
  readonly prefs: Prefs;
  readonly rates: Rates;              // last tick's ledger (previewRates after a load)
  readonly speed: Speed; readonly paused: boolean; readonly mode: Mode; readonly modalOpen: boolean;
  setSpeed(sp: Speed): void;          // also unpauses; stores prefs.speed
  togglePause(): void;
  setPaused(p: boolean): void;
  changed(): void;                    // something changed outside a tick: panels re-check signatures now
  act(r: ActionResult, opts?: { okSfx?: SfxName; okToast?: string }): ActionResult;   // standard result handling: error toast with r.reason + 'error' sfx, or ok sfx; then changed()
  startPlacing(p: PlacingState): void; cancelPlacing(): void;
  placeAt(tile: number, shift: boolean): void;   // actions.place(owner 'player', replaceId) → act(); keeps placing if shift (desktop) else cancels
  inspect(t: InspectTarget | null, sticky: boolean): void;
  select(id: number | null): void;    // view.select + inspect building
  focusTile(tile: number): void;      // centre + flash
  openTab(tab: TabId, anchor?: string, from?: OpenFrom, shift?: boolean): void;   // who asked (layout.route); shift with a key: wide
  prefillContract(spec: ContractSpec): void;   // opens 'trade' with the new-contract form filled
  applyRemedy(r: Remedy): void;       // §13.6
  newGame(opts?: { afterVictory?: boolean }): void;
  continueGame(): void;
  toTitle(): void;                    // saves first
  save(): boolean;
  exportSave(): string;
  importSave(text: string): boolean;
  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void;
  sfx(name: SfxName): void;
}
```
`src/ui/types.ts` also exports `Panel`, `Updater`, `InspectTarget`, `SfxName`, `Mode` and re-exports `Prefs`, `PlacingState`.

### 13.3 Components and frozen cross-package classes
```ts
// src/ui/index.ts (H) — the UI root, created by App
export class UI {
  constructor(g: Game);
  build(): void;                                  // creates every widget in its DOM id; builds SidePanel, Inspector, ChoiceCard
  frame(now: number): void;                       // every animation frame; widgets throttle their updaters to UI_THROTTLE_MS
  onFx(events: FxEvent[]): void;                  // §13.7
  showTitle(): void; hideTitle(): void;
  showVeil(run: OfflineRun, onSkip: () => void): void; hideVeil(): void;
  showDispatch(kind: 'founding' | 'away' | 'victory', report?: AwayReport): void;
  showPlaceBanner(p: PlacingState | null, check: PlaceCheck | null): void;
  readonly layout: Layout;                        // §13.10, created in build() right after the SidePanel
  readonly tray: Tray;                            // the Breviarium (below)
}
// src/ui/tray.ts (H) — the Breviarium, the accounts every HUD figure opens (DESIGN §15.2); UI-only, not a TabId
export class Tray {
  constructor(g: Game, root: HTMLElement, objective: HTMLElement);   // root = #tray; objective = #objective (re-hosted on SHEET)
  readonly open: boolean;
  covers(el: HTMLElement): boolean;               // open beneath that HUD figure: its hover card holds back (Hud.quiet)
  toggle(fig: string, from: HTMLElement | null, viaKey?: boolean): void;   // a HUD figure (data-fig): open there, or close on a second tap of it
  show(section?: string, from?: HTMLElement | null): void;                // 'awaiting' | 'gestae' | 'grain' | 'water' | 'coin' | … | 'ordo'
  close(): void;                                  // also a history.ts layer (BACK_RANK.tray): Back and Esc
  mount(host: Host): void;                        // layout 'classes': #objective in (sheet) or back to #left
  update(now: number): void;                      // throttled by UI.frame; does nothing while closed
  onRead: (() => boolean) | null;                 // 'Read' on a waiting dispatch → ChoiceCard.reveal
}
// src/ui/panels.ts (I)
export class SidePanel {
  constructor(g: Game, root: HTMLElement);        // root = #side
  frame(now: number): void;                       // signature diff of the open tab; badges; NEW stickers on reveal
  open(tab: TabId, anchor?: string): void;
  readonly current: TabId;
  toggle(open?: boolean): void;                   // collapse (desktop) / bottom sheet (mobile): through layout.panelToggle
  show(on: boolean, instant?: boolean): void;     // writes the open or folded panel (Layout.setDetent calls it)
}
// src/ui/inspector.ts (I)
export class Inspector {
  constructor(g: Game, root: HTMLElement);        // root = #inspector
  show(t: InspectTarget | null, sticky: boolean): void;   // hover = transient, click = sticky
  frame(now: number): void;
}
// src/ui/choice.ts (I)
export class ChoiceCard {
  constructor(g: Game, root: HTMLElement);        // root = #choice; shows s.choice; options → actions.chooseOption
  frame(now: number): void;
}
// each tab file (I): export const panel: Panel
export interface Panel {
  id: TabId; label: string; sub: string; icon: string; hotkey: string;   // label Latin, sub English, icon = sprite name
  signature(g: Game): string;                     // discrete data only: ids, counts, statuses, unlocks, filters — never stocks or progress
  build(g: Game, body: HTMLElement, up: Updater[]): void;   // full rebuild; push closures that refresh volatile text in place
  badge?(g: Game): { text: string; kind: 'info' | 'warn' | 'bad' | 'gold' } | null;
  scrollTo?(anchor: string, body: HTMLElement): void;
}
export type Updater = () => void;
```
The **signature-diff pattern** (Hearthlands) applies to every panel, the inspector, the Res Gestae panel and the counsel card: compute the signature at most every 200 ms; if it changed, clear and rebuild (preserving scroll); otherwise run the updaters. Buttons are never rebuilt under the pointer within 300 ms of a click.

### 13.4 Helpers (`src/ui/dom.ts`, scaffold)
```ts
export type Kid = Node | string | number | null | undefined | false | Kid[];
export type Attrs = Record<string, unknown>;   // class, id, style (string | object), data-*, aria-*, role, type, value, disabled, hidden, on<event> handlers
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...kids: Kid[]): HTMLElementTagNameMap[K];
export function img(spriteName: string, scale?: number, cls?: string): HTMLImageElement;   // spriteURL, pixelated, alt ''
export function clear(el: Element): void;
export function fmt(n: number): string;             // < 10: one decimal unless integer; < 10,000: integer with separators; else 12.5k
export function fmtRate(n: number): string;         // '+17/d', '−6.2/d' (true minus sign)
export function fmtDays(n: number | null): string;  // '47 d', '∞', '—'
export function fmtCost(c: Cost): string;
export function costEl(s: GameState, c: Cost, reserved?: Cost): HTMLElement;   // icon chips; red where short
export function plural(n: number, one: string, many: string): string;
export function realTime(days: number, speed: number): string;   // '≈ 12 s at 2×'
export function tip(el: HTMLElement, content: string | (() => Node | string), opts?: { wide?: boolean }): HTMLElement;
export function initTooltips(): void;               // #tooltip singleton: 80 ms hover delay; touch long-press 450 ms pins a card with ✕; edge-aware
export function esc(s: string): string;
```
Never use `title=` attributes or `innerHTML` with game text (names are data); build with `h()`.

**Modals and toasts** (H; the scaffold ships working minimal versions with these signatures):
```ts
// modals.ts
export function openModal(content: Node, opts?: { kicker?: string; title?: string; closable?: boolean; wide?: boolean;
  parchment?: boolean; onClose?: () => void }): () => void;     // returns close(); stacked; sim paused while any is open; Esc closes the top closable; focus trapped
export function confirm2(btn: HTMLButtonElement, armedLabel: string, fn: () => void): void;   // two-click confirm, disarms after 3 s
export function openMenu(g: Game): void;
export function openExportImport(g: Game): void;
export function openHowTo(g: Game): void;
export function openRename(g: Game): void;
// toasts.ts
export function toast(text: string, kind?: 'info' | 'good' | 'bad' | 'gold', icon?: string, ms?: number): void;   // max 4 visible, oldest dropped
export function toastBatch(key: string, text: (n: number) => string, kind?: 'info' | 'good' | 'gold', icon?: string): void;   // coalesces within 1.5 s
```

### 13.5 Counsel card (`counsel.ts`, H)
Exactly one item, by priority: Periculum advisory › urgent tip (`nextTip(s)?.urgent`) › an opening lesson whose job is not done (DESIGN §11.13) › Cave advisory › a lesson in its breather (payoff, *Begin now*) › tip (if `prefs.tips`) › Monitum / Opportunitas advisory › calm line (*"The council is content. Next: {current milestone}"*). Above it (once a lesson has brought it, `introduced(s, 'portraits')`) the portrait strip of appointed advisors (`portrait(id, advisorMood)`, severity pip; click → `openTab('advisors', id)`). An advisory renders `renderAdvisory()` lazily (only when it is the shown item or the signature changed): kicker (advisor office), title, metric chip, text, up to 3 remedy buttons (disabled with `check.reason` when not ok), **Hush 30 d** (not Periculum), **Mute** (Nota only). Building remedies show **Ask the Ordo** + **Place it myself** when Ordo construction is on, else only the latter. A tip shows the mentor portrait, `mentorKicker(s)`, title, text, **Understood** (`dismissTip`) and **Show me** when `target`/`tab` is set (opens the tab and pulses the target selector for 3 s).
What waits on the player, pure (tests/voice.test.ts): `awaitingItems(s)` lists, most pressing first, each Periculum advisory, a dispatch (`s.choice`), each Cave advisory, the chores learned and not yet answered (`pendingOffers`, once the lessons have brought Edicta's Mandata), and a ready petition while Edicta is on the bar (the Breviarium's *Awaiting you*; the phone voice line's '+n', which counts them less the one the line shows: `waitingBeyond`). On the SHEET the counsel card is the voice line (§13.10): folded to its head (portrait, kicker, title, the chip, the pip) at the sheet's top, unfolded inside the sheet; `showLesson(g, l)` is every Show me's route (its tab where the lessons' table puts it, `bringTarget`, then `pulseTarget`). `voiceAction(item, s)` gives an item's one chip: a Periculum or Cave with a building remedy → **Place** (that remedy, checked), offers → **Review** (Edicta at `mandates`), a lesson under way with a pointer → **Show me**, a dispatch → **Read**, a petition → **Petition**; else none (the line shows ▾). `awaitAction` is a row's: an advisory's first remedy (a building one as Place), else the chip. `remedyChip(list, first, s)` is the shared core.

### 13.6 Remedy execution (`App.applyRemedy`, H)
```
check = checkRemedy(s, r); if (!check.ok) → toast(check.reason, 'bad'); sfx 'error'; return
place     → startPlacing({ kind: 'building', type: r.building, at: resolvePlaceAt(s, r.building, r.tile) })   // the tile while still valid, else the best slot
open      → openTab(r.tab, r.anchor)
overlay   → view.setOverlay(r.overlay, r.layer)
contract  → prefillContract(r.spec)
building + op 'center' → focusTile(building tile)
otherwise → act(applyRemedy(s, r))          // sim remedies run through actions
```

### 13.7 FxEvent → UI (`UI.onFx`, H)
| FxEvent | UI |
|---|---|
| `built` | `toastBatch('built', n => n === 1 ? '{Name} finished' : n + ' works finished')`, sfx `build` |
| `evolved` | `toastBatch('evolved', …)`, sfx `tink` (batched) |
| `milestone` | gold toast *"Res Gestae: {text}"* + unlock line, sfx `lyre` |
| `rank` | rank banner 8 s, sfx `cornu` |
| `stage` | banner *"Capitolium: {stage name}"*, sfx `cornu` |
| `taxes`, `caravanIn` | sfx `coin` (the HUD coin chip flashes) |
| `arrive` | sfx `gate` |
| `fire` | sfx `crackle` |
| `event` | sfx `event`; the ChoiceCard shows `s.choice`; **slow for news**: if `prefs.slowForNews` and speed > 2 → `setSpeed(2)` |
| `advisory` with sev 3 (new or raised) | sfx `tintinnabulum` (≤ once per `BELL_S` s); if `prefs.pauseOnCritical` → pause |
| `victory` | Victory dispatch, sfx `victory` |
| `birth`, `death`, `declined`, `leave`, `caravanOut`, `season`, `ordoPlaced` | no toast (map only); `birth`/`death` sfx at most every 10 s |
Toasts are only for completions, evolutions, milestones, rank-ups and errors (DESIGN §15.1). New Annales lines appear in the ticker, never as toasts.

### 13.8 `main.ts` (H) — the App
```
boot: registerAllArt(); prefs = loadPrefs(); initTooltips(); view = new MapView(#map, #minimap, callbacks); ui = new UI(app); ui.build()
      hasSave() ? title (Continue) : title (Found a new colony); the title map = loadGame() ?? newGame({ seed: 42, now })
frame(t): dt = min(DT_CLAMP, (t − last) / 1000)
  catchup → slice run (§11.5); view.frame; ui.frame; return
  game & !paused & !modalOpen → acc += dt × speed; steps = 0
     while acc ≥ 1 && steps < MAX_STEPS: ctx = newCtx(); tick(s, ctx); rates = ctx.rates; fxBuf.push(...ctx.fx); acc −= 1; steps++
     if steps === MAX_STEPS: acc = 0          // drop the backlog
  fxBuf.push(...drainActionFx()); if fxBuf.length: view.handleFx(fxBuf, s); ui.onFx(fxBuf); fxBuf = []
  view.frame(dt × 1000, s, speed, paused); ui.frame(t)
  autosave timer; s.stats.playMs += dt × 1000 while in game mode and the tab is visible
new game: s = newGame({ seed: hashStr(String(now)) , legacy, legacyBonus, now }); view.attach(s); paused; Founding dispatch → "Raise the standard" → setSpeed(1)
keys (keys.ts): Space, 1–4 (5 in ?dev), E V B P T L, O / Shift+O, R, H, WASD/arrows → view.panBy, + / − → view.zoomBy, Esc chain (modal → placing → selection → the panel above its host's default detent → menu); ignored inside inputs
back (history.ts): initBack(app) registers the layers of the Esc chain (modal 100 › placing 50 › selection 40; the phone's
      speed popover (hud.ts) adds 70 and the Breviarium (tray.ts) 60; the layout adds the panel above its host's default
      detent at 30, stepping full → half → closed; later layers registerBack({ rank, open, close })); ui.frame → syncBack(mode !== 'title') keeps one sentinel history entry in a game;
      popstate closes the top open layer (a letter that must be answered goes to the title) and re-arms; with none open the
      first Back saves and toasts 'Back again to leave · the colony is saved', a second within LEAVE_MS leaves
startPlacing(p): the place banner first (it refreshes the layout: a phone's sheet drops while placing), then view.startPlacing
      (a pre-positioned ghost reports its verdict, and on touch its Place button, through onPlacementPreview);
      view.startPlacing glides the ghost into the free map only when it is not there already (ensureVisible)
focusTile(tile): centres the building on it (its whole footprint) or the tile in the free map, and flashes it
enter(s): the title comes down first (UI.hideTitle syncs the tab bar and refreshes the layout), then view.attach(s), so the
      default zoom and the forum's centring are for the map the HUD, the panel and the column leave free
```
`?dev` exposes `window.cv = app` and `window.skip(days)` (runs `days` online ticks synchronously).

### 13.9 CSS ownership and conventions
- `tokens.css` (S) defines every DESIGN §16.1 token plus `--font-body: 'Pixelify Sans'`, `--font-caps: 'Silkscreen'`, spacing `--s1..--s5` (4/8/12/16/24 px), radii, z-index tokens (`--z-map` 0 … `--z-veil` 200 from DESIGN §15.1). Fonts are imported in `main.ts` (`@fontsource/pixelify-sans/400.css`, `600.css`, `@fontsource/silkscreen/400.css`).
- `base.css` (H) owns the shared components every UI file uses and nobody redefines: `.btn` (`.primary .legate .good .danger .ghost .small`), `.chip` (`.bad .good .gold`), `.well`, `.card`, `.kicker`, `.meter`, `.pip`, `.sev-0…3`, `.badge`, `.new`, `.seal`, `.num`, `.muted`, `.meander` (border-image from `f_meander`, injected as a CSS variable by `ui/index.ts`).
- New class names are prefixed by area: `hud- left- obj- counsel- tick- toast- banner- place- map- modal- disp- title- veil- tray-` (H); `side- tab- ed- adv- bld- pop- tr- ann- ins- choice-` (I).
- Size classes (§13.10): `#app[data-w=compact|medium|expanded|large][data-h=short|regular|tall][data-input=touch|mixed|mouse][data-host=sheet|drawer|dock|columns][data-detent=closed|half|full]` and `[data-tiny]`, written by `ui/layout.ts` (on a phone also `[data-card]` while a card stands in the phone's slot; on the SHEET `--sheet-closed|half|full` and `--dock-h`, the height of what stands on the bar; on the DRAWER `--drawer-half|full`, the pane's widths; on the DOCK `--dock-half|full`, its pane's widths, and dock.css's `--dock-now`, the width at the detent; on the COLUMNS
`--cols-half|full`, the panel's widths, columns.css's `--cols-now`, which is `--side-w` there, and `[data-fold]` where
the left column folds away for the wide panel or `[data-strip]` where the map gives way to it, `columnsRoom`). What both phone hosts share is keyed `#app:is([data-host='sheet'], [data-host='drawer'])` (the same specificity as one host's selector), and what the DOCK shares with them (the voice line's look, the tool column, the 76 px banner's box, the tab bodies' 12 px floor) `#app:is([data-host='sheet'], [data-host='drawer'], [data-host='dock'])`. New CSS keys on these attributes only (plus `@container` queries inside panels); the width-only `@media` breakpoints below are migrated to them as each host lands, and keep working until then.
- Container queries (tabs.css): `#tab-body` is the `tab-body` container (inline size): its page (`.side-body`) is one column under 520 px (the 380 px desktop panel, a phone), sections in two columns from 520 and three from 840 (`display: block`, `columns`, each section `break-inside: avoid`), and under 330 px (the 340 px drawer's 314 px body; never the 380 px desktop panel's, even with a 15 px scrollbar) the dense rows fold (labour lines, trade rows, edict rows, works queue) so nothing is cut off by the body's `overflow-x: hidden`. Grids in tab bodies size by the body (`.adv-filters`, `.pop-grid`: `auto-fit`/`auto-fill` with a minimum), not by fixed counts.
- Breakpoints (P4: every host but COLUMNS has its own shape, and COLUMNS is never under 1,280 px): the width blocks of mobile.css and panels.css (under 1,100, 1,200, 900, 560 px) now serve only what the phones still lean on and stand off the DOCK (`:where(#app:not([data-host='dock']))`, the same specificity); the DOCK's one 56 px HUD row, pane, spine, wide pane, map tools and banner are `dock.css`; the desktop COLUMNS' badge
spine, ⤢, wide panel and what moves with them (the view control's place, the map tools, the toasts, the event card) are
`columns.css` (imported last; P5), today's desktop rules of hud.css, left.css, panels.css and map-ui.css standing as
they were for the docked panel. The Breviarium as a wide pane's first column is tray.css's (`#side > #tray.tray-col`). Before: desktop ≥ 1,100 px; tablet 900–1,099 (side panel overlays the map, minimap hidden); mobile < 900 (bottom sheet 46 vh, HUD two rows; the SHEET host's own one-row HUD is `#app[data-host='sheet']` in hud.css, its sheet, bar, voice line, tool column, toasts and placing banner in `sheet.css`; the DRAWER's 44 px HUD row in hud.css and its spine, pane, floating voice line, tool column, card slot, one-row banner and toasts in `drawer.css`; both imported after mobile.css (drawer.css last) so they outrank the rules of mobile.css and panels.css that the 720–899 px tablets still use; the old phone HUD and Res Gestae rules of mobile.css stand under `:where(#app:not([data-host='sheet'], [data-host='drawer']))` and its short-window drawer under `:where(#app:not([data-host='drawer']))`, which keeps their specificity); compact < 560. Touch targets ≥ 44 px wherever `(pointer: coarse)` matches, at any width (a touch screen under 1,280 px gets the two-row HUD for them); `image-rendering: pixelated` on every sprite `<img>` and canvas; `-webkit-font-smoothing: none`.
- Page hygiene (base.css): `#app { overflow: clip }` (script can never scroll the frame; only `#tab-body` scrolls, through `dom.scrollWithin`, never `scrollIntoView`); `touch-action: pan-x pan-y` on `#app > :not(#map)`, `#modal-root`, `#title-screen`, `#veil` (never `#app *`, which would override `#map { touch-action: none }`); a `gesturestart` preventDefault (main.ts); `overscroll-behavior: none` and `text-size-adjust: 100%` on html, body; `-webkit-touch-callout: none` on img; fields of 16 px on touch; ligatures off everywhere (`font-variant-ligatures: no-common-ligatures`: Pixelify Sans draws 'fi' as one glyph that reads as 'A'). The canvas draws text in Silkscreen only, which has no ligatures.

### 13.10 Layout engine (`src/ui/layout.ts`, H)
One game screen: the map full-bleed underneath and one panel on top, whose shape (the **host**) follows the window and whose resting position (the **detent**) follows the player.
```ts
// pure (tests/layout.test.ts)
export type WClass = 'compact' | 'medium' | 'expanded' | 'large';   // #app CSS px: < 600 · 600–959 · 960–1439 · ≥ 1440
export type HClass = 'short' | 'regular' | 'tall';                  // < 480 · 480–759 · ≥ 760
export type InputClass = 'touch' | 'mixed' | 'mouse';               // coarse & !any-fine · coarse & any-fine, or fine & any-coarse · else
export type Host = 'sheet' | 'drawer' | 'dock' | 'columns';
export type Detent = 'closed' | 'half' | 'full';
export function classify(w: number, h: number, m: Media): Classes;   // { w, h, input, host, tiny }
export function route(i: Intent, c: RouteCtx): Route;                // { detent, remember, card }
export function reveal(selector: string, host: Host, w?: WClass): string;   // a hidden target's visible proxy (revealOn: REVEAL, the DOCK's by width), a card's copy of a row (CARD_ROWS), else itself
export function hostPointer(l: Lesson, host: Host): { open; anchor?; glow; card };   // lessonPointer, but a CARD_LESSONS job on the SHEET stays in its card
export function trayHolds(anchor?: string): boolean;                // the SHEET's build tray carries this Aedificia anchor (else: full)
export function lessonFolds(l: Lesson, host: Host): boolean;        // the lesson arrives folded in the voice line (a tray card's job)
export function isPhone(host: Host | null): boolean;                // SHEET or DRAWER: the phone widgets
export function drawerWidths(W: number, spine: number): Record<Detent, number>;   // the DRAWER pane's width per detent
export function clearOf(box: Box, ob: Box, gap?: number): Box;      // the largest part of a box clear of what stands in it
export function priorityDrops(need: number, room: number, widths: readonly number[]): number;   // the DRAWER's and the DOCK's HUD priority+
export function dockWidths(W: number, w: WClass): Record<Detent, number>;   // the DOCK pane's width per detent: spine 56 · clamp · wide
export function brevColumn(host: Host, w: WClass, d: Detent): boolean;      // the Breviarium is the wide pane's first column (DOCK ≥ 960, COLUMNS)
export function columnsRoom(W: number, lessons?: boolean): 'beside' | 'fold' | 'strip';   // how the COLUMNS make room for wide: the left column beside the 630 px of map (≥ 1750), folded away, or (the opening lessons running: its card is theirs) kept with the map a strip
export function columnsWidths(W: number, lessons?: boolean): Record<Detent, number>;   // the COLUMNS panel per detent: spine 64 · 380 · wide (all but 630 px of map, and the left column where it stays)
export function toolColumn(host: Host, w: WClass): boolean;  // the phones' tool column (and the overlay bar in Mappae): phones, DOCK < 960
export function slimBanner(host: Host | null): boolean;      // the placing banner with the reason row and ⟳: all but COLUMNS
export function isLayer(d: Detent, host: Host): boolean; export function backDetent(d: Detent, host: Host, tiny: boolean): Detent;   // Back/Esc
export function keyAction(key: string, shift: boolean, host: Host): KeyAction | null;   // a tab letter (Shift: wide), C M I: a view
export function visibleOn(host: Host, w?: WClass): readonly string[]; export function revealOn(host: Host, w?: WClass): Record<string, string>;
export const DEFAULT_DETENT, LESSON_VIEW, VISIBLE, REVEAL, DOCK_TOOLS, CARD_LESSONS, CARD_ROWS, VIEWS, VIEW_HOSTS, TAB_KEYS, DOCK, COLUMNS; // host defaults · LessonId → 'tab' | 'map' | 'frame' · per-host targets · the views · the DOCK's and the COLUMNS' widths
// DOM: one instance (UI.build), window.cv.ui.layout in ?dev
export class Layout {
  readonly classes: Classes; readonly host: Host; readonly input: InputClass; readonly tiny: boolean; readonly detent: Detent;
  setDetent(d: Detent, opts?: { instant?: boolean; fromH?: number; user?: boolean }): void;   // the panel, the SHEET's slide, the insets
  panelToggle(open: boolean): void;                           // SidePanel.toggle(): the last open detent, or closed
  go(i: Intent): Route; restore(): boolean; forget(): void;   // route() and move there; put back (detent and tab-body scroll) / drop what a remembering route left
  dock(el: HTMLElement | null): void; readonly docked: HTMLElement | null; readonly dockH: number;   // the SHEET's card slot; what stands on the bar
  lift(why: string): void; drop(why: string): void;           // half for a while (the SHEET's unfolded counsel), and back
  onMount(mount: (host: Host, c: Classes) => void): void;     // a widget's place per host (and width class), run before the layout measures
  attachSheet(hooks: SheetHooks, observe: HTMLElement[]): void;   // the phones' head, slide and floating voice line (sheet.ts)
  readonly offered: readonly Detent[]; readonly sheetHeights: Record<Detent, number> | null;
  readonly extents: Record<Detent, number> | null;            // the SHEET's heights, the DRAWER's, the DOCK's or the COLUMNS' widths
  freeRect(): { left: number; top: number; right: number; bottom: number };   // #app px of map the UI leaves free
  reveal(selector: string): string;
  onChange(cb: (why: 'classes' | 'detent' | 'free') => void): () => void;
  refresh(): void;                                            // measure now (the title shown or hidden, placing)
}
```
- **Hosts**, first match wins: DRAWER if short and < 960 wide · SHEET if < 720 wide · COLUMNS if a mouse and ≥ 1280, or anything ≥ 1440 · else DOCK. **Tiny** (< 360 wide or < 420 tall) takes the half detent off the sheet (closed ↔ full). Players see the detents as sheet closed/half/full, drawer spine/half/full, dock and columns spine/docked/wide; code says closed/half/full. Defaults: sheet and drawer closed, dock and columns half.
- **Observed**: a ResizeObserver on `#safe-box` (the window inside the safe areas: the classes are read from it, never from `#app`, whose box the phone hosts run under the insets, so a host can never change the size that chose it: a 900 × 490 window with a 20 px home indicator stays a 900 × 470 DRAWER), on `#app` (the geometry) and on `#hud`, `#side`, `#left`, `#place-banner`, `#tabs`, `#map-col` and a docked card; `change` on `(pointer: coarse)`, `(any-pointer: fine)`, `(any-pointer: coarse)`; `refresh()` from the UI root when the title or placing changes the chrome. Each recompute rewrites the `data-*` attributes on `#app` (§13.9) when a class changes and calls `view.setInsets` when the free rect changes (with `host: true` on a host change: the view re-picks its default zoom).
- **One source of truth for the detent**: the Layout. `SidePanel.toggle()` asks it (`panelToggle`), it writes the panel through `SidePanel.show()`; the view control and the keys C, M, I go through `moveDetent`. A detent above the host's default is a Back/Esc layer (`BACK_RANK.detent`, 30), and on the DOCK its spine too: Back from the spine or from wide docks the pane again (`isLayer`, `backDetent`, pure). On the COLUMNS only wide is a layer: the spine is a view of its own there, so Esc from it goes on to the menu (the chain: modal → placing → selection → wide → docked → menu). A tiny sheet's half becomes full, marked forced, and goes back to half once the window offers it again (`keepDetent`, pure).
- **Free rect**: the `#app` rect below the HUD, clear of the panel at its detent's **target** (never mid-slide: the SHEET's heights, the DRAWER's, the DOCK's and the COLUMNS' widths from the pure tables; a phone's sheet and drawer drop while placing, the DOCK's pane stays), right of the desktop's `#left` column (unless it folds away for the wide panel, `columnsRoom`), and above `#place-banner` while placing. The DOCK's wide pane leaves a 320 px strip from 960 px wide and none under it (the free rect is then empty: the inspector's popup hides, `currentFree()`); beside the DOCK's spine it is clear of the floating head. The map's tools, the ticker and a phone's band of cards float on the free map and are not taken out (the inspector steps a target clear of them; P2's voice line and tool column replace them). Turned into canvas insets with `view.mapRect()`, given to the view as soon as a detent is set, from the slide's start (its target's rect: the camera's glide that follows, a centring or a pre-positioned ghost, runs with the slide and lands in the map that will show), on every host.
- **Routing** (`route`, pure): place and focus clear a phone's map (closed, remembered; focus also opens the context card) and leave a tablet or desktop pane, but for a wide one: placing docks the DOCK's or the COLUMNS' wide pane at any width, remembered (cancelling goes wide again; `Layout.go` drops a kept detent whenever a placing keeps nothing itself, so its end can never restore an older one), and a focus docks the DOCK's wide pane under 960 px, which leaves no map (`RouteCtx.w`), not remembered: it stays docked (SPEC A §7). Every "show on map" routes that focus off the phones (`App.select`, `App.focusTile`: an Annales line, a remedy's Look, a ledger row; the focus row too); a tab opens half on a sheet (full for council, trade, annals, from a slot too; a chip half), half in a drawer, docked elsewhere unless already wide (Shift + its key: wide); a lesson follows `LESSON_VIEW` (its tab as a tab opens · the map shows: a full panel steps down · the frame: unchanged). `reveal` runs first in `pulseTarget` (counsel.ts), so every lesson's pointer glows something the host shows (a table test covers every lesson × host × detent).
- **The SHEET** (portrait phones, P2b; `sheet.ts`, `sheet.css`). `#side` is the sheet: `[#sheet-grab strip][#sheet-voice: #counsel's folded card as the voice line, #ticker in calm][#tab-body]`, standing on the bar (`#tabs`, re-hosted to `#app`'s foot: 60 px + the bottom safe area, five stable slots `BAR_SLOTS`, Annales none; `slotTap`: the open tab's slot closes a raised sheet). `#app` runs under the safe areas there; the HUD and the bar pad themselves. Heights (pure `sheetHeights`): closed = the head (grabber + voice line, `SheetHooks.head`, re-measured when the line's words change), half = clamp(240, 44% of `#app`, 380) (50% at h regular), full = up to the HUD; written as `--sheet-closed|half|full` on `#app`. `setDetent` slides with a transform from the taller of the two heights (`SheetHooks.slide`), the inline height dropped at rest (`#side[data-rest]`: the tab body hides only once closed; `data-moving` shows it during a drag, the strip keeping its rest shape), the insets set for the target at once. The grabber: drag (follows the finger; `snapDetent`: nearest, or the next one on a fling ≥ `FLING` px/ms, a finger held still before it lets go flinging nothing), tap (`cycleDetent`), touch-action none; its 44 px hit area reaches over the map above a 10 px strip (the strip is 44 px at full). Entering the SHEET, and entering a colony on it, closes the sheet (`hostEntryDetent`, pure) unless a tab was opened in the last second; the other hosts keep the player's detent (the DRAWER: below). Routing through `go()`: tabs (`SidePanel.open(tab, anchor, from)`, `Game.openTab`'s optional `from`: 'chip' for the voice line's Review, the ticker, danger chips and portraits; 'key'; 'remedy'; 'lesson'), placing (the UI root: `place` → closed, remembered; `forget()` after a work is placed, `restore()` on cancel), the pinned inspector card (`focus` → closed; closing it restores, as does its building vanishing: `Inspector.onPin`) and the lessons (`UI.showLesson`: their tab, or `{ kind: 'lesson' }`; it waits for the founding letter). `lift('counsel')`/`drop('counsel')`: the voice line's tap unfolds the card inside the sheet at half and folds it back; a closed sheet folds it. Free rect: below the HUD, above the sheet at its detent's height and the bar (above the placing banner while placing), left of `#map-col`. The tool column `MapColumn` (`#map-col`: Via, Mappae, `#zoom-ctl`) sits 8 px above the sheet (`--sheet-now`), hides at full, wraps beside the zoom on a short strip; its popovers (Via's tools, Mappae holding `#overlay-bar`) are `BACK_RANK.popover` layers. `reveal` proxies on the SHEET (`REVEAL.sheet`): `#overlay-bar` → `#map-mappae` (an explicit Show me opens the popover: `bringTarget`/`registerBringer`, and a target that shows after all glows itself), `#objective` → `#hud`, `#ticker` → `#counsel`, `#tab-annals` → `#hud-menu`. The bar's slot tap while placing ends the placing first (the open tab's slot then shows its tab, never folds it); toasts stand under the HUD (over the bar at full) and stay tappable. Pure helpers: `sheetHeights`, `snapDetent`, `cycleDetent`, `slotTap`, `barSlot`, `hostEntryDetent`; module accessors `currentHost`, `currentDetent`, `routeIntent`, `moveDetent`, `revealTarget`, `bringTarget`.
- **The SHEET's slot and banner** (P2c). One card at a time stands where the sheet was, over the bar (`Layout.dock(el)`: `#app[data-card]` hides `#side`, the free rect ends above the card, `--dock-h` carries the tool column on it, and the card's height is observed): the **context card** (the inspector's `.ins-popup` with `data-docked`: no `place()` beside its target; its target glides clear above it, `view.ensureVisible` then `dodge`; a brief of the parts `briefParts` picks, pure, and More; a work's labour line, `labourEl`, staffs it in place) and the **event card** (`#choice[data-docked]`: a new dispatch arrives folded, as the voice line's `CounselItem` 'event' right after a Periculum, 'NVNTIVS · … · 28 d' with Read; Read docks it, ≤ 70% tall, answers pinned; folding, Back (`BACK_RANK.card`, 45), a bar slot or a building tapped gives the slot back). Opening either is a `focus` (closed, remembered); one taking the slot from the other keeps it closed; closing the last restores the detent and the tab body's scroll, that tab's only (UI root: `Inspector.onPin`/`onDock`, `ChoiceCard.onStage`, re-told when a turn of the phone docks or undocks an unfolded card, `SidePanel.onSlotTap`, which `SidePanel.open` also calls on the SHEET: any tab opened steps the card aside first). Placing hides the context card (sheet.css) until it ends; a dispatch that waits shows on it as a Read row (the 'choice' anchor). The **placing banner** is 76 px over the bar (name and cost; the verdict; the reason row, `placingWhy`: the lesson job or the advisory that asked; ⟳, Place, ✕), the column riding on it; pure `startAt` (a finger's ghost, or any on the SHEET, starts on the best plot) and `afterPlace` (⟳ on touch is Shift-click: the ghost moves to the free plot nearest the last), the ⟳ state in the UI-owned key `castravaleria.ui.keepPlacing.v1`. Aedificia at half draws the build tray (one panel, `trayShown()` in its signature); `Intent` 'open' carries the anchor, and an anchor the tray lacks (`trayHolds`, pure: the Agenda, the works queue, the tools) opens Aedificia at full. A lesson whose job is a tray card arrives folded (`lessonFolds`, pure), and VIII points the tray at its cards ('cards': every category). ⟳ shows on the phones' banners (the SHEET's, the DRAWER's; P4 owns the tablet's). Lesson I carries its job in its card (`CARD_LESSONS`, `hostPointer`: no tab opens; `CARD_ROWS` glows the card's Annona row); Show me folds any other lesson's card into its line. Modals on the SHEET are full-screen sheets (`.modal-head` sticky, `.modal-actions` sticky, or `.modal-foot` holding the actions and their `.modal-status`; box-less elsewhere).
- **The DRAWER** (landscape phones and short windows, P3; `drawer.css`, the same nodes as the SHEET in another arrangement, `isPhone` wherever the two share a behaviour). `#app` runs under the safe areas (`inset: 0`); the HUD is one 44 px row (hud.css; its rule a shadow), the figures in their order and the speed pair `[❚❚][1× ▾]` and the menu at the right, and `Hud.fit` (priority+, pure `priorityDrops`) gives `.hud-drop` to the date, then spirits, souls, coin, Aqua and Grain as the row's width runs out (refitted when its width or its figures' words change; dropped off the DRAWER). `#tabs` (re-hosted to `#app`, `aria-orientation: vertical`, Up/Down arrows, an `aria-label` per icon) is the 56 px **spine** at the right edge (`--spine-w`, plus the right safe area; 0 while no tab is revealed); a `drawer-spine` size container drops Annales' icon when six do not fit (REVEAL: the menu, which has its Annales row on both phones, as do the ACTA lines). `#side` is the **pane** left of the spine: `drawerWidths` (pure: half clamp(280, 42% of `#app`, 360), full everything left of the spine, closed none) written as `--drawer-half|full`; `setDetent` slides it sideways (`SheetHooks.slide`, the axis per host; `translateX` from the wider extent, the width set at rest), a drag of its left-edge grabber (`.sheet-grip`: a 30 px strip, 8 px over the map, and its 44 × 64 handle `#sheet-grab` across the border) follows the finger with the pane's live width and snaps by `snapDetent` over the widths, a tap on the handle (only: a tap beside it on the strip does nothing) cycles; closed, it waits under the spine, hidden (`[data-rest='closed']`); at full it runs from `#app`'s left edge under the notch, its grabber and sections padded clear of the left safe area. While placing or with a card in the slot it stays away (`:is(.placing, [data-card])`, as the SHEET's sheet does), the tool column and toasts keep their closed places and the free rect ignores it; `lift()` holds back while a card is docked (the counsel's lesson card then waits folded), and on a phone `SidePanel.open()` ends a placing first for any tab but a lesson's (a Breviarium row, a key: as a bar slot or spine icon does), so a lesson's tab opened meanwhile shows once the placing ends. The voice line's slot (`#sheet-voice`) heads the open pane and, closed, floats at the bottom-left of the map as a child of `#app` (`SheetHooks.floating`; `slide()` places it before the layout measures; ≤ 380 px wide, 44 px tall); a tab icon routes as a bar slot (`slotTap`; route: half, a switch at full stays full). The tool column (`MapColumn`, fitted from its foot) stands left of the spine or the pane at half, hidden at full; the card slot (`Layout.dock`: the docked context card and event card at the bottom-left, ≤ half the free map wide, ≤ 80% tall; `#app[data-card]` hides the floating line) and the one-row placing banner (56 px, up to the tool column; ⟳ as on the SHEET) at the foot. Free rect: inside the safe area (`Layout.safeRect()`, `safeArea()`: `#safe-box` against `#app`), below the HUD, left of the spine, the pane at its detent's width and the tool column, and clear (pure `clearOf`: above, or beside a tall card) of the card, else the floating voice line, else the banner. The tool column's popovers keep within the map left of the column and the safe area, and where that strip is narrower than 220 px (the half pane of a 568 or 667 px phone) open to the column's right, over the pane (`.map-pop-over`). Populus' census is two columns there. Entering the DRAWER keeps the player's detent (`hostEntryDetent`), a colony entered closes it; half and full are Back layers; lesson VIII points its Aedificia at the catalogue (`hostPointer`: 'cards'), the others as everywhere; `REVEAL.drawer` = the SHEET's proxies. A pre-positioned ghost stays when a banner or card appears under a resting mouse (view.ts: only a ghost the mouse moved leaves with it).
- **The DOCK** (tablets, foldables, 800-px mouse windows, touch laptops under 1,440 px; P4; `dock.css`). `#app` stays inside the safe areas. The HUD is one 56 px grid row of named areas (the full tablets with label, trend and strip; coin over souls; spirits; from 960 px dignitas, the date and the materials; then `#view-ctl`, `#speed`, the menu); `Hud.fitDock` (priority+, `priorityDrops`) drops the date, dignitas and the materials, folds the speeds to the `[❚❚][1× ▾]` pair (`.fold`), bares the view control's label (`.bare`), then drops spirits, coin with souls, Aqua and Grain; last, the materials' cells the strip cannot show whole step out from the last (`.hud-cut`: never a stock cut mid-number). `#side` is docked at the right (`dockWidths`: clamp(300, 40%, 360) under 960, clamp(340, 30%, 400) from 960; written as `--dock-half|full`), a `dock-pane` size container: `#sheet-voice` (order −1) holds `#objective` in its one-line form (its `.obj-fold` ▾ unfolds it) over `#counsel` drawn as the voice line (counsel.ts `voiceLine`: chip and +n pip; unfolded at most 40% of the pane), then `#tabs` (3 × 2; one row of six wide) and `#tab-body`. `SheetHost` slides it sideways (transform; `data-rest` keeps the detent the layout follows while it moves); closed it is the 56 px spine (`#side[data-rest='closed']`) with the head afloat top-right (`SheetHooks.floating()` returns it at rest there, and the free rect is the larger part clear of it, `clearOf`, written as `--dock-free-t|r` for the event card); wide it is the whole width under 960 and all but 320 px from 960, where `Tray.column` stands `#tray` in it as the first grid column (`brevColumn`; no ✕, grip or Back layer; a HUD figure scrolls it). Under 960 the phones' tool column serves it (`toolColumn`: `MapColumn.mount(host, w)`, the overlay bar in Mappae, `DOCK_TOOLS` reveal); from 960 the desktop's `#map-tools` with the minimap. The inspector stays a popup beside its target, bounded by the free rect; the event card floats centred in the free map; placing keeps a docked pane (a wide one docks, remembered) and uses the slim 76 px banner (`slimBanner`: the reason row and ⟳). Rotating keeps the host and the detent (only the width class changes; mounts run on a width-class change too); a phone's closed panel (its default) unfolded or widened into the DOCK or the COLUMNS docks there (`hostEntryDetent`); a colony entered on either never starts wide (`Layout.settle`, UI.hideTitle).
- **The view control** (DOCK and COLUMNS): `VIEWS` (Urbs · City closed, Mensa · Map & ledger half, Tabularium · Ledgers full), `#view-ctl` (hud.ts: three segments, the one in use pressed and labelled with its Latin name; each one's tooltip and aria-label `Urbs · City`, `Mensa · Map & ledger`, `Tabularium · Ledgers` with its key) in the DOCK's HUD row and, on the COLUMNS, re-hosted into `#app` at the top-left of the map beside the left column (`Hud.mountView`, an `onMount`; columns.css), so the desktop's HUD row and its materials strip stay as they were, keys C, M, I and Shift+E/V/B/P/T/L (`keyAction`, pure; keys.ts) through `moveDetent` and `route` (`from: 'key'`, `shift`).
- **The COLUMNS** (the desktop: a mouse from 1,280 px, anything from 1,440; P5; `columns.css`). Docked (Mensa, the default) is today's desktop: the 64 px HUD, the 300 px left column (`#left`: the Res Gestae, the counsel, the hover card) and the 380 px panel. `columnsWidths` (pure; `COLUMNS`) gives the panel's width per detent, written as `--cols-half|full` (`Layout.sizeColumns`), and `SheetHost` slides it sideways between them as the DOCK's (`data-rest`; its voice slot stays empty, the left column keeping the Res Gestae and the counsel). Closed (Urbs) it is a **64 px badge spine** at the right edge under the HUD, as tall as its six tab icons (40 px with a mouse, 44 for a finger) with their badges and NEW stickers at 12 px (`#side[data-rest='closed']`; a click opens that tab docked: `route` open from 'tab'; their names in an aria-label there only, `SidePanel.spineNames`: docked or wide the buttons' own words name them, badge and NEW included, as before), `#side-toggle` (◂ ▸) beside it expanding and folding it as before; the free rect ends at the spine (`W − 64`), the map tools, ticker, placing banner and event card keep clear of it (`--side-w` is `--cols-now`); the left column stays as it is. Wide (Tabularium) the panel covers the map but for **630 px of it** (`COLUMNS.map`: the view control, the map tools and the ticker as beside the docked panel), `#tray` its first grid column (`brevColumn`, `clamp(250px, 26%, 340px)`) and the page beside it (two columns from the tab body's 520 px query). `columnsRoom` says how the room is found, and the layout writes it on `#app` for columns.css: from 1,750 px (`left + map + brev + body`) the left column stays beside the map (`W − 940`); under that it folds away while the panel is wide (`[data-fold]`: columns.css hides `#left`, and `--cols-map-l`, where the map begins, is 0; the panel is `W − 630`: x 630–1440 at 1,440 px, a one-column page at 1,366 and 1,280); but never while the opening lessons run (`introRunning`: their card is the left column's counsel; `[data-strip]`: the map gives way to the panel instead, down to a 320 px strip with the minimap and the zoom, the overlay bar and the ticker stepping aside, O still cycling; the UI root has the layout measure again when they begin or end). Leaving wide, the Breviarium column stays until the slide rests (the UI root watches `#side`'s `data-rest`), so the page never lays out again across the wide panel without it. ⤢ (`#side-wide`, panels.ts) hangs under the ▸ toggle on the panel's edge, docked or wide (the 3 × 2 tabs need 365 of the docked header's 378 px): it widens the panel and docks it again (⤡), as I and M do (`aria-pressed` while wide: `SidePanel.syncWide`). Toasts stand clear of the handles and never reach the view control (wide, under it); the event card stands below the view control's row (`top` from its height: 44 px buttons for a finger), wide centred in the map the panel leaves (in the lessons' strip over the page, under the tabs). Placing from wide docks the panel (remembered); asking for wide while placing (I, ⤢, the view control, Shift with a tab's key) ends the placing first (`Layout.setDetent`, the DOCK's too); Esc and Back step wide → docked; the spine is no layer (Esc goes on to the menu).
- **The focus row** (`focusrow.ts`, the DOCK and the COLUMNS, `FOCUS_HOSTS`, `keepsFocus`: a click, never a hover): rows carry `data-focus` (`b:<id>` a building or site: works queue, gentes, an advisory with a centring remedy; `w:<type>:<tile>` an Agenda wish; `c:<cat>` a labour category; `decl` the declining homes), one capture-phase listener on `#tab-body` lights the row (`.focus-row`, repainted after rebuilds) and answers on the map: `route({ kind: 'focus' })` first (the medium wide pane docks), then one object centred and flashed, several brought into view (`ensureVisible` of their union) and each flashed. Pure `parseFocus`, `focusRects`, `unionRect`, `focusOfAdvisory`, `keepsFocus` (tests/focusrow.test.ts). On the COLUMNS a works-queue row's click also selects its site (the popup beside it in the free map); hovering a row does nothing.

---

## 14. Work breakdown

### 14.0 Process (every package)
- **Phases**: Scaffold (one agent) → **10 parallel work packages A–J** → Integration (integrator) → Balance & polish (J + integrator).
- **Branches**: `wp/a-world`, `wp/b-sim`, `wp/c-ordo`, `wp/d-progress`, `wp/e-guidance`, `wp/f-render`, `wp/g-art`, `wp/h-shell`, `wp/i-panels`, `wp/j-tests`, all from the tag `scaffold`. Commit messages start with `[WP-X]`. Rebase on `main` before opening the PR. No force-push to `main`.
- **Ownership**: edit only the files your letter owns in §3 (new files only under your own prefix, listed in the PR note). Read anything.
- **Always green**: `npm run typecheck` and `npm test` pass on every commit of every branch. Tests that need another package's *real* behaviour are wrapped in `describe.runIf(INTEGRATED)` (from `tests/util.ts`); in Phase 1 they are skipped, at integration they run.
- **Contract changes**: if a frozen signature is wrong or missing, do not work around it silently. Put `CONTRACT:` in the PR note with the proposed change; the integrator updates §4/§8/§12/§13 and the owning stub. Until then, keep a local adapter inside your own file.
- **Numbers**: never inline a tunable. Missing constant → add a local `const X = … // TODO(balance): move to B.group` in your file; J moves it into `balance.ts` at integration.
- **Definition of done** (every package): all items of your *Acceptance* list; typecheck and tests green; file budgets respected (§3, aim ≈ 70%); no `any` except in `save.ts` migrations; no `TODO` without a tag; JSDoc one-liner on every export; the PR note lists what is stubbed or assumed.

### 14.1 Scaffold (S — one agent, first, ≈ 3.5k lines)
**Writes fully**: `package.json` (+ the generated `package-lock.json`), `tsconfig.json`, `vite.config.ts`, `.gitignore`, `README.md` (play link placeholder, scripts, the Pages setup note, credits: idea from the author's *rome* prototype and *IdleSettlement*), both workflows, `public/favicon.svg`, `index.html` (§13.1), `src/styles/index.css` + `tokens.css` (and every other CSS file of §3 as an empty file with an owner header so the `@import`s resolve), `src/game/types.ts` (§4 verbatim), `balance.ts` (§7, every DESIGN number), `rng.ts`, `calendar.ts`, `fx.ts`, `memo.ts`, `state.ts` (`newGame` per DESIGN §18.1), all `data/*.ts` (every DESIGN table transcribed: 29 buildings with every column, 6 tiers, 5 ranks, 5 focuses with plans/splits, 9 edicts with options and effects, 7 settings, 2 switches, 5 path decisions × 3 options with effects, 6 hubs with quirks and seasonal targets, names, 6 advisors), `survey.ts` (full geometry, §8.2), `map.ts` (toy map, §8.2), `actions.ts` (§8.7 verbatim), `sim.ts` (§9 verbatim), `src/render/sprites.ts` (§12.3 complete), `src/ui/dom.ts` and `src/ui/types.ts` (complete), `tests/util.ts`, `tests/calendar.test.ts`, `tests/smoke.test.ts`, `tests/data.test.ts`.

**Writes as stubs** (every other file in §3, with the **final exported signatures** and the minimal behaviour below, so the app runs and each package can work in isolation):

| Area | Stub behaviour |
|---|---|
| `derived.ts`, `coverage.ts` | real `buildingAt`, `road`, `counts`, `houses`, `sites`, `plotOwner`; coverage layers all 0; desirability 0 |
| `place.ts`, `site.ts` | `canPlace` = in bounds, territory radius, not occupied, urban types on free plots of active blocks; `placeBuilding` pays and creates the site; `mult` 1; `bestSlot` = first valid slot |
| `economy.ts`, `census.ts` | output = perWorker × staffed × season; need = Σ stage NEED; caps = base + storage; census counts beds, workforce, idle |
| `people.ts`, `housing.ts`, `construction.ts`, `civic.ts`, `forecast.ts` | `assignJobs` fills `plan.perBuilding` in id order; construction applies 1 work per builder and completes sites; others no-op; forecast = straight-line from today's net |
| `ordo/*` | `runOrdo` returns water-first-then-food-then-builders; build/trade/emergency no-op; actions return `{ ok: false, code: 'notReady' }` |
| `decisions.ts` … `offline.ts` | reveal everything; no milestones; no events; base prices; `save.ts` real JSON + localStorage with `try/catch`; `offlineRun` real (N ticks) |
| `advisors/*`, `guide.ts`, `hints.ts` | `RULE_DEFS = []`; `GUIDE` = the `welcome` tip only; remedies `{ ok: false, code: 'notReady' }` |
| `src/render/**` | debug `MapView`: terrain colour per tile, building footprints coloured by category, roads, pan/zoom/click callbacks; `art/index.ts` with `REQUIRED_SPRITES` fully expanded from §12.3 and the name helpers implemented; other art files empty `register…()` functions |
| `src/ui/**`, `main.ts` | working loop (§13.8), title → new game → founding text → *Raise the standard*; HUD shows date, souls, grain, water, coin and speed buttons; tabs render placeholders; minimal modal/toast |

**Acceptance**: `npm ci && npm run typecheck && npm test && npm run build` pass; `npm run dev` shows the toy map with the castrum, six tent plots, the well and the field as coloured rectangles; Space/1–4 change speed and the Roman date advances (`Kal. Apr. AUC DCCC` → …); calendar tests of §6 pass; `data.test.ts` asserts registry completeness (every id of every `as const` array has exactly one def; 29 buildings; 15 path options in 5 decisions; every rule id's prefix is an `AdvisorId`; every edict option id unique within its edict) and that `newGame(42)` matches DESIGN §18.1 (24 people, 6 families, stocks, 30 beds). Then tag `scaffold`; from here §4, §8 signatures, §12.3, §13.1 and §13.2 are frozen.

### 14.2 Phase-1 work packages (run in parallel)

**WP-A · World and placement** — owns `map.ts`, `survey.ts` (after S), `derived.ts`, `coverage.ts`, `place.ts`, `site.ts`; tests `map`, `placement`, `coverage`.
- Implement DESIGN §3 (generation with guarantees and retries, castrum plan, rings, masking, districts, territory, roads with auto-routing, aqueduct A*), §5.1 site rules and adjacency, §7.4 road-BFS coverage, §7.5 desirability, §10.5 site scoring and `bestSlot`, the 12-check `canPlace` table (§8.2), felling, ceremony paving, the Reserve-block tool.
- Acceptance: guarantees hold for 200 seeds (fertile sites ≥ 25, wood, hills, ore, clay, fons reachable within `AQUEDUCT_MAX`, via to the edge); `getMap` ≤ 40 ms per seed (node); every `canPlace` row has a test returning that exact code and reason; coverage BFS distances equal hand-computed integer steps on a fixture layout; desirability formula test; plans/stakes/sites per `PlaceOpts`; `validSlots` ≤ 5 ms on a dense colony; `bestSlot` deterministic (lowest tile on ties).
- May assume: scaffold economy stubs (site score uses only map data and current buildings).

**WP-B · Simulation core** — owns `economy.ts`, `census.ts`, `people.ts`, `housing.ts`, `construction.ts`, `civic.ts`, `forecast.ts`, `sim.ts` (after S); tests `sim`, `housing`, `construction`.
- Implement DESIGN §4, §6, §7.1–7.3, §7.6–7.7, §8 (production formula with the ×2.5 cap, seasons, chains, rationing children first, hunger/thirst bands, storage/rot/evaporation, woods, denarii, morale, care, dignitas), §9.5 Capitolium flow, §5.3 construction rules (queue order, stakes, refunds, tools), the forecast with 12 month cells (§11.11), `housekeeping`.
- Acceptance: DESIGN §18.2 opening arithmetic within ±3% (water 23.9/day, grain ≈ 8.8/worker, need 20.35, cistern finished ≈ 13 days after its stake) using hand-made `LabourPlan`s; rationing order; hunger/thirst deaths only past the bands; evolution needs 15 OK days and renovation materials; Declining after 20 days, one-tier drop after 60 more, never offline (stops at 55); queue order (player first); refunds 100/75/25%; Capitolium crew cap 64 and pro-rata materials; Kalends pays accrued taxes; forecast cells match a brute-force 365-tick projection within 10% on the toy map; immigration respects beds and Rome's roll.
- May assume: scaffold `runOrdo` stub; real coverage from A only under `INTEGRATED`.

**WP-C · The Ordo** — owns `ordo/*`; test `ordo`.
- Implement DESIGN §8.12 (emergency ladder), §10.2–10.7 (toggles, division of labour, labour steps with Reasons, build wish list and cadence, concurrency `1 + workforce/40 ≤ 4`, 5-day stakes, `savingFor` without deadlock, requests and pin, trade automation every 10 days), `councilReport`, `reasonText`/`reasonShort`, manual mode, `applyOnce`, govern-while-away.
- Acceptance: labour order (water → food → required services → builders → focus split) with a Reason per line; the Ordo never demolishes, moves, converts or places on future-ring blocks; player sites first; `savingFor` reserves and releases (no 120-day stall in a fixture); each emergency step triggers and lifts at its thresholds; all toggles off → the Ordo does nothing except (offline + governAway) running the manual areas; `wishList` is pure (same input → same output) and explains every item.
- May assume: stubs for economy/placement; tests that need real B/A behaviour run under `INTEGRATED`.

**WP-D · Progression, events, trade, persistence** — owns `decisions.ts`, `objectives.ts`, `reveal.ts`, `events.ts`, `trade.ts`, `save.ts`, `offline.ts`; tests `progression`, `events`, `trade`, `save`.
- Implement DESIGN §9 (ranks, petition checklist, charter and paths with fees and effects, 24 milestones with unlocks, legacy), §10.8–10.10 (focus, edicts with season windows, settings, switches), progressive reveal (§15.3 table), §12 (16 events, 6 festivals, pacing, defaults, gate party, relief card), §13 (prices, market drift, caravans, contracts with pause codes, merchant, bandits), §11 (save/migrate/sanitise/export/import/prefs/Fasti), §14 offline run and report.
- Acceptance: petition readiness per rank; an edict cannot change twice inside one season window (reason names the next Kalends); every path option's effect appears in `fx`; milestones fire in order and each unlock becomes visible through `reveal`; no event before day 300, ≥ 200 days between cards, ≥ 120 between harmful events, none harmful offline; property test over 2,000 forced events: ≤ 30% of a stock, ≤ 5% of pop; asymmetric prices and trip-day formula; contracts pause with the right code; save round trip and sanitiser fixtures (NaN, unknown ids, missing keys); `offlineRun` = N ticks; report fields filled.

**WP-E · Guidance** — owns `advisors/*`, `guide.ts`, `hints.ts`; tests `advisors`, `guide`.
- Implement DESIGN §11.3–11.7: the 24 rules (one file per advisor), engine with hysteresis (raise, clear ×1.25, 3-day downgrade, 3-day minimum life, flap limit, supersede), ordering and appointment, render-time titles/texts/remedies, `checkRemedy`/`applyRemedy`/`remedyLabel`, Hush/Mute, the 20 mentor tips with `after`/`until`, `mentorKicker`, `howToGetMore`, `benefitLine`, `outputChain`.
- Acceptance: each rule has a fixture that raises it at each severity and clears it; no rule flaps > 2 times in 60 days on a sawtooth fixture; every rule returns 1–3 remedies; `checkRemedy` never throws over random states; tips: ids unique, every `after` exists, `welcome` first, `vitals` before day 10 (with the bot under `INTEGRATED`).

**WP-F · Render core** — owns `camera.ts`, `input.ts`, `terrain.ts`, `view.ts`, `buildings.ts`, `linear.ts`, `placement.ts`, `overlays.ts`, `minimap.ts`, `actors.ts`, `particles.ts`.
- Implement §12.1–12.7 completely, including `rise()`, seasons with crossfade, autotiled walls/roads/aqueduct (palisade → murus at Oppidum), status marks, the placement ghost with verdict/bonus/coverage/laurel, road and pave drag, picking, fx mapping, walkers, minimap, title drift, touch pan/pinch/tap-preview.
- Acceptance (manual checklist in the PR with screenshots at 1×/2×/4× zoom): 60 fps at 1,100 × 800 with a 600-building save (`?dev` → `skip`); frame ≤ 6 ms; every `PlacingState` works; overlays match their sources; unknown sprites show the checker (so it works before G lands); `?dev&sheet` draws every registered sprite in a labelled grid (for WP-G's review).

**WP-G · Art** — owns `src/render/art/*`; test `art`.
- Implement every name of §12.3 with the sizes of DESIGN §16.3, the palette of §16.2 (only `PAL` keys), 2 variants per house tier, seasonal variants for fields, olive rows and oaks, forum stages 0–4, Capitolium stages 1–4 and the three crowns, portraits with 3 moods (palette/mouth-row swaps), meander/seal/aquila.
- Acceptance: `art.test.ts` — every `REQUIRED_SPRITES` name registered, `validateArt()` returns `[]`, sizes as declared; visual sheet `?dev&sheet` (rendered by `view.ts` debug hook) reviewed in the PR with a screenshot. Readability rule: every building identifiable at level 1 by silhouette alone.

**WP-H · UI shell** — owns `src/main.ts`, `ui/index.ts`, `hud.ts`, `vitals.ts`, `tray.ts`, `objective.ts`, `counsel.ts`, `ticker.ts`, `toasts.ts`, `banner.ts`, `modals.ts`, `dispatch.ts`, `title.ts`, `audio.ts`, `keys.ts`, and `base.css hud.css left.css map-ui.css modals.css title.css tray.css mobile.css`.
- Implement §13.2–13.9 and DESIGN §15.1–15.2, §15.4 (place banner, overlay bar, zoom), §15.5–15.8, §11.8, §11.10 (resource/date/morale/dignitas tooltips), §11.11 (vital tablets + 12-month strip), §17 (all 17 sfx), the catch-up veil, the three parchment dispatches, autosave and offline flow (§11.4–11.5).
- Acceptance: layouts at 1,280 × 800, 1,000 × 700, 390 × 844; the beat sheet of DESIGN §11.12 plays with the counsel card showing exactly one item by the priority rule; HUD numbers match `rates` and `forecast`; modals pause and trap focus; Esc chain; toasts ≤ 4 and batched; away report renders from `simulateOffline` fixtures; no `innerHTML` with game strings.

**WP-I · UI panels** — owns `ui/panels.ts`, `tabs/*`, `inspector.ts`, `choice.ts`, and `panels.css tabs.css inspector.css`.
- Implement DESIGN §15.3 (six tabs with reveal, NEW stickers, badges, hotkeys via `openTab`), §15.4 inspector (house, building, block, tile), the event card, the contract form with live preview, the Crossroads card, the Agenda, the works queue, labour lines (manual: priorities, ±, *Ordo would*, Apply once), Annales filters and Fasti.
- Acceptance: every tab renders with the stubs and with an integrated 2-hour save; signatures contain no continuous numbers (unit test on `signature()` stability across ticks); every button routes through `actions` / `Game.act` / `Game.applyRemedy`; disabled buttons show their reason; the contract form previews price, trip days and profit before sending.

**WP-J · Tests and balance** — owns `balance.ts` (after S), `tests/autoplayer.ts`, `balance.test.ts`, `contract.test.ts`, `determinism.test.ts`, `perf.test.ts`, `trace.test.ts`.
- Bots (`autoplayer.ts`, actions only): **decision-only** (charter and paths with a fixed option table per seed, petitions when ready, edicts at their situational advice, choice cards at their default, Ordo on), **undecided** (no decisions), **advisor-follower** (decision-only + remedy 0 of the top advisory every 10 days; `place` → `ask`), **builder** (decision-only + every 5 days places every Aedilis/Fabrum build remedy at its best slot as a player site), **neglect** (all Ordo toggles off, no input).
- Tests: every DESIGN §18.5 row (opening always; full bands under `BAL_FULL=1`); `contract.test.ts` (the grep of §10.1, id uniqueness, `balance.ts` numbers equal the DESIGN §18.3 list, every `MulKey`/`AddKey` used by at least one data row or rule); `determinism.test.ts` (§10.9); `perf.test.ts` (tick ≤ 1.5 ms median at pop 600; 1,825-day offline ≤ 6 s; `getMap` ≤ 40 ms); `trace.test.ts` (`npm run trace`: per seed a table every 300 days — day, AUC, rank, pop, beds, houses by tier, grain/water DoH, coin, morale, dignitas, Ordo sites, advisories ≥ Cave).
- Phase 1: bots and tests run against the stubs (all bot assertions under `INTEGRATED`; the grep, id, constants and determinism tests run now).

### 14.3 Integration (integrator, sequential)
1. Merge **A + B**, set `INTEGRATED = true` locally, fix seams until `sim`/`placement` tests pass and a 2,000-day decision-bot run neither crashes nor NaNs.
2. Merge **C, D, E**; run the whole game suite and J's opening balance test; fix contract mismatches (update this document for any signature change).
3. Merge **F, G**; check the art sheet, a 600-building save at 60 fps, every overlay, placement ghost and `rise()`.
4. Merge **H, I**; full play check: DESIGN §11.12 beat sheet at 1× (first 10 minutes), 10× through Oppidum, a 2-minute and a 61-minute absence (60 days / 1,825-day cap report), export → import → continue, reload continuity, mobile 390 × 844 (bottom sheet, tap-preview placement, long-press tooltips).
5. Commit `INTEGRATED = true` as the default; CI green; push `main` → Pages deploy; verify on the Pages sub-path (relative asset URLs, fonts, `castravaleria.*` keys, no console errors).

### 14.4 Balance and polish (J + integrator)
- Tune only `balance.ts` and the numeric columns of `data/*.ts` (ownership exception for this phase) against DESIGN §18.4 with `npm run trace` over seeds [1, 2, 3, 42, 1337], then `npm run balance` until every band passes. Priority: opening (first Hiems survivable without input, Vicus 7–13 min) → Oppidum → Capitolium phase → victory population.
- Polish order: tooltips on every number; ticker/advisory text pass (Latin terms consistent with DESIGN, V-for-U only in inscriptions); sprite readability; sound levels; performance profiling on a mid phone; accessibility (focus order, `aria-selected`, contrast of `--muted` on panels).
- Then, only if all of the above is done, the stretch list of DESIGN §19 in its order. If over budget, cut from DESIGN §19's *cut from the top* list in order.

---

## 15. Test inventory

| File | Owner | Runs | Asserts |
|---|---|---|---|
| `calendar.test.ts` | S | always | §6 dates, leap years, seasons, Kalends |
| `smoke.test.ts` | S | always | `newGame` + 100 ticks without throwing; serialise round trip |
| `data.test.ts` | S | always | registry completeness, DESIGN §18.1 start state |
| `map.test.ts` | A | always | 200-seed guarantees, survey geometry, determinism of `getMap` |
| `placement.test.ts` | A | always | every `canPlace` code in order; plans, stakes, auto-roads, aqueduct |
| `coverage.test.ts` | A | always | BFS steps, effective radius, desirability |
| `sim.test.ts` | B | always | opening arithmetic, rationing, hunger/thirst, storage, morale, taxes |
| `housing.test.ts` | B | always | evolution, renovation, fork, decline, drop, offline stop |
| `construction.test.ts` | B | always | queue, stakes, refunds, tools, Capitolium flow |
| `ordo.test.ts` | C | always (+ `INTEGRATED`) | labour steps, wish list, stakes, saving, emergency ladder, toggles |
| `progression.test.ts` | D | always | petitions, paths, edicts windows, milestones, reveal |
| `events.test.ts` | D | always | pacing, defaults, clamps (2,000 forced events), festivals |
| `trade.test.ts` | D | always | prices, trips, contracts, merchant, bandits |
| `save.test.ts` | D | always | round trip, sanitiser, migrations, export/import, offline = N ticks |
| `advisors.test.ts` | E | always | 22 rule fixtures, hysteresis, flapping, remedies never throw |
| `guide.test.ts` | E | always (+ `INTEGRATED` beat sheet) | tip graph, order, beat sheet with seed 42 |
| `art.test.ts` | G | always | `REQUIRED_SPRITES` registered, `validateArt()` clean |
| `camera.test.ts` | F | always | camera insets at DPR 1, 2, 2.625, 3: screen ↔ world round trips, free-rect centring, the clamp keeps 25% of the free rect, `ensureVisibleDelta` 0 inside and minimal outside |
| `voice.test.ts` | H | always | `awaitingItems` order and filters, the `remedyChip` table (Place for a building remedy, a row's first remedy, none), `voiceAction` per kind of item, `waitingBeyond` (the voice line's '+n') |
| `layout.test.ts` | H | always | `classify` over the 35 measured window sizes and the design's own (touch, mixed, mouse; tiny), the `route` table, the lessons' table covers every `LessonId`, every lesson's pointer shows on every host and detent (the SHEET's through its `REVEAL` proxies), `keepDetent`, the SHEET's `sheetHeights` (half leaves the tab body 200 px, 160 on the SE in Safari), `snapDetent`, `cycleDetent`, `slotTap` and `BAR_SLOTS`, the inspector's `roomShift` and `dodge` |
| `contract.test.ts` | J | always | determinism grep, id uniqueness, constants mirror DESIGN, effect keys used |
| `determinism.test.ts` | J | always (+ `INTEGRATED` long runs) | §10.9 |
| `balance.test.ts` | J | `INTEGRATED`; full bands with `BAL_FULL=1` | DESIGN §18.5 |
| `perf.test.ts` | J | `INTEGRATED` | tick, offline, map generation budgets |
| `trace.test.ts` | J | `npm run trace` only | prints the tuning table |

`tests/util.ts` (S) exports `INTEGRATED`, `fresh(seed = 42): GameState`, `run(s, days, onDay?)`, `ctx(offline = false)`, `setJobs(s, plan)`, `place(s, type, x, y, opts?)`, `noNaN(s): string[]`, `forceEvent(s, id)`.
