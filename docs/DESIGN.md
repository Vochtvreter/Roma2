# CASTRA VALERIA — Game Design Document (final)

*AB CASTRIS AD COLONIAM — from camp to colonia.*
A pixel-art Roman city builder that keeps running when you look away. You lay out the city; the *Ordo Decurionum* runs it day by day; Rome rises.

This document is the **single source of truth for content and numbers**. `docs/ARCHITECTURE.md` is the implementation contract (types, files, signatures, work packages). Where the two ever disagree on a *number*, this file wins; where they disagree on a *name, type or signature*, ARCHITECTURE.md wins.

---

## 0. Conventions

- **Day** = one game day = one simulation tick = one real second at 1×.
- `state.day` is the absolute game day: day 0 = *Kalendae Ianuariae AUC DCCC* (1 Jan AD 47). The game starts on **day 90 = Kal. Apr. AUC DCCC**. **Elapsed** = `day − 90`. All "day N" pacing figures in this file are *elapsed* days unless written as a Roman date.
- Tables give the code id in `code` font, then *Latin label* / English sub-label as shown in the UI.
- **(tune)** marks an initial value the balance agent may move in `src/game/balance.ts` without a design change. Everything else is a design decision; change it only by editing this file.
- **Severity names**: code 0 *Nota* (info), 1 *Monitum* (advice), 2 *Cave* (warning), 3 *Periculum* (critical).
- Tiles are 16 px. The map is 112 × 84 tiles. Distances are in tiles; "steps" are road steps (N4 moves along built road tiles).

---

## 1. Pitch, pillars and loops

### 1.1 Pitch
It is the Kalends of April, AUC 800. Twenty-four souls of six legionary families — the Valerii, Antonii, Flavii, Cassii, Aemilii and Iulii — pitch their tents inside a fresh earth-and-timber rampart on a river bend at the frontier. You are the *Praefectus castrorum*. The groma has staked the camp: the **cardo** and **decumanus** cross at the **principia**, four gates open onto the land, and the *Via Valeria* runs off the map toward six neighbouring markets.

You lay out blocks, wells, granaries, shrines and fields yourself — or leave it to the **Ordo Decurionum**, the council that staffs, builds and trades every day, even while you are away, and always says *why*. Six advisors with pixel portraits count the days of grain and water, name what is wrong, and offer one-click remedies. Tents become thatched *casae*, tiled cottages, stone houses, and finally three-storey *insulae* or atrium *domus*; the palisade becomes a stone *murus*; aqueduct arches stride in from a hill spring; the forum grows from tents and standards to marble. Five ranks lie ahead — **Castra → Vicus → Oppidum → Municipium → Colonia** — each sealed by a permanent three-way choice, and the run ends when the **Capitolium** is dedicated, about four hours of 1× play (or a few days of short check-ins).

### 1.2 Pillars
1. **You decide, the Ordo runs.** Automation guarantees survival; decisions (charter, paths, focus, edicts, settings) drive progress; building by hand makes you *better and faster* than the Ordo.
2. **Every number is a runway.** Grain and water are always shown as *days on hand*, with a 12-month forecast. Every warning names cause, deadline and remedy.
3. **The city visibly grows up.** Housing evolves on a surveyed Roman grid; roofs, storeys, walls, streets, forum, aqueduct and Capitolium all change on screen.
4. **Nothing waits for you; absence is never punished.** Events resolve to the cautious option, rank-ups are non-blocking, offline time replays the real tick at half speed, houses never lose a tier while you are away, and there is no game over.
5. **One deterministic tick.** Seeded RNG in the save; offline progress is exactly N ticks.

### 1.3 Core loops

| Scale | What the player does | What the game does |
|---|---|---|
| **Minute to minute** (1×–10×) | Watches the two vital tablets (Grain, Water) and their forecast strip. Clicks an advisor remedy. Places a house plot, a shrine where the ghost reads *"+5 houses could evolve"*, a field on the river loam. Opens an overlay to see why a house is stuck. | One day per second. The Ordo staffs jobs daily, raises a wish every 2 days and states its reason on the ticker. Scaffolds rise, houses evolve with a *tink*, carts bring families along the via, smoke and steam rise. |
| **Season to season** (91 days ≈ 1.5 min) | Prepares for the two crunches: **Hiems (grain)** and **Aestas (water)**. Changes an edict when its window opens on the season's Kalends. Answers an event card (≈ one per 3–4 min). | Seasonal multipliers swing production; taxes arrive on every Kalends with a coin shower over the forum; caravans come and go. |
| **Session to session** | Reads the *Litterae Ordinis* away report. Petitions Rome when the Crossroads card glows and picks a permanent path. | Offline replay at 0.5×, capped at 1,825 days (one *lustrum*). The Ordo governs everything (Govern while away), saves for the next petition, and writes what it decided in your name. |
| **Run to run** | Dedicates the Capitolium; founds a new colony with Legacy +10% output / +2 morale per finished colony. | The *Fasti coloniarum* on the title screen records each colony. |

### 1.4 The idle contract (enforced by tests, §18.5)
- **Survival**: with the Ordo fully on and *zero* decisions, the colony survives indefinitely and never loses more than 5% of its people per year to hunger or thirst.
- **Progress needs decisions**: rank never advances without a petition (a path choice). A no-decision run stays *Castra* and its population stays at or below Rome's roll (§6.6) plus births.
- **Decisions alone suffice**: a bot that only decides (never places, never assigns) reaches every rank inside the pacing bands (§18.4).
- **Building pays**: a bot that also places what the Aedilis and Fabrum suggest reaches Oppidum at least 10% sooner.

---

## 2. Time and calendar

### 2.1 Clock
- **1 tick = 1 day = 1 real second at 1×.** Speeds ❚❚ / 1× / 2× / 5× / 10× (keys Space, 1–4). `?dev` adds 20× (key 5) and `skip(days)`.
- Fixed-step `requestAnimationFrame` accumulator: `dt` clamped to 0.1 s, at most 8 ticks per frame, the backlog is dropped when the cap is hit.
- The game **starts paused** under the parchment *Founding Dispatch*; its button **"Raise the standard"** starts 1×. After that nothing waits: event cards, tips, banners and the advisor card never pause. Open **modals** pause (menu, export/import, how-to-play, away report, victory).
- UI pref **"Slow for news"** (default on): when a choice card appears while speed > 2×, speed drops to 2×. UI-only, never touches the sim.
- Every countdown shows days; its tooltip adds the real-time equivalent at the current speed (*"23 days ≈ 12 s at 2×"*).

### 2.2 Calendar — real Julian, one clock for everything
- The proleptic Julian calendar, ported verbatim from rome's `calendar.ts` (algorithm reproduced in ARCHITECTURE.md §6): real month lengths 31/28/31/30/31/30/31/31/30/31/30/31; leap year when `AD = AUC − 753 > 0 and AD % 4 == 0` (AUC 801 = AD 48 is a leap year).
- Dates use Roman counting: `Kal. Apr.`, `a.d. IV Non. Apr.`, `Non. Apr.`, `pridie Id. Apr.`, `Id. Apr.`, `a.d. XVII Kal. Mai.`; year as `AUC DCCC`. Nones/Ides on the 7th/15th in Mar, May, Jul, Oct; otherwise 5th/13th. Tooltip: *"ante diem quartum Nonas Apriles · 2 April AD 47 · Ver, day 33 of 92 · Hiems in 244 days · next edict window Kal. Iun."*
- **Seasons by month**: `ver` (Mar–May), `aestas` (Jun–Aug), `autumnus` (Sep–Nov), `hiems` (Dec–Feb). A season is 89–92 days ≈ 1.5 min at 1×; a year is 365/366 days ≈ 6 min.
- Key early dates (elapsed): Kal. Iun. (Aestas) = 61; Kal. Sep. (Autumnus) = 153; Kal. Dec. (Hiems) = 244; Kal. Mart. AUC DCCCI (first Hiems over) = 335.
- **Aging uses the same 365-day clock.** A ≈4-hour run spans ~39 years: founders grow old, children born in year 1 work from year 17. Growth comes mainly from immigration and veterans; births matter in the second half.
- **Edict windows**: a changed edict stays fixed until the next season's Kalends (Kal. Mart. / Iun. / Sept. / Dec.). Locked edicts read *"Settled. Next window: Kal. Sept. (in 47 days)."*
- **Taxes** accrue daily and are paid into the aerarium on every **Kalends** (coin sound, gold particles over the forum, one ledger line in the Annales).

### 2.3 Pacing targets (1×, decision-only bot, medians; bands in §18.4)

| Milestone | Elapsed day | AUC (≈) | Real time 1× | Pop |
|---|---|---|---|---|
| Founding | 0 | DCCC | 0:00 | 24 |
| First Hiems weathered | 335 | DCCCI | 5:35 | 42 |
| **Vicus** | 600 | DCCCII | 10 min | 55 |
| **Oppidum** | 2,700 | DCCCVII | 45 min | 190 |
| **Municipium** | 6,300 | DCCCXVII | 1 h 45 | 410 |
| **Colonia** (Capitolium begun) | 11,900 | DCCCXXXII | 3 h 18 | 720 |
| **Capitolium dedicated** (victory) | 14,300 | DCCCXXXIX | 3 h 58 | 1,050 |

Anything that asks the player to react lasts **≥ 25 days** (event cards 30, veterans 30, merchants 30, Declining grace 20 + 60).

---

## 3. Map and world

### 3.1 Size
**112 × 84 tiles** (1792 × 1344 world px). Integer zoom levels `[1, 2, 3, 4, 5] × devicePixelRatio`; default 3 on desktop, 2 below 700 px. At zoom 1 the whole map fits a 1080p screen, so there is no overview mode.

### 3.2 Terrain and features

| Terrain id | Name | Buildable | Notes |
|---|---|---|---|
| `grass` | Pratum / grass | yes | fertility 1.0 |
| `meadow` | moist lowland | yes | fertility 1.1 |
| `loam` | riverland | yes (rural only) | fertility 1.25; tiles within 2 of the river |
| `scrub` | dry slope | yes | fertility 0.75; olives +15% |
| `forest` | Silva | yes, felled on placement | wood stock 60 |
| `dense` | old forest | yes, felled | wood stock 100 |
| `hills` | Colles | yes | quarry ground, olives |
| `rock` | Saxa / outcrop | quarry/mine only | quarry ground |
| `crag` | cliff | no | impassable |
| `river` | Flumen | no | crossed only by the via's pre-built bridge; aqueduct arches may span it |

Features: `clay` (30% of river-adjacent land tiles; the figlina must touch one), `ore` (2 veins of 2–4 tiles on hills/rock, quality 0.7–1.4 per vein), `fons` (1–2 springs on hills — the aqueduct source), `lucus` (sacred grove, unbuildable, desirability +3 r3), `ruins` (Celtic ruins, unbuildable flavour).
**Water table**: tiles within 12 of the river or with moisture > 0.6; a well off the water table yields ×0.6.

### 3.3 Generation (seed-pure, never saved; only the seed and diffs are saved)
1. Elevation `= fbm(x/22, y/22, 4 octaves)·0.75 + tilt·0.35` (tilt raises one side, chosen by seed). Moisture `= fbm(x/14 + 100, y/14)`.
2. Relief by quantile over the map: hills > 74th percentile, rock > 88th, crag > 96th.
3. Woods: moisture > 0.56 → forest, > 0.68 → dense (not on river/loam). Scrub: moisture < 0.36 on non-hill land.
4. **River**: one river from the high-side edge to the opposite edge, a downhill N4 walk biased toward the target edge (`cost = elevation + 0.15·distToTargetEdge + jitter·0.03`); if the walk stalls it carves straight to the edge. Width 2, 3 in the lower half. Land within 2 tiles becomes `loam`.
5. **Castrum site**: search origins for the 39 × 29 rectangle (castrum + wall + fossa, §3.4). Requirements: no river, crag, rock or hills inside; river 3–10 tiles from the rectangle on one side; the whole Oppidum pomerium bounding box (61 × 51) plus a 4-tile margin inside the map. Score = loam within 20 + forest within 24 + hills within 28. Best score wins, ties by lowest tile index.
6. **Via Valeria**: a straight road along the decumanus line from the **Porta Praetoria** (the decumanus gate facing away from the river, or toward the nearer map edge if the river is parallel) to the map edge. River tiles on it become a pre-built timber bridge. A milestone sprite at the edge reads *"VICVS METELLIANVS M·P·IIII"*.
7. Features: 1–2 `fons` on hills 22–44 tiles from the castrum; 2 ore veins 14–34 tiles out; 1 `lucus` 10–20 out; 1 `ruins` 15–30 out.
8. **Guarantees** (map test over seeds 1–20 and every seed used by other tests): ≥ 25 valid 3 × 3 farm sites inside Castra territory and outside all surveyed blocks and streets; a valid quarry site and a lumber site (≥ 60 wood within r4) inside Castra territory; a clay tile inside Vicus territory; ore inside Oppidum territory; a `fons` inside Municipium territory; the via reaches the edge; all of these on the castrum side of the river or reachable through the via bridge.
9. If the best castrum site fails a guarantee, try the next-best site; if none works, regenerate terrain with `seed + 1000·k` (k ≤ 8; the retry loop is part of the pure function of the seed).

### 3.4 The castrum plan (pre-surveyed by the groma)

**One global survey grid, pitch 5**: a street line every 5 tiles; between lines a 4 × 4 **block** (*insula* in the planning sense) of four 2 × 2 **plots** (*areae*); every plot touches two street sides.

```
castrum interior 31 × 21 (castrum coords x 0..30, y 0..20); wall ring at −1/31 and −1/21;
fossa (ditch) 3 tiles beyond the wall; rectangle with wall + fossa = 39 × 29.
 x: 0    5    10   15   20   25   30
    S====S====S====C====S====S====S      S = survey street (built at start inside the castrum)
    S ## S ## A  A  A  A  A ## S ## S      ## = block (four 2×2 plots)
    S====S====S====C====S====S====S      C = cardo (x = 15), D = decumanus (y = 10)
    S ## S ## F  F  F  F  F ## S ## S      F = principia / forum 9×9 (x 11..19, y 6..14)
    D====D====F  F  F  F  F====D====D      A = Area Capitolina, reserved 9×4 (x 11..19, y 1..4)
    S ## S ## F  F  F  F  F ## S ## S
    S====S====S====C====S====S====S
    S ## S ## S ## C ## S ## S ## S
    S====S====S====S====S====S====S      outer lines x=0/30, y=0/20 = via sagularis
Gates: Porta Praetoria and Porta Decumana at the decumanus ends; Portae Principales at the cardo ends.
```

- **Interior**: 24 blocks − 4 forum blocks − 2 reserved Capitoline blocks = **18 blocks = 72 plots**.
- **Area Capitolina**: blocks (2, 0) and (3, 0) plus the cardo segment between them (x 15, y 1..4) are reserved at map generation for the Capitolium (9 × 4). That cardo segment is never built; an altar sprite marks the site from day 1. Nothing else may be placed there.
- **Wall and fossa**: palisade (*vallum*) ring at offset −1, fossa at offsets −2..−4. At Oppidum the palisade and gates swap to stone (*murus*) as a cosmetic rank-up change.
- **Districts** (soft, steer the Ordo): *Praetentura* (half toward the Porta Praetoria: commerce, horrea, mansio), *Latera praetorii* (blocks touching the forum: temples and civic), *Retentura* (rear half: housing).
- **Streets inside the castrum are built at start** (dirt). Ring streets outside the walls are *staked* (dotted chalk with pegs) and are built automatically, free and instantly, when a block in that ring receives its first building (the block's four sides plus the shortest connection along survey lines to the existing network).

### 3.5 Rings, pomerium and territory
The survey continues outside the fossa. **Ring 1** (the *canabae*) is the first band of blocks around the fossa (32 blocks); **Ring 2** the next band (40 blocks). A block is **masked** (never urban; becomes rural land) if any of its tiles is river, crag, rock, lucus or ruins, if more than 4 of its tiles are loam, or if it leaves the map.

| Rank | Pomerium (urban zone) | Territory (Chebyshev distance from the fossa rectangle) |
|---|---|---|
| I Castra | castrum interior | 20 |
| II Vicus | + Ring 1 | 26 |
| III Oppidum | + Ring 2 (final) | 34 |
| IV Municipium | unchanged | 44 |
| V Colonia | unchanged | whole map |

No ring is ever added after Oppidum; the final pomerium is 61 × 51 and leaves river loam and the outer land rural for good. There is **no renewal that demolishes farms**: the Ordo never places rural buildings on unmasked blocks of future rings, and never demolishes anything.

### 3.6 Placement classes and footprints

| Class | Footprint | Where | Types |
|---|---|---|---|
| **plot** | 2 × 2 | one free plot of an active, unmasked block | `area`, `puteus`*, `cisterna`*, `lararium`*, `fabrica`*, `taberna`, `hortus`, `castellum`, `lacus` |
| **half** | 4 × 2 | the top or bottom half of a block (2 plots) | `horreum`, `apotheca`, `mansio`* |
| **block** | 4 × 4 | a whole free block | `macellum`, `templum`, `balneum`, `thermae`, `theatrum` |
| **rural** | its own W × H | territory outside the castrum rectangle, not on survey streets, not on unmasked blocks of active rings | `ager` 3×3, `olivetum` 3×3, `lapicidina` 3×3, `venatio`, `pabulatio`, `lignarius`, `figlina`, `caementarium`, `fodina`, `officina` 2×2; and the starred types above |
| **fixed** | — | pre-placed or reserved | `principia` 9×9, `capitolium` 9×4 |

\* *either*: placed on a plot (urban) or on rural land. `mansio` must touch the via (urban half-block in a block adjacent to the via line, or rural touching a via tile).
Orientation is fixed (no rotation). Rural buildings auto-lay a free dirt road to the network (§3.7). The **player** may place rural buildings on unmasked blocks of *future* rings (the ghost warns *"This land is surveyed for the canabae; the plots stay blocked until you move it"*); the Ordo never does.

### 3.7 Roads
- Two levels: **dirt** (free) and **paved** (*silex*, 2 stone per tile; cosmetic plus desirability +1 r1).
- Rural placement auto-lays the cheapest dirt road (Dijkstra, ≤ 40 tiles) from a non-corner ring tile to the network. Step cost: grass/meadow/loam/scrub 1, hills 1.7, forest/dense 3 (the timber goes to stores), rock 2.5, survey street tile 0.5, unmasked future-ring block tile 6; river (except the via bridge), crag, castrum rectangle (except gates) and active-pomerium non-street tiles are impassable. No path → *"No road can reach it."*
- The **road tool** (R) lets the player drag dirt roads on rural land; inside the pomerium roads may only follow survey lines (*"The groma forbids it: streets follow the survey."*). The **paving brush** paves built road tiles.
- At Oppidum the cardo and decumanus inside the castrum are paved (ceremony). The *Via Militaris* path paves the via. Under the *Urbs* focus the Ordo paves the 2 most-used dirt street tiles per month near houses.

### 3.8 Aqueduct
Placing a **castellum** (Municipium) auto-routes an aqueduct with A* from the nearest reachable `fons` to the castellum's footprint edge. Step cost: hills 0.8, flat 1.0, forest 1.4, river 2.5 (arches), road 1.2 (arch over road); buildings and reserved sites block; max 70 tiles. The route is part of the castellum: its cost and work grow with length, its tiles are reserved while it is built, and the arches are drawn progressively as work progresses (taller over low ground). Water flows (600/day) only when the castellum completes. Maximum one castellum per spring (1, or 2 if the map has two springs).

---

## 4. Resources

Stocks are floats (no flooring), displayed rounded. Storage caps are fixed **units**, always displayed in **days** for grain and water.

| id | *Latin* / English | Unit | Base cap (principia sheds) | Role | Trade base (den) |
|---|---|---|---|---|---|
| `denarii` | *Denarii* / coin | — | none | building costs, upkeep, fees, imports | — |
| `grain` | *Frumentum* / grain | modii | 600 (sheds) | the only staple; **vital #1** | 2 |
| `water` | *Aqua* / water | amphorae | 300 | drunk daily; caementarium, baths; **vital #2** | — |
| `timber` | *Lignum* | logs | 300 | building, kiln & bloomery fuel | 3 |
| `stone` | *Lapis* | blocks | 300 | building, renovation, concrete, paving | 4 |
| `tiles` | *Tegulae* | stacks | 100 | roofs (T2+), civic buildings | 4 |
| `concrete` | *Opus caementicium* | cubicae | 100 | civic gate material, T4, aqueduct, Capitolium | — |
| `ore` | *Venae ferri* | loads | 100 | bloomery input | — |
| `iron` | *Ferrum* | ingots | 100 | tools, domus, thermae, Capitolium | 10 |
| `tools` | *Instrumenta* | kits | 20 | auto-issued +20% buffs | — |
| `oil` | *Oleum* | amphorae | 60 | T4 house need | 6 |
| `wine` | *Vinum* | amphorae | 60 | T4 domus need, festivals (import only) | 8 |

**Meters** (not stocked): *Laetitia* (morale, 0–100, EMA) and *Dignitas* (a rating recomputed daily, never spent).
**Grain storage**: grain up to the total horrea capacity is safe; grain above it sits in the open **sheds** and rots **0.3%/day** (×2 in Aestas). Horrea add +4,000 each. Water evaporates 0.2%/day in Aestas.
Wine has **no producer**: it comes only from trade (Oppidum Silvanum, Forum Narbonis, Portus Massiliae) and merchants, which makes trade matter for patricians.

---

## 5. Buildings

29 placeable/fixed types. Costs are **den / timber / stone / tiles / concrete / iron**. **Work** is builder-days (one novice builder = 1 work/day). **Rank** = rank that unlocks it (I Castra … V Colonia). ★ = core set (build order).

### 5.1 Identity, cost, work, placement

| id | *Latin* / English | Class | Cost | Work | Rank | Placement rule and adjacency |
|---|---|---|---|---|---|---|
| `area` ★ | *Area domus* / house plot | plot | 0/4/0/0/0/0 | 4 | I | Becomes a T0 tentoria; evolves (§7). |
| `principia` ★ | *Principia → Forum* | fixed 9×9 | pre-placed | — | I | Stage = rank (0–4). |
| `capitolium` ★ | *Capitolium* | fixed 9×4 | started by the Colonia path (§9.5) | 320,000 | V | Area Capitolina only. |
| `ager` ★ | *Ager* / fields | rural 3×3 | 50/20/0/0/0/0 | 40 | I | ≥ 7 of 9 tiles fertile (grass, meadow, loam, scrub). Site = average fertility × (1 + min(0.20, 0.04·river-or-loam tiles in the ring)) × (1 + min(0.10, 0.05·adjacent fields)). |
| `venatio` ★ | *Venatores* / hunting lodge | rural 2×2 | 40/15/0/0/0/0 | 20 | I | ≥ 10 wooded tiles within r5. Site = wood density in r5 (0.4–1.4). |
| `pabulatio` | *Pabulatio* / forage camp | rural 2×2 | 30/12/0/0/0/0 | 12 | I | Site = 1 + 0.05·(meadow or forest ring tiles), max 1.3. |
| `olivetum` | *Olivetum* / olive grove & press | rural 3×3 | 90/20/20/0/0/0 | 50 | II | ≥ 5 hills/scrub tiles in footprint; ×1.15 if all 9. Young grove ×0.5 for its first 365 days. |
| `horreum` ★ | *Horreum* / granary | half | 80/40/20/0/0/0 | 60 | I | Praetentura preferred by the Ordo. |
| `apotheca` | *Apotheca* / warehouse | half | 70/40/20/0/0/0 | 50 | II | — |
| `puteus` ★ | *Puteus* / well | plot or rural | 30/10/10/0/0/0 | 15 | I | Off the water table: ×0.6. |
| `cisterna` ★ | *Cisterna* / cistern | plot or rural | 50/10/20/0/0/0 | 25 | I | — |
| `castellum` | *Castellum aquae* + aqueduct | plot | 150/0/40/0/30/0 **+ per route tile** 4/0/8/0/3/0 | 80 + 6 per tile | IV | Auto-routed from a reachable fons (§3.8), ≤ 70 tiles. |
| `lacus` | *Lacus* / public fountain | plot | 30/0/8/0/4/0 | 12 | IV | Within 18 tiles of an active castellum. |
| `lignarius` ★ | *Lignarius* / lumber camp | rural 2×2 | 30/10/0/0/0/0 | 15 | I | Catchment = standing wood within r4 (≥ 40 required). |
| `lapicidina` ★ | *Lapicidina* / quarry | rural 3×3 | 50/20/0/0/0/0 | 40 | I | ≥ 3 hills/rock tiles in footprint + ring. Site = clamp(0.6 + 0.1·(hills/rock tiles in footprint+ring), 0.6, 1.4). |
| `figlina` ★ | *Figlina* / tile kiln | rural 2×2 | 60/20/10/0/0/0 | 30 | II | Must touch a clay tile; +20% if it also touches the river. |
| `caementarium` | *Caementarium* / concrete works | rural 2×2 | 90/25/15/10/0/0 | 45 | III | +15% within 6 tiles of a lapicidina. |
| `fodina` | *Fodina* / iron mine | rural 2×2 | 100/25/15/0/0/0 | 50 | III | Footprint covers ≥ 1 ore tile; output × vein quality. |
| `officina` | *Officina ferraria* / bloomery | rural 2×2 | 80/20/20/10/0/0 | 40 | III | +20% within 4 tiles of a fodina. |
| `fabrica` | *Fabrica* / smithy (tool kits) | plot or rural | 100/20/20/10/0/0 | 40 | III | — |
| `taberna` ★ | *Tabernae* / shop row | plot | 40/15/10/0/0/0 | 20 | II | — |
| `macellum` | *Macellum* / market hall | block | 160/40/60/30/0/0 | 120 | III | — |
| `mansio` | *Mansio* / road station | half or rural | 120/40/30/0/0/0 | 60 | II | Must touch the via. |
| `lararium` ★ | *Aedicula* / wayside shrine | plot or rural | 25/5/8/0/0/0 | 10 | I | — |
| `templum` ★ | *Templum* | block | 220/30/120/30/20/0 | 200 | III | Dignitas ×1.5 if the block touches the forum. |
| `balneum` ★ | *Balneum* / bathhouse | block | 200/30/80/30/20/0 | 160 | III | Draws 20 water/day. |
| `thermae` | *Thermae* / great baths | block | 600/60/300/80/120/20 | 600 | IV | Within 18 tiles of an active castellum; draws 60 water/day. |
| `theatrum` | *Theatrum* | block | 500/40/250/60/80/0 | 500 | IV | — |
| `hortus` | *Hortus* / garden | plot | 15/4/0/0/0/0 | 6 | I | — |

### 5.2 Function, staff, coverage, storage, upkeep

Per-worker output is per day before season, site, skill, tools, morale, effects and legacy (§8.1). Coverage radii are **road steps** from the road tiles touching the footprint (§7.4). Desirability is *value / range*.

| id | Slots (cat) | Output per worker-day (or passive) | Season mult [Ver, Aes, Aut, Hie] | Coverage (layer r) | Storage | Upkeep den/day | Desir | Dignitas |
|---|---|---|---|---|---|---|---|---|
| `principia` | — | +3 den/day subsidy at Castra, +1.5 at Vicus | — | shrine r4 (*aedes signorum*) | base sheds (§4) | 0 | +4/r5 (stage ≥ 3: +6/r6) | 5/8/12/16/20 by stage |
| `ager` | 6 food | 6 grain × site | 1.0 / 1.3 / 0.9 / **0.35** | — | — | 0 | −1/r1 | 0 |
| `venatio` | 2 food | 5 grain × site | 0.8 / 0.8 / 1.2 / **1.3** | — | — | 0 | −1/r1 | 0 |
| `pabulatio` | 2 food | 4 grain × site | 0.5 / 1.4 / **1.8** / 0.1 | — | — | 0 | −1/r1 | 0 |
| `olivetum` | 4 food | 1.2 oil × site | 0.2 / 0.2 / 1.4 / **2.2** | — | — | 0 | +1/r2 | 0 |
| `horreum` | 0 | — | — | — | grain +4,000 (safe) | 0.2 | −2/r2 | 2 |
| `apotheca` | 0 | — | — | — | timber, stone +400; tiles, concrete, ore, iron +150; tools +10; oil, wine +300 | 0.2 | −2/r2 | 1 |
| `puteus` | 2 water | 11 water × site | 1.0 / **0.8** / 1.0 / 1.0 | water r4 | water +50 | 0 | +1/r1 | 0 |
| `cisterna` | 0 | passive 8 water | 1.2 / **0.3** / 1.0 / 1.5 | water r2 | water +400 | 0 | 0 | 0 |
| `castellum` | 1 water | passive 600 water when complete | 1.0 / 0.9 / 1.0 / 1.0 | fountain r3 | water +2,000 | 1.0 | +2/r2 | 4 |
| `lacus` | 0 | — | — | fountain r6 | — | 0.1 | +3/r3 | 0.5 |
| `lignarius` | 3 materials | 4 timber × catchment (0.2–1.3), draws forest stock | 1 / 1 / 1 / 0.7 | — | — | 0 | −2/r2 | 0 |
| `lapicidina` | 4 materials | 3 stone × site | — | — | — | 0 | −4/r4 | 0 |
| `figlina` | 3 industry | 0.5 timber → 2.5 tiles | — | — | — | 0.1 | −4/r3 | 0 |
| `caementarium` | 2 industry | 1 stone + 1 water → 2.5 concrete | — | — | — | 0.2 | −3/r3 | 0 |
| `fodina` | 3 materials | 1.5 ore × vein | — | — | — | 0.1 | −4/r3 | 0 |
| `officina` | 2 industry | 2 ore + 1 timber → 1 iron | — | — | — | 0.2 | −5/r4 | 0 |
| `fabrica` | 2 industry | 1 iron + 1 timber → 0.4 tools | — | — | — | 0.2 | −2/r2 | 0 |
| `taberna` | 2 services | market tax 0.008 den per covered resident | — | market r6 | — | 0.3 | +1/r2 | 0.5 |
| `macellum` | 4 services | market tax 0.015 den per covered resident; delivers oil & wine | — | macellum r10 (also market) | oil, wine +300 | 0.8 | +2/r3 | 4 |
| `mansio` | 2 services | +1 caravan slot (max 2 mansiones count); merchants ×1.5; trips −1 day each way | — | — | — | 0.5 | −2/r2 | 2 |
| `lararium` | 1 services | — | — | shrine r5 | — | 0.05 | +2/r2 | 1 |
| `templum` | 3 services | — | — | temple r12 (also shrine) | — | 0.8 | +6/r5 | 8 |
| `balneum` | 4 services | uses 20 water/day | — | baths r8 | — | 1.0 | +3/r4 | 6 |
| `thermae` | 8 services | uses 60 water/day | — | baths r14 | — | 3.0 | +5/r5 | 12 |
| `theatrum` | 6 services | — | — | culture r14 | — | 2.0 | +4/r5 | 10 |
| `hortus` | 0 | — | — | — | — | 0 | +4/r3 | 0.5 |
| `capitolium` | builders (crew cap 64) | on completion: victory, morale +10 | — | temple r20 | — | 0 | +10/r8 | 40 |
| T4i house (insula) | — | — | — | — | — | — | −1/r2 | (§7) |
| T4d house (domus) | — | — | — | — | — | — | +1/r2 | (§7) |

**Service activity**: a service with slots is *active* with ≥ 1 worker; at ≥ ceil(slots/2) workers it covers its full radius, below that `floor(0.6·r)`. Zero-slot services are always active. Unpaid upkeep halves efficiency (output and radius ×0.5, rounded down). Path effects add to radii (§9.3).
**Processing** reserves inputs worker by worker against the start-of-day stock. Industry never draws grain below the *Grain reserve* or water below the *Water reserve* settings (except under *Aquae: Operibus prius*).

### 5.3 Construction rules
- **Paying**: cost is paid up front when a site is placed. Exceptions: the Capitolium draws its materials gradually (§9.5); a **player plan** placed while unaffordable is a ghost with a ⌛ badge, paid and started automatically when the stock covers it (it ignores the Ordo's reservations except the petition fee).
- **Felling**: forest under a rural footprint is felled first; its timber goes to stores; work += stock/12.
- **Builders** work the queue in order: **player sites first** (owner `player`, including requests), then Ordo sites; within each group by `order` (↑ prioritise moves a site to the front), then id. Builders pour work into the first site until it is done or stalls for materials, then the next. Idle adults add 0.3 work each.
- **Ordo stake**: every Ordo-placed site is first **staked** for 5 days (paid, groma and chalk outline, Ordo seal; no work). During the stake the player may **Cancel (100% refund)** or **Move** (place the same type elsewhere as a player site; the stake is refunded). Survival wishes and player requests skip the stake.
- **Cancel/demolish**: cancel a site within 5 days of placement and before any work → 100%; otherwise 75%. Demolish a finished building → 25%. The principia, the Capitolium and the via bridge cannot be demolished. **The Ordo never demolishes, moves or replaces anything.**
- **Visual stages**: groma pegs (staked) → foundation trench (0–10% of work) → scaffold and `rise()` (the sprite grows bottom-up) → completion: dust and star burst, *build* arpeggio, a pennant on the roof for 5 days. Progress bar colours: grey trench, gold building, purple "waiting for materials".
- **Tools**: one kit is auto-issued per eligible building without an active kit (construction sites first, then ager, lignarius, lapicidina, fodina, caementarium, figlina, officina): +20% for 120 days (180 with *Ars Fabrilis*).

---

## 6. People

### 6.1 Individuals
- Every person is a plain record (`Person`, ARCHITECTURE §4): praenomen, gens (nomen, stored in masculine form), optional ordinal and cognomen, sex, birth day, family, spouse, parents, home, work, skills, veteran flag, sick-until. Hard cap **1,500** living people; the design peak is ≈ 1,100.
- **Households** are families (`Family`: gens, head, home). Families arrive together and are housed together; a house is labelled after its principal family (*"Casa tegulata · gens Antonia"*).
- **Gentes**: 6 founding (Valerius, Antonius, Flavius, Cassius, Aemilius, Iulius); 14 veteran (Pompeius, Crassus, Sertorius, Vitellius, Lentulus, Metellus, Corvinus, Silanus, Regulus, Maximus, Drusus, Sabinus, Marcellus, Scaevola); 30 immigrant (Aurelius, Cornelius, Domitius, Fabius, Fulvius, Herennius, Licinius, Lucretius, Manlius, Marius, Minucius, Octavius, Papirius, Petronius, Plautius, Porcius, Quinctius, Rutilius, Sempronius, Sergius, Servilius, Sulpicius, Terentius, Tullius, Vettius, Vibius, Volusius, Atilius, Calpurnius, Hostilius).
- **Naming** (patrilineal, fixing rome): sons get a praenomen from rome's 36-name pool, with an ordinal if a living family member shares it (*Marcus II Valerius*). Daughters take the feminine gens name (*-ius → -ia*): the first daughter *Valeria*, later ones *Valeria Secunda / Tertia / Quarta*. Wives keep their birth gens and join the husband's household. Children take the father's gens and family.

### 6.2 Founding roster (rome's 24 souls, daughters' names fixed)

| Gens | Head (age, skill) | Wife (gens, age) | Children (age → stage) |
|---|---|---|---|
| Valerius | Marcus 38, agri 2 | Livia (Livius) 34 | Gaius 14 youth · Valeria 8 |
| Antonius | Lucius 42, aqua 1 | Aelia (Aelius) 36 | Publius 10 · Antonia 5 |
| Flavius | Titus 35, aqua 1 | Valeria Prisca (Valerius) 32 | Quintus 16 adult · Flavia 12 youth |
| Cassius | **Decimus 41**, fabri 2 — *primus pilus emeritus, the mentor* | Iunia (Iunius) 33 | Cassia 9 · Aulus 4 |
| Aemilius | Gnaeus 39, aqua 1 | Caecilia (Caecilius) 35 | Sextus 11 · Aemilia 6 |
| Iulius | Publius 40, lapis 1 | Claudia (Claudius) 37 | Lucius 15 youth · Iulia 7 |

13 adults, 3 youths, 8 children. Daily need 13·1 + 3·0.85 + 8·0.6 = **20.35** grain and water.

### 6.3 Life stages

| Stage | Age | Works? | Need ×adult | Ration tier |
|---|---|---|---|---|
| `child` | 0–11 | no | 0.6 | 1st (fed first) |
| `youth` | 12–15 | no | 0.85 | 2nd |
| `adult` | 16–54 | yes | 1.0 | 2nd |
| `elder` | 55+ | yes at ×0.7 until 64; retired from 65 | 0.75 | 3rd (fed last) |

Residents of a T4 **domus** are *patricii*: they never take jobs (they pay high taxes, §7). Sick people (fever) do not work.

### 6.4 Skills
Seven skills: `agri` (fields, forage, olives, hunting), `aqua` (wells, castellum), `silva` (lumber), `lapis` (quarry, concrete), `ferrum` (mine, bloomery, smithy), `fabri` (builders, kiln), `officium` (services, markets, temple, baths, mansio, theatre). Working gains **+0.004 level/day** (level 1 ≈ 250 days, level 10 ≈ 7 years); +4% output per level; max 10 per skill; **lifetime budget 20** levels across skills. Assignment is sticky so skill accrues; the Ordo prefers the most skilled candidate for a slot.

### 6.5 Marriage, births, deaths
- **Marriage**: each day, unmarried men aged 18–50 (in id order) each have a 1/400 chance to seek a wife; the first unmarried woman aged 16–45 of a *different gens* passing the kinship check (no parent, child, sibling, or shared parent/grandparent) marries him. At most 2 marriages per day. Widowed people may remarry 180 days after the death. The search uses per-gens buckets (O(n)).
- **Births**: each married woman aged 16–42 with a living husband: annual rate **0.09** × foodF × moraleF × bedsF × fx(`births`), applied daily as /365. foodF = 1 if grain DoH ≥ 20, 0.5 if ≥ 10, else 0.1; moraleF = clamp(morale/55, 0.3, 1.3); bedsF = 1 if free beds ≥ 2, 0.5 if 1, else 0. The child joins the father's family and home.
- **Deaths** (daily probability): annual hazard `h = (age < 1 ? 0.04 : age < 12 ? 0.006 : 0.004) + 0.010·e^((age − 55)/7.5)`, × (1 − 0.35·care) (§8.10), /365. Plus **starvation**: 0.012/day for each person in a stage group whose hunger > 75; **thirst**: 0.015/day when thirst > 75 (both ×0.4 offline). Plus event deaths (clamped, §12). Causes are logged; old age is the largest-term default.

### 6.6 Immigration and Rome's roll
- **Rome's roll** (*numerus coloniae*): immigration never takes the population above `CEILING[rank] = [100, 260, 560, 900, 1500]` (Castra … Colonia). Births and veterans are not blocked but veterans need `pop < ceiling` to appear. At the ceiling the Aedilis says *"Rome's roll is full (100/100 souls). Petition for Vicus to open the canabae to new colonists."* This is the no-decision stall; it never blocks building.
- **Rate** (households per day): `IMM_RATE[rank] = [0.014, 0.011, 0.0075, 0.003, 0.04]` (tune) × attract, where attract = clamp((morale − 30)/40, 0, 1.25) × foodF (grain DoH ≥ 20 → 1, ≥ 10 → 0.5, else 0.1) × waterF (water DoH ≥ 10 → 1, else 0.5) × renown × fx(`immigration`). Rome sends many colonists to found the camp and the vicus, fewer once the town grows by its own births, and a new wave to the Colonia.
- **Renown** (*Rome's favour*): Rome sends colonists faster to a town of renown. A Vicus is measured against the dignitas (§8.11) the Oppidum petition asks (40): renown = min(2, 1 + 1.25 × max(0, dignitas / 40 − 1)) — ×1 at or below the bar, ×1.125 at a tenth above it, ×2 at four-fifths above. At every other rank it is ×1 (`RENOWN.FROM`/`TO` in `balance.ts` set the ranks). The Ordo raises what the vicus needs, which carries it to about the bar by the end of the rank; what lifts it beyond is the player's own building — above all gardens, which the Ordo leaves to the player (§10.3: a hortus only under *Urbs*), and extra shrines and works — so building pays in colonists (§1.4).
- **Rome's call** (steady arrivals): each day the rate × 3 souls accrues on the call (`immCall`); once the call passes 1.5 souls, one roll a day — its chance rising linearly to certainty at 4.5 souls — sends a household, and the household's souls leave the call. The call is capped at 4.5, so days the gates were shut (no beds, the roll full) are not owed. Arrivals come at the drawn rate without Bernoulli clumps, so the first rank-up no longer swings by a year between seeds.
- A household arrives only if **free beds ≥ its size** and the roll allows. Mix: 70% a couple with 0–3 children (0–14); 20% a single craftsman with one skill at 1–3; 10% a widow with 1–3 children. Nomen from the immigrant pool (prefer gentes not yet present). The family walks in along the via behind an ox-cart and moves into the house with the most free beds nearest the forum (ties by id).
- **Emigration**: while morale < 25, one household leaves with p = 0.02/day. Homeless people re-house when beds free up; after 20 days homeless they leave. Both are reported by the Aedilis with the cause.
- **Veterans at the gate** (event, §12): 2–3 skilled older families camp as tent sprites outside the Porta Praetoria for 30 days.

---

## 7. Housing — the heart of the city

### 7.1 Tiers

| Lvl | `id` | *Latin* / English | Beds | Tax den/res/day | Needs to *become* this tier (cumulative) | Renovation materials | Rank | Dignitas |
|---|---|---|---|---|---|---|---|---|
| T0 | `tentoria` | *Tentoria* / tents | 5 | 0.02 | street access (always true once placed) | plot: 4 timber | I | 0 |
| T1 | `casa` | *Casa* / wattle-and-thatch hut | 8 | 0.04 | **water** access + **fed** | 8 timber | I | 0.5 |
| T2 | `tegulata` | *Casa tegulata* / tiled cottage | 10 | 0.06 | + **religion** (shrine or temple) + **market** (taberna or macellum); desirability ≥ −5 | 6 timber, 8 tiles | II | 1 |
| T3 | `domusParva` | *Domus parva* / stone house | 13 | 0.12 | + **temple** coverage; desirability ≥ 0 | 12 stone, 8 tiles | III | 2 |
| T4 | `insula` | *Insula* / 3-storey apartments (plebs) | 24 | 0.11 | + **baths** + **macellum** + **oil** supplied; desirability ≥ −3 (tenements tolerate their own crowding); branch rule below | 20 stone, 12 tiles, 8 concrete | III | 3 |
| T4 | `domus` | *Domus* / atrium house (patricii) | 10 | 0.40 | + baths + macellum + oil + **wine** supplied; desirability ≥ 10 | 16 stone, 12 tiles, 6 concrete, 4 iron | III | 5 |

- *Coloni* path: T0–T2 +2 beds. *Ius Latii*: insula +4 beds.
- **Fed** = the city fed index (30-day EMA of the population-weighted grain ration ratio, §8.4) ≥ 0.9.
- **The fork (T3 → T4)** — plebs or patricians, labour or prestige. Each house has a preference toggle in its inspector: `auto` (default) · `insula` · `domus`. *auto* becomes a domus when the plot's desirability ≥ 10, otherwise an insula; *domus* waits (want: laurel) until desirability ≥ 10; *insula* always becomes an insula. Gardens, temples and fountains push a block toward domus; tabernae, horrea, workshops and insulae themselves keep it plebeian. Changing the preference of a finished T4 house starts an 8-day conversion that costs the target branch's renovation materials once its needs are met; overflow residents become homeless. The Ordo never changes preferences.
- **Aquae variant** (Municipium+): a T4 house inside **fountain** coverage gains its aqueduct form — insula +6 beds and a 4th storey; domus tax ×1.3 and a fountain in the peristyle; +1 dignitas. Purely a coverage effect, no extra tier.

### 7.2 Evolution
- Each house is checked every 5 days on its own slot (`(id + day) % 5 == 0`). If all needs of the next tier hold, `okDays += 5`, otherwise `okDays = 0`.
- When `okDays ≥ 15`, the evolution throttle allows (≤ 1 + floor(houses / 8) renovations *started* per 10-day window, by house id), and the **renovation pool** covers the materials, the household **renovates**: materials are paid, a scaffold overlay shows for **8 days** (4 under *Opera: Magna*), then the tier rises (`fx evolved`, floating *"+Casa tegulata"*, hammer *tink*, toast batched per update).
- **No builders are used.** The renovation pool per resource = `max(0, stock − reserved) × Renovation setting` (default 60%), where *reserved* = the Ordo's saving target (petition fee, pins, requests, player plans, pending wish) plus the next 30 days of Capitolium materials. Renovation never deadlocks construction and vice versa (tested).

### 7.3 Declining and devolution (idle-safe)
- If the needs of the **current** tier fail on a check, `badDays += 5`. At `badDays ≥ 20` the house is **Declining**: tax ×0.5, a morale term, a cracked-plaster overlay, and an Aedilis warning with a countdown. Needs restored for 10 days end the decline.
- After **60 more days** of decline the house drops **one** tier (never below T1); residents over the new capacity become homeless (they re-house or leave after 20 days).
- **Offline, no house ever drops a tier**: the decline counter stops at 55 during replay, and the player returns to warnings, not losses. Fires and other harmful events are also off offline.

### 7.4 Coverage (exact)
- Layers: `water` (puteus r4, cisterna r2), `fountain` (castellum r3, lacus r6; counts as water access), `shrine` (principia r4, lararium r5; temple counts too), `temple` (templum r12, capitolium r20), `market` (taberna r6; macellum counts too), `macellum` (macellum r10), `baths` (balneum r8, thermae r14), `culture` (theatrum r14).
- **BFS over built road tiles** (N4, both dirt and paved, the via included). Sources are road tiles N4-adjacent to the service footprint; distance in steps; a road tile is covered when its distance ≤ the effective radius (§5.2 activity rule, + path bonuses). A **house is covered** when any road tile N4-adjacent to its footprint is covered.
- One `Uint8Array` per layer, recomputed when the structure epoch or the set of effective radii changes. The placement ghost, the Ordo's site scoring and the advisors' "best spot" all use the same function.

### 7.5 Desirability (*Dignitas loci*)
- Per tile: `Σ v · (1 − d/(r + 1))` over every source with `d ≤ r`, where d is the Chebyshev distance from the source's footprint. Sources: building values in §5.2, house values (insula −1/r2, domus +1/r2), `lucus` +3/r3, river tiles +1/r2, paved road tiles +1/r1. Clamped to −20..+30. A house uses the average over its 4 tiles.
- Thresholds: T2 ≥ −5, T3 ≥ 0, insula ≥ −3, domus ≥ 10. (An insula is −1/r2 to its neighbours: at ≥ 0 a block of insulae dragged itself below its own need, declined, dropped, recovered and rose again without end.)

### 7.6 Goods
- T4 residents consume **oil 0.05**/day; domus residents also **wine 0.05**/day, delivered daily from city stock to houses inside macellum coverage. On shortage, higher tiers first, then by house id. Each house keeps a supply EMA (rate 0.1/day) of delivered/needed; *supplied* means EMA ≥ 0.8.

### 7.7 What the house wants
Every house exposes its **first unmet need for the next tier** as an icon bubble (Domus overlay, inspector): water drop, wheat sheaf (fed), shrine, basket (market), temple, laurel (desirability), bath, market hall, oil amphora, wine amphora, crate (materials), scroll (rank: *"a Vicus charter"*). The placement ghost of a service shows ↑ over every house whose first unmet need it would satisfy and reads *"+k houses could evolve"*. This is the core city-builder hook.

---

## 8. Economy and survival

### 8.1 Production formula
`out = base × season × elder(0.7) × unpaid(0.5) × min(2.5, site × (1 + 0.04·skill) × tool(1.2) × productivity × fx(key) × legacy)`
- `productivity = 0.85 + 0.30 × morale/100` (×0.85–1.15). `legacy = 1 + 0.10 × legacy level`.
- The combined per-worker multiplier inside `min(2.5, …)` is capped at **×2.5**.
- The inspector shows the chain with only non-1 factors: *"Fields, north loam: 6 hands × 6.0 × Aestas 1.3 × site +40% × skill +8% × tools +20% × spirits +3% = 75.2 grain/day."*
- **One formula module** (`economy.ts`) is used by the tick, the forecast, the Ordo and the tooltips.

### 8.2 Seasonal multipliers (all in one place)

| | Ver | Aestas | Autumnus | Hiems |
|---|---|---|---|---|
| `ager` | 1.0 | 1.3 | 0.9 | **0.35** (*Pagus rusticus*: 0.45) |
| `venatio` | 0.8 | 0.8 | 1.2 | **1.3** |
| `pabulatio` | 0.5 | 1.4 | **1.8** | 0.1 |
| `olivetum` | 0.2 | 0.2 | 1.4 | **2.2** |
| `lignarius` | 1.0 | 1.0 | 1.0 | 0.7 |
| `puteus` | 1.0 | **0.8** | 1.0 | 1.0 |
| `cisterna` (rain) | 1.2 | **0.3** | 1.0 | 1.5 |
| `castellum` | 1.0 | 0.9 | 1.0 | 1.0 |
| water evaporation | 0 | 0.2%/day | 0 | 0 |
| shed grain rot | 0.3%/day | 0.6%/day | 0.3%/day | 0.3%/day |
| forest regrowth | 1.0 | 1.0 | 1.0 | 0.25 |

**Two crunches give the year its shape**: **Hiems** is the grain crunch (fields ×0.35; hunting and olives peak; forage peaks before it, in Autumnus) and **Aestas** is the water crunch (cisterns ×0.3, wells ×0.8, evaporation; cisterns refill in Hiems and Ver).

### 8.3 Production chains
```
FOOD      Ager 6/wkr ─┐ Venatio 5/wkr (Hiems) ─┐ Pabulatio 4/wkr (Autumnus) ─┐
                      └──────────────► GRAIN ◄──┘ idle adults forage 0.3 ────┘ ─► eaten (children first) · export · festivals
          Olivetum 1.2/wkr (Hiems) ──► OIL ─► T4 houses (0.05/res) · export        WINE ◄─ trade only ─► domus (0.05/res), festivals
WATER     Puteus 11/wkr · Cisterna 8 passive · Castellum 600 passive ─► WATER ─► drunk · Caementarium · Balneum 20 · Thermae 60
TIMBER    Lignarius 4/wkr (forest stock) ─► TIMBER ─► building · Figlina 0.5 · Officina 1 · Fabrica 1 · export
STONE     Lapicidina 3/wkr ─► STONE ─► building · renovation · Caementarium · paving · export
TILES     Figlina: 0.5 timber ─► 2.5 TILES (clay free) ─► roofs T2+ · civic · export
CONCRETE  Caementarium: 1 stone + 1 water ─► 2.5 CONCRETE ─► templum · baths · T4 · aqueduct · thermae · theatrum · Capitolium
IRON      Fodina 1.5 ore × vein ─► ORE ─► Officina: 2 ore + 1 timber ─► 1 IRON ─► Fabrica: 1 iron + 1 timber ─► 0.4 TOOLS (+20% kits)
          iron also ─► domus · thermae · petition fees · Capitolium · export
```
Gate order forced by costs and ranks: lumber → quarry → cistern/horreum (Castra) → figlina, olivetum, taberna (Vicus) → caementarium → mine → bloomery → smithy, templum, macellum, balneum (Oppidum) → castellum, thermae, theatrum (Municipium) → Capitolium (Colonia).

### 8.4 Consumption and rationing
- Daily need per person = stage multiplier × portion × fx(`grainUse`) for grain; stage multiplier × fx(`waterUse`) for water (water is never rationed by edict).
- Portions: *Largae* 1.15 · **Plenae 1.0** · *Parcae* 0.85 · *Arctae* 0.70 (emergency measures only).
- **Tiered allocation** (rome): children, then adults + youths, then elders. A tier that cannot be fully served gets a proportional share; later tiers get nothing. The Acta records it: *"Yesterday's mess: elders on reduced portions; adults went short."*
- **Fed index** = 30-day EMA (α = 1/30) of Σ(group need × ratio) / Σ need for grain. It gates T1+ houses (§7.1) and morale.

### 8.5 Hunger and thirst (per stage group, 4 groups × 2 needs, each 0–100)

| Ration ratio r | Hunger Δ/day | Thirst Δ/day |
|---|---|---|
| r ≥ 1.0 | −5 | −6 |
| 0.8 ≤ r < 1 | −2 | −2 |
| 0.6 ≤ r < 0.8 | 0 (holds: *Arctae* is survivable) | 0 |
| r < 0.6 | +5 × (1 − r/0.6) | +7 × (1 − r/0.6) |

Bands (rome): ≤ 25 *Sated/Hydrated*, ≤ 50 *Peckish/Thirsty*, ≤ 75 *Hungry/Parched*, > 75 *Starving/Dehydrated*. Above 75 the death terms of §6.5 apply. With nothing at all, starvation deaths begin around day 16 and thirst deaths around day 11. A band change into Hungry/Parched or worse writes one Watch line (deduplicated per group).

### 8.6 Storage
- Caps are units (§4), displayed in time: under 3 weeks *"14 days"*, under 4 months *"6 weeks"*, above *"4.2 months"*; tooltip *"Sheds hold 600 (19 days). Each Horreum adds 4,000 (125 days at today's 32/day)."* Growth visibly shrinks the runway.
- Overflow above the cap is wasted (logged at most once per 30 days per resource; *annonae.storage* advises).
- Shed rot and evaporation per §8.2. Horrea grain never rots.

### 8.7 Woods
Forest tiles hold timber (60, dense 100). A lumber camp draws from its r4 catchment: first tiles at ≥ 50% of their maximum, nearest first, then the rest (visible clearings). Tiles under 25% show stumps. Regrowth per day: 0.3% of max for tiles inside a lumber catchment (replanting) — 0 under *Silvae: Caedua*, ×2 under *Lucus* — and 0.05% for other tiles next to standing wood; ×0.25 in Hiems. The forest layer repaints only changed tiles, so **woods visibly recede** around a growing city. Quarries and ore veins never deplete.

### 8.8 Denarii
- **Taxes**: Σ residents × tier tax × (declining ×0.5) × (aquae domus ×1.3) × Tributum × fx(`tax`) × (forum stage ≥ 3: ×1.10), plus market tax (taberna 0.008, macellum 0.015 per covered resident, × fx(`marketTax`)). Accrued daily, **paid on each Kalends** (`fx taxes`).
- **Stipendium legionis**: +3/day at Castra, +1.5/day at Vicus, then 0 (its own ledger line so the player sees it end).
- Other income: exports (paid when the caravan returns), merchant sales, Lustrum census windfall (0.5 × pop every 5th Kal. Apr.), events.
- **Costs**: construction (up front), Capitolium gradual denarii, upkeep (daily), imports (at dispatch), petition fees, festivals, events.
- The treasury never goes negative. If a day's upkeep cannot be paid, unpaid buildings work at 50% (red coin pip) until paid; the Quaestor raises *Periculum*.

### 8.9 Morale (*Laetitia*)
`target = 50 + grainTerm + rationTerm − 20·(1 − r̄_grain) − 20·(1 − r̄_water) + 2·avgTier + 8·religionShare + 5·bathsShare + 6·cultureShare − 20·homelessShare − 10·decliningShare − min(12, 2·nonOldAgeDeaths30) + festivals + fx(morale) + (Hiems ? fx(hiemsMorale) : 0) + 2·legacy`
- grainTerm: grain DoH ≥ 30 → +5; 15–30 → +2; 7–15 → −3; < 7 → −10. rationTerm: Largae +6, Plenae 0, Parcae −6, Arctae −14. Shares are fractions of houses covered (religion = shrine or temple). avgTier: mean house level 0–4.
- `morale += (target − morale) × 0.05` per day (τ ≈ 20 days). Clamp 0–100. Start 65.
- Effects: productivity ×0.85–1.15; births ×clamp(m/55, 0.3, 1.3); immigration attract (§6.6); emigration below 25; veterans need ≥ 55; merchants need ≥ 45.
- Labels: ≥ 75 *High spirits*, ≥ 50 *Steady*, ≥ 30 *Uneasy*, < 30 *Despondent*. The tooltip lists every term with its sign.

### 8.10 Care (health folded into coverage)
`care = share of residents in baths coverage + fx(care)` (clamped 0–1). It reduces the death hazard (×(1 − 0.35·care)) and the fever event weight and deaths. There is no separate health meter.

### 8.11 Dignitas (a rating, never spent)
`dignitas = (Works + Homes + Roads + Deeds + Fama)`, recomputed daily:
- **Works**: Σ dignitas of finished buildings (§5.2; principia by stage; templum ×1.5 when touching the forum, × fx(`templeDignitas`)).
- **Homes**: Σ tier dignitas of houses (§7.1; aquae +1).
- **Roads**: 0.05 × paved road tiles.
- **Deeds**: +1 per completed milestone.
- **Fama**: event modifiers (fxAdd `dignitas`), then the whole sum × fx(`dignitas`).
Shown as a laurel number with its groups (*"Works 46 · Homes 18 · Roads 3 · Deeds 9"*). Petition thresholds: **Vicus 12 · Oppidum 40 · Municipium 100 · Colonia 190**. Advisors can say *"a templum gives +8"*.
- **Renown**: a Vicus whose dignitas passes the Oppidum threshold draws Rome's colonists faster (up to ×2, §6.6), so the rating is never spent but already earns before the petition.

### 8.12 Emergency measures (*Lex de annona*) — the one relief ladder
A council switch, **default On**, revealed at the first emergency or milestone 5. Evaluated daily, in order; each step is announced by its advisor and logged with the tag *decided*:
1. **Rations**: grain runs out in < 12 days → portions *Parcae*; < 6 days → *Arctae*. Ignores the edict window. Lifted (back to the edict's portion) when grain DoH > 25.
2. **Water**: water runs out in < 8 days → caementarium and baths pause (no water draw) until water DoH > 15.
3. **Emergency import**: grain runs out in < 8 days and the coin covers it → one import of 20 days of grain from the cheapest open hub, arriving after that hub's one-way days, outside the caravan slots, ignoring the trade reserve. Cooldown 90 days.
4. **The Legate's relief** (*mutuum*): structural famine (max potential < need) and grain runs out in < 10 days, or grain < 6 days with coin below the import cost → the relief card (§12): accept (default) → 30 days of grain arrive in 5 days; debt = 2 × base price × qty, repaid from 25% of each Kalends tax payment. Once per 365 days (one free relief per year with *Annona Publica*). Works offline (auto-accepted).

**Guarantee**: with the Ordo on and emergency measures on, no year loses more than 5% of the average population to hunger or thirst (balance test).

---

## 9. Progression

### 9.1 Rank ladder (*cursus*) — one new verb per rank

| Rank | Player title | Petition requirements (✔/○ checklist, rendered from `petitionNeeds()`) | Petition fee | On promotion / unlocks | New verb |
|---|---|---|---|---|---|
| **I Castra** | *Praefectus castrorum* | start | — | area (T0–T1), ager, venatio, pabulatio, puteus, cisterna, horreum, lignarius, lapicidina, lararium, hortus; hub Vicus Metellianus; roll 100; subsidy 3/day | food, water, the first winter |
| **II Vicus** | *Magister vici* | Lex coloniae chosen · pop ≥ 50 · first Hiems weathered (≥ Kal. Mart. DCCCI) · a Horreum · *Stabilitas* (grain ≥ 30 d, water ≥ 10 d, morale ≥ 55, held 10 days) · dignitas ≥ 12 | 250 den, 100 timber | Ring 1 (canabae) joins the pomerium (a plough-ox walks the new *sulcus primigenius*, fx); territory 26; T2; figlina, taberna, apotheca, mansio, olivetum; hubs Pagus Durii, Oppidum Silvanum; **Commercium** tab and trade toggle; roll 260; subsidy 1.5/day; forum stage 1 (timber principia) | caravans & contracts, tiled roofs, markets |
| **III Oppidum** | *Praefectus oppidi* | pop ≥ 180 · ≥ 10 houses at T2+ · ≥ 70% of houses with religion **and** market coverage · caravans returned from ≥ 2 hubs · dignitas ≥ 40 | 900 den, 250 stone, 150 tiles | Ring 2 joins the pomerium (final); territory 34; T3 and the T4 fork; caementarium, fodina, officina, fabrica, templum, macellum, balneum; hubs Forum Narbonis, Portus Massiliae; **palisade and gates become stone** (sprite swap); cardo & decumanus paved; roll 560; subsidy ends; forum stage 2 (stone colonnade) | concrete & iron, temple, insula/domus fork |
| **IV Municipium** | *Duumvir* | pop ≥ 400 · ≥ 16 houses at T3+ incl. ≥ 4 at T4 · templum, macellum and balneum staffed · 60 iron smelted (lifetime) · dignitas ≥ 100 | 2,500 den, 400 stone, 200 concrete, 60 iron | territory 44; castellum + aqueduct, lacus, thermae, theatrum, T4 aquae variant; hub Colonia Augusta; roll 900; forum stage 3 (basilica & curia: taxes ×1.10) | aqueduct routing, great baths, fountains |
| **V Colonia** | *Patronus coloniae* | pop ≥ 700 · aqueduct flowing · thermae and theatrum staffed · ≥ 12 houses at T4 · contracts completed with ≥ 5 hubs · dignitas ≥ 190 | 5,000 den, 600 stone, 300 concrete, 120 iron | territory = whole map; roll 1,500; forum stage 4 (marble, statues); **the Capitolium works begin** | the Capitolium set piece |

- **The petition is the Crossroads.** When every requirement is ticked the Res Gestae CTA glows (*"Petition Rome: Oppidum"*) and the Augur raises the gold *Opportunitas* advisory. While requirements are met but the fee is short, the Ordo **saves for the fee** (every Ordo spend respects it) and the card says *"The Ordo is saving: 120 stone (≈ 9 days)."*
- Petitioning = choosing one of three **permanent paths**; it pays the fee and grants the rank. A non-blocking banner follows (*"AUC DCCCVII · CASTRA VALERIA FIT OPPIDVM"*), a cornu fanfare, legionaries march out of the forum, a beam sweeps the new pomerium.
- **Paths are never chosen automatically**, not even offline. The away report's first line becomes *"Rome would hear our petition for Oppidum."*

### 9.2 The Founding Charter and the four paths (5 permanent choices)
Each option changes how the city plays **and** names a visible change.

**Lex coloniae** (charter; free; any time at Castra; required for the Vicus petition) — *"By what law is this colony founded?"*

| Option id | Name | Effects | Visible change |
|---|---|---|---|
| `veterani` | *Colonia veteranorum* | builders ×1.25; veteran events ×2 and their heads +1 skill; morale +2 | walkers in legion-red cloaks; extra standards at the principia |
| `agricolae` | *Coloni agrarii* | fields ×1.2; horrea capacity ×1.25 | centuriation boundary stones between fields |
| `mercatores` | *Emporium castrense* | +1 caravan slot; trade prices ×1.10 better; merchants ×2; Commercium (Vicus Metellianus only) usable at Castra | market stalls in the forum; mules join caravans |

**Path 1 — Vicus** — *"The canabae outside the gates swell with camp-followers. What will the vicus become?"*

| `canabae` | *Canabae* (market village) | market radius +3; market tax ×1.4; oil ×1.2 | casae grow shop awnings |
| `pagus` | *Pagus rusticus* | hunting & forage ×1.3; Hiems fields +0.10 (0.35 → 0.45, winter wheat) | haystacks in the fields |
| `coloni` | *Coloni* | immigration ×1.3; T0–T2 +2 beds; births ×1.2 | more family carts on the via |

**Path 2 — Oppidum** — *"A walled town rises. What will Castra Valeria be known for?"*

| `arsFabrilis` | *Ars fabrilis* | figlina, caementarium, officina, fabrica ×1.25; tool kits last 180 days | smoke plumes; an anvil sign on the gates |
| `pietas` | *Pietas* | shrine & temple radius +4; temple dignitas ×1.5; festival costs ×0.5; morale +4 | incense particles; garlanded shrines |
| `viaMilitaris` | *Via militaris* | caravan trips ×0.8; +1 caravan slot; bandits ×0.3 | the via is paved in basalt to the edge, with milestones |

**Path 3 — Municipium** — *"Rome grants a charter. What rights will the municipium hold?"*

| `iusLatii` | *Ius Latii* | immigration ×1.5; taxes ×1.10; insula +4 beds | citizen togas on walkers |
| `annonaPublica` | *Annona publica* | grain need ×0.95; horrea ×1.25; morale +6 in Hiems; one free Legate's relief per year | grain-dole queue at the forum |
| `aquaeSalutares` | *Aquae salutares* | castellum cost ×0.7; lacus cost ×0.5; baths radius +4; care +0.2 | steam from every bath; extra fountain sparkle |

**Path 4 — Colonia** — *"Under what vision will the Capitolium rise?"* (choosing it starts the Capitolium)

| `iuppiter` | *Iuppiter Optimus Maximus* | morale +8; Capitolium work ×0.8 | gilded quadriga crowns the pediment |
| `aeternitas` | *Aeternitas* | Capitolium materials ×0.8 | gilded eagle (aquila) on the pediment |
| `imperium` | *Imperium* | all labour ×1.10; the next colony gets +5% legacy | she-wolf group and imperial standards |

"Your story" chips in Edicta list each choice (*"AUC DCCCII: the canabae became a market village."*).

### 9.3 Effect bus summary
All paths, edicts, timed modifiers (events, festivals), emergency rations and legacy feed one typed effect bus: `fx(state, mulKey)` (product, default 1) and `fxAdd(state, addKey)` (sum, default 0). Focus has no effects (it steers the Ordo only). Keys are listed in ARCHITECTURE §4.

### 9.4 Milestones (*Res Gestae*) — one goal at a time, each unlocks something, each adds +1 *Deeds* dignitas

| # | id | Goal | Progress | Unlocks |
|---|---|---|---|---|
| 1 | `firstWork` | Raise your first building | built (non-start) ≥ 1 | *Spare beds* setting · "Build next" pin |
| 2 | `charter` | Proclaim the Lex coloniae | charter chosen | Council Focus |
| 3 | `fed30` | Thirty days without hunger | consecutive days with every group at full rations / 30 | *Rationes* edict · *Grain reserve* setting |
| 4 | `horreum` | Raise a Horreum | horreum done | *Tributum* edict |
| 5 | `hiems` | Weather the first Hiems | date ≥ Kal. Mart. DCCCI | *Opera* edict · *Builder share* setting · *Lex de annona* switch shown |
| 6 | `pop50` | Fifty souls | pop / 50 | *Hospites* edict |
| 7 | `stabilitas` | *Stabilitas* | streak / 10 days | *Water reserve* setting |
| 8 | `vicus` | Become a Vicus | rank ≥ II | *Horae* edict · *Trade reserve* setting |
| 9 | `caravan` | A caravan returns | caravans returned ≥ 1 | *Nundinae* edict |
| 10 | `tegulae` | Ten tiled roofs | houses at T2+ / 10 | *Feriae* edict · *Renovation* setting |
| 11 | `pop150` | 150 souls | pop / 150 | *Silvae* edict · *Treasury floor* setting |
| 12 | `oppidum` | Become an Oppidum | rank ≥ III | *Aquae* edict · Reserve-block tool |
| 13 | `templum` | Raise a Templum | templum done | *Dignitas loci* overlay · paving brush |
| 14 | `fork` | The first insula or domus | houses at T4 ≥ 1 | gilded standards at the principia (cosmetic) |
| 15 | `iron60` | Smelt 60 iron | lifetime iron / 60 | bronze statues in the forum (cosmetic) |
| 16 | `municipium` | Become a Municipium | rank ≥ IV | fountain layer in the Aqua overlay |
| 17 | `aqua` | Water flows from the hills | castellum active | fountains sparkle on the minimap (cosmetic) |
| 18 | `pop500` | 500 souls | pop / 500 | a laurel on the HUD crest (cosmetic) |
| 19 | `colonia` | Become a Colonia | rank V | the Capitolium works |
| 20 | `capitolium` | **Dedicate the Capitolium** | Capitolium done | **Victory** · Legacy |
| post | `pop1200` · `allT3` · `sixHubs` · `saturnalia10` | 1,200 souls · every house T3+ · contracts with all 6 hubs · 10 Saturnalia kept | — | purple banners · gilded quadriga · triumphal garlands (cosmetic) |

`checkObjectives` loops, so several milestones complete in one tick (offline). Completion: laurel *pop* animation, lyre arpeggio, toast *"Unlocked: Hospites edict. See Edicta."*

### 9.5 The Capitolium (endgame set piece, ≈ 30–45 min at 1×)
- **Start**: choosing the Colonia path pays the fee and turns the reserved *Area Capitolina* into the Capitolium site (no other up-front cost).
- **Work** 320,000 × fx(`capWork`). **Crew cap**: at most **64 builders** work on it (*"Even Rome cannot put more than sixty-four fabri on one temple."*). One builder ≈ 1.6–2.3 work/day (skill, tools, spirits, *Opera Magna*), so the crew-bound minimum is ≈ 2,200–3,100 days (*Iuppiter* or *Colonia veteranorum* builders ≈ 20% less).
- **Gradual materials** (× fx(`capMat`)), consumed pro rata to work: stone 24,000 · concrete 9,000 · tiles 4,000 · iron 1,800 · denarii 160,000. At 140 work/day this is ≈ 10 stone, 3.9 concrete, 1.8 tiles, 0.8 iron and 70 denarii per day — the aerarium's great expense of the age — — modest flows the city must *sustain* for half an hour. Progress per day = min(crew work, the work the available materials allow). Materials are drawn from stock above the Ordo's other reservations (denarii above the treasury floor).
- **Monument mode**: while the Capitolium is unfinished, the Ordo staffs its crew on top of the normal builder share (total builders ≤ 30% of the workforce), builds producers for the binding material (wish `materials`) and imports it when trade is on.
- **Four stages** at 25/50/75/100% of work: I *Podium*, II *Cella*, III *Columnae* (colonnade), IV *Fastigium* (pediment and the path's crowning group). Each stage: banner, cornu, morale +5 for 30 days, log line.
- `fabrum.capitolium` names the bottleneck: *"At this flow the Cella rises in 410 days; concrete is the bottleneck (3.2/day of 4.1)."*
- **Dedication** = victory: cornu banner, the parchment **Victory dispatch** (stats), Fasti entry, **"Keep governing"** or **"Found a new colony (Legacy N+1: +10% output, +2 morale)"**.

### 9.6 Legacy
- Each finished colony: **+10% output and +2 morale** (multiplicative output factor `1 + 0.10·L + bonus`, *Imperium* adds +0.05 to the next). New seed, new name (*Colonia Valeria Secunda, Forum Iulii Novum, Aquae Antoniae, Castra Flavia, Forum Cassii, Colonia Aemilia Equestris*…). The founding families are the same six gentes.
- **Fasti coloniarum** (prefs, shown on the title screen): name, founded AUC, dedicated AUC, peak population, paths chosen, real play time.

---

## 10. Player agency and the Ordo

### 10.1 What the player does (always available, every automation on or off)

| Verb | How | Notes |
|---|---|---|
| **Place a building** | Aedificia card → **Place** → the ghost snaps to plots/halves/blocks (urban) or tiles (rural) → click. Shift-click places more. | Ghost shows validity with the reason, a gold *+NN%* site bonus, the coverage preview, ↑ on houses it would let evolve (*"+k houses could evolve"*), felling yield, the **laurel marker on the Ordo's choice** of slot. Unaffordable → a **plan** (⌛) paid automatically later. Player sites **jump the builder queue**. |
| **Ask the Ordo** | Card or remedy button (shown when Ordo construction is on) | Queues a request (max 3). Within 2 days the Ordo places it at its best slot as a *player* site (no stake), flashing the spot for 2 s and logging *"Raising the Lararium you asked for — 6 houses lacked a shrine."* |
| **Build next (pin)** | Card button (milestone 1) | The Ordo saves for that type and places it first. |
| **Roads, paving** | Road tool (R) drag; paving brush (milestone 13) | §3.7. |
| **Reserve block** | Tool (milestone 12) or block inspector | The Ordo never builds in a reserved block. |
| **Prioritise, cancel, move, demolish** | Works queue ↑ / ✕; inspector | Refunds §5.3. *Move* only for Ordo stakes. |
| **Building controls** | Inspector: **Open / Closed**, staffing priority **Low / Normal / High** | Closed keeps the sprite with a red CLAVSVM plank and releases workers. |
| **House preference** | House inspector: auto / insula / domus | The fork (§7.1). |
| **Petition, paths, focus, edicts, settings, switches** | Edicta tab | §9, §10.8–10.10. |
| **Trade** | Commercium: contracts, merchant deals | §13. |
| **Events** | Event card | Default = cautious option. |
| **Remedies** | Advisor card / Consiliarii | One click, typed (§11.5). |
| **Overlays, inspection** | Overlay bar, `O` | §11.9. |

### 10.2 What the Ordo automates (*"Who decides the details?"*, revealed at Vicus or when any toggle is off)

| Toggle (`code`) | UI label | Ordo on | Manual |
|---|---|---|---|
| `labour` | *Operae* / Labour | Daily staffing targets (§10.4) with a reason per category; people move to match (sticky). | Player sets category priorities 1–5 and per-building open/priority; staffing fills by priority, then by step order; a ghost line *"The Ordo would assign: Water 4 · Food 14 · Builders 5 …"* with **[Apply once]**. |
| `build` | *Aedificatio* / Construction | A wish every 2 days (§10.5), stakes for 5 days, saves for fees. | Only the player's placements, plans and pins are built. The Agenda shows *"The Ordo would raise: Horreum (Praetentura) — [Apply once]"*. House evolution always continues. |
| `trade` | *Negotia* / Trade | Contracts every 10 days and merchant deals (§10.7). | Only player contracts and deals; *"The Ordo would: sell 120 timber to Vicus Metellianus — [Apply once]"*. |

**Always automatic**: house evolution and decline, immigration and housing assignment, rationing, tool-kit issue, goods delivery, coverage, emergency measures (if the switch is on).
**Govern while I am away** (switch, default On): during offline replay every manual subsystem is run by the Ordo, and the away report lists what it did *in your name*.

### 10.3 Division of labour: what the Ordo will and will not do
- **Modest cadence**: one wish every 2 days; concurrent Ordo sites ≤ 1 + floor(workforce / 40), max 4 (the Capitolium is extra).
- **Stakes**: Ordo sites sit staked for 5 days (cancel 100% / move) before builders start. Player sites go first in the queue.
- **Never**: demolishes, moves, converts or "renews" any building; changes a house preference; builds in reserved blocks or blocks holding a player plan or unfinished player site; places rural buildings on future-ring blocks; builds a *hortus* or paves streets (except under the *Urbs* focus or on request); chooses a path.
- **Counts the player's work**: coverage, storage and slots from player buildings count fully before the Ordo plans its own.
- **Leaves to the player**: beautification, the fork, extra culture, and anything faster than the cadence (baths are city management: a balneum goes up wherever ≥ 3 homes wait for one, like any service of row 6). The **builder persona** test (§18.5) proves that placing by hand pays.

### 10.4 How the Ordo staffs (daily; each step records a Reason)
Workforce = adults and elders under 65, excluding patricii and the sick. Within a step, buildings marked High fill first, then the best marginal output, then lowest id.
1. **Water** `needWater`: wells to need × base (passive sources counted first). base 1.05; 1.2 when water DoH < *Water reserve*; 1.5 when any group's thirst > 25; 1.3 in Ver when the forecast shows an Aestas shortfall (*"Aestas pre-fill"*).
2. **Food** `needFood` / `reserveTopup`: one worker at a time to the food building with the best marginal output *this season* until production ≥ need × base. base 1.0; 1.2 when grain DoH < *Grain reserve*; 2.0 when any group's hunger > 25; in Hiems ≥ 1.4 when DoH < 10; 0.85 when grain is at its cap. Food workers ≤ 75% of the workforce (90% when hungry).
3. **Required services** `requiredService`: every service that some house's *current* tier depends on gets ≥ 1 worker, then up to half its slots (full radius).
4. **Builders** `builderShare` / `monument`: while any site is workable, max(2, round(workforce × *Builder share*)); plus the Capitolium crew in monument mode; total ≤ 30% of the workforce.
5. **Pending inputs** `pendingInput`: producers of whatever the saving target, the pending wish, waiting renovations or the next 30 days of Capitolium lack (*"Quarry 4: saving 60 stone for the Horreum"*).
6. **Winter stockpile** `winterStock`: in Autumnus and the last 30 days of Aestas, while grain < need × *Grain reserve* and there is room: fill food to need × 1.35 (*"+3 fields: stockpiling for Hiems (612/900)"*).
7. **Tools** `tools`: fabrica (and its inputs) while tool kits < 0.5 × tool-using buildings.
8. **Luxury** `luxuryStaff`: olive groves to oil demand × 1.2 over the year — the goal follows the season's yield, so the same hands press in every season and the Autumnus and Hiems presses fill the stores for Ver and Aestas.
9. **Services** `serviceFull`: fill remaining service slots.
10. **Focus split** `focusSplit`: the remaining workforce by the focus weights (§10.8).
11. **Leftovers** `leftover`: any open slot (materials, industry, services, food, water order); the rest are idle — they forage 0.3 grain/day and add 0.3 work/day to sites.
A *priority* remedy (*"Fields first for 30 days"*) moves its category directly after step 2 until it expires.

### 10.5 How the Ordo builds (every 2nd day; save-without-deadlock)
The wish list is walked in order. Each wish names a type and a slot (`bestSlot`). The **first unaffordable** wish becomes *pending* (what the Ordo saves for); later wishes may proceed only if they need none of the resources *pending* lacks (Hearthlands `take/ready/pending`). Every spend except survival respects the **saving target** and the **treasury floor**.

| # | Code | Condition | Builds | Stake |
|---|---|---|---|---|
| 0 | `request` / `pin` | player asked / pinned | that type | no (player site) |
| 1 | `survivalFood` / `survivalWater` | max potential < need and DoH < 30 | best food producer for the coming season / well or cistern | no; ignores the saving target |
| 2 | `aestasWater` | forecast: lowest water DoH in the coming Aestas < *Water reserve* | cistern while a full store (+ one cistern) carries the Aestas deficit above the *Water reserve*, else puteus | yes |
| 3 | `hiemsStore` / `storageFull` | forecast: the Hiems need exceeds total capacity (a shortfall the stores could already hold is for the fields and hunters, not a granary); or grain ≥ 95% of cap / a material ≥ 95% of cap, while horrea/apothecae < 1 + rank — horrea beyond that while grain capacity < 2 × *Grain reserve* × need | horreum / apotheca | yes |
| 4 | `beds` | free beds + planned beds < *Spare beds* and pop < roll | house plot (partly built blocks first) | yes |
| 5 | `waterAccess` | ≥ 2 houses whose first unmet need is water | puteus (lacus once a castellum flows) covering most of them | yes |
| 6 | `evolve` | a service type is the first unmet need of ≥ 2 houses (≥ 3 for block-sized services, balnea included) | that service at the slot unblocking the most houses (greedy set cover) — *the Aedilis's top advisory, executed* | yes |
| 7 | `rank` | a building named by the next petition is missing | it | yes |
| 8 | `materials` | a resource lacking for the saving target, pending wish, renovations or Capitolium with ETA > 30 days | its producer | yes |
| 9 | `luxury` | oil demand × 1.2 > the groves' yearly yield (olivetum unlocked); demand counts T4 residents and the residents of homes whose first want is oil or wine | olivetum | yes |
| 10 | `focusPlan` | the focus's ordered `[type, count]` plan | next item | yes |
| 11 | `beauty` | *Urbs* focus only | hortus lifting the most T3 houses toward desirability 10 | yes |

**Saving target** (`savingFor`) = the petition fee (once its other requirements are met) + player plans + pins + requests + the pending wish. Renovations and Ordo spends draw only from stock above it (§7.2).

**Site scoring** (`siteScore`, memoised per type and structure epoch; −0.12 × felling work; ties by lowest index):

| Type | Score |
|---|---|
| house plot | −1.0·steps to forum + 0.5·desirability + 2·(block already has houses) + 2·(Retentura) − 3·(industry within 3 tiles) |
| services | 3·(houses whose first unmet need it satisfies) + 1·(houses newly covered) − 0.3·steps to forum + 3·district fit (templum/balneum/thermae/theatrum in Latera; taberna/macellum in Praetentura) + 5·(templum touching the forum) |
| horreum, apotheca, mansio | +3 Praetentura + 2·(block touches the decumanus or via) − 1 per house within 3 |
| well / cistern | 2·(houses newly given water access) − 0.2·steps |
| ager | 10·site − 0.4·distance to the fossa + 1.5·adjacent fields − 2·(adjacent to a house) |
| venatio, pabulatio, olivetum | 8·site − 0.3·distance |
| lignarius, lapicidina, fodina | 4·(catchment / rock / vein factor) − 0.3·distance |
| figlina, caementarium, officina, rural fabrica | 4·adjacency bonus − 0.3·distance − 1.5·houses within 4 |
| castellum | 2·houses within fountain reach − 0.2·route length |
| lacus | 2·T4 houses newly in fountain coverage + houses newly covered |

### 10.6 The Ordo explains itself
- **Ticker** (bottom-centre, one line, also carries the Acta): *"ORDO · Raising: Horreum — Hiems in 34 d, our stores hold 19 d, we keep 45 · Next: house plot (2 free beds; we keep 8) · Saving: 40 stone (≈ 9 d)"*.
- **Agenda** (top of Aedificia): the next 3 wishes with state (*staked: starts in 3 d / building 40% / saving: 40 stone ≈ 9 d / waiting for builders*) and reason; with construction manual, headed *"The Ordo would raise…"*.
- **Staffing reasons** (Populus): *"Food 14 / 16 — grain need 31/day + winter stock (612 of 900)"*.
- **Why here?** — Ordo-placed buildings store 2–3 site notes (*"beside the river (+20%)", "next to 2 fields (+10%)", "6 steps from the forum"*) and their reason (*"Raised by the Ordo for the winter store, a.d. IV Id. Iul. DCCC"*). Ordo buildings carry a small seal icon.
- **Chronicle discipline**: one Annales line per Ordo *decision* (placement, contract, emergency step, ration change); staffing moves are summarised once a month in the **Kalends ledger** line.
- Reasons are typed `{code, params}` (ARCHITECTURE §4) and rendered from templates; a **"why?"** tooltip expands the chain.

### 10.7 Trade automation (every 10 days, `day % 10 == 5`; contracts tagged *Ordo*)
1. `deficitImport`: grain when the Hiems forecast is short or grain DoH < *Grain reserve*/2 with max potential < need; cheapest open hub that sells grain; only if coin runway stays > 90 days.
2. `luxuryImport`: oil or wine when supplied houses would run out in < 60 days and local production cannot cover (repeat while needed).
3. `wishImport`: a pending wish or the Capitolium has waited > 40 days on a tradeable resource → import the shortfall (≤ 80).
4. `surplusExport`: any tradeable above max(*Trade reserve* × daily use, 95% of cap — 60% under *Mercatura*) plus pending targets → export ≤ 80 to the hub with the best `price × qty / roundTripDays`.
5. `merchantDeal`: on a merchant's last day, take offers that sell surplus at ≥ 1.1 × base or buy goods named by an active Cave/Periculum advisory, keeping coin runway > 60 days.
The Ordo never cancels or edits a player contract.

### 10.8 Council focus (*Propositum*) — free to change, steers the Ordo only

| Focus id | *Latin* / English | Build plan front-loads (`PLANS`) | Focus split of spare workers | Trade lean / special |
|---|---|---|---|---|
| `concordia` | *Concordia* / Balanced | lignarius, lapicidina, lararium, venatio, horreum, cisterna, ager ×2, figlina, taberna ×2, apotheca, olivetum, mansio, caementarium, fodina, officina, fabrica, macellum, templum, balneum | materials .35, industry .35, services .30 | balanced |
| `copia` | *Copia* / Food & growth | ager ×2, venatio, pabulatio, horreum ×2, cisterna ×2, ager ×3, olivetum, horreum ×3 | food .50, materials .25, industry .25 | spare beds +4; winter target ×1.25; imports grain early |
| `materia` | *Materia* / Materials & industry | lignarius ×2, lapicidina ×2, figlina, apotheca, caementarium ×2, fodina, officina ×2, fabrica | materials .50, industry .40, services .10 | builder share +5 points; exports materials last |
| `mercatura` | *Mercatura* / Trade & coin | taberna ×2, mansio, olivetum ×2, apotheca ×2, macellum, mansio ×2 | services .40, industry .30, materials .30 | exports from 60% of cap; treasury floor ×0.5 |
| `urbs` | *Urbs* / The city beautiful | lararium ×2, hortus ×2, taberna ×2, templum, lacus ×2, balneum | services .60, materials .20, industry .20 | beauty wishes; paves 2 busy streets a month; imports oil & wine |

### 10.9 Edicts (*Edicta*) — milestone unlocks, one change per season window

| id | *Edict* / question | Options (**default** in bold) and effects | Situational use | Unlock |
|---|---|---|---|---|
| `rationes` | *Rationes* — how much grain does each mouth receive? | *Largae*: grain need ×1.15, morale +6 · **Plenae** · *Parcae*: ×0.85, morale −6, births ×0.8 | Parcae through a famine Hiems; Largae in a full summer | M3 |
| `tributum` | *Tributum* — what do households owe? | *Leve*: tax ×0.7, morale +4, immigration ×1.1 · **Iustum** · *Grave*: tax ×1.4, morale −8, immigration ×0.8 | Grave to fund the Capitolium; Leve during unrest | M4 |
| `opera` | *Opera publica* — how hard do we push public works? | *Magna*: builders ×1.3, renovation 2× faster, morale −5 · **Solita** · *Modica*: builders ×0.85, morale +5 | Magna for the horreum before Hiems, the aqueduct, the Capitolium | M5 |
| `hospites` | *Hospites* — how are newcomers received? | *Patentes*: immigration ×1.6, fever ×1.2, morale −2 · **Cauti** · *Clausi*: immigration ×0.2, veterans ×0.5, morale +3 | Patentes after laying out plots; Clausi before a hard Hiems | M6 |
| `horae` | *Horae operis* — how long do our people labour? | *Otium*: labour ×0.9, morale +6 · **Solitae** · *Longae*: labour ×1.15, morale −10, fever ×1.3 | Longae to rush a petition; Otium to fix morale | M8 |
| `nundinae` | *Nundinae* — how often are market days held? | *Frequentes*: merchants ×2, prices ×1.05 better, morale +2, labour ×0.97 · **Solitae** · *Rarae*: merchants ×0.5, labour ×1.03 | Frequentes when trade is the plan | M9 |
| `feriae` | *Feriae* — which festivals does the colony keep? | *Frequentes*: all four festivals, morale +4, dignitas ×1.05 · **Solemnes** (Parilia, Saturnalia) · *Nullae*: labour ×1.04, morale −6, Robigalia not kept (blight ×2) | Frequentes before a petition or to cure unrest | M10 |
| `silvae` | *Silvae* — how are the woods cut? | *Caedua*: timber ×1.35, no regrowth, morale −3 · **Renovata** · *Lucus*: timber ×0.85, regrowth ×2, hunting ×1.15, morale +3 | Caedua for a building boom | M11 |
| `aquae` | *Aquae* — when water is short, who drinks first? | *Operibus prius*: industry and baths keep their full draw; concrete ×1.05 · **Populo prius**: people first; industry pauses below the water reserve · *Aequa*: proportional shares | Operibus prius once the aqueduct flows | M12 |

Rules: re-clicking the current option is a no-op; changing locks the edict until the next season's Kalends; emergency measures may override *Rationes* without touching the window. Each option's tooltip shows its effects in words and its *current measured impact* (*"Parcae: saves 4.6 grain a day; costs 6 spirits"*); every affected resource tooltip shows the effect as a tag.

### 10.10 Council settings (*Mandata Ordini*) and switches

| id | *Name* / English | Range (default) | Unlock | Read by |
|---|---|---|---|---|
| `spareBeds` | *Cubilia vacua* / spare beds | 0–40 (8) | M1 | build wish 4 |
| `grainReserve` | *Frumenti subsidium* / grain reserve | 10–120 days (45) | M3 | food base, winter stockpile, industry floor, Hiems wish |
| `builderShare` | *Fabri* / builder share | 5–40% (15%) | M5 | labour step 4 |
| `waterReserve` | *Aquae subsidium* / water reserve | 5–40 days (15) | M7 | water base, Aestas wish, industry floor |
| `tradeReserve` | *Mercatura cauta* / trade reserve | 10–90 days (30) | M8 | exports, contracts auto-pause |
| `renovation` | *Renovatio* / renovation allowance | 0–100% (60%) | M10 | renovation pool |
| `treasuryFloor` | *Aerarium* / treasury floor | 0–3,000 den (150) | M11 | every Ordo spend |
| switch `emergency` | *Lex de annona* / emergency measures | On/Off (On) | shown at M5 or first emergency | §8.12 |
| switch `governAway` | *Govern while I am away* | On/Off (On) | shown after the first away report or any toggle off | offline replay |

Before its unlock a setting uses its default and is shown only in the one-line teaser.

---

## 11. Guidance — city management as Roman counsel

### 11.1 Ten rules (acceptance criteria for every pixel of guidance)
1. **Lead with time, not units.** Grain, water and coin are stated first as days.
2. **A sentence before a number.** Advisory titles are sentences with the number inside (*"Grain runs out in 18 days."*).
3. **Cause, deadline, remedy.** Every warning names its cause and deadline and offers 1–3 executable remedies.
4. **Forecast, don't just report.** Each crunch is shown before it bites (forecast strip, seasonal forecast rules).
5. **Name people and places**, filled from state at render time (*"Put Quintus Flavius on the fields"*, *"a well by the north gate"*); never hard-coded.
6. **No survival number needs a tooltip.** Tooltips explain; they never hide danger.
7. **Every "no" has a why and a how** — disabled buttons, placement rejections, locked edicts.
8. **One voice per job.** Mentor teaches once; advisors speak while a condition holds; the Ordo states intent; dispatches summarise time.
9. **Quiet when things are well.** *Nota* never takes the card; hysteresis prevents flapping; when nothing is at *Cave* or above the card shows a calm line (*"All is well: grain 84 d, water 40 d."*).
10. **Latin labels, English meaning.** Every Latin label has an English sub-label; inscription caps (V for U) only in kickers.

### 11.2 Four voices

| Voice | Persona | Surface | Lifetime |
|---|---|---|---|
| **Mentor** (one-shot tips) | *Decimus Cassius, primus pilus emeritus* — a founding head; if he dies the kicker becomes *"From the notes of Decimus Cassius"* | the counsel card (left column) | once per colony; re-readable in the *Commentarii* codex |
| **Advisors** | six officials with portraits (§11.3) | the counsel card (top advisory) and the *Consiliarii* tab (all) | while the condition holds, with hysteresis |
| **The Ordo** | *Ordo Decurionum* (council seal) | ticker, Agenda, staffing reasons, *Why here?* | every tick |
| **Dispatches** | the Legate, the Ordo, Rome | parchment modals: Founding, While-away (*Litterae Ordinis*), Victory | event-driven |

### 11.3 The six advisors (24 × 24 portraits, 3 moods: calm / concerned / alarmed, following their worst active severity)

| id | Office | Name | Domain | Portrait cues | Appointed |
|---|---|---|---|---|---|
| `annonae` | *Praefectus Annonae* | Aulus Annius Frugi | grain, rations, horrea, winter, oil & wine for homes, famine relief | grey beard, ochre tunic, wheat-ear brooch | start |
| `aquarum` | *Curator Aquarum* | Sextus Aquilius Fonteius | water, wells, cisterns, summer forecast, aqueduct | blue-grey cloak, water jar | start |
| `fabrum` | *Praefectus Fabrum* | Titus Vibius Faber | builders, sites, labour, idle hands, materials, Capitolium flow | leather cap, soot smudge, groma pin | start |
| `quaestor` | *Quaestor* | Publius Nonius Arca | coin, upkeep, taxes, contracts, merchants | bald, toga with a thin stripe, wax tablet | Vicus, first coin advisory, or first contract |
| `aedilis` | *Aedilis* | Quintus Sempronius Lepidus | houses and evolution, beds and the roll, morale | young, toga praetexta, city-plan scroll | Vicus or a house blocked ≥ 5 days |
| `augur` | *Augur* | Servius Volusius Auspex | pending choices, petitions, omens | veiled head, curved lituus | first event card or Kal. Sept. AUC DCCC |

Unappointed advisors show as silhouettes (*"Appointed at Vicus"*). Tie order: annonae > aquarum > aedilis > fabrum > quaestor > augur.

### 11.4 Advisory model
- Rules are **pure** and evaluated **once per day inside the tick**, after the forecast, using only the shared Forecast, Census and Derived data (cheap, O(rules)). They return `{rule, severity, metric, params}`. Titles, texts, named people, best slots and hubs are resolved **lazily at render/click time**.
- **Hysteresis**: raise at the threshold; clear only past threshold × 1.25 (or the rule's explicit clear condition); severity rises at once and falls only after **3 stable days**; an advisory lives at least **3 days**; a rule may not toggle raised ↔ cleared more than twice in 60 days (tested).
- **Order**: severity, then advisor tie order, then age. *Opportunitas* (petition ready) renders gold, ranks as Monitum and never outranks *Cave*.
- **Supersede**: `annonae.famine` hides `annonae.grain.runout`; `annonae.mess` is hidden while either is active at ≥ its severity.
- **Noise control**: *Hush 30 days* on Nota, Monitum and Cave (never Periculum); *Mute rule* for Nota only. An Annales line is written only when an advisory is **new at Cave or above** or **rises** in severity. A bell (*tintinnabulum*) sounds on a new Periculum, at most once per 30 s. *Pause on Periculum* is an optional pref (default off).
- **Fixable vs structural** (rome's `maxPotential`): if every able adult optimally assigned could cover the need, the remedy is *reassign*; otherwise *build or import*.

### 11.5 Remedies — typed and pre-checked
Remedy kinds: `ask` (Ask the Ordo), `place` (placement mode with the ghost pre-positioned on the Ordo's best slot, laurel marked), `priority` (a labour category first for N days), `assign` (manual labour), `edict`, `setting`, `switch`, `focus`, `contract` (opens Commercium pre-filled: hub, goods, quantity, price and trip days already computed; one more click sends), `buyNow` (emergency/merchant purchase), `relief`, `toggleOrdo`, `building` (open/close/prioritise/centre), `open` (tab + anchor), `overlay`.
- Every remedy is pre-checked: if it cannot run it stays **visible but disabled with its reason** (*"Next edict window: Kal. Sept."*).
- Building remedies render as **two buttons** — **Ask the Ordo** and **Place it myself** — when construction automation is on; only *Place it myself* when it is off.
- The advisor-follower bot executes remedy 0 of the top advisory every 10 days (a `place` remedy executes as `ask`).

### 11.6 Rule catalogue (22 rules)
R = *runs out in* = stock / −(3-day average net) when net < 0. DoH = stock / daily need.

| # | id | Adv | Trigger / metric | Severity (clear) | Title / text | Remedies (1–3) |
|---|---|---|---|---|---|---|
| 1 | `annonae.grain.runout` | annonae | net grain < 0; R | P < 10 · C < 25 · M < 60 (R > ×1.25, or net ≥ 0 for 3 days) | **"Grain runs out in {R} days."** Fixable: *"We eat {cons} a day and gather {prod}. {idle} and {n} others stand idle; {open} places wait in the fields."* | Ordo on: Food first 30 d · manual: Assign +{k} to food · Edict *Rationes Parcae* · Contract: import grain from {cheapest} |
| 2 | `annonae.famine` | annonae | max potential < need and R < 15 | P | **"Famine looms: even every hand in the fields feeds only {pct}% of us."** | Ask/Place Ager · Buy {20 d} grain now · Relief (if eligible) |
| 3 | `annonae.hiems.forecast` | annonae | 120 days before Kal. Dec. → Kal. Mart.; lowest projected grain DoH in Hiems | P: ≤ 0 and Hiems < 45 d away · C: ≤ 0 · M: < 15 (> 18.75) | **"Hiems in {D} days: grain would run out on {date}."** / *"…our lowest would be {P} days."* *"In Hiems our fields give a third. We need about {need} in store by Kal. Dec.; we hold {stock}, with room for {cap}."* (+ *"Even full, our stores are too small."*) | Ask/Place Horreum (if capacity short) · Grain reserve → {x} · Ask/Place Venatio · Contract: import grain |
| 4 | `annonae.mess` | annonae | any group got r < 1 yesterday | P if children short, else C (3 full days) | **"Yesterday's mess: {groups} went short."** *"Watch: {names}."* | Open Populus: Watch · Buy grain now |
| 5 | `annonae.storage` | annonae | grain ≥ 97% of cap with net > 0 for 5 days, or shed rot ≥ 3/day | M; C if spill + rot > 10/day (< 90% and rot < 1) | **"The sheds overflow: {x} grain a day spills or rots."** | Ask/Place Horreum · Contract: export grain |
| 6 | `annonae.goods` | annonae | oil (or wine) for T4 houses runs out in < 30 days or supply < 90% | M; C if a house declines from it | **"Oil for the insulae runs out in {R} days."** | Ask/Place Olivetum · Contract: import {res} from {hub} |
| 7 | `aquarum.water.runout` | aquarum | net water < 0; R | P < 7 · C < 15 · M < 30 | **"Water runs out in {R} days."** (fixable/structural variants) | Wells first 30 d · Ask/Place Puteus · Pause caementarium (if it draws) |
| 8 | `aquarum.aestas.forecast` | aquarum | 90 days before Kal. Iun. → Kal. Sept.; lowest projected water DoH in Aestas | P: ≤ 0 and < 30 d away · C: ≤ 0 · M: < 10 (> 12.5) | **"Aestas in {D} days: we would run dry on {date}."** / *"…our lowest would be {P} days of water. Cisterns catch a third of their rain in Aestas and wells draw four-fifths."* | Ask/Place Cisterna · Ask/Place Puteus · Water reserve → {x} |
| 9 | `aquarum.access` | aquarum | ≥ 2 houses whose first unmet need is water | M; C if any declines for it | **"{n} homes fetch water from the river."** *"A well at {place} would reach {k} of them."* | Ask/Place Puteus (best) · Overlay Aqua |
| 10 | `aquarum.aqueduct` | aquarum | rank ≥ IV and no active castellum | M; C if the Colonia petition waits on it | **"A spring rises {dist} paces to the {dir}."** *"An aqueduct of ~{len} arches would bring 600 amphorae a day and fountains to every street."* | Place Castellum (route preview) · Ask the Ordo |
| 11 | `fabrum.labour` | fabrum | (a) idle ≥ max(3, 8% of workforce) for 5 days with no open slots (Ordo) or with open slots (manual); (b) open slots > 10% while water, food or a required service is short | (a) M · (b) C | (a) **"{n} hands idle and no work for them."** *"A {suggest} would employ {k}."* (b) **"We lack {n} hands: {cats}."** | (a) Ask/Place {suggest} · Give labour to the Ordo · Apply once; (b) Ask/Place house plots · Edict *Hospites Patentes* |
| 12 | `fabrum.stalled` | fabrum | a site waiting > 20 days for materials or builders | M; C if a petition needs it or > 40 days | **"The {site} has waited {d} days for {lacking}."** | Prioritise ↑ · Builder share +5 · Contract: import {res} |
| 13 | `fabrum.capitolium` | fabrum | Capitolium active and the stage ETA at current flow > 365 days | M | **"At this flow the {stage} rises in {eta} days; {res} is the bottleneck ({rate}/day of {need})."** | Ask/Place {producer} · Contract: import {res} · Edict *Opera Magna* |
| 14 | `quaestor.coin` | quaestor | 30-day average net denarii < 0 (R), or upkeep unpaid | P < 15 or unpaid · C < 45 · M < 120 | **"The aerarium empties in {R} days."** *"Upkeep {u} a day against taxes {t}."* / **"{n} works go unpaid and labour at half pace."** | Edict *Tributum Grave* · Contract: export {surplus} · Close {costliest optional} |
| 15 | `quaestor.contract` | quaestor | a contract auto-paused | M | by code — reserve: **"Our {res} caravan to {hub} stands idle: we keep {X} days in reserve."** · stock · denarii · storage · refused | Trade reserve −10 · Open contract · Resume |
| 16 | `quaestor.merchant` | quaestor | merchant present | N; M if an offer answers an active ≥ C advisory | **"{caravan} camps at the forum for {d} more days."** | Open Commercium: merchant |
| 17 | `aedilis.evolve` | aedilis | ≥ 3 houses meet all but one next-tier need, and it is the same need | M; C if a petition requirement depends on it | **"{n} {tier} near {place} would become {next} but lack {need}."** | Ask/Place {service} (+{k} houses) · Overlay Domus |
| 18 | `aedilis.declining` | aedilis | any house Declining | C; P if ≥ 10% of houses | **"{n} homes are declining: {need} lapsed."** *"The first falls back in {d} days."* | the remedy for that need · Overlay Domus |
| 19 | `aedilis.beds` | aedilis | (a) free beds < 2 and an arrival or birth blocked in 30 days, or anyone homeless; (b) pop ≥ roll | (a) M, C if homeless · (b) M | (a) **"No free beds: newcomers turn back at the gate."** (b) **"Rome's roll is full ({pop}/{roll} souls)."** *"Petition for {rank} to open the gates to new colonists."* | (a) Ask/Place house plots ×2 · Spare beds +4; (b) Open Edicta: petition |
| 20 | `aedilis.morale` | aedilis | morale < 50 / < 35 / < 25, or falling > 0.3/day for 10 days | M / C / P | **"Spirits are {label} ({m}): {term1}, {term2}."** | by the top negative term: Edict *Rationes Plenae/Largae* · Edict *Feriae Frequentes* · Edict *Tributum Leve* · Ask/Place Lararium |
| 21 | `augur.choice` | augur | a choice is pending | N; M when ≤ 7 days left | **"{title}: {d} days to decide."** *"If we are silent: {default}."* | Open the dispatch |
| 22 | `augur.petition` | augur | petition requirements met | *Opportunitas* (gold) | **"Rome would hear our petition for {rank}."** (+ *"The Ordo saves {lacking} (≈ {eta} days)."*) | Open Edicta: petition |

**Named-remedy helpers** (render-time): idle adults sorted by best skill for the target job; understaffed buildings; unstaffed sites; `bestSlot` covering the most affected houses; the cheapest open hub for a good.

### 11.7 Mentor tips (*Decimus Cassius*) — list order is priority; each shown once
GuideStep `{id, title, text, when, after?, until?, target?, tab?, urgent?}`; buttons **Got it**, **Show me** (switches tab, glows the target), **Hide tips** (pref). Text is filled from state.

| # | id | Title | When | After | Until | Target | Gist |
|---|---|---|---|---|---|---|---|
| 1 | `welcome` | Salve, Praefecte | always | — | — | — | *"I am Decimus Cassius, once primus pilus. The Ordo runs the camp day by day, even while you sleep. You set its course, and you may build whatever you like yourself. I will speak when something new matters."* |
| 2 | `starving` ★urgent | The bellies are empty | any group hunger > 50 | welcome | grain DoH > 20 | `#vital-grain` | *"The Ordo cuts rations before anyone starves. Raise fields, buy grain, or set rations yourself in Edicta."* |
| 3 | `thirst` ★urgent | The amphorae run dry | water R < 6 | welcome | water DoH > 12 | `#vital-water` | *"A well by the river draws best. The Curator's card has a remedy."* |
| 4 | `event` ★urgent | A dispatch arrives | a choice is pending | welcome | — | `#choice` | *"Decide before the timer ends, or the Ordo takes the cautious path."* |
| 5 | `petition` ★urgent | Petition to Rome | petition ready | welcome | rank rose | `.path-card` (Edicta) | *"Every requirement is met. The path you choose is permanent and shapes the town."* |
| 6 | `vitals` | Two numbers keep us alive | elapsed ≥ 2 | welcome | — | `#vital-grain` | *"Grain and Water, counted in days. The strip beneath each shows the year ahead: Aestas is our thirsty season, Hiems our hungry one."* |
| 7 | `ordo` | The Ordo explains itself | elapsed ≥ 5 | vitals | — | `#ticker` | *"This line says what the Ordo does and why. Disagree? Steer it in Edicta, or build yourself."* |
| 8 | `charter` | Your first decision | elapsed ≥ 10 | ordo | charter chosen | `.path-card` (Edicta) | *"By what law is this colony founded? The charter is permanent."* |
| 9 | `counsel` | Your advisors | an advisory ≥ Monitum | vitals | — | `#counsel` | *"Each advisor keeps one part of the ledger and speaks only when something needs you. Every warning comes with a remedy."* |
| 10 | `speed` | Time | elapsed ≥ 20 | charter | — | `#speed` | *"One day passes each heartbeat. Speed it up, or pause to think: Space, 1–4."* |
| 11 | `build` | Build with your own hands | Aedificia revealed | speed | player placed a building | Aedificia | *"Pick a work and a plot. Gold means a bonus; the laurel marks the Ordo's choice. Your works are raised first."* |
| 12 | `aestas` | The thirsty season | Aestas, or the Aestas forecast ≥ Cave | welcome | — | `#vital-water` | *"Cisterns catch little rain in Aestas and wells draw less. Fill the cisterns in Ver."* |
| 13 | `wants` | What a house wants | a house blocked ≥ 5 days | build | Domus overlay opened | `#overlay-bar` | *"Hover a house to see what it needs next, or open the Domus overlay. A shrine within five steps is often all it takes."* |
| 14 | `autumn` | Hiems is coming | Autumnus, or the Hiems forecast ≥ Monitum | welcome | a horreum exists and the forecast is clear | `#vital-grain` | *"In Hiems our fields give a third. Open sheds hold weeks and rot; a Horreum keeps grain for months. If grain runs low the Ordo cuts rations before anyone starves."* |
| 15 | `edicts` | Your first edict | M3 done | charter | — | `[data-guide=edicts]` | *"Edicts trade one good for another. Each may change once a season; the window opens on the season's Kalends."* |
| 16 | `reins` | Taking the reins | manual section revealed | edicts | — | `[data-guide=manual]` | *"You may take labour, building or trade from the Ordo. Leaving it all to them works just as well."* |
| 17 | `trade` | Caravans and contracts | Commercium revealed | edicts | a contract exists | Commercium | *"Far markets pay more and sell cheaper, but take longer. A standing contract repeats on its own and pauses itself if it would hurt us."* |
| 18 | `fork` | Insula or domus? | rank ≥ III and a T3 house exists | wants | — | Dignitas loci overlay | *"A stone house rises two ways: near shops and noise it becomes an insula, many hands for work; near gardens, temples and fountains a domus, few hands but rich taxes and prestige. Each house has a preference in its inspector."* |
| 19 | `aqueduct` | Water from the hills | rank ≥ IV | trade | castellum placed | Aedificia | *"Place a castellum in town; the arches find their own way from the spring."* |
| 20 | `away` | The years passed | after the first away report | welcome | — | Annales | *"Time away passes at half speed, up to five years. The Ordo kept the city and wrote you this."* |

### 11.8 Res Gestae panel (top-left)
Kicker `RES GESTAE · VII / XX` and progress (*"pop 41 / 50"*); goal text, one-line hint, meter (terracotta → gold); *"Unlocks: Hospites edict"*; a pulsing **CTA** — *"Charter: choose the founding law"*, *"Petition Rome: Oppidum"*; **danger chips generated only from Periculum advisories** (one source of truth: *Grain 6 d*, *Water 4 d*, *Unpaid works*, *3 homes declining*) plus active timed modifiers (*Robigo: one field idle, 21 d*).

### 11.9 Overlays (overlay bar + minimap; `O` cycles, Shift+O off; 1 px/tile layer at 45% alpha, smoothed)

| id | *Name* | Shows | While placing | Revealed |
|---|---|---|---|---|
| `aqua` | *Aqua* | water (light blue) and fountain (deep blue) coverage on roads and houses; ✕ on houses without water; water-table stipple; 18-tile castellum reach | wells, cisterns, castellum, lacus preview their reach | start |
| `domus` | *Domus* | houses by readiness: green all next-tier needs met, amber one missing (its want icon), red two+, grey pulsing declining | services show ↑ on houses they would unblock | first house blocked, or M1 |
| `officia` | *Officia* | selector: shrine/temple, market/macellum, baths, culture; covered roads tinted, unstaffed services ringed red | a service previews its radius | first service built |
| `desir` | *Dignitas loci* | desirability heat map, −20 red … +30 green, marks at 0 and 10 | the building's desirability footprint | M13 |
| `terra` | *Terra* | fertility (straw → gold), hills/rock, ore with vein quality, clay, timber density, springs | rural buildings auto-select it | elapsed ≥ 30 |

Placement auto-selects the matching overlay and restores the previous one afterwards.

### 11.10 Tooltips (desktop hover; touch long-press 450 ms pins a card with ✕)
- **Resource**: name and Latin; stock / cap and days (*"962 of 4,600 · 47 days on hand · room for 82 days"*); the per-source ledger from Rates (*"+ Fields ×3 (12 hands) +61.2 · + Hunting lodge +7.8 · − Eating 36 souls (Plenae) −31.0 · − Rot in the open sheds −1.4 · = +37.5 a day ▲"*); active effect tags; the seasonal outlook; **How to get more**, generated from the building registry and the hub table, with a live line (*"You have 2 Agri (11/12 hands). Next: staff 1 more, or raise a 3rd (50 den, 20 timber)."*).
- **House**: tier, residents / beds, family, tax, ✔/○ next-tier needs with distances and a remedy button per ○, renovation materials, decline countdown, preference.
- **Building**: output chain (§8.1), staff with names, site notes, coverage, upkeep, Ordo reason.
- **Date**: long Roman date, modern date, season day, next crunch, next edict window, next festival. **Morale**: every term signed, then *"rising toward 68"*. **Dignitas**: groups and the next threshold. **Edict option**: effects in words and measured impact.

### 11.11 Vital tablets and the forecast strip (HUD left — the signature widget)
- Two tablets, always visible, the largest HUD elements: **Grain** (sheaf) and **Water** (amphora). A big **days-on-hand** number, a trend arrow with net/day (*▼ −6.2*), and a red sub-line when net < 0: *"empty a.d. VI Id. Ian."*
- Beneath each, **12 month cells** starting with the current month, coloured by the lowest projected days on hand that month: green ≥ 30, gold 15–30, orange 7–15, red < 7, black empty; season initials beneath. Hover shows the 12-month line with cap and season bands. A Periculum in the domain pulses the tablet.
- The forecast is pure and computed once per day from the same formula module as the tick: for each month, projected production = (Ordo labour on) `min(maxPotential(month's season), need × 1.35)` for grain / `need × 1.10` for water, except the crunch season which uses `maxPotential`; (Ordo labour off) current staffing. Consumption = current need + industry draws; caps, shed rot and evaporation applied month by month.

### 11.12 The first ten minutes at 1× (target; asserted by the guide test with seed 42 and the decision bot)

| Real time | Elapsed / date | What happens | Guidance |
|---|---|---|---|
| 0:00 | Kal. Apr. DCCC (paused) | **Founding Dispatch** on parchment: *"To the Praefectus castrorum at Castra Valeria. Twenty-four souls of six families. Grain for 24 days, one well, one field. Hiems comes on the Kalends of December, 244 days hence: have the horrea full. Aestas comes sooner, and it is thirsty."* → **Raise the standard** | — |
| 0:01 | day 1 | The Ordo staffs the field and the well; ticker: *"Staffed the fields: grain need 20.4/day."* | tip `welcome` |
| 0:02 | day 2 | **First advisory** (Curator Aquarum, Monitum): the well gives ≈ 24/day in Ver but ≈ 19 in Aestas against 20.4 needed — *"Aestas in 59 days: our lowest would be 7 days of water."* The Ordo stakes a **Cisterna** (*aestasWater*). | tips `vitals`, `ordo` |
| ≈ 0:20 | day ≈ 20 | The cistern is finished; the forecast recovers; the advisory clears (≤ day 45). | tips `charter`, `counsel` |
| 0:20–1:00 | days 20–60 | Lumber camp, lararium, new plots; first casae near the well; M1, M3. | `speed`, `build`, `edicts` |
| 1:01 | Kal. Iun. | **Aestas**: cisterns ×0.3; the water strip turns gold. | `aestas` |
| 2:04 | day 124 | **Hiems forecast** opens (Annona): stores too small → the Ordo stakes a **Horreum**. | `autumn` |
| 2:33 | Kal. Sept. | Autumnus; the Augur is appointed; forage ×1.8; the Ordo stockpiles. | — |
| < 4:04 | before Kal. Dec. | Horreum finished (test). M4. | — |
| 4:04 | Kal. Dec. | **Hiems**: fields ×0.35; the grain tablet shows the dip the strip forecast months ago. | — |
| 5:00 | day 300 | Random events may begin (none earlier). | — |
| 5:35 | Kal. Mart. DCCCI | M5 *Weather the first Hiems*. | — |
| 7:00–12:00 | days 420–720 | Pop 50, Stabilitas, charter → **Vicus petition** (band). Quaestor and Aedilis appointed; Commercium opens. | `petition`, `reins`, `trade` |

---

## 12. Events (*Nuntii*)

### 12.1 Framework and pacing (real-time)
- `EventDef {id, kind: 'choice'|'instant', benign, harmful, weight(s), cooldown, condition}`; choices carry options with costs/gains, a written effect note, and an **explicit `defaultIndex`** (the cautious option).
- **No random events before elapsed day 300** — the first five minutes belong to onboarding.
- One daily roll with probability **1/40**; the event is drawn by weight among eligible ones.
- **Choice cards**: at most one pending; at least **200 days** between choice cards (≈ one every 3–4 real minutes at 1×); expire after **30 days** (relief 15); on expiry the default applies — if the default is unaffordable, the first affordable option after it, wrapping. The card always says *"If we are silent for {d} days: {default}."* *Slow for news* drops speed to 2×.
- **Harmful instant events**: at least **120 days** between them; fire at most once a year.
- **Clamp** (rome audit): no event removes more than 30% of any stock or kills more than 5% of the population.
- **Offline**: only `benign` events, rolled on half the days; no new choice cards except the Legate's relief (auto-accepted); a card pending before the absence resolves at expiry to its default.
- Calendar festivals are automatic toasts, never cards.

### 12.2 Catalogue

| # | id | Kind | Weight / conditions | Options (**default**) and effects | Offline |
|---|---|---|---|---|---|
| 1 | `veterani` | choice — *Veterani ad portam* | 1.0 × fx(veterans); pop ≥ 30, pop < roll, morale ≥ 55, grain DoH ≥ 30, free beds ≥ 8; cooldown 365 | 2–3 families (head 54–62, primary skill 3–4 in agri / fabri / silva / lapis, +1 with *Veterani*; 50% a secondary 1–2; wife 50–58; 0–2 children 4–14) camp as tents at the Porta Praetoria. *Grant land (missio agraria)*: 80 den per family, all join (as beds allow), morale +3 per family (max +9) · *Take only the craftsmen*: the best-skilled family joins free, morale +3 · **Send them on to Colonia Augusta**: none join, Fama +2 dignitas for 365 days. The card shows skill chips and free beds. | never spawns; resolves at expiry |
| 2 | `legatus` | choice — *Legatus Augusti* | 0.4; rank ≥ II; cooldown 1,095 | *Host a banquet*: −150 den, −20 wine (or −40 den more without wine) → Fama +6 dignitas for 5 years and the next petition fee ×0.85 · **A modest welcome**: nothing | no |
| 3 | `mutuum` | choice — *the Legate's relief* | relief ladder step 4 (§8.12) | **Accept the legion's grain**: 30 days of grain in 5 days; debt 2 × base price, repaid from 25% of each Kalends tax · *Refuse* | yes (auto-accept) |
| 4 | `pestilentia` | choice — *Pestilentia* (fever) | 0.6 × (0.5 + insula share + (1 − water-covered share) + 0.4 in Aestas) × fx(disease); pop ≥ 60; cooldown 365; harmful | 3–6% fall sick for 20 days (no work); each sick person dies with p = 0.12 × (1 − 0.5·care). *Vow to Apollo Medicus*: −100 den → deaths ×0.5, morale +3 · **Isolate the sick outside the walls**: half as many fall sick, morale −4 | no |
| 5 | `robigo` | choice — *Robigo* (blight) | 0.7 × fx(blight) × (0.5 if Robigalia kept this year); Ver/Aestas; ≥ 2 fields; cooldown 365; harmful | *Sacrifice to Robigus*: −40 den → 70% averted, otherwise as the default · **Burn the blighted field**: the best field idles 30 days, then +10% for 60 days | no |
| 6 | `siccitas` | choice — *Siccitas* (drought) | 0.6; Aestas; cooldown 730; harmful | 40 days: cisterns ×0.3, wells ×0.85. *Dig the wells deeper*: 20 stone + 30 den per well (max 300 den) → wells unaffected · **Ration the wells**: water need ×0.85 for 40 days, morale −6 | no |
| 7 | `annonaRomae` | choice — *Rome asks for grain* | 0.4; rank ≥ III; grain DoH ≥ 120; cooldown 730 | *Ship 600 grain*: +1,500 den, Fama +4 for 5 years · *Ship 200 grain*: +450 den, Fama +1 for 5 years · **Plead poor harvests**: nothing | no |
| 8 | `ignis` | instant — *Ignis* (fire) | 0.3 × min(1.5, insulae/5 + workshops/4); once a year; harmful | one insula or workshop (figlina, officina, fabrica), drawn by risk, is **damaged** for 30 days (15 inside water coverage): a house keeps half its beds (overflow homeless), a workshop stops. Flames 5 days, then smoke. | no |
| 9 | `inundatio` | instant — *Inundatio* (flood) | 0.5; Ver; a field within 2 tiles of the river; cooldown 730; harmful | riverside fields idle 20 days, then +15% for 365 days (silt) | no |
| 10 | `frigus` | instant — *Hiems dura foretold* | 0.5; Autumnus; once a year; harmful | the coming Hiems: fields ×0.8 and wells ×0.85 (Kal. Dec. → Kal. Mart.); snow on the map; the Augur announces it and the forecasts update | no |
| 11 | `latrones` | instant — *Latrones* (bandits) | on dispatch to a hub ≥ 12 one-way days: 8% × fx(bandits); harmful | the caravan loses 30% of its cargo | no |
| 12 | `nuptiae` | instant, benign — *a great wedding* | 0.6; pop ≥ 50; cooldown 365 | morale +4 for 30 days; births ×1.2 for 365 days | yes |
| 13 | `augurium` | instant, benign — *eagles fly right* | 0.5; cooldown 180 | morale +6 for 30 days | yes |
| 14 | `messis` | instant, benign — *a bountiful season* | 0.6; Aestas; cooldown 365 | fields ×1.25 for 30 days | yes |
| 15 | `mercator` | visitor, benign — *Mercator* | daily 0.012 × fx(merchants) (× 1.5 per mansio, max 2); morale ≥ 45, pop ≥ 20, none present, ≥ 60 days since the last | a striped-awning wagon parks in the forum (or at a mansio) for 30 days with 2–4 instant offers (§13.6) | only through the Ordo |
| 16 | `coloni` | instant — *the legion sends coloni* | no working adults left; once per game | two families arrive | yes |

### 12.3 Calendar festivals (automatic, by the *Feriae* edict; costs × fx(festivalCost); skipped with an Augur *Nota* if unaffordable)

| Festival | Date | Kept under | Cost per resident | Effect |
|---|---|---|---|---|
| *Parilia* | 21 Apr | Solemnes, Frequentes | 0.5 grain, 0.1 den | morale +6 for 30 days; the year's **Fasti** line in the Annales |
| *Robigalia* | 25 Apr | all but Nullae | — | blight weight ×0.5 for the year |
| *Floralia* | 28 Apr | Frequentes | 0.3 grain, 0.1 den | morale +4 for 30 days |
| *Ludi Romani* | 5 Sept | Frequentes | 0.2 den, 0.02 wine if any | morale +6 for 30 days |
| *Saturnalia* | 17 Dec | Solemnes, Frequentes | 1 grain, 0.2 den, 0.05 wine if any | morale +10 for 30 days; births ×1.2 for 90 days; masks and lanterns on houses for 7 days |
| *Lustrum* | Kal. Apr. every 5th year from AUC 805 | always | — | census windfall 0.5 den × pop; census report line |

---

## 13. Trade (*Commercium*)

### 13.1 Goods
Tradeable, base den/unit: grain 2, timber 3, stone 4, tiles 4, iron 10, oil 6, wine 8. Never traded: water, concrete, ore, tools.

### 13.2 Hubs — distance improves the price in both directions (fixing rome)

| id | Hub | One-way days | We buy at × | They pay × | Quirks | Opens |
|---|---|---|---|---|---|---|
| `metellianus` | *Vicus Metellianus* | 4 | 1.15 | 0.88 | *"Nearest hamlet: quick trips, but merchants charge a premium."* | Castra (Vicus without *Mercatores*) |
| `durii` | *Pagus Durii* | 7 | 1.05 | 0.95 | lean harvests: grain buy ×1.6, sell ×1.3 | Vicus |
| `silvanum` | *Oppidum Silvanum* | 10 | 1.00 | 1.00 | sells oil; wine buy ×1.2 | Vicus |
| `narbo` | *Forum Narbonis* | 14 | 0.92 | 1.06 | timber buy ×1.6; **will not sell iron**; oil & wine ×0.9 | Oppidum |
| `massilia` | *Portus Massiliae* | 12 | 0.88 | 1.10 | **will not sell grain**; iron buy ×1.6; timber ×1.3 both ways; oil & wine ×0.8 (cheapest wine) | Oppidum |
| `augusta` | *Colonia Augusta* | 18 | 0.82 | 1.15 | stone buy ×1.6; iron sell ×1.3 and **will not sell iron** (no buy-low-sell-high on one road); tiles sell ×1.2 | Municipium |

Trade (contracts) is usable from Vicus (from Castra with *Mercatores*, Metellianus only).

### 13.3 Prices and the market
- `buy = base × market[res] × hub.buy × quirk.buy ÷ fx(tradePrice)`; `sell = base × market[res] × hub.sell × quirk.sell × fx(tradePrice)`.
- `market[res]` eases 2%/day toward its **seasonal target**; each dispatch moves it **at dispatch** by ±0.0015 per unit (exports lower, imports raise); clamp 0.6–1.6.

| Target | Ver | Aestas | Autumnus | Hiems |
|---|---|---|---|---|
| grain | 1.15 | 0.95 | **0.80** | **1.25** |
| timber | 1.0 | 1.0 | 1.0 | 1.20 |
| oil | 1.0 | 1.0 | 1.10 | 0.85 |
| wine | 1.0 | 1.0 | 0.85 | 1.0 |
| others | 1.0 | 1.0 | 1.0 | 1.0 |

So: buy grain in Autumnus, sell it in Hiems; buy wine after the vintage.

### 13.4 Caravans
- **Slots** = 1 + 1 (Vicus) + 1 (Oppidum) + min(2, mansiones) + fxAdd(caravanSlots) (*Mercatores* +1, *Via militaris* +1); max 7.
- **Cargo** ≤ 80. **One-way** = round(max(3, hubDays + ceil(qty/40) − (any mansio ? 1 : 0)) × fx(tripDays)); round trip = 2 × one-way.
- Visible ox-carts and mule trains leave by the Porta Praetoria along the via, fade at the map edge, and reappear on return with a coin sound.

### 13.5 Contracts
`{hub, mode: export | import, res, qty, repeat, owner: player | ordo}`.
- Export: goods leave at dispatch; coin arrives on return. Import: paid at dispatch; goods arrive on return (overflow refunded pro rata).
- **Repeat** contracts re-dispatch whenever a slot is free; if a slot is not free they simply wait (*"waiting for a mule team"*).
- **Auto-pause** with a typed code, one log line on pause and one on resume (no spam): `reserve` (an export would take grain below *Trade reserve* × need, or a material below the Ordo's reservations), `stock` (not enough to load), `denarii` (cannot pay an import), `storage` (no room for an import), `refused` (the hub will not trade it).
- The form (hub → mode → good → qty → repeat) previews trip days and value live.

### 13.6 Visiting merchant
Names from rome: *Caravan from Lutetia, Syrian spice traders, Gallic cattle merchants, Pannonian iron peddlers, Greek wine factors*. 2–4 instant offers: **we buy** 10–60 at 0.85 × the regional price, **we sell** 10–80 at 1.15 ×; quantities scale with population. The Quaestor announces it. With trade automation on, the Ordo takes clearly good offers on the last day (§10.7).

---

## 14. Offline progress

| Rule | Value |
|---|---|
| Trigger | on Continue (`now − lastSave`) and on tab return (`now − hiddenAt`) when the absence is **> 60 s** |
| Rate | **0.5 game days per real second away** |
| Cap | **1,825 days** (one *lustrum*), reached after ≈ 61 min away (≈ 13% of a run) |
| Method | the real `tick()` N times with `ctx.offline = true`; `offline(N) === N ticks` (tested); sliced 30 ms per frame |
| Differences (and nothing else) | benign events only, on half the days; no new choice cards except the auto-accepted relief; pending cards resolve to their default at expiry; starvation/thirst deaths ×0.4; **no house loses a tier** (decline counters stop at 55); fires and harmful events off; merchants only through the Ordo; **Govern while away** runs manual subsystems with the Ordo; emergency measures apply if on; fx discarded; rates not accumulated |
| Stops early | on victory; `report.days` = days actually simulated |
| Presentation | a semi-transparent veil *"Anni transeunt… — the years pass"* with a progress bar; the Roman date, HUD and map visibly race underneath; **[Skip]** runs the rest synchronously (identical result) |

**The away report — *Litterae Ordinis*** (parchment modal; built from a highlight recorder: log entries tagged *highlight* / *decided*, stat deltas, and the runner's lowest-point tracker):
```
LITTERAE ORDINIS · from a.d. IV Non. Apr. to Id. Nov. AUC DCCCII   (221 days · you were away 7 min 22 s)
THE CITY      Souls 118 → 131 (+9 births, +11 arrivals, −7 deaths, −2 departed) · Rank Vicus · Spirits 61 → 76
STORES        Grain 41 → 88 days · Water 22 → 17 days · Coin 640 → 1,415 (+775)
WORKS RAISED  Horreum · 2 house plots · Lararium · Olivetum          HOMES  3 casae became casae tegulatae
DECIDED IN YOUR NAME
              · Veterans at the gate (3 families): sent on to Colonia Augusta.
              · Emergency: rations cut to Parcae for 12 days in Iul. (grain ran low).
LOWEST POINT  Water fell to 6 days on a.d. III Id. Iul.; the concrete works paused.
AWAITING YOU  ▲ Rome would hear our petition for Oppidum.  ● Oil for the insulae runs out in 24 days.
              Time away passes at half speed, up to five years.            [ Return to the city ]
```
Awaiting You lists the ready petition first, then the top 3 advisories with their buttons.

---

## 15. UI and UX

### 15.1 Desktop layout (≥ 1100 px) — the map dominates
```
┌─ HUD 64 px ──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│[aquila] CASTRA VALERIA │▌GRAIN 47 d ▼−6.2│▌AQVA 12 d ▲+3│ ⊛1,240 +17/d │ 64/72 │ ☺62 │ ✿118 │ timber stone tiles …│☼ a.d. IV Non. Apr.│❚❚ 1 2 5 10│☰│
│ VICVS · Magister vici  │ ▮▮▮▮▮▯▯▮▮▮▮▮    │ ▮▮▮▮▮▮▮▮▮▮▮▮ │ coin         │ souls │spir.│ dign.│ progressive strip   │ AUC DCCCI · Ver ▬▭ │          │ │
├────────────────────┬──────────────────────────────────────────────────────────────┬───────────────────────────────┤
│ RES GESTAE 7/20    │            [ event card · top centre ]   [ toasts ]           │ Edicta · Consiliarii ·        │
│ goal · hint · meter│                                                              │ Aedificia · Populus ·         │
│ Unlocks… [CTA]     │                                                              │ Commercium · Annales          │
│ danger chips       │                                                              │──────────────────────────────│
│ ▣▣▣▣▣▣ portraits   │                         MAP (canvas)                         │  tab body (380 px,            │
│ ┌ counsel card ──┐ │                                                              │  signature-diffed)            │
│ │ top advisory   │ │                                                              │                               │
│ │  — or a tip —  │ │                                                 [overlay bar]│                               │
│ └────────────────┘ │  [ placement banner ]                               [minimap]│                               │
│ INSPECTOR (▾)      │  ORDO · Raising: Horreum (Hiems in 34 d…) · Next: plot · Saving 40 stone   [+][−][⌂]        │
└────────────────────┴──────────────────────────────────────────────────────────────┴───────────────────────────────┘
```
- **One guidance slot**: the **counsel card** shows exactly one item, by priority: Periculum advisory › urgent tip › Cave advisory › tip › Monitum/Opportunitas advisory › calm line. Above it, a compact **portrait strip** of appointed advisors (20 px, severity pip; click opens Consiliarii filtered). When nothing is at Cave or above and no tip is due, the card collapses to the strip plus the calm line.
- **One ticker** (bottom centre) merges the Ordo line and the Acta (rotates every 6 s: current Ordo action, next wish, saving line, latest Acta line). Click → Agenda.
- **Danger chips** come only from Periculum advisories. **Toasts** only for completions (batched), house evolutions (batched), milestones, rank-ups and placement errors. Max 4.
- **Z-order**: map 0 · left column, inspector, ticker, overlay bar, minimap, zoom 14 · side panel 15 · side toggle 16 · placement banner 18 · HUD 20 · counsel card 21 · toasts 24 · event card 25 · rank banner 30 · title 60 · modals 70 · tooltip 100 · catch-up veil 200.

### 15.2 HUD (left to right)
1. **Brand**: aquila icon; colony name (click to rename, ≤ 24 chars); rank badge (`VICVS`, Silkscreen) and title (*Magister vici*); Legacy stars.
2. **Vital tablets** Grain and Water (§11.11).
3. **Coin**: *1,240 ▲ +17/d* (30-day average) or *lasts 63 d* in red.
4. **Souls**: *64 / 72* beds with a stacked life-stage bar; amber when free beds < 2; tooltip shows Rome's roll.
5. **Spirits**: face (5 moods) and number. **Dignitas**: laurel and rating; tooltip shows groups and the next threshold.
6. **Resource strip** (progressive reveal): timber, stone always; tiles when a figlina exists or stock > 0; concrete, ore, iron, tools likewise; oil, wine when unlocked or > 0. Each: 24 px sprite, amount / cap, rate; `.full`, `.flash` states.
7. **Date**: season sprite, Roman date, `AUC DCCCI · Ver`, a 3 px season bar.
8. **Speed** ❚❚ 1× 2× 5× 10×; **menu** ☰ (Esc).

### 15.3 Side panel tabs (Latin label, English sub-label; progressive reveal with a NEW sticker; badges)

| Tab id | Label | Hotkey | Revealed | Badge | Content |
|---|---|---|---|---|---|
| `council` | *Edicta* / Decisions | E | always | `!` when charter or petition is ready | Crossroads card (charter or next petition: ✔/○ checklist from `petitionNeeds()`, fee, note *Not yet / Saving / Ready*, 3 option buttons each with its effects and *visible change*) · Your story · Focus (segmented) + Ordo line · Edicts (window dates) · Settings sliders · Switches · one-line teaser of the next unlock · *Who decides the details?* (3 toggles + "would" ghost + Apply once) |
| `advisors` | *Consiliarii* / Advisors | V | first advisory ≥ Monitum | Cave + Periculum count | six portraits (silhouettes until appointed) as filters; every advisory card by severity: title, metric chip, text, remedy buttons, Hush, Mute; *"Quiet"* for advisors with nothing to say |
| `build` | *Aedificia* / Build | B | first finished building or elapsed ≥ 20 | plans waiting | **Agenda Ordinis** (next 3 wishes, state, ETA, reason; "would" in manual) · **Works queue** (stage bars, owner icon, ↑, ✕, staked: *Cancel 100% / Move*, click to centre) · tool row (Road, Pave, Reserve block, Demolish) · category chips (*Domus, Annona, Aqua, Materia, Officinae, Mercatus, Religio, Salus & Ludi, Ornamenta*) · card grid (sprite, name, footprint, built count, benefit line, cost chips red if short, *"Requires Oppidum"*; buttons **Place**, **Ask the Ordo**, **Build next**); cards two ranks ahead are hidden |
| `people` | *Populus* / People | P | elapsed ≥ 10 | idle count (manual) / Watch count (red) | stats grid (souls, beds, roll, spirits, children, elders, births/deaths per year) · housing tier histogram with *blocked by* breakdown (click → Domus overlay) · labour by category: have / target / slots with the Ordo's reason (manual: priority 1–5, ±, "Ordo would", Apply once) · Watch list · *Gentes* (families, home, veterans) · roster (60 oldest, collapsible) |
| `trade` | *Commercium* / Trade | T | Vicus, or *Mercatores* | merchant present / paused contracts | caravans in flight (return dates) · contracts (status, pause reason, owner seal, edit/cancel) · hub cards (distance, ▲▼ prices vs base, quirks, locked until rank) · merchant offers · new-contract form with live preview |
| `annals` | *Annales* / Chronicle | L | M1 | — | filter chips (All, Ordo, Works, People, Trade, Events, Advisors) · log (short Roman dates, newest first) · Fasti (one line per Parilia) · stats grid · *Commentarii* (seen tips) |

Panels rebuild only when their signature string changes; volatile text updates through updater closures every 200 ms (Hearthlands pattern).

### 15.4 Map widgets
- **Inspector** (bottom-left; hover transient, click sticky, collapsible ▾): **house** — tier sprite, family, residents/beds, preference toggle, ✔/○ needs with a remedy button per ○, renovation materials, decline countdown, Demolish; **building** — output chain, staff names, site notes, coverage, upkeep, Ordo reason and seal, Open/Closed, priority, Cancel/Move (stakes), Demolish (two-click); **block** — Reserve/Unreserve, plots free; **tile** — terrain, fertility, wood, ore quality, pomerium/territory, and the placement verdict while placing.
- **Placement banner** (bottom centre): sprite, name, cost chips, *"CLICK A GLOWING PLOT · SHIFT-CLICK TO PLACE MORE · ESC / RIGHT-CLICK TO CANCEL"*.
- **Event card** (top centre, ember border, slides down): title with Latin kicker, text, option buttons with −cost/+gain chips (disabled with reason if unaffordable), timer line with the default. Veterans show each family's skill chips and the free beds.
- **Rank banner** (non-blocking, 8 s): *"AUC DCCCVII · CASTRA VALERIA FIT OPPIDVM"*, path, unlock chips, meander frame.
- **Minimap** (bottom right, 224 × 168 = 2 px/tile): whole map, active overlay mirrored, viewport rectangle, click/drag to pan; hidden < 1100 px and while placing. **Overlay bar** beside it (5 toggles + Officia selector + legend). **Zoom** +, −, ⌂ (centre on forum).

### 15.5 Modals and dispatches (modals pause the sim)
- **Parchment dispatches** (light, *letters*): **Founding Dispatch** (new game), **Litterae Ordinis** (away report), **Victory**. Parchment `#eadfc4`, ink `#2b1e15`, code-drawn meander border, red wax seal sprite. *Letters are light, instruments are dark.*
- **Utility modals** (dark): Menu (Resume · Save · How to play · Export/Import · Sound + volume · Tips on/off · Slow for news · Pause on Periculum · Save & quit to title · Abandon with two-click confirm) · Export/Import (base64 textarea, Copy, Load) · Rename · How to play (5 sections: *You decide, the Ordo acts* · *Grain and water in days* · *Build where you like* · *Seasons and the two crunches* · *Time away*).
- There is no defeat modal.

### 15.6 Title screen
The live map of the save (or a fresh seed) drifts behind the title. Logo **CASTRA·VALERIA** in Silkscreen with a terracotta extrusion (`0 4px 0 #8a3b13, 0 8px 0 #0a0710, 0 0 40px rgba(242,201,76,.35)`) and a bobbing aquila; kicker `AB CASTRIS AD COLONIAM`; subtitle *From a legion's camp to a colonia of Rome*. Buttons: **Continue** (*"Castra Valeria · Vicus · Id. Mai. AUC DCCCII · 64 souls"*), **Found a new colony** (two-click confirm when a save exists; shows Legacy), **How to play**, **Import a save**. The **Fasti coloniarum** list if any colony is finished. Footer: *"An idle Roman city · saves automatically · v1.0"*. An unreadable save shows an explanation and an *Export raw save* button.

### 15.7 Mobile (< 900 px; compact < 560 px)
- HUD row 1: grain, water, coin, souls, spirits (no strips) + speed; row 2: date + scrolling resources.
- Side panel → **bottom sheet** (46 vh, collapses to its tab bar). Res Gestae shrinks to one line + CTA; the counsel card collapses to a portrait chip that expands on tap; inspector floats above the sheet; minimap hidden (overlay button stays).
- **Long-press 450 ms = tooltip** (pinned card with ✕). Placement: first tap previews (ghost, verdict, bonus), a **Place** button confirms. Drag pans; pinch zooms with accumulated, eased zoom snapping to integer scales. Touch targets ≥ 44 px.

### 15.8 Controls
Space pause · 1–4 speeds · E/V/B/P/T/L tabs · O cycle overlay, Shift+O off · R road tool · H centre on forum · WASD/arrows pan · +/−/wheel zoom (accumulated deltas) · Shift-click place more · right-click or Esc cancels · Esc chain: modal → placement → selection → menu. Keys are ignored in inputs. Tabs carry `aria-selected`; modals trap focus.

---

## 16. Art direction

### 16.1 UI chrome tokens (Hearthlands construction, warm Roman umber; Hearthlands' orange kept as the selected accent)

| Token | Hex | Token | Hex |
|---|---|---|---|
| `--bg` | `#15100d` | `--ember` (selected, primary accent) | `#f0a04b` |
| `--panel` | `rgba(36,26,22,.95)` | `--ember-2` | `#d9652b` |
| `--panel-solid` | `#241a16` | `--gold` (aurum) | `#f2c94c` |
| `--panel-2` | `#2c201b` | `--terra` (terracotta) | `#c0623f` |
| `--panel-3` | `#3b2a22` | `--purple` (petitions, paths) | `#7a2e5e` |
| `--line` | `#5c4334` | `--good` (laurel) | `#9ccc5a` |
| `--line-2` | `#7d5b44` | `--bad` | `#e5554a` |
| `--text` (marble) | `#f4ead6` | `--water` | `#62b0d6` |
| `--muted` | `#bba58b` | `--dim` | `#806b57` |
| `--sev-0` Nota | `#8fa3b5` | `--sev-1` Monitum | `#f2c94c` |
| `--sev-2` Cave | `#e3843a` | `--sev-3` Periculum | `#e5554a` |
| `--parchment` | `#eadfc4` | `--ink` | `#2b1e15` |

- Panels: 2 px solid borders, radius 6, hard outer ring `0 0 0 2px #0a0710`, inset 2 px highlights, `backdrop-filter: blur(3px)`. Buttons: bevelled gradients; `.btn.primary` ember → ember-2; `.btn.legate` Tyrian purple gradient for petitions; `.btn.good`, `.btn.danger`. Inset wells `rgba(0,0,0,.24)` with 2 px `#2b1f18` borders.
- Major frames (modals, Crossroads card, rank banner, title) use a **code-drawn meander (Greek key) `border-image`** from a 12 × 12 sprite.
- **Fonts**: Pixelify Sans 400/600 (body, 15 px base) and Silkscreen 400 (kickers, labels, numbers, inscriptions), bundled with @fontsource. Kickers in inscription caps with V for U (`CONSILIVM`, `RES GESTAE`, `NVNTIVS`). Font smoothing off; `image-rendering: pixelated` on sprites and the map.

### 16.2 Map palette
Sprite palette = Hearthlands `PAL` with the outline `k` changed to umber `#1d1410` (`K` `#3b2a25`), plus Roman keys: `u` terracotta `#c0623f` · `v` dark terracotta `#8a3d2b` · `a` travertine `#efe8d8` · `i` marble shade `#d2c7b2` · `s` ochre plaster `#d9a35b` · `F` Pompeian red `#9e2f25` · `I` Tyrian purple `#6a1f4a` · `N` bronze/gilt `#c99a3b` · `O` tufa `#b8a582` · `Q` tufa shade `#8e7c5e` · `M` mosaic/impluvium blue `#3d7fa6` · `V` olive leaf `#7d8a46` · `Z` cypress `#24402c` · `X` basalt `#55565e`. Light from the top-left; 1 px `k` outline on every object; placeholders `S`/`A`/`U` (tunic, hair, trousers) recoloured per instance and given defaults for icons.

**Ground by season** (Mediterranean; snow only during *Hiems dura*):

| Terrain | Ver | Aestas | Autumnus | Hiems |
|---|---|---|---|---|
| grass | `#6fae4a` | `#b5ab5a` | `#93924a` | `#6f8a62` |
| meadow / loam | `#5f9e3e` | `#8fae48` | `#8a8a44` | `#62805a` |
| scrub | `#9aa35a` | `#c4b06a` | `#a8975a` | `#8a8a66` |
| hills | `#8a9a5a` | `#a99a62` | `#94865a` | `#7d8068` |
| rock / crag | `#9a968a` | `#a8a296` | `#9a948a` | `#8a8a86` |
| river | `#3f86b8` | `#4a90bf` | `#3f80ad` | `#3a7095` |
| oak canopy | `#4f9a3a` | `#5b8f35` | `#c0702e` | `#55684f` |

Other: cypress and umbrella pine `#24402c` / `#3d6b3a`; dirt road `#9b7a52` edge `#6f5639`; paved basalt `#5c5d66` edge `#3f4048` speckles `#77787f`; forum travertine `#d8ceb6`; survey chalk `#efe8d8` at 60% alpha with peg dots; fossa `#4a3a2a`; river foam `#cfe6f5`. Ground chunks get the Hearthlands per-pixel hash dither (±8% on 20% of pixels) and baked water ripples.

### 16.3 Sprite inventory (w × h px; buildings bottom-aligned and centred on their footprint, overhanging upward)

| Group | Sprites |
|---|---|
| Houses (2×2, 32 wide; 2 variants each by hash) | tentoria 32×20 (red legion tents) · casa 32×24 (thatch) · casa tegulata 32×26 (**terracotta roof**) · domus parva 32×30 (stone, 2 storeys) · insula 32×44 (3 storeys, balconies) · insula aquae 32×52 (4 storeys) · domus 32×30 (atrium with blue impluvium) · domus aquae 32×30 (fountain in the peristyle) · overlays: renovation scaffold 32×32, cracked plaster 32×24, Saturnalia lanterns |
| Forum (9×9, procedural) | stage 0 tents and standards · 1 timber principia · 2 stone forum and colonnade · 3 basilica and curia · 4 marble, statues |
| Civic (4×4 = 64 wide; 4×2 = 64 wide) | templum 64×72 (pediment, `N` acroteria) · macellum 64×56 (tholos) · balneum 64×52 (domes, steam) · thermae 64×64 (big domes) · theatrum 64×56 (procedural cavea) · horreum 64×40 (buttressed) · apotheca 64×36 · mansio 64×40 |
| Plot buildings (32 wide) | lararium 32×28 · taberna 32×28 (striped awnings) · puteus 32×22 (well with trough) · cisterna 32×22 · castellum 32×32 · lacus 32×24 · hortus 32×24 · fabrica 32×30 (forge glow) |
| Rural | ager 48×48 procedural furrows by season + farmhouse · olivetum 48×48 olive rows · lapicidina 48×40 cut terraces · venatio 32×26 (antlers) · pabulatio 32×22 (baskets) · lignarius 32×26 + log pile · figlina 32×28 (kiln dome, smoke) · caementarium 32×26 (mixing pits) · fodina 32×28 (adit, spoil) · officina 32×30 (shaft furnace glow) |
| Capitolium (9×4 = 144 wide, procedural) | podium · cella · colonnade · pediment, crowned by the path's group (quadriga / aquila / she-wolf); the altar marker before it begins |
| Linear | roads (procedural autotile: dirt, paved basalt with kerbs) · staked streets (chalk + pegs) · vallum (earth bank + palisade) and murus (tufa + crenels) autotile 16×24 · gatehouses 48×40 timber/stone · fossa (ground) · aqueduct autotile 16×28 (arches E–W, piers N–S, blue channel; taller over low ground) · via bridge 16×16 · edge milestone 6×10 |
| Actors (visual only, ≤ 220 walkers, 120 on mobile, hash-sampled) | person 7×10 (idle, walk ×2, work) with tunic = labour category colour and carried goods · child 5×6 · elder (white hair) · patrician in white toga · legionary 9×12 (rank-up march) · priest · ox-cart 20×12 · mule train 24×12 · merchant wagon 24×14 (striped awning) · veteran tents 16×10 · plough ox (pomerium ceremony) · birds, sheep, river fish |
| Icons 12×12 | 12 resources · 5 spirit faces · laurel · 4 seasons · 12 wants · Ordo seal · plan ⌛ · stake groma · CLAVSVM plank · unpaid coin · unstaffed pip · request star |
| Portraits 24×24 | 6 advisors × 3 moods (palette/mouth-row swaps) · mentor (and a sepia "notes" variant) |
| Frames | meander 12×12 border tile · wax seal 16×16 · aquila logo 32×32 · favicon SVG |

### 16.4 What visibly matures (core checklist)
1. Roofs: thatch → terracotta (T1 → T2). 2. Houses rise from 1 to 4 storeys. 3. Forum stages 0–4. 4. Palisade → stone murus; timber → stone gatehouses (Oppidum). 5. Streets staked → dirt → paved cardo/decumanus (Oppidum) and more (Urbs, brush). 6. The via paved with milestones (*Via militaris*). 7. Aqueduct arches stride in (Municipium). 8. Fountains sparkle. 9. Bath steam, kiln and bloomery smoke, temple incense. 10. Fields ring outward, olive groves on the hills. 11. Woods recede. 12. Walker crowds thicken; patrician togas appear. 13. The Capitolium rises in four stages.
**Construction feedback**: groma pegs → trench → scaffold and `rise()` → dust, stars, pennant. **Evolution feedback**: scaffold flash, floating *"+Casa tegulata"*, *tink*. **Kalends**: gold coins rise over the forum.

---

## 17. Audio (WebAudio synthesis, no files; master gain 0.22 × volume; 70 ms per-sound throttle)
- Kept from Hearthlands: `click`, `place`, `build` (G–C–E), `birth`, `death`, `discover`, `event`, `error`, `victory`.
- New: `coin` (two triangle blips 1320 → 1760 Hz: Kalends taxes, caravans, merchants) · `cornu` (sawtooth 196/262/330/392 Hz through a 1.2 kHz lowpass, 0.9 s: rank-up, Capitolium stages) · `lyre` (plucked triangle arpeggio 392–494–587–784 Hz: milestone, tip) · `tink` (square 1046 Hz 40 ms: house evolves, batched) · `crackle` (band-passed noise bursts: fire) · `splash` (noise lowpass sweep: aqueduct, fountain) · `tintinnabulum` (triangle 1568 + 2093 Hz, short decay: new Periculum, ≤ once per 30 s) · `gate` (wooden thud + bells: arrivals, merchants, veterans).
- Prefs: sound on/off and a volume slider. No music in the MVP.

---

## 18. Numbers

### 18.1 Starting state (day 90, Kal. Apr. AUC DCCC, paused under the Founding Dispatch)

| Item | Value |
|---|---|
| People | the roster of §6.2 (24; 13 adults, 3 youths, 8 children); 6 families |
| Houses | **6 tentoria plots (30 beds)**: the 4 plots of the Retentura block west/east of the forum in block row 1 (the side away from the Porta Praetoria) and the 2 forum-side plots of the block below it (row 2) |
| Buildings | principia (stage 0); **1 puteus** on a remaining plot of that row-2 block; **1 ager** on the best loam site in Castra territory (the Ordo's site score); vallum, fossa and 4 timber gates; all castrum streets (dirt); the Via Valeria with its bridge; the altar on the Area Capitolina |
| Jobs | Marcus Valerius on the ager; Lucius Antonius and Titus Flavius at the well (the Ordo re-plans on day 1) |
| Stocks | denarii **600** · grain **480** (cap 600 → 23.6 days) · water **240** (cap 300 → 11.8 days) · timber **80** · stone **40** · tools **4** · others 0 |
| Meters | morale 65 · fed index 1.0 · dignitas ≈ 5 |
| Ordo | labour, build and trade on (trade inert until Vicus unless *Mercatores*) · focus *Concordia* · settings at defaults · emergency and govern-away on |
| Advisors | Annonae, Aquarum, Fabrum appointed |
| Market | all 1.0, easing toward the Ver targets |

### 18.2 Opening arithmetic (verify in `balance.ts` tests)
- Need 20.35 grain and 20.35 water per day. Productivity at morale 65 = 0.85 + 0.30·0.65 = 1.045.
- **Water**: 2 well workers (aqua 1) × 11 × 1.045 × 1.04 ≈ **23.9/day** in Ver (net +3.6). In Aestas ×0.8 → 19.1 (net −1.2, evaporation −0.6). From a full 300 at Kal. Iun. the projected lowest is ≈ 135 → **≈ 7 days on hand → Monitum** on day 2, below the 15-day water reserve → the Ordo stakes a **cistern** (+400 cap, 9.6/day in Ver, 2.4 in Aestas), after which the Aestas lowest stays above 12.5 days and the advisory clears.
- **Grain**: ager site ≈ 1.4 (loam + river) → 6 × 1.4 × 1.045 ≈ 8.8 per worker (Marcus +8%). Grain DoH 23.6 < reserve 45 → food base 1.2 → 3 workers ≈ 27/day (net ≈ +6.6). The sheds fill in ≈ 18 days, then base 0.85.
- **First Hiems**: a full field gives 6 × 8.8 × 0.35 ≈ 18.5/day against a need of ≈ 30 (pop ≈ 36 by Kal. Dec.): −11.5/day × 90 ≈ −1,035 plus rot, more than the 600-grain sheds hold. The Hiems forecast opens on day 124 → the Ordo stakes a **horreum** (+4,000) and a **venatio** (≈ 13/day in Hiems); the Autumnus stockpile (6 field workers ≈ 47/day vs 28 need) fills the horreum. The test asserts the horreum is finished before Kal. Dec. (elapsed 244).
- **Builders**: 2 + 0.3 per idle adult ≈ 3 work/day: the cistern (25) finishes ≈ 13 days after its 5-day stake.
- **Coin**: 600 + 3/day subsidy + ≈ 0.6/day taxes − ≈ 450 of first-year works → ≈ 1,000 at the Vicus petition (fee 250 den + 100 timber).
- **Growth**: 0.014 households/day × attract ≈ 0.95 × 3 souls (Rome's call) ≈ 0.04/day → +24 by day 600, + ≈ 2 births → ≈ 50 (seeds 46–54).

### 18.3 Key constants (`balance.ts` names in ARCHITECTURE §7; every number in this file is mirrored there)
Time: SPEEDS [1,2,5,10] · START_DAY 90 · OFFLINE_RATE 0.5 · OFFLINE_MAX_DAYS 1,825 · OFFLINE_MIN_MS 60,000 · AUTOSAVE_S 20 · STAKE_DAYS 5 · EVENT_START 300 · EVENT_CHANCE 1/40 · CHOICE_GAP 200 · HARMFUL_GAP 120 · CHOICE_DAYS 30.
Map: W 112 · H 84 · TILE 16 · PITCH 5 · CASTRUM 31×21 · TERRITORY [20,26,34,44,999] · rings by rank [0],[0,1],[0,1,2]…
People: NEED child .6 youth .85 adult 1 elder .75 · BIRTH 0.09/yr · MARRY 1/400 · IMM_RATE [0.014,0.011,0.0075,0.003,0.04] · RENOWN Vicus 1 + 1.25 × (dignitas / 40 − 1), ≤ ×2 · CEILING [100,260,560,900,1500] · POP_CAP 1500 · SKILL_XP 0.004 · SKILL_BONUS 0.04 · ELDER_OUT 0.7 · RETIRE 65.
Economy: MULT_CAP 2.5 · PRODUCTIVITY 0.85 + 0.30·m · TOOL 1.2 × 120 d · IDLE_FORAGE 0.3 · IDLE_BUILD 0.3 · SHED_ROT 0.003 (×2 Aestas) · EVAPORATION 0.002 · HORREUM 4,000.
Housing: OK_DAYS 15 · RENOVATE_DAYS 8 · DECLINE_AFTER 20 · DROP_AFTER 60 · OFFLINE_DECLINE_STOP 55 · THROTTLE 1 + houses/8 per 10 d · DESIR_DOMUS 10.
Ordo: BUILD_EVERY 2 · TRADE_DAY 10/5 · SITES 1 + workforce/40 (max 4) · FOOD_CAP .75/.90 · BUILDERS_MAX .30 · CAP_CREW 64.
Advisors: CLEAR ×1.25 · DOWNGRADE 3 d · MIN_LIFE 3 d · HUSH 30 d · BELL 30 s.

### 18.4 Target curves (decision-only bot, medians over seeds [1, 2, 3, 42, 1337])

| Real 1× | Elapsed | AUC | Pop | Houses T0/T1/T2/T3/T4i/T4d | Notable |
|---|---|---|---|---|---|
| 0 | 0 | DCCC | 24 | 6/0/0/0/0/0 | founding |
| 2 min | 120 | DCCC | 30 | 4/3/0/0/0/0 | cistern, lumber, lararium |
| 5.5 min | 335 | DCCCI | 42 | 2/5/0/0/0/0 | horreum, first Hiems weathered |
| 10 min | 600 | DCCCII | 55 | 1/7/0/0/0/0 | **Vicus** |
| 25 min | 1,500 | DCCCIV | 120 | 1/8/6/0/0/0 | figlina, tabernae, caravans |
| 45 min | 2,700 | DCCCVII | 190 | 1/7/13/0/0/0 | **Oppidum** |
| 1 h 15 | 4,500 | DCCCXII | 300 | 0/4/12/8/1/1 | templum, macellum, balneum, iron |
| 1 h 45 | 6,300 | DCCCXVII | 410 | 0/3/10/12/4/2 | **Municipium** |
| 2 h 30 | 9,000 | DCCCXXIV | 580 | 0/2/10/15/9/5 | aqueduct, thermae |
| 3 h 18 | 11,900 | DCCCXXXII | 720 | 0/2/10/18/13/7 | **Colonia**; Capitolium begun |
| 3 h 58 | 14,300 | DCCCXXXIX | 1,050 | 0/3/10/20/22/12 | **Capitolium dedicated** |

Treasury net (den/day): Castra +3 · Vicus +6–10 · Oppidum +12–25 · Municipium +30–50 · Colonia +40–80.

**Bands** (assertions): Vicus 420–780 · Oppidum 2,100–3,400 · Municipium 5,000–7,600 · Colonia 9,800–14,000 · victory 12,000–17,500 · Capitolium phase 1,800–3,000 days, each stage 350–900 · pop at victory 900–1,400.

### 18.5 Balance-bot and contract assertions (headless vitest)

| Test | Assertion |
|---|---|
| **opening** (always) | 5 seeds × 4,000 days: min pop ≥ 20 after day 30; Vicus and Oppidum inside their bands |
| **full** (`BAL_FULL=1`) | Municipium, Colonia, victory, Capitolium phase and stage bands |
| **undecided** | no decisions at all, Ordo on, 3,000 days: pop ≥ 20, rank Castra, pop ≤ 125 |
| **hunger** | in every Ordo-only run, hunger + thirst deaths ≤ 5% of the average population in every 365-day window |
| **advisor-follower** | decision bot + every 10 days applies remedy 0 of the top advisory: each rank no later than decision-only + 10% |
| **builder** | decision bot + every 5 days places every Aedilis/Fabrum build remedy at its best slot as a player site: Oppidum ≥ 10% sooner (median) |
| **neglect** | all three Ordo toggles off, no input, 20 years: no crash, no NaN |
| **offline safety** | from the bot's snapshot at each rank: a capped offline run keeps pop ≥ 90% of the start, 0 tier drops, treasury ≥ min(start, floor) |
| **no deadlock** | over every bot run, renovation and construction each progress at least once in every 120-day window while both have work |
| **guardrails** | no event takes > 30% of a stock or > 5% of pop (property test over 2,000 forced events); treasury never negative; never at 0 for > 60 consecutive days with the Ordo on |
| **determinism** | two 2,000-day runs serialise identically; save → load → continue equals never saving; `offline(N) === N` ticks; 200 s away = exactly 100 days; 24 h away = 1,825 |
| **guidance** | §11.12 beat sheet; tip ids unique, every `after` exists, `welcome` first, `vitals` before day 10; every rule returns ≥ 1 remedy and `checkRemedy` never throws over a 2-year run; no rule flaps > 2 times in 60 days; every tab revealed within 4,000 days |
| **performance** | tick ≤ 1.5 ms median at pop 600 (node); a 1,825-day offline run ≤ 6 s |

---

## 19. Cut list and stretch list

**Cut (decided — do not build)**: amphitheatrum, arcus, gladiators; marble; bread chain and the pietas meter; vinea (wine is import-only); raids, Centurio, turris, defence, Dilectus/Praesidium, Limitanei, the Murus project; stone bridges, the player bridge tool, a third road level and per-hub road upgrades; per-rank plot allotments, villa rustica, river port and barges, a second via; the compressed calendar; spent dignitas; legacy heirlooms and lineage; Mandata; per-tile depletion of hills and ore; game herds; hill levelling; Tabularium sparklines and history notes; the full Designatio painting tool (replaced by the house preference toggle and the Reserve-block tool); temple deities; overlays beyond five; a separate health meter; fire as a simulation, vigiles and the Ignis overlay; T5 tiers; medicus, statua, pistrinum, posterula; rotation and drag-to-place rows; any renewal that demolishes or moves buildings; barter contracts; music.

**Stretch (only after the core is integrated, in this order)**: tombs along the via (every 6th death); drag-to-place rows of plots; glowing insula windows on Hiems evenings; tip-codex history notes; T5 *insula magna / domus magna*; an ambient seasonal drone; a second castellum on a second spring; hub price sparklines; barter.

**If over budget, cut from the top**: theatrum (Colonia then needs thermae only) → pabulatio (idle foraging gets the Autumnus ×1.8) → lacus (castellum fountain radius 6) → mansio (slots from ranks only) → olivetum (oil import-only) → forest depletion (static wood density) → the aquae variant → the paving brush.

**Never cut**: the survey grid with plots and blocks; houses T0–T4 with the fork and want icons; road-BFS coverage; grain and water in days with horrea and the two crunches; vital tablets with the forecast strip; the Ordo with stakes, reasons and three toggles; six advisors with the 22 rules and typed remedies; mentor tips; Res Gestae; nine edicts; charter + four paths; offline replay with *Litterae Ordinis*; the five overlays; ≥ 10 events including the veterans; six hubs with contracts; `rise()` construction; the Capitolium set piece.

---

## 20. Decision log (judges' must-fix items → resolution)

| Item | Resolution |
|---|---|
| Base | *Builder* proposal, with the steward's guidance layer and the idle proposal's contract tests grafted in. |
| Player vs Ordo | Ordo stakes (5 days, cancel 100% / move); player sites first in the queue; Ordo counts all coverage, never demolishes/moves/converts; modest cadence; beautification, fork and extra culture left to the player; builder-persona test (§10.3, §18.5). |
| Calendar | real Julian 365-day calendar, aging on it, edict windows on season Kalends (§2). |
| Arc and scale | ≈ 4 h at 1×, ≈ 1,050 people at victory, cap 1,500 (§2.3, §18.4). |
| Finale | Capitolium crew cap 64 + gradual materials; 30–45 min; stage bands asserted (§9.5). |
| First rank-up | Vicus at 7–13 min with pop 50, first Hiems, horreum, Stabilitas (§9.1). |
| Devolution | Declining after 20 days, one-tier drop after 60 more, never offline (§7.3). |
| No-decision stall | Rome's roll (immigration ceiling per rank), not a plot allotment; building is never capped (§6.6). |
| Pomerium geometry | interior → Ring 1 (Vicus) → Ring 2 (Oppidum, final); loam masked; no farm demolition; map guarantees (§3.3–3.5). |
| Coverage | BFS over built road tiles in integer steps; paving is cosmetic + desirability (§7.4). |
| Event cadence | no events before day 300; ≥ 200 days between cards; ≥ 120 between harmful events; slow for news; explicit defaults (§12.1). |
| Names | unique ids for tabs, toggles, focuses, edicts, advisors and hubs (ARCHITECTURE §4). |
| UI density | one counsel card, one ticker, chips from Periculum only, toasts for completions/milestones (§15.1). |
| Guidance volume | 22 rules, 20 tips, no Mandata (§11). |
| Storage | fixed units shown as days; sheds rot (§4, §8.6). |
| Relief | one ladder: rations → industry pause → emergency import → Legate's relief; ≤ 5%/year test (§8.12). |
| Rank verbs | one new system per rank (§9.1). |
| Walls | palisade → murus sprite swap at Oppidum (§3.4). |
| Dignitas | a rating, never spent (§8.11). |
| Offline | 0.5×, 1,825-day cap, govern while away, Litterae Ordinis (§14). |
| GitHub Pages | `base: './'`, @fontsource, namespaced keys `castravaleria.*`, CI + Pages workflows (ARCHITECTURE §2). |
