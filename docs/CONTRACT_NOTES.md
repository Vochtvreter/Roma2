# Scaffold contract notes

Decisions and deviations recorded while building the scaffold (ARCHITECTURE §14.1). Work packages must read this: where a note here disagrees with ARCHITECTURE.md, the note describes what the scaffold actually implements.

## Contract notes
These merge the four agents' reports with my own.

**Integrator**
1. `types.ts` has no JSDoc lines. "§4 verbatim" and the frozen-file rule take precedence over "JSDoc on every export"; the doc comments in §4 serve instead.
2. The toy map's `startAger (40,60)` sits on ring-2 survey blocks (0,6) and (1,6). I kept it, because ARCHITECTURE §8.2 sets it explicitly and DESIGN §3 allows rural buildings on future-ring blocks, where they block the plots. `derived.plotOwner` already marks those plots as taken. WP-A's real generator should pick a site off the future rings, since the Ordo itself never builds there.
3. `ZOOM_LEVELS` is [1..5] with default 3 (2 below 700 px), following DESIGN §3.1. ARCHITECTURE §12.1 says [1..4] with default 2. DESIGN wins on numbers; §12.1 should be updated.
4. The §6 calendar test dates are one day late (see core note 1). §6 should read 91 → `a.d. IV Non. Apr.`, 100 → `a.d. III Id. Apr.`, 101 → `pridie Id. Apr.`

**Core**
1. Corrected calendar tests: 91 → `a.d. IV Non. Apr.`, 100 → `a.d. III Id. Apr.`, 101 → `pridie Id. Apr.`, 102 → `Id. Apr.`
2. Calendar signatures §6 leaves open:
   - `dateOf` returns `{year, month 1..12, day}`; `dayOf(y, m, d)` is its inverse.
   - `seasonDay` counts from 1.
   - `nextSeasonStart` is strictly after `day`.
   - `elapsed(s: {day})`.
   - The three `formatRoman*` functions take `{year?}`.
3. Districts: "Latera = blocks touching the forum" takes priority, so start block (4,1) is `latera`.
4. The toy `startAger` overlaps the survey (see integrator note 2).
5. Toy-map grass moisture is 0.62, so the start well draws the full rate (23.9/day).
6. Survey choices: ring streets leave out river, crag and sacred-way tiles; `blockStreets` returns street tiles only; all 96 blocks exist with stable ids, and off-map blocks are masked; the via starts just outside the Porta Praetoria.
7. `newGame` lays no road to the start ager.
8. Epoch values are unique across all states (one global counter).
9. Rations are not in `fx`; economy and civic apply `B.economy.PORTIONS` and `B.morale.RATION_TERMS`.
10. `B.map.TERRITORY`/`RINGS` and `B.people.IMM_RATE`/`CEILING` mirror `RANK_DEFS`, which stays authoritative. I verified they are equal.

**Data**
1. Data files do not import `B`.
2. Settings with unit `%` are stored as fractions 0..1.
3. Some effects stay off the effect bus: Rationes portions and morale, Feriae Nullae's blight, Aquae Operibus's concrete ×1.05.
4. Effect-key readings: `renovation` is a speed factor; `toolDays` 1.5 gives 180-day kits; `shrineRadius` covers shrines and temples; `fodina` uses `fxKey 'quarry'`.
5. `TIER_DEFS.needs` is cumulative and never includes `'materials'`, which `firstWant` adds.
6. Templum and capitolium serve both the temple and shrine layers; macellum serves macellum and market.
7. Fixed buildings: capitolium has 0 slots, its crew cap is `B.construction.CAP_CREW`; castellum `maxCount` 1 with `rule 'none'`, so `place.ts` must special-case its `noFons` check.
8. `denarii.baseCap` is `Infinity`; it is never saved.
9. `BUILD_ORDER` has the 27 placeable types; unlock lists hold only what each rank newly opens; `PATH_DEFS.charter.grants` is 0, so the charter must not trigger a rank-up.
10. Focus plan steps mean "at least n in total".
11. Hubs: wine and oil limited as in DESIGN; quirks that name no side apply to both buying and selling.
12. `AdvisorDef.portrait` holds the DESIGN portrait cues; `order` 0..5 is the tie order.
13. `COLONY_NAMES` is extended past DESIGN's "…".

**Game stubs**
1. Rule files export `ANNONAE_RULES` … `AUGUR_RULES`, spread into `RULE_DEFS` (beware load-order cycles).
2. In `snapSlot`/`canPlace` the rural tile is the footprint's top-left; for urban types any tile in a slot snaps to it.
3. Check 9 on rock for non-quarries returns `terrain` with "Too rocky to build."; the table's "Rome grants this to a {Rank}" produces "a Oppidum".
4. Forecast: `runout` is an absolute day; `coin.net30` is the 30-day average per day; `doh` is 9999 when need is 0.
5. `catSlots.builders` equals the current number of builders.
6. `pomerium` includes the reserved blocks and the forum rect; `reservedTile` includes the Area Capitolina and the routes of unfinished castella.
7. `taxesDay` records accrued taxes in `rates`.
8. `startCapitolium` creates a player-owned building site with work = `CAP_WORK × fx(capWork)`.
9. `hubOpen` needs rank ≥ Vicus or the Mercatores charter; `slotsInUse` counts contract caravans only; `takeOffer` returns `notReady` because `MerchantOffer.kind`/`price` are unclear.
10. `edictWindow.next` is `nextSeasonStart(day)` while the window is open.
11. `advisorMood`: Periculum → 2, Monitum/Cave → 1, otherwise 0. `mute` is allowed when there is no active memo or the memo is a Nota.

**Client**
1. Zoom is [1..5], default 3/2 (see integrator note 3).
2. `registerArt` outlines `b_`, `h_`, `a_` and `p_` sprites by default; `outline()` keeps the size.
3. Palette keys S, A and U have neutral defaults.
4. `validateArt` takes its fixed sizes from §12.3.
5. Required sprites: `a_elder_*` and `a_patrician_*` are idle/walk0/walk1; base names plus `@0..3` are required for `b_ager`, `b_olivetum` and `n_oak_*`.
6. `buildingSprite` mapping for principia, capitolium stages and unfinished `area`; `faceIcon` index 0 is the gloomiest.
7. `MapView`: coordinates in CSS px; `panBy` moves the content like a drag; two-click demolish is armed inside the view; a touch tap only previews.
8. Extra public members: `UI.changed`, `UI.side`, `UI.inspector`, `UI.choice`; `SidePanel.poke`; `modals.modalCount`, `closeTopModal`, `closeAllModals`; `commercium.prefill`; camera helpers; `sprites.makeCanvas`; `audio.setAudio`; `keys.initKeys`.
9. `plural(3, 'house', 'houses')` returns `'3 houses'`; `fmt` uses a true minus and switches to M at 1e6.
10. Legacy is handled in `App.newGame`; the Fasti entry is written on the victory fx.
11. Autosave after a path choice is detected from the count of `s.decisions.paths`, plus a save on a rank fx.

## Files I changed
- `/home/user/Roma2/src/main.ts` (445 lines; one 2-line guard added). No other repository file was changed.

The temporary test files were deleted. My check scripts are in `/tmp/claude-0/-home-user-Roma2/d4a48ea6-432e-5c2b-93de-0293bc719454/scratchpad/`: `smoke.mjs`, `smoke2.mjs`, `road.mjs`, `serve.mjs` and `contract/check.ts`.


## Per-part reports


### core

CONTRACT NOTES**
1. **§6 calendar test dates are one day late.** Day 92 → `a.d. IV Non. Apr.`, day 101 → `a.d. III Id. Apr.` and day 102 → `pridie Id. Apr.` contradict day 90 = Kal. Apr. and DESIGN's "a.d. IV Non. Apr. = 2 April". The tests assert the correct days instead: 91 → `a.d. IV Non. Apr.`, 100 → `a.d. III Id. Apr.`, 101 → `pridie Id. Apr.`, 102 → `Id. Apr.`.
2. **Calendar signatures §6 leaves open:**
   - `dateOf(day)` returns `{year, month 1..12, day}`; `dayOf(year, month, day)` is its inverse.
   - `seasonDay` counts from 1 ("Ver, day 33").
   - `nextSeasonStart` is strictly after `day`.
   - `elapsed(s: {day})`.
   - `formatRoman`, `formatRomanFull` and `formatRomanLong` all take `{year?}`.
3. **Districts:** "Latera = blocks touching the forum" takes priority. So the start-house block (4,1), which DESIGN §18.1 calls a "Retentura block", is `latera`. The start plots are still placed exactly as §18.1 describes.
4. **The toy `startAger (40,60)` overlaps survey land.** It sits on ring-2 blocks (0,6) and (1,6) and the ring street at x = 41. I kept it as documented; whoever owns map.ts should move it, e.g. to (84,4).
5. **Toy-map grass moisture is 0.62.** That puts the castrum on the water table, so the start well draws the full §18.2 rate (23.9/day) instead of 0.6×.
6. **Survey choices:**
   - Ring street tiles leave out river, crag and sacred-way tiles.
   - `blockStreets` returns only street tiles.
   - All 96 blocks exist with stable ids; blocks that run off the map are masked.
   - The via starts at the tile just outside the Porta Praetoria.
7. **`newGame` has no road to the start ager.** Roads at start are interior streets, the 4 gates and the via only, as listed in §8.1.
8. **Epoch values are unique across all game states** (one global counter), so a module-level cache keyed on an epoch can't mix up a state with its `structuredClone`.
9. **Rations are not in `fx`.** The data agent gave `rationes` options no grain or morale effects (only Parcae's births ×0.8), so economy/civic must apply `B.economy.PORTIONS` and `B.morale.RATION_TERMS` themselves. This is consistent with `B`.
10. **Mirrored constants:** `B.map.TERRITORY`/`RINGS` and `B.people.IMM_RATE`/`CEILING` copy `RANK_DEFS`, because §18.3 lists them as key constants. `RANK_DEFS` stays authoritative, and `activeRings` reads it.

### data

CONTRACT NOTES
1. Data files do not import `B` (§5: data imports only `types.ts`). Values without a per-row field are already in `balance.ts`: principia stage dignitas and desirability, market tax, mansio bonuses, Capitolium morale. `BUILDING_DEFS.principia` carries the stage-0 values (dignitas 5, desir [4,5]); `capitolium.work` is 160000, inline.
2. Settings with unit `%` (`builderShare`, `renovation`) are stored as fractions 0..1 (0.15, 0.6), to match the core agent's `B.ordo.FOCUS.MATERIA_BUILDERS: 0.05` and `B.housing.RENOVATION_SHARE: 0.6`. The UI shows them ×100.
3. Some edict effects stay off the effect bus to avoid double counting:
   - Rationes portion and morale come from `B.economy.PORTIONS` and `B.morale.RATION_TERMS`, keyed by the option ids largae/plenae/parcae. Those options' `fx` only carries Parcae births ×0.8.
   - Feriae Nullae "blight ×2" just means the Robigalia is not kept, so there is no `blight` effect.
   - Aquae Operibus "concrete ×1.05" has no MulKey; economy has to apply it from the option id.
4. Effect key readings:
   - `renovation` is a speed factor (Opera Magna = 2, so 8 days becomes 4).
   - `toolDays` 1.5 gives 180-day kits for Ars fabrilis.
   - `shrineRadius` covers both the shrine and temple radius (Pietas).
   - `fodina` uses `fxKey: 'quarry'`.
5. `TIER_DEFS.needs` is cumulative in NEEDS order and includes `'rank'` for tiers with rank > 0. It never includes `'materials'`: `firstWant` should return that when the needs hold but the renovation pool falls short. Tentoria's "renovation" is the plot cost `{timber: 4}`.
6. Coverage: templum and capitolium serve both temple and shrine layers, and macellum serves both macellum and market.
7. Fixed buildings: `capitolium` has slots 0 and labor null; its crew cap of 64 is `B.construction.CAP_CREW`. `castellum` has `maxCount: 1` (matching `B.map.CASTELLUMS_PER_FONS`; a second spring is a stretch item). `principia` and `capitolium` have `maxCount: 1`. `castellum.rule` is `'none'` because SiteRule has no fons value, so `place.ts` must special-case its noFons check.
8. `RESOURCE_DEFS.denarii.baseCap` is `Infinity` ("no cap"). It only reaches derived caps, never the saved state.
9. `BUILD_ORDER` holds the 27 placeable types (not principia or capitolium), ordered by rank. `RANK_DEFS[].unlocks` and `hubs` list only what that rank newly opens; principia is in no unlock list, capitolium is under Colonia. `PATH_DEFS.charter.grants` is 0, so choosing the charter must not trigger a rank-up.
10. `FOCUS_DEFS.plan` steps `[type, n]` mean "at least n of that type in total", reading "ager ×2 … ager ×3" as targets. The focus extras (spare beds +4 and so on) are in `B.ordo.FOCUS`.
11. Hubs:
    - Wine is sold only by Silvanum, Narbo and Massilia (§4).
    - Oil is limited the same way, my reading of Silvanum's "sells oil" quirk: Metellianus, Durii and Augusta refuse to sell both.
    - Quirks with no side named (Narbo and Massilia "oil & wine ×0.9 / ×0.8") apply to both buying and selling.
12. `AdvisorDef.portrait` holds the DESIGN portrait cues, since sprite names come from `portrait()` in `art/index.ts`. `order` is 0..5 in the tie order annonae, aquarum, aedilis, fabrum, quaestor, augur.
13. `COLONY_NAMES` starts with 'Castra Valeria' and adds a few names after DESIGN's list, which ends in "…".

### gamestubs

CONTRACT NOTES**
1. **Rule file exports:** each advisor file exports its array as `ANNONAE_RULES`, `AQUARUM_RULES`, `FABRUM_RULES`, `QUAESTOR_RULES`, `AEDILIS_RULES` or `AUGUR_RULES`. `RULE_DEFS` spreads them when engine.ts loads. A rule file that is imported before engine.ts and itself imports something that leads back to engine.ts would hit a load-order error. The header of each rule file warns about this.
2. **Tile meaning in `snapSlot`/`canPlace`:** for rural buildings the tile is the footprint's top-left corner, which matches the `validSlots`/`bestSlot` keys. For urban buildings, any tile inside a slot snaps to the plot, half or block origin. If the ghost should be centred under the cursor, the view has to offset it.
3. **Rock for non-quarries (check 9):** code `terrain` with the reason "Too rocky to build." The table only gives the iron-vein text. The table's literal "Rome grants this to a {Rank}." produces "a Oppidum".
4. **Forecast:** `runout` (for each essential and for coin) is an absolute day, not days remaining. `coin.net30` is the 30-day average net per day (`counters.coinEma`), not a 30-day sum. When need is 0, `doh` is 9999 so it stays a finite number. The offline snapshot uses Infinity in that case, since it is never saved.
5. **Builders:** `Census.catSlots.builders` equals the current number of builders, because the contract has no builder-capacity concept.
6. **Derived layers:** `pomerium` includes the reserved forum and capitolium blocks and the forum rect. `reservedTile` always includes the Area Capitolina, plus the aqueduct routes of unfinished castella.
7. **Taxes in the ledger:** `taxesDay` records accrued taxes in `rates.prod.denarii.taxes` even though the coin only arrives on the Kalends.
8. **Capitolium site:** `startCapitolium` creates it with owner `player`, status `building`, work = `CAP_WORK × fx(capWork)` and `matUsed: {}`.
9. **Trade access:** `hubOpen` requires rank ≥ Vicus or the Mercatores charter, as well as the hub's own rank. `slotsInUse` counts only caravans of kind `contract`. The meaning of `MerchantOffer.kind` and `price` is unclear (per unit? whose side?), so `takeOffer` returns `notReady`.
10. **Edict window:** when the window is open, `edictWindow.next` is `nextSeasonStart(day)`.
11. **Advisor moods and muting:** `advisorMood` maps Periculum to 2, Monitum/Cave to 1, and anything else to 0. `mute` is allowed when there is no memo or the memo is a Nota, and the muted list is kept in RULES order. `pruneGuide` marks unseen tips whose `until` already holds as seen.
12. **Ordo session:** `ordoActive` = `on[area] || (offline && governAway)`. `runOrdo` always calls `emergencyDay`; WP-C checks the emergency switch inside it.
13. **Rank-up and paths:** `rankUp` has no ctx, so it raises its fx through `pushActionFx`. `choosePath` also calls `ceremonyPaving('via')` for `viaMilitaris` and calls `invalidate`.
14. **Save defaults:** when filling missing keys, a field whose saved type doesn't match takes the default, a null where the default is a number becomes 0, and fields whose default is null keep the saved value. state.ts and save.ts import each other (SAVE_VERSION and newGame). This only works because neither uses the other's import when the module first loads.
15. **Works order:** `derived().sites` repeats the `worksQueue` ordering (player first, then `order`, then id) so derived.ts does not need to import construction.ts.

### client

CONTRACT NOTES**
1. **Zoom:** DESIGN §3.1 wins on numbers, so ZOOM_LEVELS is [1,2,3,4,5] and the default is 3 on desktop, 2 below 700 px. ARCHITECTURE §12.1 says [1..4] with default 2.
2. **Outlines:**
   - `registerArt` outlines by default for `b_`, `h_`, `a_` and `p_` names.
   - `outline()` keeps the sprite size: it only paints `k` into transparent pixels next to non-outline pixels, so art that already has a hand-drawn `k` ring is unchanged.
3. **Palette:** the placeholder keys S, A and U have neutral defaults (#c9b48a, #5d3b2a, #6f5639) instead of Hearthlands' magenta/cyan/yellow.
4. **`validateArt` size checks:** I took the fixed sizes from the §12.3 table: `i_` 12×12, `pt_` 24×24, `f_*`, `ov_*`, `l_*`, `n_milestone`, `p_forum` 144×152, `p_capitolium` 144×96, `p_crown` 32×24. It also checks that `h_*` sprites are 32 wide, seasonal variants match their base, and numbered variants or animation frames of one family share a size.
5. **REQUIRED_SPRITES choices:**
   - The "…" in `a_elder_<…>` and `a_patrician_<…>` is read as idle/walk0/walk1.
   - Base names plus `@0..3` are required for `b_ager`, `b_olivetum` and `n_oak_0..2`.
6. **`buildingSprite`:**
   - principia → `p_forum_<RANK_DEFS[rank].forumStage>`.
   - capitolium → `p_capitolium_4` when done, otherwise the stage being raised (clamped 1–4).
   - An unfinished `area` uses the tentoria sprite.
   - `faceIcon` index 0 is the gloomiest.
7. **MapView behaviour:**
   - The `zoomBy` anchor is in CSS px, like every other MapView coordinate.
   - `panBy` moves the map content like a drag, so keys pass negative values for D/→.
   - `screenOf` returns the tile centre in CSS px, or null when off-screen.
   - Two-click demolish is armed inside the view; only the confirming click reaches `cb.onClick`.
   - A touch tap while placing a building only previews; the place banner's Place button confirms via `placeAt`.
8. **Extra public members** (the frozen signatures are unchanged):
   - `UI.changed()` and the `UI.side`, `UI.inspector`, `UI.choice` fields, which App uses for `openTab` and `inspect`.
   - `SidePanel.poke()`.
   - `modals.modalCount`, `closeTopModal`, `closeAllModals`. Esc is handled only in keys.ts.
   - `tabs/commercium.prefill(spec)`.
   - Camera helpers `scaleFor`, `defaultLevel`, `nearestLevel`, `TILE`, `WORLD_W`, `WORLD_H`.
   - `sprites.makeCanvas`, `audio.setAudio`, and `keys.initKeys(g, dev)`.
9. **Number helpers:** `plural(3, 'house', 'houses')` returns `'3 houses'` (number included). `fmt` uses a true minus for negatives and switches to M from 1e6.
10. **Legacy:** after a victory, a new colony gets legacy + 1, and legacyBonus + 0.05 if `imperium` was chosen. Abandoning keeps the previous save's legacy and legacyBonus. The Fasti entry is written on the victory fx with `founded = stats.startedAt` and `dedicated = stats.victoryDay ?? day`.
11. **Autosave after a path choice:** App detects it when the number of `s.decisions.paths` entries changes, because panels call the action directly. It also saves on a rank fx.

### bootstrap

CONTRACT NOTES:
1. **index.css import order:** neither §3 nor §13.9 spells out the order. I followed §3's list but moved `mobile.css` to the end so its breakpoint rules override the panel styles from I.
2. **Extra tokens in tokens.css:** besides what §16.1 and §13.9 list, I added a few that the §16.1 prose and §15.1 layout describe. These are `--ring` / `--ring-shadow` (#0a0710 outer ring), `--well` / `--well-line`, `--border-w`, `--blur`, `--fs-base` (15px), `--hud-h` (64px) and `--side-w` (380px).
3. **Radii and z-index token names:** §13.9 says "radii" without names, so I used `--r1` 3px, `--r2` 6px (the panel radius), `--r3` 10px and `--r-pill`. The z-index tokens are one per §15.1 element: `--z-map` 0, `--z-left`, `--z-inspector`, `--z-ticker`, `--z-overlay-bar`, `--z-minimap`, `--z-zoom` all 14, `--z-side` 15, `--z-side-toggle` 16, `--z-place-banner` 18, `--z-hud` 20, `--z-counsel` 21, `--z-toasts` 24, `--z-choice` 25, `--z-banner` 30, `--z-title` 60, `--z-modal` 70, `--z-tooltip` 100, `--z-veil` 200.
4. **Font fallbacks:** `--font-body` and `--font-caps` add fallback fonts after 'Pixelify Sans' and 'Silkscreen'.
5. **No JSDoc in types.ts:** the file has no JSDoc one-liners on its exports. "§4 verbatim" was taken to win over the general JSDoc rule; the doc's own trailing `//` comments stay as documentation.
6. **Contradictory Pages note in the spec:** §2.4 says "Deploy from a branch" makes `/src/main.ts` 404. That is how the README states it, but strictly the browser fails on the module because Pages serves the raw `.ts` file, not because it is missing.