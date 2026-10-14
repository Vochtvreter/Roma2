# Economy review: tool kits, sinks and new goods (proposal)

Status: **proposal for review**, not yet part of `DESIGN.md`. Nothing in the game changes until the owner accepts a
phase; then its numbers move into DESIGN.md and `balance.ts` as usual. The screen it proposes, *Copiae*, is drawn on a
Claude Design canvas (§6), not built.

The question: the tool kits used to speed up building in the old game, but building here is never slow; stores keep
hitting their caps, so the player sets up trade routes just to dump the surplus; and after the opening, coin stops
mattering. What should the tool kits be, and what should the surplus and the coin buy?

---

## 1. What the bots measured

`npm run economy` (new: `tests/economy.test.ts`) plays a whole game headless and prints, per rank, where the coin comes
from and goes, how full every store sits, what spills, how much of the builders' capacity is used, the idle hands, the
tool kits and Rome's favour. Below: the attentive-player bot (`active`, DESIGN §18.5) on seed 42, to the dedication.
Seed 1 gives the same picture within a few percent; the Ordo alone (`decision`, seed 42, 25,000 days) is worse on every
line.

| | Castra | Vicus | Oppidum | Municipium | Colonia |
|---|---|---|---|---|---|
| days in the rank | 653 | 2,205 | 4,126 | 2,786 | 2,143 |
| souls (mean) | 37 | 111 | 276 | 541 | 1,103 |
| coin when the rank opens | 600 | 2,158 | 20k | 107k | 275k → **523k** at the dedication |
| net coin a day (DESIGN §18.4 target) | +2.4 (+3) | +8.1 (+6–10) | +21 (+12–25) | **+60** (+30–50) | **+115** (+40–80) |
| materials ≥ 95% of cap, share of days | 91–93% | 93–97% | 59–87% | 77–96% | 16–79% (the Capitolium draws) |
| water spilt a day | 13 | 38 | 142 | 308 | 231 |
| idle adults (mean) | 7 | 29 | 12 | 87 | 173 |
| builders' capacity used | 32% | 3% | 26% | 4% | 1% |
| days from placing a site to done | 8.9 | 4.4 | 6.1 | 3.9 | 3.3 |
| staffed tool works carrying a kit | 15% | 0% | 99% | 100% | 100% |
| Rome's favour (cap ×3) | ×2.93 | ×3.00 | ×3.00 | ×3.00 | ×3.00 |

The whole game's coin (seed 42): **earned ≈ 990k**. Spent: upkeep 263k (27%), the Capitolium 128k (13%), imports 45k
(5%), festivals 4k, and every work, renovation and petition fee together ≈ 29k (**3%**). **Unspent at the dedication:
523k (53%).** The four petition fees together are 8,650 den; the treasury holds more than twice that when the Oppidum
opens.

The Ordo alone (seed 42) holds 7.7k when the Vicus opens, 74k at the Oppidum, 322k at the Municipium and 760k at day
25,000; its idle adults climb 11 → 48 → 103 → 192, and its builders use 1–4% of their capacity. Its Rome's favour stays
×1.0 until the Oppidum, as designed.

## 2. Diagnosis

1. **Building is never the bottleneck, so the build kit buys nothing.** Idle adults add 0.3 work each (`IDLE_BUILD`), and
   there are more of them every year: at the Municipium 87 idle adults pour ≈ 26 work a day into whatever site is open,
   enough for a templum (200 work) in eight days with no builder at all. A site is done 3–9 days after it is placed, five
   of those days the Ordo's stake. A kit lasts 120 days; the site it is issued to lasts three. Four levers are dead with
   it: the build kit, *Colonia veteranorum*'s builders ×1.25, *Opera Magna*'s builders ×1.3 and the *Builder share*
   setting.
2. **The tool kit is a free, permanent +20% with no decision.** There are none for the first hour (the smithy opens at the
   Oppidum and kits are never traded). Then one smithy with two hands (0.8 kits a day, each lasting 120 days) keeps
   about 96 works kitted, and 99–100% of them are. It is issued automatically, costs 2.5 iron and 2.5 timber a kit, and
   boosts output that is already spilling.
3. **The stores sit full and the hands sit idle.** From the Vicus on every material is at its cap most days. The
   colony *needs* under 2 stone, timber or tiles a day on average through the Oppidum and Municipium, so the Ordo
   staffs the quarries and camps lightly and the rest idle. A colony run by hand has no such throttle: its stores hit the
   cap sooner and spill, and the only outlet is exports, one contract at a time, which is the routine the owner noticed.
4. **Coin has nothing to buy.** Every coin lever (Tributum, Nundinae, merchants, exports, *Mercatura*, *Canabae*, the
   mansio) goes dead after the Vicus, because after it nothing costs enough to matter: the nets above run past their
   §18.4 targets from the Municipium and compound with nothing to spend them on.
5. **Rome's favour, the strongest growth lever, costs a garden.** Favour = 1 + 4 × splendour per home, capped at ×3,
   and a garden (15 den, 4 timber) gives 0.5 splendour. One garden per home holds the cap from the first year. Most of the
   "playing pays 2½–3×" gap (§1.4) is bought for pocket change.

**The root cause is one thing: demand does not grow with the town.** A house that has reached its tier only eats grain
and drinks water (an insula or domus adds 0.05 oil, a domus 0.05 wine). Works and renovations are paid once. The only
steady sink is upkeep, about a quarter of all income (18–41% by rank). So the surplus spills or is exported, the coin piles up, and a buff to output
or to building speed buys nothing, because neither is short.

## 3. Goals

- **Demand that grows with the town**: recurring use of goods by homes, so production, labour and trade stay live into
  the Colonia.
- **Sinks that pay in progress, never in more of the same**: colonists (Rome's favour), tiers that rise and stay,
  dignitas, petitions sooner.
- **At every rank, more worth buying than the colony can afford**: coin and kits are choices again.
- **The pillars hold**: absence is never punished (a sink is a bonus that lapses, never a debt that bites); the Ordo
  keeps the colony alive on safe defaults; building and choosing by hand stays better and faster than the Ordo (§1.2).

## 4. The proposal

### 4.1 Tool kits become the currency of improvement: *Expolitio*

Kits are no longer lent to buildings. They are **spent to improve a finished work** by one level (I → II → III), with
coin and a material, and the improvement takes builders' work, so builders matter again.

| Level | Kits | Coin | Material | Work | A workshop or producer | A service or temple | A store or well |
|---|---|---|---|---|---|---|---|
| I | 2 | 40 | — | 20 | output +15% | reach +1, dignitas +25% | holds +25%; a well +15% |
| II | 5 | 150 | 20 of its main material | 60 | +30% | +2, +50% | +50%; +30% |
| III | 10 | 400 | 10 iron (works) or 10 marble (civic, §4.6) | 150 | +45%, one more hand | +3, +75% | +75%; +45% |

(Per level, cumulative; × 2 for block-sized works. (tune))

- **A work under improvement runs at half output** until the work is done.
- **Upkeep rises 30% per level**: improvement is capital that costs coin every day, the steady coin sink the late game
  lacks. A fully improved colony of ≈ 120 works spends ≈ 2,000 kits and ≈ 70k den on improvements, and its upkeep
  roughly doubles.
- **Improved civic works add splendour** (0.25 per level on a service, temple, bath, theatre, fountain or forum work), so
  they lift Rome's favour past what gardens give (§4.4).
- **The player's lever.** The Ordo never improves a work (as with gardens and the fork, §10.3); a work it is asked to
  build arrives at level 0. Pillar 1 holds: by hand is better.
- **Kits from the Vicus**: the smithy (*fabrica*) moves to rank II, working on iron bought at Pagus Durii or Oppidum
  Silvanum until the mine opens; kits become tradeable (base 18 den, sold at Silvanum and Durii). The Vicus, when coin
  first piles up (2k → 20k), gets its first sink.
- **Ars fabrilis** (path 2) changes from "kits last 180 days" to "improvements cost 25% fewer kits and take half the work".
- **Removed**: the auto-issue (`issueTools`, tick step 4), the build kit, the passive +20% (`TOOL_MULT`, `TOOL_DAYS`,
  `TOOL_TARGET`, `TOOL_ORDER`, `BuildingDef.tool`, `toolUntil`, fx `toolDays`). Production loses its free +20%; levels
  give it back where the player chooses.
- **Visible change**: level pips in the inspector; level II a terracotta trim, level III a bronze or gilt detail on the
  sprite (code-drawn overlays, one per class).

### 4.2 Builders build: idle hands only help them

Idle adults' help is capped at the builders' own work: `crew = builders' work + min(builders' work, 0.3 × idle)`.
"They fetch and carry for the fabri; they cannot lay stone without them." Building pace then follows the builder share,
skill, *Opera* and the charter, and the Ordo staffs builders when sites are open (its `BUILDERS_MIN` step already does).
Works stay quick at the Castra, where the founders are the builders; improvements (§4.1) and the Capitolium are what
take time later. (tune: `IDLE_BUILD`, a new `IDLE_HELP_MAX`.)

### 4.3 Homes use goods every day

The goods ladder that oil and wine began (DESIGN §7.6) is extended down the tiers, with the same supply EMA, the same
"needed to rise and to stay" rule and the same order on shortage (higher tiers first):

| Good | Made by | Wanted by | Per soul a day | Trade base |
|---|---|---|---|---|
| **Pottery** (*vasa fictilia*) | the tile kiln, by a fire split the player sets (tiles / pottery) | tiled cottage and up | 0.02 | 3 |
| **Wool** (*lana*) | **sheepfold** (*ovile*, rural 3×3 on meadow, scrub or hills, 3 hands, 2/hand) | the looms | — | — (not traded) |
| **Cloth** (*panni*) | **weaver** (*textrina*, plot, 2 hands, each 2 wool → 1 cloth a day) | stone house and up | 0.02 | 12 (a premium export) |
| oil, wine | as now | insula and domus; domus | 0.05 | 6, 8 |

And **the baths burn fuel**: a balneum 3 timber a day, the thermae 8 (the hypocaust). Timber becomes a flow the woods and
the *Silvae* edict have to answer, not a stock that fills.

At the Municipium (≈ 400 souls from the tiled cottage up, ≈ 280 from the stone house up) this is ≈ 8 pottery, 5–6 cloth,
11–12 wool and 14 timber of fuel a day (two balnea and the thermae): ≈ 18–20 more hands at work and four new flows to keep balanced. The ladder gives
the tiers a reason to need trade: pottery and cloth can be bought when the kilns or looms fall short, and sold when they
run over.

### 4.4 Coin buys growth

- **Rome's favour is split.** Gardens and paving give at most ×2 (splendour from them capped at 0.25 per home). The rest,
  up to ×3, comes only from **improved civic works** (permanent, §4.1) and **munera** (timed, below). The colony a
  Praefectus beautifies and pays for draws colonists three times as fast; one that only plants gardens, twice; the Ordo
  alone, once. (§18.4 bands retuned: §4.8.)
- **Munera** (public benefactions; Edicta or the Copiae treasury view), repeatable, cost by head:
  - *Ludi* (games): 3 den a soul; spirits +6 and splendour +0.15 per home for 90 days; again after 180 days; ×1.5 with a
    theatrum.
  - *Epulum* (the public feast): 1 den, 1 grain and 0.1 wine a soul; spirits +4 and births ×1.2 for 60 days; again after
    120 days. It spends the grain surplus and the wine trade.
  - The Ordo holds none (it never spends for splendour); the existing *Feriae* festivals are untouched.
- **Postulata Romae** (Rome's requests) generalise the *Annona Romae* card (§12.2): every ≈ 2 years Rome asks for a
  quantity of goods the colony makes (tiles, iron, cloth, oil, grain), due in ≈ 180 days. Fulfilled: Fama +4 for five
  years and the next petition's fee −20%. **No coin is paid** (the old card paid 1,500 den, adding to the pile).
  Declining or letting it lapse costs nothing (pillar 4). Offline, the Ordo sets aside only what lies above every
  reserve.

### 4.5 One standing order per good instead of a row of caravans

Every tradeable good gets three lines, set in the Copiae screen (§6) and shown on its meter: **keep at least**, **sell
above**, **buy below** (with the hub). Past a line, the next free mule team carries up to 80. This is what the owner did
by hand with many contracts. The Ordo's trade duty (§10.7, `surplusExport`, `deficitImport`) reads the same lines instead
of its own fixed 95% (60% under *Mercatura*). Player contracts stay as they are for one-off trades.

### 4.6 New resources: what to add, and what not

Recommended (the management depth the owner asked for):

1. **Pottery**, 2. **wool → cloth** (§4.3): recurring, scale with the tiers, compete for kiln fire, land and hands.
3. **Fuel without a new stock**: baths burn timber (§4.3).
4. **Tool kits** stay, re-purposed (§4.1).
5. **Marble** (*marmor*), import only (Portus Massiliae, Colonia Augusta; base 25): the level III material for civic
   works, and optionally a forum stage. The late game's coin → dignitas converter. **Marble is on the cut list (§19)**:
   the owner's call.

Not recommended:

- **Bread** (*pistrinum*): grain must stay the one staple and the vital tablet's runway stays exact (pillar 2); a
  second food would split the days-on-hand. Also on the cut list.
- **Garum, salt, a vineyard**: more goods than the household ladder needs; the domus already has wine (import only, which
  keeps trade mattering), and *vinea* is cut. (Furniture, once listed here, is now a recipe: §4.7.)

With these and the recipes of §4.7, the stores go from 12 to 21: grain, water · timber, stone, tiles, concrete · ore,
iron, tool kits · planks, nails · pottery, wool, cloth, oil, wine, furniture · carts, cranes · marble.

### 4.7 Workshops and recipes: what the tool kits make

The owner's question: goods made in workshops, by recipes that need tool kits, that build equipment which moves the game
on; for example oil, planks, bearings and nails for carts that carry more per trip. Every item below is checked against a
lever that actually binds, measured where the bots could measure it.

**The rule: every recipe wears tool kits.** A workshop uses up one kit for every so many units it makes. Kits become the
moving part of all industry, not a buff that sits in a building: the iron chain (mine → bloomery → smithy) has work all
year, and kits are spent three ways (recipes, *Expolitio*, carts and cranes), so the player chooses where they go.

Two workshops make everything; a workshop works one recipe, or splits its hands between two, as the kiln splits its fire
(§4.3):

| Workshop | Recipe (per hand a day) | Wears | Feeds |
|---|---|---|---|
| **Smithy** (*fabrica*, from the Vicus, §4.1) | 1 iron + 1 timber → 0.4 tool kits (as now) | — | every recipe, *Expolitio* |
| | **nails** (*clavi*): 1 iron + 0.5 timber → 3 | 1 kit per 30 | carts, cranes, furniture, Rome's requests |
| **Carpenter's yard** (*officina tignaria*, new: Vicus, plot, 3 hands; *carpenter* comes from *carpentarius*, a cart-maker) | **planks** (*tabulae*): 2 timber → 3 | 1 kit per 40 | carts, cranes, furniture |
| | **furniture** (*supellex*): 2 planks + 1 nail → 1.5 | — | insulae and domus (below) |
| | **a cart** (*plaustrum*): 6 planks + 4 nails + 2 iron + 1 kit → 0.25 (4 hand-days) | the kit | trade (below) |
| | **a crane** (*machina tractoria*, the treadwheel): 24 planks + 12 nails + 8 iron + 4 kits → 0.1 (10 hand-days) | the kits | building (below) |

(tune, all of it.)

**What each one buys:**

- **Carts → trade.** A caravan that takes a cart from the stores carries 160 instead of 80, loaded as fast as 80 is now
  (`CARGO_PER_DAY` 40 → 80 for a cart), so the trip takes no longer and each caravan slot carries twice as much. A cart
  wears out after 6 round trips and is greased with 2 oil a trip (*axungia*, axle grease; oil spills 6–14 a day at the
  Municipium and Colonia, so this is a sink it can take). Without a cart a caravan is a mule team of 80, as now. **When it
  matters:** only when the colony trades in volume. The bots never had every caravan slot busy (0% of days, seeds 42 and
  1, from the Vicus), because the Ordo keeps its stores lean. A colony run by hand is different: five slots to Pagus
  Durii carry 25 a day (80 every 16 days each), and two fully staffed quarries make ≈ 30. That is the owner's row of
  trade routes; carts halve it. With the standing orders (§4.5), *Postulata Romae* and imports of marble, wine, kits and
  iron, they matter more.
- **Cranes → building.** The Capitolium was short of hands on every one of its ≈ 2,150 days (seeds 42 and 1: the full
  64 fabri, ≈ 149 work a day; never a material). Each crane in the stores lets 16 more fabri work it (two at most):
  ≈ 1,720 days with one, ≈ 1,430 with two. On any block-sized work, or an improvement of one (§4.1), builders' work is
  ×1.5 while a crane stands there; with idle hands no longer building alone (§4.2) that is felt. A crane wears out after
  360 days at work. The §9.5 phase band (1,800–3,000 days) is retuned, or the Capitolium takes one crane only.
- **Furniture → homes.** Insulae and domus use 0.02 a soul a day (couches, tables, chests), with the same supply rule as
  oil (§7.6). At the Municipium (≈ 200 souls in insulae and domus) that is ≈ 4 a day: 8 planks, 4 nails, ≈ 7 hands,
  ≈ 7 timber and 2 iron a day.
- **Nails → Rome.** *Postulata Romae* (§4.4) may ask for nails, carts or cloth for a legion (when Legio XX left
  Inchtuthil in the 80s it buried 875,000 nails rather than leave them), so the crafted goods have an outlet that pays in
  Fama and a cheaper petition, not coin.

**The owner's example, item by item:** planks from timber with tools, yes; nails, yes; oil, yes, as axle grease used up
each trip; carts that carry more, yes, but worn out with use rather than kept for ever, and worth building only when
trade runs at volume. **Bearings, no**: Roman carts turned on greased wooden axles in iron-banded hubs (the bronze balls
under the Nemi ships' turntables are the one exception, and not on a cart). The iron tyres and hub bands are the
cart's 2 iron.

**Considered and left out:**

- **Ploughs** (iron shares, more grain): grain is never short after the first Hiems (the horrea run 79–93% full), so
  more output buys nothing (§2).
- **Pumps and water-wheels**: water spills 35–310 a day; a better well is an *Expolitio* level, not a good.
- **Glass** (sand → glass windows, desirability for the domus): plausible (Pompeii glazed its baths), but the lever is
  unmeasured: domus are rare (one at the dedication on the §18.4 curve) and it is not yet shown that desirability is
  why. Measure first.
- **Bronze statues** (copper and tin, imported): a dignitas sink like marble, but *statua* is cut (§19).
- **Leather, rope, barges**: more steps with no new lever; river barges are cut.

### 4.8 What "fixed" means: targets for `npm run economy`

Measured for the attentive player, median over the five seeds, after each phase:

- Coin when a rank opens: at most ≈ 2× the next petition's fee (today: 8× when the Oppidum opens, 21× at the Municipium).
- Unspent at the dedication: at most 15% of all coin earned (today 53%); works, improvements and munera at least 30%.
- Materials at ≥ 95% of cap on at most 30% of days from the Vicus on (today 75–97%).
- Idle adults at most 8% of the adults (today up to ≈ 25%).
- Builders' capacity used 20–60% on days a site or improvement is open (today 1–7%).
- The §18.4 pacing bands and the idle floor (2.2–3.6×) still hold, retuned once: the favour split slows the
  garden-only player, and the sinks speed the paying one.

## 5. Phases

1. **Kits and builders** (smallest, highest leverage): §4.1 *Expolitio*, §4.2 the idle-help cap, the smithy at the Vicus
   and kits tradeable, §4.5 standing orders in the engine (and as lines in the Commercium form until the Copiae screen
   lands). Retune the bands. Touches `economy.ts` (`cappedBase`, `issueTools` removed), `construction.ts` (three kit
   sites; improvement work in the works queue), `sim.ts` (tick step 4), `data/buildings.ts` (`tool` → an improvement
   class per work), `data/ranks.ts` (fabrica to rank II), `data/resources.ts` and `data/hubs.ts` (kits tradeable),
   `data/decisions.ts` (*Ars fabrilis*), `ordo/labour.ts` step 7 (kits wanted = the queue's), `ordo/trade.ts`
   (lines), `hints.ts` and `ui/inspector.ts` (the tool factor → the level), `save.ts` (drop `toolUntil`, add `level`;
   a save migration), tests `construction`, `data`, `contract`.
2. **Goods, workshops and the screen**: §4.3 pottery, wool, cloth, bath fuel; §4.7 the carpenter's yard, nails, planks,
   furniture, carts and cranes (recipes and splits in the workshop's inspector; carts in the caravan dispatch in
   `trade.ts`; cranes in `constructionDay` and `capitoliumDay`); the *Copiae* tab (§6).
3. **Coin into growth**: §4.4 the favour split, munera, *Postulata Romae*; marble if the owner revives it.

## 6. The Copiae screen (design for review)

A new side-panel tab, *Copiae* / Stores (key `G`), revealed with the first finished work, drawn on the canvas
**<https://claude.ai/artifact/N7EFAYm2Phb2bvHhyZPAKp>** (private to its owner until shared from its Share menu). Ten
artboards:

- **Why**: the measurements above and the flow from producers through the stores to the five sinks and on to progress.
- **Stores** (desktop, the ledgers wide; interactive: click a row): every good grouped by chain (*Annona*, *Materia*,
  *Ferrum*, *Bona*, *Ornamenta*) with its stock against its cap, the keep and sell-above marks, the day's net and an
  outlook chip (*Full 41 days · spills*, *Dry in 49 days*, *Short in 45 days*); the chosen good's flows (*comes from* /
  *goes to*, spills in red), its three standing orders as sliders, and its advisor's counsel with one-click remedies.
- **Treasury and spending**: coin in and out by source, what is being saved for (the next petition), and the three
  sinks side by side: the *Expolitio* queue, *Munera*, *Postulata Romae*; and Rome's favour split by source.
- **Phone**: the same list in the sheet, one good opened with its sell-above line and remedies.
- **Expolitio**: the inspector card for improving a work (a tile kiln II → III), its costs against the stores (iron held
  for the petition), its gains, and the three levels.
- **Workshops and recipes** (§4.7): the smithy's and the carpenter's yard's recipes with their inputs and kit wear, what
  carts, cranes, furniture and nails each buy with the measured reason, the owner's cart example checked item by item,
  and what was left out.

And four on how the economy works once all of this is in:

- **How goods move**: every chain from land and producers through the workshops (each wearing tool kits) into the
  stores, then out to the seven uses (homes every day, works, *Expolitio*, carts and cranes, fuel and grease, munera
  and Rome's requests, sell above and buy below) and on to progress.
- **The loop**: people → work → stores → supplied homes → taxes → aerarium → *Expolitio*, munera and imports →
  Rome's favour → colonists, with the surplus branch to market, and why demand now grows with the town.
- **Rank by rank**: for each rank, the new goods, what homes want, the new ways to spend, what the player manages, the
  petition to leave, and the coin when the rank opens (measured today against the §4.8 target).
- **Where the coin goes**: a whole game's coin by where it ends up, today (measured) against the proposed target split,
  and an illustrative Municipium day for timber, tool kits and coin.

The figures on the artboards are a plausible Municipium under this proposal, for layout; they are not measurements.

## 7. Questions for the owner

1. Revive **marble** (cut in §19) as an import-only prestige material, or end the improvement ladder on iron?
2. Should improvements stay the player's alone, or become a duty the Ordo can be handed (§10.2), on safe defaults?
3. The **favour split** (§4.4) makes gardens alone worth ×2 instead of ×3. It is the strongest change to the
   "playing pays" calibration (§1.4, §18.4); accept a retune of the bands?
