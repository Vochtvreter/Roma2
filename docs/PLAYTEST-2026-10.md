# Castra Valeria playtest: ten full playthroughs

Ten testers each played Castra Valeria from the title screen to the dedication of the Capitolium (victory), each with a different player type and device. All ten won. Every one of them also hit at least one long stall, and most of those stalls ended only when the player tore down their own buildings.

- 443 raw notes merged into 211 findings; every factual claim was checked against the source code (and reproduced in a browser where useful) by independent skeptics, whose corrections are folded in.
- Played on the main branch at commit 533de5e, built and served with `vite preview`, in headless Chromium driven from screenshots (real touch input on the phone and tablet profiles).
- Days below are game days since founding (at 1× a game day is one real second).

## The ten playthroughs

| Run | Player and device | Vicus | Oppidum | Municipium | Colonia | Victory | Real time (estimate) |
|---|---|---|---|---|---|---|---|
| 1 | First-timer who follows the tutorial · Desktop 1440×900 · played by the lead tester | 1,020 | 3,764 | 8,445 | 11,606 | 14,005 | 1.5–2.5 h, about half of it waiting for settlers |
| 2 | Casual bus commuter · iPhone, portrait, touch | 1,716 | 5,904 | 15,144 | 20,363 | 25,604 | 20–25 short sessions over many days |
| 3 | Veteran city-builder fan · Desktop, mouse and keyboard | 719 | 3,321 | 6,092 | 8,380 | 10,414 | 1.5–2.5 h; ~35 min of it waiting on the Capitolium |
| 4 | Idle-game fan who plays by leaving · Laptop 1280×720 | 4,188 | 9,068 | 16,597 | 23,706 | 26,470 | ~1 h with the tab open plus ~47 h away; 5–6 calendar days |
| 5 | Cozy builder with Large text · iPad, touch, Text size Large | 910 | 3,665 | 9,360 | 14,182 | ≈17,080 | 3–4 h |
| 6 | Returning player who fears losing the save · Android phone, touch | 1,984 | 4,610 | 8,361 | 10,652 | 13,425 | 3–3.5 h over 5–6 sittings |
| 7 | Skips the tutorial, tests failure states · iPhone, landscape, touch | 1,635 | 3,743 | 7,965 | 11,708 | 14,494 | 3–3.5 h |
| 8 | QA-minded breaker · Desktop, resized down to phone width | 1,074 | 3,310 | 8,019 | 11,061 | 13,433 | 2.5–3.5 h |
| 9 | History buff who reads everything · Laptop 1280×720 | 766 | 3,609 | 6,649 | 10,149 | 13,390 | 1.5–2.5 h |
| 10 | Micromanager who never delegates, then a Legacy colony · Desktop, mouse and keyboard | 503 | 2,479 | 6,366 | 9,210 | 11,619 | 3–3.5 h, plus 15–20 min of the Legacy colony |

Design targets for an attentive player: 573 / 2,840 / 7,003 / 10,116 / 12,276 (victory band 11,000–17,500); the town council alone: ≈ 28,460.

## Fix these first

### 1. One advisor tap lets the town council carpet the map with gardens

*High · Town council (Ordo) · 8 of 10 runs (2, 3, 4, 5, 6, 7, 8, 9)*

**Observation:** The Aedilis (housing advisor) offers a one-click remedy, "Focus: The city beautiful". With that focus the Ordo (town council) plants a garden about every 6 days on any free plot. Run 2's next away letter read "Garden ×241". Run 3 had 190 gardens against 26 house plots; Runs 4 and 6 had 211 and about 200. Switching the focus back removes none of them.

**Problem:** Gardens take the plots that homes, market halls, baths and the aqueduct need. Growth stalls for thousands of days while advisors report "no free plot" and never name the gardens as the cause. Testers spent 80 to 200 clicks demolishing gardens two clicks at a time; Run 6 lost about 45 minutes this way.

**Suggestion:** Plant a garden only while nearby homes still lack desirability, and cap gardens per block. Never take blocks a rank-up work needs, and let the Ordo replace its own gardens when something more important needs the land. Before applying the focus, say "The council will plant gardens on free plots".

*Verification: Confirmed in code. The garden wish needs only one stone house below desirability 10, and site choice has no minimum benefit and no count cap (src/game/ordo/build.ts:352-371, 495).*

### 2. Rank-ups stall on a missing 4×4 block, and the game never offers to clear one

*High · Advisors · 10 of 10 runs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)*

**Observation:** Every run hit a stretch where homes waited for a temple, bathhouse or market hall with no free 4×4 block within reach. The Aedilis explains it ("they keep their roofs until a block near them is cleared") but names no block and offers no button. Every run broke the stall by demolishing its own buildings. One cleared block in Run 3 showed "+13 houses could evolve", and its insulae (apartment blocks) went from 5 to 15 in 180 days.

**Problem:** The most effective move in the mid and late game is to tear down a block for a service, and nothing teaches it. Players read "no site can take a temple yet" as the game being stuck.

**Suggestion:** When homes wait on a block-sized service and no site reaches them, have the advisor pick a specific block, highlight it and offer "Clear this block for a temple", which demolishes and pre-places the work. Give the council a "make room" rule that replaces its own low-value fillers.

*Verification: Partly confirmed. The council can buy out a block, but only one of cottage-level homes, with 3 or more waiting homes, at most once per 60 days, under the services duty (src/game/urbs.ts:466-567).*

### 3. Demolishing is one building, two clicks, and no warning at a time

*High · Interface · 10 of 10 runs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)*

**Observation:** The demolish tool takes one building at a time, each needing a second click within 3 seconds. Its confirm says only "Click again to demolish": no refund amount, no residents, no homes that lose service. In Run 5 the tester cleared wells for a bath block, and months later a 13-bed stone house fell back to an 8-bed hut for lack of water.

**Problem:** Clearing land is a core late-game action (see the previous finding). As built, it is tedious, blind and irreversible, and the damage shows up long after the click.

**Suggestion:** Add drag or area demolish and a "Clear the council's gardens in this block" action. On the first click, show the impact, e.g. "2 homes, 14 people · 3 homes lose water · 25% back: 10 timber". Add a short Undo.

*Verification: Confirmed in code. 25% refund (src/game/balance.ts:152). The map tool's confirm is text only (src/render/view.ts:615-628).*

### 4. "Click again to confirm" is a 3-second timing puzzle on permanent choices

*High · Interface · 10 of 10 runs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)*

**Observation:** Every run struggled with two-step confirms: the founding charter, the rank-up paths, demolish and the build-queue ✕. They stay armed for a fixed 3 seconds with no countdown, so careful players needed 2 to 5 tries. On a phone, a mentor tip inserted above the path cards pushed them about 115 px between the two taps, and Run 6's second tap armed a different path. The reverse also happens: a single double-click passes the confirm, which is how Run 8 chose its Municipium path by accident.

**Problem:** Irreversible choices are the worst place for a timing test. Slow, careful players fail, and fast ones misfire.

**Suggestion:** For permanent choices, open a confirm sheet that names the choice and has no timeout. Elsewhere, keep the armed state until the pointer leaves or Esc is pressed, and ignore a confirming click that arrives under 400 ms after arming. Never reflow the layout while a card is armed.

*Verification: Reproduced. ARM_MS = 3000 with no minimum delay (src/ui/modals.ts:33, src/ui/tabs/common.ts:87). The phone tip shift and the double-click pass were both reproduced in a browser.*

### 5. Year one can run out of timber, and the only way out is a secret

*High · Onboarding · 6 of 10 runs (1, 2, 3, 4, 8, 9)*

**Observation:** The colony starts with 80 timber. The lesson works and automatic tent-to-hut upgrades (8 timber each, starting before the timber counter is even shown) can spend it all. Runs 1, 2, 4 and 8 sat at 2 to 6 timber with zero income by about day 200. A lumber camp needs 10, and trade only opens at the first rank-up. Run 2 waited 960 days, and two testers had to read the source code. The way out: a free road dragged through forest fells its trees ("A road of 14 paces is laid; 620 timber cleared").

**Problem:** In the first hour the game looks unwinnable, and the fix is hidden, free and unlimited, which also makes lumber camps nearly pointless.

**Suggestion:** Guarantee a start: keep 10 timber back for a lumber camp, stop upgrades below a timber floor, or let idle hands gather a trickle. Teach felling: show "fells N timber" while dragging a road and add it to the timber tooltip's "How to get more". Cap the yield so lumber camps still matter.

*Verification: Reproduced. Stall reproduced in a browser. Starting stock is 80 timber and 40 stone (src/game/balance.ts:352). Building placement previews felling, but road drags and the timber tooltip don't (src/game/place.ts:426-442).*

### 6. Most of the game is waiting for settlers, with no rate, no ETA and no lever

*High · Pacing · 8 of 10 runs (1, 3, 4, 6, 7, 8, 9, 10)*

**Observation:** In 8 runs, souls (population) were the last missing requirement for most ranks, often for 1,000 to 2,000 days. Run 1 went from 105 to 161 of 180 souls in about 1,450 days, with 54 idle hands and 93k denarii. Run 7 gained about 6 souls per 100 days at Oppidum, where base immigration is about 2 souls a year before bonuses. Births were zero for years in Runs 7 to 10.

**Problem:** These long stretches leave nothing to do and show no lever. The strongest one, Rome's favour from gardens and paved streets (up to ×3), is a single line in a tooltip. Run 1 tripled arrivals instantly by paving about 200 tiles, and no advisor had ever suggested it.

**Suggestion:** Show "≈ 1 family every N days" and its factors in the souls tooltip, and an ETA on the petition line. Have the Aedilis name the limiter and offer paving as a remedy. Raise Oppidum and Municipium immigration or lower their soul gates, and let spare coin attract settlers.

*Verification: Design intent, still frustrating. The observed rates match the design curve (src/game/people.ts:614-623). Nothing in the game shows the arrival rate or an ETA.*

### 7. The Capitolium finale is a long wait, and the screen blames the wrong thing

*High · Pacing · 8 of 10 runs (2, 3, 5, 6, 7, 8, 9, 10)*

**Observation:** In 7 runs the last 2,000 to 2,900 days were pure waiting. The works row reads "bottleneck: builders", but at most 64 builders can work on the Capitolium. Run 3 clicked + 120 times to staff 192 builders: the ETA barely moved, and 17 homes declined because the wells lost their workers. In Runs 2, 5, 7 and 9 the real block was concrete at 0, yet every screen still said "builders". The only true hint was a grey line in the people panel: "2 hands on concrete: we need 230 more for the capitolium".

**Problem:** The climax of the game is a wait with hundreds of idle hands and 400k+ coin, and the UI points players at a fix that does nothing.

**Suggestion:** Show "64 of 64 builders (the most that fit)". Compute the bottleneck from actual progress and name the starved input ("waiting for concrete: 0 in store, +0/day"). Give spare coin or hands a way in, such as hired crews or a second crew per stage.

*Verification: Partly confirmed. CAP_CREW = 64 (src/game/balance.ts:153). The "72 builders" some runs saw includes 8 town-wall builders. The Opera Magna and Horae Longae decrees do speed the work. The flow counts a staffed but starved concrete works at full rate, so the label stays "builders" (src/game/construction.ts:207-240).*

### 8. A default setting silently shuts down concrete production

*High · Economy & balance · 2 of 10 runs (9, 10)*

**Observation:** Runs 9 and 10 had a staffed concrete works producing nothing for hundreds of days. One temple "waited 284 days for 20 concrete", and the Capitolium sat at 39% "bottleneck: builders". The cause: under the default water decree (Populo prius), industry only gets water above a 15-day reserve, but the colony's storage held only about 14 days of water, so industry never got any. Switching the decree to Aequa fixed it at once.

**Problem:** A default silently disables a whole production chain, and nothing on the building or from the advisors says why.

**Suggestion:** Never set the industry floor above what storage can hold. On the works and in the materials advisor, say "Idle: water reserve (15 d) not met; storage holds 14 d", with a one-click fix.

*Verification: Confirmed in code. The industry water pool is max(0, water − reserve × need) under Populo prius (src/game/economy.ts:400-410).*

### 9. Coming back after a long absence: capped time and a letter that hides the blocker

*High · Saves & sessions · 3 of 10 runs (2, 4, 6)*

**Observation:** Time away runs at half speed and is capped at 1,825 days, which is reached after about 61 minutes. An 8-hour absence gives the same as a 1-hour break (Run 4, 12 absences). The Litterae Ordinis (the council's letter on your return) often said "Works raised: None this time" with souls flat (Run 2: 731 → 731). It listed side issues such as "3 homes fetch water from the river" instead of what blocked the next rank. Ready petitions also wait: Run 4's Vicus petition sat ready for up to about 1,590 days.

**Problem:** The idle promise, that the colony runs while you sleep, breaks: long absences are wasted, and the letter doesn't say why nothing moved.

**Suggestion:** State the cap in real time, and say in the letter when it was hit ("7 h of your absence went unused"). Consider a longer cap with diminishing returns. Add a progress line (petition items, Capitolium %), and lead with "Stalled because X" when nothing moved. Offer an opt-in "Carry petitions when ready; I'll choose paths later".

*Verification: Confirmed in code. 0.5 game days per real second, capped at 1,825 days (src/game/offline.ts:18-21). The cap is intended per DESIGN §14; the letter has no progress line (src/ui/dispatch.ts:87-138).*

### 10. "Place X" advice can point to a plot that doesn't serve the home that asked

*High · Advisors · 7 of 10 runs (1, 3, 5, 7, 8, 9, 10)*

**Observation:** From a house card, "Place a temple" put the ghost on a valid plot. Run 10 built a temple, bathhouse and market hall on the suggested spots, and 2,500 days later the cottage still showed "○ A temple — within 12 steps". Run 8's suggested well never reached the tent that asked for it. "Ask the Ordo" services also landed on the far side of town (Runs 1, 3, 5, 8 and 9).

**Problem:** Following the game's own advice wastes coin, land and thousands of days, and it teaches players to distrust the advisors.

**Suggestion:** When no free plot reaches the home, say so ("No free plot within 12 steps of this house; clearing one of these would") instead of silently using the nearest plot. On the ghost, show "reaches this home ✓ (9 steps)".

*Verification: Reproduced. The house card checks road reach first; the miss comes from a silent straight-line fallback, reproduced in a browser (src/ui/tabs/house.ts:64-76). "Ask the Ordo" requests carry no house at all (src/game/ordo/build.ts:684).*

### 11. Staffing by hand: new buildings stay empty and advisors say "build another"

*High · Interface · 4 of 10 runs (2, 3, 7, 10)*

**Observation:** With staffing kept by hand, finishing a building adds posts but not workers, so new works sit unstaffed. A new well left 3 homes declining (Run 10), and two olive groves sat at 0 of 4 hands for about 1,700 days. Advisors then say "Place a well" or "Place an olive grove" instead of "Staff the one you have". Targets change by 1 per click (Shift-click gives 5, but nothing says so): Run 3 needed 120 clicks for builders, and Run 10 needed 45 for the fields.

**Problem:** The tutorial starts every player in this mode. At a few hundred people it turns into bookkeeping and wrong advice.

**Suggestion:** On completion, toast "Olive grove finished: 0/4 hands [+4]" and flag rows where posts exceed the target. When unstaffed capacity is the cause, make the first remedy "Put N hands on X". Add a number field or "Fill to capacity", and show the Shift ±5 hint.

*Verification: Design intent, still frustrating. Finishing a work never changes the manual target, by design (src/game/ordo/labour.ts:325-353). A map pip and an idle-hands warning exist but don't name the building. Shift-click ±5 exists, with no tooltip (src/ui/tabs/labour.ts:23).*

### 12. "Found a new colony" erases the saved colony instantly

*High · Saves & sessions · 2 of 10 runs (6, 8)*

**Observation:** On the title screen, "Found a new colony" asks for a second click within 3 seconds, then overwrites the save at once. Run 6's Vicus became a fresh camp before "Raise the standard" was even pressed. Run 8's won colony (481 KB) was replaced by one double-click. Backing out of the founding letter doesn't bring it back.

**Problem:** This is total, silent progress loss from a reflex double-tap. Run 6 recovered only because they had exported two minutes earlier.

**Suggestion:** Don't overwrite until the new colony's first autosave, and treat Back on the founding letter as cancel. Keep the previous colony in a second slot. Confirm with a dialog that names the colony and offers "Export first".

*Verification: Reproduced. newGame writes the save before the founding letter opens (src/main.ts:284-293). Double-click overwrite reproduced.*

### 13. The goals panel can freeze for thousands of days

*High · Interface · 3 of 10 runs (1, 3, 8)*

**Observation:** The Res Gestae (goals panel) stopped updating in Runs 1, 3 and 8. Run 1's kept showing a finished goal from day ~5,635 to day 8,529, which hid the gold "Petition Rome: Municipium" button; the tester found the ready petition about 600 days late. The panel deliberately waits while the pointer rests on the advisor card, but that hover flag gets stuck when a clicked card collapses under the cursor.

**Problem:** The game's main "what do I do next" signal silently freezes, and nothing tells the player.

**Suggestion:** Expire the hold after a few seconds, or on any pointer movement outside the card. Never hold through a milestone change.

*Verification: Reproduced. src/ui/objective.ts:98 skips rebuilds while the counsel PointerHold holds (src/ui/steady.ts:120-149).*

### 14. The victory letter can vanish unread, and there's no way back to it

*Medium · Interface · 6 of 10 runs (3, 5, 7, 8, 9, 10)*

**Observation:** When the Capitolium is dedicated, a banner shows and the parchment Victory dispatch opens a moment later, with "Keep governing" focused. Pressing Space, the pause key and a natural reflex at the big moment, closes it unseen (Run 8). The harness's scripted pause key did the same in three more runs. Nothing in the Menu, Annales or Res Gestae reopens it.

**Problem:** The emotional payoff of a 2 to 4 hour game can be lost to one key press.

**Suggestion:** Focus the dialog itself rather than a dismiss button, and ignore Space inside it. Add "Read the dispatch again" to the Annales next to the Fasti entry.

*Verification: Partly confirmed. Space dismissal reproduced in a browser (src/ui/keys.ts:57). The simulation itself halts while the letter is open (src/main.ts:530), and the letter opens only from a one-shot event (src/ui/dispatch.ts:206).*

### 15. The game resumes on its own after a reload or an away letter

*Medium · Saves & sessions · 5 of 10 runs (2, 4, 6, 8, 10)*

**Observation:** Reloading, pressing Continue, or closing the away letter (Return to the city, ✕, or any remedy button) always resumes at your last speed, even if you paused before leaving. Run 4 came back at 20× with an event card already ticking. Run 8's letter button opened the decrees panel, and 24 days passed unnoticed.

**Problem:** Returning players lose decisions in their first seconds back.

**Suggestion:** Save and restore the paused state, or always return paused with a clear Resume button.

*Verification: Reproduced. Every way out of the letter calls setSpeed (src/ui/dispatch.ts:202) and no paused flag is saved (src/main.ts:296-308). Resuming is documented design.*

## All findings

Sorted by severity, then by how many runs reported it.

### Demolish is two clicks per building, with no area tool, no impact preview and no undo

*High · Interface · 10 of 10 runs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)*

**Observation:** Every run had to demolish. Run 4 cleared ~95 gardens in ~190 clicks; Run 6 cleared 50 gardens and 4 granaries with ~100 taps. Run 9 removed wells for a temple and 4 homes lost water. Run 5 lost water for 8 homes and a 13-bed stone house fell back to a hut. The map confirm reads only "Click again to demolish"; residents are evicted silently.

**Problem:** Demolition becomes the forced fix for late-game stalls, yet it is the riskiest, most tap-heavy action, with no safety net. Players improve the town and watch it get worse.

**Suggestion:** Add drag or area demolish and a 'Clear council gardens in this block' action. On the first tap, show impact ('2 homes evicted, 3 homes lose water, salvage 10 timber'). Add a 10-second Undo. Draw each well's reach in the water overlay.

*Verification: Reproduced. Reproduced: two clicks within 3 s per building, drag removed nothing, no undo or toast. Inspector button does show 'Demolish? 25% back' (src/render/view.ts:55).*

### Rank gates wait on a free 4×4 block near homes, and no one offers to clear one

*High · Advisors · 10 of 10 runs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)*

**Observation:** Temples, baths and market halls need a free 4×4 block within 8-12 road steps of waiting homes. Run 1: homes waited ~1,500 days until the player bulldozed their own gardens. Run 7: 13 cottages waited ~900 days. Run 9: the Ordo (town council) built baths and temples outside the walls instead. The Aedilis (housing advisor) says only "No free block within reach", naming no block.

**Problem:** The main rank gates hinge on a spatial puzzle nobody explains. The advisor diagnoses it but never names a block or offers to clear one, and 'no site' messages give no reason.

**Suggestion:** When homes wait on a block service with no reachable site, have the Aedilis name a block and offer 'Clear this block for baths?' (highlight, demolish, pre-place). Let the Ordo replace its own gardens and fillers. Make 'no site' messages say why.

*Verification: Partly confirmed. Advisory has no clear-block remedy (src/game/advisors/rules-aedilis.ts:134). The Ordo can buy out blocks, but only of humble cottages, never gardens or mixed blocks.*

### 'City beautiful' focus makes the council lay gardens without limit, locking growth

*High · Town council (Ordo) · 8 of 10 runs (2, 3, 4, 5, 6, 7, 8, 9)*

**Observation:** The Aedilis (housing advisor) offers 'Focus: The city beautiful' as a one-click fix for slow colonists. The Ordo (town council) then adds a garden every ~6 days: Run 2 got 241, Run 4 211, Run 6 201 against 18 house plots. Gardens took every house plot ('No site can take a house plot yet') and the blocks baths and market halls needed. Switching focus removed none.

**Problem:** A remedy the game recommends drives its automation into deadlock: no beds and no site for baths or market halls. It stops only when no plot is left, never clears its gardens, and nothing names them as the cause.

**Suggestion:** Only place a garden where it actually lifts a waiting house, and stop when favour reaches ×3. Never take the last free plots near homes or a block a petition needs. Let the Ordo replace its own gardens, and have the Aedilis warn about them.

*Verification: Confirmed in code. The garden wish needs only one stone house below desirability 10; site choice has no minimum lift and no count cap (src/game/ordo/build.ts:495).*

### 'Place X' suggestions silently fall back to plots that cannot serve the home that asked

*High · Advisors · 5 of 10 runs (3, 5, 7, 8, 10)*

**Observation:** Run 10 lost ~2,000 days and ~2,500 denarii building a temple, baths and market hall on suggested spots that never served the cottage. Run 8 placed a suggested well one tile from a tent ('Good ground'); it stayed dry. Run 5's 'water lapsed' well ghost appeared in the northern forest. Run 3's market hall ghost was ~20 tiles away. Advisors meanwhile said 'No free block within reach'.

**Problem:** The game's most trusted tool points at plots that can't work, with no warning. After two failures the player trusts no suggestion, and real time and money are lost.

**Suggestion:** When no free plot reaches the home, say so ('No free plot reaches this home') instead of offering the nearest one. Show 'reaches this home (9 steps)' on valid ghosts. Target advisor 'Place' remedies at the homes they name. Label trade remedies 'Draft contract…'.

*Verification: Reproduced. Main path checks road reach; failures come from a silent straight-line fallback (src/ui/tabs/house.ts:68) and untargeted advisor remedies. Fallback reproduced in browser.*

### Following the lessons can spend all timber in year one, with no lumber camp on offer

*High · Economy & balance · 4 of 10 runs (1, 2, 4, 8)*

**Observation:** Every colony starts with 80 timber. Automatic tent-to-hut upgrades (8 timber each) start before the timber counter appears; the lesson cistern, an advised granary (40) and house plots drain the rest. Run 1, Run 2, Run 4 and Run 8 sat at 2-6 timber with no income, and a lumber camp costs 10 timber. Run 4 waited 1,955 days.

**Problem:** A newcomer who follows the lessons and advisors exactly can strand the colony with no timber income. The works advisor claims 'every day of production brings it nearer' when production is zero. Testers said 'a human would have quit'.

**Suggestion:** Guarantee a timber bootstrap: offer the lumber camp from lesson I, reserve 10 timber for it, or let idle hands gather a trickle. Stop automatic upgrades below a timber floor. Warn when a placement would leave less than a lumber camp's cost.

*Verification: Reproduced. Stall reproduced in browser. Not a hard lock: once lesson VIII opens the catalogue, a lumber camp placed on forest fells far more than its cost (src/game/place.ts:374).*

### On phones, a tip unfolding above the petition shifts cards so a tap picks the wrong path

*High · Mobile & touch · 4 of 10 runs (1, 2, 6, 9)*

**Observation:** Run 6 (Pixel 7): between two taps on the Coloni path, the Vicus (rank II) petition tip unfolded above the cards, pushed them ~115 px and armed Pagus rusticus, the path above, instead. A verifier reproduced it on a phone: two taps aimed at Coloni permanently chose Pagus rusticus. Cards sit only 5 px apart, and an armed card grows ~20 px.

**Problem:** An irreversible choice sits on a list that moves under the finger. The player aims at one path and gets another, with no undo.

**Suggestion:** Freeze the layout while a choice card is armed: never unfold tips or lessons above it. Put permanent choices behind a fixed confirm sheet, and give the cards more spacing on phones.

*Verification: Reproduced. Reproduced on Pixel 7 profile: a 114 px shift committed the wrong path. Desktop is unaffected by tips; its jumps come from panel rebuilds (src/ui/counsel.ts:348).*

### The Capitolium stalls on concrete while every status line blames 'builders'

*High · Interface · 4 of 10 runs (2, 5, 7, 9)*

**Observation:** Run 2: the Capitolium (final temple) sat at 46.4% through a 5-year absence while the queue read 'bottleneck: builders · next stage ≈ 77 d', concrete 0. Run 7 froze at 50% with concrete 0; the works advisor offered decrees already in force. Run 9 read 'bottleneck: builders' for ~500 days while the water reserve starved the concrete works. Only the Operae (labour) tab mentioned concrete.

**Problem:** At the climax, the one status line players trust names the wrong bottleneck. Trusting it, they wait for years or add builders that do nothing.

**Suggestion:** Compute the bottleneck from real recent output, not nominal producer rates: 'waiting for concrete: 0 in store, +0/day'. Show it on the works row and Capitolium card, and have the works advisor raise a red card naming the input that starves the works.

*Verification: Confirmed in code. Reproduced in a headless sim: a water-starved concrete works still counts at ~5.3/day, so the label stays 'builders' (src/game/construction.ts:207). The council's materials duty is fooled the same way.*

### Under manual labour, finished buildings get no workers and nothing points to them

*High · Interface · 4 of 10 runs (2, 3, 7, 10)*

**Observation:** With manual labour, finishing a work raises a category's posts but not its worker target. Run 10: a new well at '0 of 2 hands' left 3 homes declining, a shop row left '9 homes declining: a market lapsed', and two olive groves sat at 0/4 for ~1,700 days. Run 7's lumber camp and quarry produced nothing for ~100 days. Shop and shrine cards don't list hands.

**Problem:** Every new colony starts in manual labour, so every new player meets this. They build what was asked and can't see why it doesn't count, and it keeps recurring: declining homes, stalled production, oil running out.

**Suggestion:** When a work finishes under manual labour, toast 'Olive grove finished: 0/4 hands [+4 to food]'. Highlight labour rows where posts exceed the target, add 'Fill to capacity', and show hands on every build card.

*Verification: Design intent, still frustrating. Targets are player-set by design (src/game/ordo/labour.ts:339). Not fully silent: a map pip and an idle-hands warning exist. Groves starved because they were far from the forum.*

### The Res Gestae (goals panel) freezes after a click on a collapsing advisor card

*High · Interface · 3 of 10 runs (1, 3, 8)*

**Observation:** Run 1: from day ~5,635 to 8,529 the panel kept showing a finished goal with stale '0 D' timers, and the gold Municipium (rank IV) petition prompt never appeared; the petition was found ~600 days late in Edicta (decrees panel). Run 8 hit it three times after clicking card buttons. Hovering the advisor strip and leaving fixed it every time. Run 3 likely hit it too.

**Problem:** The main 'what next' panel silently shows finished goals and hides the rank-up prompt. The advisor card freezes too, so new warnings, even a Periculum (danger) alert, never appear.

**Suggestion:** Don't rely on the pointerleave event alone: have the hover hold also check that the pointer is still over the card (:hover), or clear it when the card is rebuilt. Never hold through a milestone change.

*Verification: Reproduced. Reproduced in Chromium: the card collapses, pointerleave never fires and the hold sticks (src/ui/steady.ts:120). Multi-thousand-day freezes are inflated by harness mouse jumps.*

### The away letter shows no progress toward the next rank, so long stalls go unexplained

*High · Saves & sessions · 3 of 10 runs (2, 4, 6)*

**Observation:** Run 2 came back from 5-year absences to 'WORKS RAISED: None this time.' with souls flat (731 to 731) and no reason given. Run 4's letters never mentioned the insulae (apartment blocks) 0/4 or 7/12 that blocked the next rank, listing a spring and 'No free beds' instead. Run 6's Capitolium (final temple) went from 2% to 20% unmentioned. 'Awaiting you' shows at most 3 items, sorted by severity.

**Problem:** For an idle or short-session player, the letter is the whole interface. It omits the one thing they need: 'progress stopped because X; tap here'.

**Suggestion:** Add a Progress line: petition items and Capitolium %, start to end of the absence. If nothing moved, lead with 'Stalled: [reason]' and one remedy. Rank 'Awaiting you' by impact on the next rank, and explain 'None this time'.

*Verification: Design intent, still frustrating. Matches the design doc's §14 layout; no progress line exists (src/ui/dispatch.ts:126). 'Never' overstates: some letters did name the timber stall.*

### 'Found a new colony' wipes the saved colony on one double-click, with no backup or undo

*High · Saves & sessions · 2 of 10 runs (6, 8)*

**Observation:** Run 6: at a 56-soul Vicus (village rank), a quick second tap passed the 'Tap again: replace the saved colony' confirm. The save shrank from 57,926 to 10,467 characters before 'Raise the standard' was pressed, and browser Back led to a title showing 24 souls. Only an export rescued it. Run 8: one double-click replaced a won 1,452-soul colony within 2 s.

**Problem:** A reflex double-click destroys hours of play. The confirm never names the colony, backing out of the founding letter doesn't restore it, and the Victory letter's own 'Found a new colony' button has no confirm at all.

**Suggestion:** Keep the old save in a 'previous colony' slot with a Restore button, and overwrite only once the new colony starts. Ignore confirms within ~400 ms of arming, name the colony in the prompt, and add a confirm to the Victory letter's button.

*Verification: Reproduced. Reproduced twice in browser: one double-click overwrote the save within ~100 ms. The 3 s confirm has no minimum gap (src/ui/modals.ts:134). Esc does nothing; browser Back exits.*

### The default water reserve can stop concrete works indefinitely when storage is too small

*High · Economy & balance · 2 of 10 runs (9, 10)*

**Observation:** Run 10: a fully staffed concrete works made 0 concrete for ~300 days; the temple and baths 'waited 284 days for 20 concrete'. Setting water priority to 'Aequa' fixed it at once. Run 9: the Capitolium (final monument) sat at 39% for ~500 days reading 'bottleneck: builders', with 313 idle hands and water at 14.7 days against a 15-day reserve. Lowering 'Aquae subsidium' (water reserve) to 5 days finished it.

**Problem:** Under the default 'Populo prius' (people first), industry gets water only above a 15-day reserve, but storage can hold less than that, so the works never run. Nothing on screen links concrete to the reserve, and the Capitolium blames builders.

**Suggestion:** Clamp the reserve to what storage can hold. Show 'Concrete works idle: water reserve not met' on the works and in the Capitolium bottleneck line, with a one-click fix. Stop the summer water card from suggesting a higher reserve.

*Verification: Confirmed in code. Both verifiers reproduced it headless: 0 concrete under 'Populo prius' with storage below the reserve, ~6/day under 'Aequa' (src/game/economy.ts:405). Baths starve too.*

### Advisors say 'build another' when the real fix is staffing the one you already have

*High · Advisors · Run 10*

**Observation:** Run 10, with labour kept manual: 'water lapsed' offered 'Place a well' for a new well with 0 hands. 'A market lapsed' offered 'Place a shop row' beside an unstaffed one. 'Oil... our groves press 0' offered 'Import oil' and 'Place an olive grove' with two groves idle. A Hiems (winter) danger card offered granary, lodge or import while 40 hands sat idle.

**Problem:** One-click remedies send a manual-labour player to build more unstaffed buildings, which deepens the real problem. An unstaffed service covers nobody, so the new building does nothing either.

**Suggestion:** When the category has open posts and labour is manual, lead with 'Put N hands on [category]', as the grain run-out card already does, and name the idle building. For remote groves, offer to raise that building's priority.

*Verification: Partly confirmed. Housing, winter and goods rules never check open posts (src/game/advisors/rules-annonae.ts:125). The grain run-out card does lead with staffing; Run 10's d8075 report was misread.*

### Away time caps at about one real hour, so 8 hours away earns the same as one

*High · Pacing · Run 4*

**Observation:** Run 4: every absence from 61 minutes to 8 hours gave the same '1,825 days' header ('you were away 8 h 0 min'); exactly 60 minutes gave 1,800. Twelve absences totalled ~47 hours. Away time runs at 0.5 game days per real second and stops at 1,825 days. The letter, README and How to play say only 'Time away passes at half speed, up to five years'.

**Problem:** Idle players plan around how long they are away. A night's sleep earns exactly what a lunch break does, nobody converts 'five years at half speed' into 'one hour', and the letter never says time was lost.

**Suggestion:** State the cap in real time ('the Ordo governs up to ~1 hour of your absence') and show 'capped: 7 h unused' in the letter. Consider a longer cap (8-12 h) or diminishing returns.

*Verification: Design intent, still frustrating. The ~61-minute cap is deliberate (docs/DESIGN.md:1133). Reproduced in browser: an 8-hour absence gave 1,825 days with no cap notice (src/game/offline.ts:20).*

### Two-tap confirms on permanent choices expire after 3 seconds with no countdown

*Medium · Interface · 10 of 10 runs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)*

**Observation:** Every run hit it. Run 5 read a card for ~20 s, then each tap only re-armed it; Run 6 needed 4 attempts at the Vicus (rank II) petition. Verifiers measured a fixed 3.0 s window with no countdown. On the Aedificia (build panel) and trade tabs, a background refresh cleared the armed state after ~2.4 s. Some reported '1 s' failures were slow harness taps.

**Problem:** The most important, irreversible choices punish the player who stops to read them. A tap after 3 seconds silently re-arms instead of confirming, so the button feels broken ('I tapped it three times!').

**Suggestion:** Keep the armed state until the player taps elsewhere or presses Esc, or show a draining ring of at least 10 s. Don't let background refreshes rebuild an armed card. For permanent choices, use a separate confirm sheet.

*Verification: Partly confirmed. 3 s window confirmed (src/ui/modals.ts:33). Refuted: the label never outlives the armed state, and the queue ✕ does show an armed state. Card growth doesn't cause misses.*

### Population growth gates every rank, but the game never shows the arrival rate or an ETA

*Medium · Pacing · 8 of 10 runs (1, 3, 4, 6, 7, 8, 9, 10)*

**Observation:** Run 7 waited ~1,000 days on 'Souls 50', then ~1,400 days to reach the 180 souls for Oppidum (rank III) at favour ×3, the cap, with 400k denarii (coin) unspent. Run 9 sat at 'Souls 420/700' for ~3,200 days. The Hospites Patentes (open gates) decree unlocks at 'Fifty souls', the same 50 the first petition needs. Advisors go 'Quiet' once Rome's favour passes ×1.5.

**Problem:** Long stretches offer nothing to do but watch a number, and the player can't tell if they are doing something wrong. Once favour hits ×3, coin and labour can no longer buy growth.

**Suggestion:** Show 'Settlers: about 1 family every N days' with its factors in the Souls tooltip and Census, and an ETA on the petition's Souls line. Have the Aedilis (housing advisor) name the limiter. Unlock Hospites Patentes with the charter. Let coin buy growth past ×3.

*Verification: Design intent, still frustrating. Observed ~20-25 souls/yr matches the design curve. No rate or ETA shown anywhere (src/game/people.ts:620). Real waits are 3-5 min at 10×, not 1-2 hours.*

### Capitolium crew is capped at 64, but the UI blames 'builders' and offers dead levers

*Medium · Pacing · 7 of 10 runs (2, 3, 5, 6, 7, 8, 10)*

**Observation:** The Capitolium (final temple) uses at most 64 builders. Run 3 clicked + 120 times to reach 192 builders; the ETA barely moved and 17 homes declined as wells lost hands. Run 8 saw 'Fabri (builders) 72/72' beside 'Sixty-four fabri at most': the extra 8 are town-wall builders counted as Capitolium crew. The builder share slider (max 40%) changes nothing for it.

**Problem:** The status line blames builders, yet adding builders or raising the builder share does nothing, and the works advisor still suggests it. Players pull hands off wells for nothing, and the 64 contradicts the 72 shown.

**Suggestion:** Show '64 of 64 builders (max)' on the Capitolium row and Fabri row, and say 'crew at maximum' instead of 'bottleneck'. Count wall builders separately. Stop the works advisor offering a higher builder share. Consider a coin-paid lever to speed a stage.

*Verification: Partly confirmed. Cap confirmed (src/game/balance.ts:153). But the Opera Magna and Horae Longae (work decrees) do speed it (+28%, +12%). The 2,000-3,000-day finale is the designed band.*

### Advisors push builds the town can't afford, with no route to the missing timber

*Medium · Advisors · 6 of 10 runs (1, 2, 4, 5, 6, 8)*

**Observation:** Run 6, d150: the Annonae (food advisor) 'Place' button put down a granary that sat 'waiting for 14 timber (not gathering yet)' for ~280 days. Run 5 hit the same at d160, with Aedificia (build panel) offering only Cistern and House plot. Fabrum (works advisor) said 'every day of production brings it nearer' at 0 timber a day. Run 1: Fabrum 'Quiet' at timber 6, stone 0.

**Problem:** In the first hour a one-click remedy creates a building that never arrives, and the materials advisor is silent exactly when materials are the blocker. Players learn to distrust remedies.

**Suggestion:** Don't offer Place for works whose missing materials have no producer; offer or unlock the producer first ('Place a lumber camp'). Add a Fabrum alarm on zero materials income, and name a source in '(not gathering yet)'.

*Verification: Confirmed in code. The granary remedy ignores cost (src/game/advisors/rules-annonae.ts:229), no advisor rule watches timber, and the lumber camp stays hidden until lesson VIII.*

### Roads through forest give free timber, but nothing in the game tells you

*Medium · Onboarding · 6 of 10 runs (1, 2, 3, 4, 8, 9)*

**Observation:** A free dirt road through woods drops the felled timber into stores: a verifier's 8-pace road gave 640. Run 2, Run 4 and Run 8 learned this only by reading the source, after 300-2,000 days stuck. The Timber tooltip's 'HOW TO GET MORE' lists only the lumber camp and trade. Placing a work on forest does preview 'fells N timber'; road drags show only 'N new · free'.

**Problem:** Newcomers stay stuck because the escape is invisible, while players who find it get a repeatable free refill that makes lumber camps feel pointless. Run 2 called it 'relief, but felt like a cheat'.

**Suggestion:** Show 'fells N timber' on road drags and toast the yield. Add 'Lay a road through the woods' to the Timber tooltip, and have the works advisor suggest it when timber is below a lumber camp's cost. Consider a small cost so camps stay useful.

*Verification: Reproduced. Reproduced in browser. Not unlimited: stock above the 300 cap spills next day. Preview-vs-credit mismatch (Run 9) not reproduced (src/game/hints.ts:65).*

### 'Ask the Ordo' (town council) builds can land out of reach of the house that asked

*Medium · Town council (Ordo) · 5 of 10 runs (1, 3, 5, 8, 9)*

**Observation:** Run 8: a Domus parva asked the Ordo for baths and a market hall. Both stood across town by d4180, and 110 days later the house still lacked both. Run 3: two requested shrines went up outside the canabae (civilian quarter) or unstaffed while Oppidum (town rank) waited on 56-63% coverage. Runs 5 and 9 found baths and temples outside the walls while stone houses waited.

**Problem:** The remedy is satisfied on paper but fixes nothing. Resources are spent while the real blocker remains, and the house-panel button never shows 'asked', so players ask twice.

**Suggestion:** Send the asking house, or the houses the advisor named, with the request and site within their reach. Mark the house button 'asked' or 'raising', and warn when no site can reach the house instead of falling back silently.

*Verification: Partly confirmed. Requests carry no house (src/ui/tabs/house.ts:86) and fall back silently to a general site (src/game/ordo/build.ts:684). Services the Ordo raises unasked always reach one waiting house.*

### Coin piles up after the first rank-up with little worth buying, so prices stop mattering

*Medium · Economy & balance · 5 of 10 runs (1, 2, 3, 4, 7)*

**Observation:** Run 3: 13.5k denarii at d728, 242k by ~d6200, 440k at the end. Run 4 went from 1,863 to 718k at victory; Run 1 reached 674k. Event costs of 40-300 and rank fees of 250-5,000 became 'no-brainers'. Run 7: 'Money stops meaning anything after Vicus' (village rank). Coin cannot buy builders, labour or concrete, the real bottlenecks.

**Problem:** The biggest number on screen means nothing. Taxes, trade and event choices lose their tension while the colony stalls on things coin can't buy.

**Suggestion:** Add coin sinks aimed at real bottlenecks: hire contractors, rush a work, buy concrete or extra timber shipments, sponsor settlers beyond the Veterans event. Consider event costs that scale with the treasury.

*Verification: Partly confirmed. Some sinks exist: upkeep, imports, festivals, Veterans at 80 per family, the Capitolium's 160,000 (src/game/balance.ts:154). None scale with the treasury; the design targets a growing surplus.*

### Continuing or closing the away letter unpauses the game, even if the player had paused

*Medium · Saves & sessions · 5 of 10 runs (2, 4, 6, 8, 10)*

**Observation:** Run 4 paused before leaving; 'Return to the city' resumed at 20× and a Legate choice card was down to '1 D'. Run 6 paused, reloaded and pressed Continue: running at 2×, with camera and zoom reset. Run 8's 'Petition Rome' letter button opened Edicta (decrees panel) while 24 days slipped by. Run 2 saw the same on iPhone via the close and remedy buttons.

**Problem:** A returning player loses choice-card time, and events fire before they can read the screen. The paused state is never saved, so a deliberate pause is ignored.

**Suggestion:** Save the paused state and restore it on Continue and after the away letter, or always return paused with a big Resume button. Save camera and zoom. Move focus to the panel a letter button opens.

*Verification: Reproduced. Reproduced in browser with a mouse pause; every letter exit calls setSpeed (src/ui/dispatch.ts:202). Resuming is documented design but ignores the player's pause. Import stays paused.*

### On touch, the map glides by itself when placing starts or a card opens, so taps miss

*Medium · Mobile & touch · 5 of 10 runs (2, 3, 5, 6, 7)*

**Observation:** Run 5 (d~12010): placement taps near the place bar landed a row off. Run 7: queued taps opened "TERRA Grassland" cards; at d10348 demolish taps hit another block. Verifiers: Place itself never moves the camera. Starting a placement glides the ghost 64 px inside the view (88 px on iPad); a phone map tap opens a card and pans up to 350 px. Run 3's jump was a minimap click.

**Problem:** Players making many precise taps cannot trust the map to stay put, and closing a card does not pan back. While placing, the minimap hides and the overlay toggles take its spot, so a click there afterwards recentres the camera.

**Suggestion:** Glide only when the ghost or target is actually hidden, not merely near an edge. Pan back when a card closes. Keep the overlay toggles and minimap in fixed places during placement.

*Verification: Partly confirmed. Two browser repros: Place and overlay toggles never move the camera; placement start (src/render/view.ts:403-408) and card-dodge glides do.*

### Pressing Space on the Victory letter dismisses it unseen and resumes at full speed

*Medium · Interface · 5 of 10 runs (3, 7, 8, 9, 10)*

**Observation:** Run 8: Space (the pause key) closed the Victory letter unread; the win showed only as 'POST VICTORIAM'. Run 9 and Run 10 thought the colony ran at 20× behind the letter. Verifiers found it is halted, but the HUD keeps 20× lit, and 'Keep governing' is autofocused, so Space closes the letter and resumes at 20×. Run 3 and Run 7 missed it through a test-harness Space press.

**Problem:** A keyboard player who presses Space by reflex loses the climax screen with no way to reread it, and drops straight back to top speed. The HUD gives no sign the game is held.

**Suggestion:** Focus the dialog itself instead of 'Keep governing', and stop Space from pressing buttons inside letters. Show the held state in the HUD while a letter is open. Resume paused or at 1× after victory, and let players reread the letter.

*Verification: Partly confirmed. The sim halts under any letter (src/main.ts:530), so 'keeps running' is wrong. Autofocus plus Space dismissal reproduced in browser (src/ui/keys.ts:57).*

### The active 'Ordo' toggle in the duties list is green text on orange, almost unreadable

*Medium · Text & readability · 5 of 10 runs (1, 4, 5, 8, 9)*

**Observation:** Runs 1, 4, 5, 8 and 9 each called the active 'Ordo' label in Mandata (the council duties list) near-illegible. Run 5 described it exactly: mid-green text on an orange fill with a green border, barely readable even with Large text. The inactive 'Mine' and the 'Hand over all' button read fine.

**Problem:** Who holds each duty is the key information on this screen, and it is the hardest thing to read. Green on orange is also a classic colour-blind clash.

**Suggestion:** Drop the green text colour from the active toggle so it keeps the dark text the orange button style already sets (5.8-8.1:1 contrast). Add an owner icon, such as a laurel for Ordo and a hand for Mine.

*Verification: Reproduced. CSS clash: src/styles/tabs.css:28 overrides the dark text of the orange button. Measured in browser at 1.14-1.6:1 contrast. The 'On' toggles below share the bug.*

### "Slow for news" drops to 2× silently and never restores speed, even after a reload

*Medium · Interface · 4 of 10 runs (1, 4, 5, 6)*

**Observation:** Runs 1, 4, 5 and 6: speed repeatedly fell from 5×, 10× or 20× to 2× with no message and stayed after the card was answered. Run 4 blamed Saturnalia, but festivals never trigger it; only choice cards do. Drops "with no card" were cards that expired unseen (15 s at 2×). The 2× is also saved as the preferred speed, so Continue and the away letter resume at 2×.

**Problem:** Players think they are running fast and watch at 2× for long stretches. Restoring costs two taps per event, and the slowdown quietly becomes the new default speed.

**Suggestion:** Remember the previous speed and restore it when the card resolves. Don't save the temporary 2× to preferences. Show a toast: "Slowed to 2×: Veterans at the gate [Back to 10×]".

*Verification: Partly confirmed. Reproduced: "Rust in the wheat" dropped 10× to 2× and saved speed 2; festivals left 10× alone. setSpeed overwrites prefs (src/main.ts:145).*

### Answered dispatches and granted petitions leave stale advisor cards behind

*Medium · Advisors · 4 of 10 runs (1, 6, 9, 10)*

**Observation:** Run 6 answered the Legate (fee 5,000 to 4,250), yet the card still said "4 days to decide · Read the dispatch", and that button now opened the Colonia petition. Runs 9 and 10 kept seeing "Rome would hear our petition for Oppidum" and "Saving for the petition…" after the grant. Runs 6 and 10 were still offered "Place" for a granary or shop row already queued.

**Problem:** A card that says "The dispatch awaits your answer" after the answer, with a button that opens something else, looks like a lost click. While paused it never clears. Players re-tap, reload, or learn to ignore advisors.

**Suggestion:** Clear dispatch and petition advisories the instant they are answered or granted instead of letting them fade over 3 days. Rebuild the Ordo (town council) report when a duty is handed over, a petition granted or a rank gained. Disable "Place it myself" when that building is already queued.

*Verification: Partly confirmed. Answered dispatch advisory lingers 3 game days with a frozen title (reproduced headless). Cards do refresh while paused; staleness comes from daily fades and caches (src/game/advisors/engine.ts:151).*

### Building on canabae (future town) land shows a green verdict plus "blocked"

*Medium · Text & readability · 4 of 10 runs (1, 5, 6, 10)*

**Observation:** Rural works may be placed on land reserved for the canabae (the future civilian quarter). The verdict reads "+40%" then "This land is surveyed for the canabae; the plots stay blocked until you move it." Runs 6 and 10 met it on the best spots, including the auto-pick. On Run 6's 412 px phone the all-caps lines ran off both edges; Run 5's bar cut to "This l…".

**Problem:** The placement is valid (green outline, Place enabled), yet "blocked" in gold reads as a refusal. "Move it" is unclear, and nothing says which plots are lost or when. Players avoid good spots or unknowingly block future houses.

**Suggestion:** Show one verdict in the bar, in normal case: "OK · uses canabae reserve, blocks future house plots until moved". Shade the reserve while placing, keep map labels inside the screen, and stop the auto-picked best spot from favouring reserve land.

*Verification: Confirmed in code. Allowed with a warning by design (src/game/place.ts:238). Labels use capitals-only Silkscreen, and lines wider than the view run off both edges, as Run 6's screenshot shows.*

### Early ranks arrive far behind the design pace; the full game mostly lands in its band

*Medium · Pacing · 4 of 10 runs (1, 2, 4, 5)*

**Observation:** Run 1 followed every advisor yet reached Vicus (rank II) after 1,020 days against a 573 target, and Oppidum (rank III) after 3,764 against 2,840. Across all 10 runs Vicus came at ~1.8× the target. Yet 8 of 10 victories fell inside the design's 11,000-17,500-day band, and Run 3 and Run 10 beat the 12,276 target. Away-heavy Run 2 and Run 4 took ~26,000 days.

**Problem:** The first hours, when new players decide whether to keep going, run nearly twice as slow as intended even for advice-followers. Most of that time is passive waiting or recovering from stalls.

**Suggestion:** Tune the Castra (starting camp) to Oppidum stretch against an advisor-following player, not the attentive bot. Remove the specific stalls (timber, gardens, free blocks, concrete label) so every session and absence shows progress, and make recovery actions one tap.

*Verification: Partly confirmed. Targets are medians for a bot acting every 5 days (docs/DESIGN.md:1446). The code's advisor-following bot wins on day 18,512; human followers did better.*

### Hard to find which homes need a service; 'Waiting for' chips only switch the overlay

*Medium · Interface · 4 of 10 runs (1, 2, 6, 9)*

**Observation:** Run 1 put a shop row west of the forum; the needy houses were east. Run 6 (d6922) saw 'Waiting for: 4 · a market' in Populus (population panel) and spent minutes panning to find 4 huts. Run 2 thought those rows did nothing. They are buttons, but they only switch on the housing overlay: no pan, no filter, and under a phone sheet the change is easy to miss.

**Problem:** The player sees how many homes are waiting but cannot get to them. The housing overlay shows a want icon only on homes missing exactly one need, so it cannot single out 'the 4 homes waiting for a market'.

**Suggestion:** Make each 'Waiting for' chip close the sheet, pan to those homes and pulse them, cycling on repeat taps. While placing a service, mark every home on the map that lacks it, not only those inside the ghost's reach.

*Verification: Partly confirmed. Chips are buttons that only set the housing overlay (src/ui/tabs/populus.ts:133). Placement already shows a laurel on the best plot and '+k houses could evolve' in reach.*

### Labour rows like "1 / 1 · 6" and the Populus tab badge have no labels

*Medium · Interface · 4 of 10 runs (1, 2, 9, 10)*

**Observation:** Run 2's first tutorial control (Lesson I) was a stepper reading "1 / 1 · 6" ("curious, slightly lost"). Run 10, at "0 / 3 · 7": "couldn't tell which number was mine". Runs 1 and 9 understood only after hovering. A target changed while paused shows "13 / 6" until time runs. The Populus (people panel) tab badge "17" counts idle hands, with no label or tooltip.

**Problem:** The core staffing numbers, including the tutorial's very first control, cannot be read at a glance. The same badge can also mean, in red, problems on the Watch list.

**Suggestion:** Label every row inline, e.g. "1 at work / 1 target · 6 posts", and show the existing legend in manual mode too. Give the tab badge a tooltip such as "17 idle hands".

*Verification: Confirmed in code. Row text is bare (src/ui/tabs/labour.ts:113). A legend appears only while the Ordo runs labour; manual mode, used in every reported case, says just "Labour: your targets".*

### No births for years in the early ranks, and nothing on screen says why

*Medium · Economy & balance · 4 of 10 runs (7, 8, 9, 10)*

**Observation:** Run 8 showed "Births · deaths a year 0 · 0.7" from day 274 to 1164, with 16 adults, 41 free beds, spirits 65 and full stores; population sat at 28-29 for ~500 days. Run 9 froze at 29 souls for 200 days ("worried it's broken"), Run 10 at 28 for six months, and Run 7 had no births from day 720 to 1656.

**Problem:** The player meets every condition the game names and nothing happens. The real lever, Rome's favour (from gardens and paved streets), is presented only as an immigration boost, so the colony looks stuck.

**Suggestion:** List birth factors in the Souls tooltip: fertile wives, food, spirits, Rome's favour. Say favour multiplies births. Point the Res Gestae (goals panel) "Fifty souls" card at gardens. Or raise the base rate until favour is earned.

*Verification: Design intent, still frustrating. Births are not blocked; the rate is 0.036 a year per married woman aged 16-42 (src/game/balance.ts:69), so 6-7 founding wives give ~0.3 births a year at favour ×1.*

### One house blocks a goal; the council never builds its need and advisors say "All is well"

*Medium · Town council (Ordo) · 4 of 10 runs (4, 7, 8, 9)*

**Observation:** Run 9, days 1041 to 1845: "Ten tiled roofs 9 / 10" for ~800 days because one hut lacked a shrine. The Ordo (town council) held the housing and services duties but never built one, and advisors said "All is well… Next: Ten tiled roofs". Run 7, day 2390: Vicus progress stalled ~400 days on one house waiting for a market. Runs 4 and 8 saw the same calm messages.

**Problem:** A delegating player expects the Ordo to build what the goal needs. It acts only when 2+ houses share a need, and advisors speak only at 3+, so the last house stalls the goal in silence.

**Suggestion:** Have the Ordo build any need blocking the current Res Gestae (goals panel) or petition count, even for one house. When a count goal stalls, have an advisor say "One hut needs a shrine. Ask the Ordo?"

*Verification: Partly confirmed. Ordo threshold is 2 houses (src/game/balance.ts:174), advisor threshold 3. Run 7's missing temple, market hall and baths came from no free building block, not this.*

### Advisors offer remedies that cannot work, and greyed buttons often hide their reason

*Medium · Advisors · 3 of 10 runs (1, 2, 7)*

**Observation:** Run 7 (d451, famine, before Vicus): "Buy 278 grain now" was greyed from the start; its reason, "No open market sells grain to us.", never says trade opens at Vicus (rank II). The Aedilis (housing advisor) offered the locked "Edict: Feriae Frequentes". Run 1: "Export 1 grain" with stock below the 30-day reserve; the Drought card's "Dig the wells deeper" (560 stone, 374 held) showed its reason only on hover.

**Problem:** In a crisis, buttons that can never work waste attention. Reasons say why but not how (when trade opens, what unlocks it). On event cards and the Consiliarii (advisors tab), the reason appears only on hover or click.

**Suggestion:** Drop remedies that cannot work now (closed market, locked edict, export with no surplus), as the grain run-out rule already does. Show reasons inline on event cards, and add the how: "Trade opens at Vicus", "We lack 186 stone".

*Verification: Partly confirmed. Every disabled button has a reason, often tooltip-only. Grain purchase, Feriae Frequentes and exports are offered unconditionally (src/game/advisors/rules-annonae.ts:89-92).*

### Handing food to the town council lets one field feed ~100 souls until a late rescue

*Medium · Town council (Ordo) · 3 of 10 runs (3, 5, 8)*

**Observation:** Run 5 and Run 8 handed Annona (the food duty) to the Ordo (town council) and reached ~100 souls on one field, with dozens foraging. Run 8's grain tooltip gave two run-out dates at once. Verifiers reproduced it: the Ordo built no fields through months of advisor warnings, including a red Periculum (danger), then raised 3 fields once grain fell below 30 days. Nobody starved.

**Problem:** 'Hand it over' reads as 'stop worrying about food'. Instead the player watches a red alarm stand for about three months while the council holding the duty does nothing, then scrambles at the last moment.

**Suggestion:** Let the Annona duty raise fields or hunters when the forecast shows the coming Hiems (winter) falling short, not only below 30 days on hand. Have the Ordo act on its own advisor's warnings. Show one run-out date in the tooltip.

*Verification: Partly confirmed. Reproduced in browser and sim: no new fields until grain falls below 30 days (src/game/ordo/build.ts:397), but zero hunger deaths. Run 3 had not delegated food.*

### Immigration crawls through Oppidum and Municipium, then floods at Colonia

*Medium · Pacing · 3 of 10 runs (1, 4, 6)*

**Observation:** Run 1: 324 to 341 souls in 500 days at Oppidum (third rank), then 809 to 1,201 in 540 days at Colonia (final rank). Run 4: one absence after Colonia took 775 to 1,257 souls, against 62 to 78 over five years at Vicus. Run 6: two 600-day absences after Colonia added about 490 souls, against ~25 per 500 days at Oppidum.

**Problem:** Growth is slowest where population gates progress (Oppidum needs 180+, Municipium 400+, Colonia 700+) and fastest at Colonia, where no population gate remains. Run 1 spent ~25 real minutes waiting only on souls.

**Suggestion:** Raise the Oppidum and Municipium immigration rates (0.002 and 0.0025 a day) and soften Colonia's 0.04, or tie the late wave to a goal that still needs people.

*Verification: Design intent, still frustrating. Colonia's rate is exactly 20× Oppidum's (src/game/data/ranks.ts:42), by design (DESIGN.md:357). Castra and Vicus base rates are actually higher than Oppidum's.*

### On laptop screens, side columns and the placement bar leave a small map to build on

*Medium · Interface · 3 of 10 runs (1, 3, 9)*

**Observation:** Run 9 at 1280×720 estimated about 580×420 px of usable map; the verifier measured 590×472 while placing, between the 310 px left column and the 380 px right panel. Run 1 found the placement bar faint and covering the spot to build. It flickers: each tile hovered rebuilds it and restarts a fade-in from transparent. It does not cover the zoom buttons.

**Problem:** At 1280×720 only about 30% of the window is free map while placing, and the banner fades in and out exactly while the player aims. Players build in cramped spots or pan constantly.

**Suggestion:** On desktop, fold the left column, which holds the Res Gestae (goals panel), counsel card and inspector, to a chip while placing, as screens under 1,200 px already do. Build the placement banner once and update its text in place.

*Verification: Design intent, still frustrating. Layout is by design per DESIGN.md. The camera already pans the map clear of the column. The banner flickers because every hovered tile rebuilds it (src/ui/mapbar.ts:380).*

### On phone and tablet, the number font draws 5 almost exactly like S

*Medium · Text & readability · 3 of 10 runs (1, 2, 5)*

**Observation:** Run 5 (iPad, Large text) read 3,556 as "3,SS6" and 51/93 as "S1/93". Run 2 (phone) saw "S,609" and "Souls: S2 / S0". Run 1 (desktop) misread a trade preview "+282 den" as "+888". Phone and tablet layouts switch coin, souls and day counts to Pixelify Sans, whose 5 matches S. Desktop's main HUD figures use Silkscreen and read fine.

**Problem:** Numbers are the core information. Misread stocks and requirements lead to wrong decisions, and Large text does not help because the glyph shape, not the size, is the cause.

**Suggestion:** On phone and tablet, put HUD figures back in Silkscreen (its 5 has a flat top), as DESIGN.md already specifies. Use the same face for trends, sub-lines and requirement counts like "Souls: 52 / 50" on every device.

*Verification: Partly confirmed. Rendered fonts confirm Pixelify's 5 matches S. Touch layouts override the Silkscreen rule (src/styles/hud.css:252). Large text does scale the HUD by 1.25; that claim was false.*

### On touch, placing ends after every single building, so bulk building costs many taps

*Medium · Mobile & touch · 3 of 10 runs (2, 5, 6)*

**Observation:** Run 2: 7 works took 7 trips, about 35 taps. Run 6 (d4700-4904): 6 buildings took about 25 taps and 6 long scrolls. Run 5 (d874): 4 house plots at about 5 taps each. House plots and fields have a ⟳ "Keep placing" toggle, off by default; no tester mentioned it, which explains Run 2's "inconsistent" house plots.

**Problem:** Mouse users can Shift-click to keep placing any type; touch has no equivalent for single buildings. On phones the Aedificia (build panel) also forgets its scroll after each Place, so the card must be found again every time.

**Suggestion:** Offer "Place another" on touch for every building type. Label the ⟳ toggle in words. On phones, keep the catalogue's scroll position after a successful Place, as Cancel already does.

*Verification: Design intent, still frustrating. Single buildings never keep placing on touch by design (src/ui/mapbar.ts:64-66, DESIGN.md:1253). Reproduced on phone; the iPad dock keeps its scroll.*

### On touch, the advisor card folds and unfolds by itself, moving buttons 130 to 180 px

*Medium · Mobile & touch · 3 of 10 runs (2, 5, 7)*

**Observation:** Run 7: a tap on "−" for Food hit Water, worsening a famine the tester had caused on purpose. Run 5 (iPad, d874): the tab row kept moving and taps hit the tip card. Verifiers: about 1 s after a lesson completes the card folds itself; phone list rows jumped 147 px, iPad tabs moved from y=121 to y=256. Run 2's "Populus" mis-tap was a harness artifact.

**Problem:** Controls move under the finger with no input from the player. Unfolded, the card can take 60 to 62% of the pane, leaving one list row visible on a phone at half height.

**Suggestion:** Never fold or unfold the card within a moment of a touch. Cap the unfolded card at a smaller fixed height, and on the tablet pin the tab row above it.

*Verification: Reproduced. Auto-fold measured on phone, landscape phone and iPad (src/ui/counsel.ts:341-349). Content is pushed down, not covered; the hover hold protects mouse users only.*

### Remedy clicks give no confirmation, and the Capitolium card offers levers already in force

*Medium · Advisors · 3 of 10 runs (3, 4, 8)*

**Observation:** Run 3 (d8473): "Edict: Opera Magna" was offered greyed, in force since d809; Run 7 saw "Builder share" offered at its 40% maximum. Run 4 (d23,895): after clicking both, the card still read "751 d" with no toast. Run 8 (d12268): the grain reserve stepped 45, 60, 75, 90; the "78" was a pixel-font misread of "75", and it stops at 120.

**Problem:** Card text and forecast refresh only at the next game day, never while paused, so a click looks dead. Raising builder share cannot speed the Capitolium (victory temple) at all: its crew is a fixed 64.

**Suggestion:** Filter in-force and useless remedies in the Capitolium rule, as other rules do. Confirm each click with a toast and re-forecast at once ("now ≈ 610 d"). Rebuild Consiliarii (advisors tab) buttons after edict and setting clicks.

*Verification: Partly confirmed. Label and applied value always match (src/game/advisors/remedies.ts:245). The Capitolium rule always offers Magna and builder share; title and metric wait for the daily pass.*

### Speed keys 2 to 4 silently do nothing in lessons I-VI, and pressing them unpauses the game

*Medium · Onboarding · 3 of 10 runs (4, 8, 9)*

**Observation:** Runs 4, 8 and 9: during the first lessons (days 90-219, ~10 real minutes) keys 2 and 3 did nothing and nothing said why ("why won't 2 work?"). Run 8: each locked key pressed while paused unpaused the game at 1×; verifiers reproduced this. How to play lists keys 1-4 throughout. "1 to 4" is correct: 20× on key 5 exists only in the dev builds testers used.

**Problem:** Controls that silently do nothing feel broken, and a player trying to set a speed while paused accidentally starts time.

**Suggestion:** On a locked key, keep the pause state and show "Faster speeds unlock with lesson VII". Note the lock in How to play. Keep "1 to 4" as is.

*Verification: Partly confirmed. Reproduced live: keys 2-4 clamp to 1× and unpause (src/main.ts:141). The lock is designed (DESIGN.md:1003); the "five speeds" claim was a dev-build artifact.*

### Standing grain exports keep selling into a Hiems (winter) famine

*Medium · Economy & balance · 3 of 10 runs (3, 9, 10)*

**Observation:** Run 10: a standing 'Sell 80 grain' contract ran 94 trips through the d1325 winter warning ('need 4,976 by Kal. Dec., hold 3,840') and the colony starved at d1484. Run 3 and Run 9 saw grain exports continue through famines too. Later, with 12,600 spare grain, loads were capped at 80 per trip. Understaffed fields caused the shortfall; the export made it worse.

**Problem:** The trade tab promises a standing contract 'pauses itself rather than hurt us', but it stops only at a flat 30 days of stock. The winter forecast ignores exports and never points to the trade reserve setting.

**Suggestion:** Make standing grain exports keep the winter target in reserve, or link the winter warning to the 'Trade reserve' setting. Count standing exports in the grain forecast. Add 'sell only above N' to contracts.

*Verification: Confirmed in code. Exports check only stock against the trade reserve, never the season (src/game/trade.ts:127). The reserve is adjustable (10-90 days); the 80-unit cap is designed.*

### The Annales (chronicle) keep only 400 lines, so caravan noise pushes out the founding

*Medium · Text & readability · 3 of 10 runs (1, 3, 9)*

**Observation:** Run 9: by day 3,500 the founding, the first veterans and the first Legate were gone, and the Fasti (yearly record) showed only 3 years, then 1 after victory. By day 600 about 70% of lines were caravan returns. Run 3 (6 contracts) and Run 1 saw caravans and "No room in our stores for 80 more stone" bury events like Fever, also in the ticker.

**Problem:** For narrative players the Annales are the story. They lose the beginning and keep ledger noise, and the per-year Fasti, which the design promises for every Parilia (founding festival), lasts only 2 to 3 years.

**Suggestion:** Keep highlights (events, rank-ups, Parilia lines) outside the 400-line cap. Fold caravan returns and contract pause and resume lines into one monthly trade summary. Keep the newest real event in the ticker longer than routine lines.

*Verification: Partly confirmed. Cap and Fasti loss confirmed (src/game/state.ts:284). Spill lines are already limited to one per 30 days per resource, and each pave drag logs one line, not many.*

### A red water alarm sits for years with no working fix while advisors contradict it

*Medium · Advisors · 2 of 10 runs (5, 9)*

**Observation:** Run 5, day ~6500 to the end: a red Periculum (top-level alarm) "N homes are declining: water lapsed" never left. Its Place button was often greyed, and the Curator (water advisor) said "no free plot near them can take a fountain or a well yet". Run 9, day 5183: after a demolition cut water to 4 homes, the Aedilis offered "Ask the Ordo for a well"; none came.

**Problem:** Dry homes decline forever, so the unhushable red card never clears and teaches players to ignore red. The Aedilis (housing advisor) offers a well anywhere on the map while the Curator says none can reach, so the advice conflicts.

**Suggestion:** Make the Aedilis remedy reach-aware like the Curator's and merge both into one card with one honest fix ("no plot reaches them: demolish X"). With no remedy, drop to a hushable warning and fix the "falls back a tier today" countdown.

*Verification: Partly confirmed. The Aedilis well remedy ignores reach (src/game/advisors/util.ts:210-212). Red only while 10%+ of houses decline. The Fabrum "well in 1 day" was a stale forecast, not a sited plan.*

### Advisor "Import 80 grain" buttons only fill in the trade form; nothing is sent

*Medium · Advisors · 2 of 10 runs (3, 10)*

**Observation:** Run 3, day 1465, winter famine: the grain advisor's remedies "Import 80 grain from Oppidum Silvanum" and "Export 80 grain to Pagus Durii" only filled in the Commercium (trade panel) form. Nothing left until the player found "Send the caravan"; they thought grain was coming ("nothing tells you it's not sent"). Run 10, day 4854: the oil import remedy did the same. The house inspector's import buttons behave alike.

**Problem:** The label reads as an order but only drafts a contract. In a famine the player waits for grain never ordered. The gold pulse scrolls to the form's top, not the Send button.

**Suggestion:** Either send the caravan on click with a toast ("Caravan sent: 80 grain from Oppidum Silvanum, back in N days · Edit"), or relabel it "Draft import: 80 grain…" and scroll to and flash "Send the caravan".

*Verification: Design intent, still frustrating. Pre-fill is designed (docs/DESIGN.md:865, "one more click sends"), but the imperative label misleads (src/game/advisors/remedies.ts:248). Phone below-the-fold case not checked live.*

### Aqueduct springs are tiny unmarked dots, and the Aqua overlay doesn't show them

*Medium · Interface · 2 of 10 runs (1, 3)*

**Observation:** Run 1 (d8535) placed the castellum (water tower): '44 arches from the spring', cost rising 150→326 den and 40→392 stone. The Aqua (water) overlay showed no spring, so the tester asked the Ordo (town council). Run 3 (d6182) saw '59 ARCHES FROM THE SPRING' and the arcade, but could not choose the route or find the cheapest plot. Run 1's screenshots show a faint route preview under the left panel.

**Problem:** The signature build of the Municipium rank can't be planned. The spring is one unlabelled tile, the overlay named for water leaves it out, and each plot's cost appears only by hovering it.

**Suggestion:** Mark and label springs on the map and in the Aqua overlay. Draw the route preview bolder and keep it clear of side panels. Tint valid plots by route cost and mark the cheapest.

*Verification: Reproduced. Browser repro: spring is a rock-sized dot and the Aqua overlay omits it (src/render/overlays.ts:76). Route preview does exist; cost is +4 den, +8 stone per arch.*

### Asking the Ordo (town council) to build promises "2 days" it often cannot keep

*Medium · Town council (Ordo) · 2 of 10 runs (1, 8)*

**Observation:** Run 1 asked for a granary with 6 timber, 0 stone and no income. The log said "will raise within 2 days if the stores allow"; nothing came for 20+ days. Run 8 asked for a lumber camp (10 timber) holding 2 timber at ±0 a day, days 274 to 493. It was never built. The agenda only said "(not gathering yet)", with no hint of a source.

**Problem:** The "2 days" is not a real timer. The request retries daily, is silently dropped after 180 days, and cannot use timber the camp itself would fell, since cost is paid first.

**Suggestion:** Check cost against stock and income when asked. Replace the ETA with what is missing and how to get it, e.g. "needs 8 timber; no timber income: lay a road into the forest". Log a message when a request expires.

*Verification: Confirmed in code. The ask checks rank, count and a free slot, never cost (src/game/ordo/actions.ts:38-46). The Aedificia (build panel) tooltip says "within 2 days" with no hedge at all.*

### Choice cards expire in game days and never pause, so decisions are lost by glancing away

*Medium · Pacing · 2 of 10 runs (1, 10)*

**Observation:** Run 1: a "Veterans at the gate" card had 2 days left when the tester looked; Slow for news had dropped to 2×, where a 30-day card lasts 15 real seconds. Run 10, day 2,569: a Veterans card was nearly gone when noticed. Only red advisories can pause the game ("Pause on Periculum", i.e. danger), and that is off by default. At 10× a 30-day card lasts 3 s.

**Problem:** Decisions with lasting effects resolve to the silent default while the player looks away. The design floor of 25 game days gives a real person about 15 seconds at 2×.

**Suggestion:** Add a "Pause on choice" option for event cards, on by default for new players, or run the card's timer in real time with a game-day floor.

*Verification: Design intent, still frustrating. Cards are non-modal and expire on game days; never pausing is designed (DESIGN.md:1038). Only pauseOnCritical exists, default off (src/game/save.ts:47).*

### Double-clicking 'Send the caravan' makes two contracts, and the form never resets

*Medium · Interface · 2 of 10 runs (8, 10)*

**Observation:** Run 8 (d~1240) double-clicked 'Send the caravan' and got two identical rows in Pacta (contracts list). Run 10 (d1156) made a duplicate because nothing in the form changed: the new row lands off-screen and 'Standing' stays ticked. Verifiers reproduced it: one double-click made two identical standing contracts. The only feedback is a coin sound and a ticker line, with no toast.

**Problem:** In the busiest trade form it is easy to send duplicates or carry over old settings. Run 10's accidental 'Buy (import)' was most likely the earlier Buy mode left in the form.

**Suggestion:** Disable the button for about 500 ms after a send, toast 'Contract drawn: …', and untick Standing after each send. Keep allowing identical contracts on purpose, since each runs its own mule team.

*Verification: Reproduced. Reproduced in headless Chromium; the handler has no guard and the draft persists (src/ui/tabs/commercium.ts:122). The layout-shift misclick was not reproduced.*

### Floods idle riverside fields for 20 days and the game barely says why

*Medium · Economy & balance · 2 of 10 runs (7, 9)*

**Observation:** Run 7 (d451): the famine advisor said 'our fields and lodges give 0 a day'; the flood appeared only as a chip in the Res Gestae (goals panel). Run 9 (d3715): all 3 riverside fields flooded, 2 of them placed by the Ordo (town council), grain at −162/day. The field card read 'Total 0' with its 'Idle until' line cut off below the fold. A 'Silt +15%' chip showed instead.

**Problem:** A 20-day outage reads as a permanent collapse, so the player cannot tell whether to wait, re-staff or build elsewhere. The Ordo keeps siting fields in the flood zone because its best soil lies exactly there.

**Suggestion:** Put 'Flooded until a.d. …' in the field's output chain and as a red chip that stays visible. Name the flood and its end date in the famine text. Give the Ordo's field siting a flood-risk penalty.

*Verification: Partly confirmed. Card has only a muted 'Idle until' flag, no flood factor (src/ui/inspector.ts:721). Exports stop at the 30-day floor; loam matches the flood radius exactly.*

### Grain sheds overflow while trade says the 30-day reserve is not yet met

*Medium · Economy & balance · 2 of 10 runs (1, 8)*

**Observation:** Run 1: stores at 100% ('sheds overflow, 72 grain/day spills') with 26 days on hand, next to 'Our grain caravan… stands idle: we keep 30 days of grain in reserve'. With one horreum (granary) the cap is 4,600; at about 177 grain a day, 30 days needs about 5,310, so the caravan can never leave. The advisor then offered a disabled 'Export 1 grain' button.

**Problem:** Two systems contradict each other on screen. The trade card's advice, 'Lower the reserve, or let the stock grow', cannot be followed, because the stock can never grow past the cap.

**Suggestion:** Cap the grain export reserve at what storage can hold, for example the lower of 30 days and 90% of cap. Add the tooltip line the design already specifies: 'Sheds hold 600. Each Horreum adds 4,000 (N days at today's need)'.

*Verification: Design intent, still frustrating. The export reserve ignores storage capacity by design (src/game/trade.ts:109). The cap tooltip in DESIGN.md:481 was never implemented.*

### How to play is about 260 words of unglossed Latin, and its panel hotkeys are unnamed

*Medium · Onboarding · 2 of 10 runs (1, 9)*

**Observation:** Run 1 and Run 9 met Ordo Decurionum, Edicta → Mandata, Aedificia, Aestas/Hiems, horrea and Kalends with no English gloss and no glossary anywhere. The keys line reads "E V B P T L panels" without saying which letter opens which panel; Run 9 was "a bit lost". The "1 2 3 4" speed keys are complete: the released game has only four speeds.

**Problem:** A newcomer must learn a vocabulary before having any context for it, and cannot match hotkeys to panels. The game's own design rules ask for an English sub-label on every Latin label.

**Suggestion:** Gloss each Latin term on first use, e.g. "Ordo Decurionum (town council)". Spell out the keys: E Edicta (decrees), V Consiliarii (advisors), B Aedificia (build), P Populus (people), T Commercium (trade), L Annales (chronicle).

*Verification: Partly confirmed. Text confirmed at src/ui/modals.ts:317. The "list all 5 speed keys" idea is wrong: key 5 and 20× exist only in the dev build.*

### Large text overlaps the lesson header, runs advisor names together and hides the date

*Medium · Text & readability · 2 of 10 runs (5, 8)*

**Observation:** Run 5 (iPad, Large): the lesson kicker "DISCIPLINA ·" spills 10 px under the progress count, and the Consiliarii (advisors tab) labels read "AnnonaeAquarumFabrumQuaestor". Run 8: at 1440×900 the date chip vanished; at 1024×768 timber and stone went too. Verifiers found the date hidden by a fixed rule even with half the bar empty; the season row on the grain and water tablets stays.

**Problem:** The setting meant for older or low-vision players breaks what they read most: the lesson header, the advisor row and the HUD. At 1024 px, timber and stone, which Run 8 was short of, vanish.

**Suggestion:** Measure the HUD row instead of hiding the date below 1,760 px, or show a short date ("Oct · Avt"). Never drop a resource that is near zero. Put the lesson kicker and progress on separate lines, and let advisor labels wrap or abbreviate at Large.

*Verification: Reproduced. Reproduced in browser by both verifiers. A fixed rule hides the date below 1,760 px (src/styles/hud.css:203). At 1024 px name and date drop even at Normal.*

### Lex de annona (emergency food law) silently overrides manual labour and building

*Medium · Town council (Ordo) · 2 of 10 runs (7, 10)*

**Observation:** Run 7 (d~375), labour set by hand, food at 1: the log said 'Lex de annona… 13 more hands go to the fields and wells'. One tap in Edicta (decrees panel) switched it Off, unwarned; starvation followed about 20 days later. Run 10 (d1484-1515), every duty set to 'Mine': the Ordo (town council) built 3 hunting lodges and 2 fields, and food labour read '32 / 14 · 32' unexplained.

**Problem:** The law adds workers above the player's target and builds survival works, announced only in passing log lines. The row still shows the player's own number. Switching it off ends rations, the water pause and the extra hands at once.

**Suggestion:** Show a banner while the law acts ('The Ordo is adding hands and building until grain holds 25 days') and mark affected rows. Ask for confirmation before switching it off, listing what stops. Link the law from the grain advisor.

*Verification: Confirmed in code. The emergency staffing floor applies under manual labour (src/game/ordo/labour.ts:339); the switch is a plain one-click toggle with no consequence text.*

### Manual staffing is a click-per-hand grind, and the Shift-click step of 5 is never shown

*Medium · Interface · 2 of 10 runs (3, 10)*

**Observation:** Run 3 needed ~30 clicks for one rebalance at 128 souls and 120 clicks on builders at d8473, then gave staffing to the Ordo (town council). Run 10 logged bursts of +35, +80, then −50. The '−' button shifts left as the count widens (x 1240 to 1217), and rows jump 18 px when 'The Ordo would assign N.' hints appear, so repeat clicks miss.

**Problem:** With hundreds of workers, staffing becomes error-prone repetitive clicking. Both testers asked for Shift-click ±5, which already exists, but nothing tells a mouse player. Targets can also run past the 64-builder crew cap without warning.

**Suggestion:** Show 'Shift: ±5' in the button tooltip and in How to play. Add an editable number or 'Max' per row, clamp targets to available posts and the crew cap, and give the count a fixed width so buttons and rows stay put.

*Verification: Partly confirmed. Reproduced in browser: plain click ±1, Shift-click ±5 (src/ui/tabs/labour.ts:71) with no tooltip; '−' moves ~9 px per extra digit; rows move 18 px.*

### New works-queue rows push the build tools and Place buttons down by about 80 px

*Medium · Interface · 2 of 10 runs (1, 4)*

**Observation:** Run 1: after a placement the Place buttons moved down and a repeat click opened an Insula (block) card. Run 4: the Demolish button, which is in Aedificia (build panel), not Edicta, moved as the Agenda grew; a muscle-memory click hit Road ("Something already stands here." four times). Verifiers measured +79 px at 1280x720 and +80 px at 1440x900 with the panel near its top.

**Problem:** Repeated workflows (place, then back to the panel) meet a moved target. The scroll anchor only protects when the mouse rests on the panel or the tool row is already scrolled to the top.

**Suggestion:** Put the works queue and Agenda below the catalogue, or give them a fixed-height box. Keep the Road/Pave/Reserve/Demolish row fixed. Teach Shift-click to keep placing the same work.

*Verification: Reproduced. Order set by design (src/ui/tabs/aedificia.ts:240-281, DESIGN §15.3). Shift reproduced at scrollTop 0 and 150; at scrollTop 300 the anchor held.*

### Petition items like 'Insulae and domus 10/12' (better houses) never say what blocks them

*Medium · Interface · 2 of 10 runs (2, 4)*

**Observation:** Run 2 sat at 'Insulae and domus 10/12' for about 3,000 days (d17207-20232) and got bored; bulldozing a garden block for a third market hall fixed it. In Run 4 only the house card's 'TO BECOME INSULA' checklist named the blocker: 'I had to dig for it'. Populus (population panel) and the Aedilis (buildings advisor) also name the need, but the advisor goes quiet when no free block exists.

**Problem:** In the exact stall both runs hit, with no free block for the needed service, every pushed message goes silent. The petition list in Edicta (decrees panel) says only 'The Ordo works toward these on its own'.

**Suggestion:** Make each unmet petition item tappable, jumping to the most-blocked houses or the housing overlay. Keep the 'no free block' advice on the counsel card and in the away letter, and say the petition is waiting on it.

*Verification: Partly confirmed. Checklist is plain text (src/ui/tabs/edicta.ts:88). The Aedilis advice drops to a hidden note when no block is free; houses missing 2+ needs are never counted.*

### Placement refusals and path texts use undefined Latin and never say what to do instead

*Medium · Text & readability · 2 of 10 runs (7, 9)*

**Observation:** Run 9 met "Reserved by the groma." (surveyor's tool), "Inside the pomerium (town boundary) only urban works.", path text "lacus cost ×0.5; care +0.2", bare advisor tabs "Annonae", "Aquarum", "Fabrum", and "Praetentura" in water advice. Run 7's temple on the empty central block got "Reserved by the groma." with no reason; it was kept for the Capitolium. Dignitas, Stabilitas and the top-bar date do have hover definitions.

**Problem:** Players cannot tell which words matter, and refusals say no without saying why or where else to build. In Run 7, 13 cottages waited about 900 days for a temple.

**Suggestion:** Give every refusal a reason and an action, e.g. "Kept for the future Capitolium; build on another block". Use English names in path texts ("Public fountain"), add English sub-labels to advisor tabs, and define groma, pomerium and Praetentura on hover.

*Verification: Partly confirmed. Refusal strings confirmed at src/game/place.ts:44, breaking the design rules on reasons and English sub-labels. Wrong: castrum and pomerium are different zones; Dignitas and dates have tooltips.*

### Skipping the introduction hides the build and people panels longer than the tutorial

*Medium · Onboarding · 2 of 10 runs (3, 7)*

**Observation:** Run 3 and Run 7 chose 'I know the camp: skip the introduction' and saw only Edicta (decrees panel) while the game ran at 1×. B and P did nothing. Res Gestae (goals panel) said 'The Ordo is already raising one; Aedificia opens once it stands', yet the Ordo (town council) held no duties. Verifiers found Populus (people panel) opens on day 100 and Aedificia (build panel) on day 110.

**Problem:** A veteran who skips gets fewer panels than a tutorial player, who sees Populus at once. Hotkeys fail silently and the goal text promises a build that never starts. On phones the objective hides inside a closed pull-down.

**Suggestion:** On skip, unlock Aedificia, Populus and the tools at once, and stay paused until the player closes the letter. Fix the Res Gestae hint. Give B and P a toast when a panel is locked. Show the objective outside the phone pull-down.

*Verification: Partly confirmed. Reproduced on desktop and phone: panels open on 10- and 20-day timers (src/game/reveal.ts:58), not after the first building. Grain lasts ~60 days, so no real famine risk.*

### The Veterans card's silent default sends settlers away even when granting land is cheap

*Medium · Economy & balance · 2 of 10 runs (1, 3)*

**Observation:** Run 1, day ~1,564: the default "Send them on" lost 9 settlers while the tester had 17k den, 30 free beds and a grant cost of 240 den. Run 3: five Veterans cards (8-11 souls each); expired ones went "sent on to Colonia Augusta" while souls were the only petition blocker. The card appears only with 8+ free beds and population below Rome's roll, so granting is nearly always possible.

**Problem:** In the population-starved phase, looking away throws away free growth for +2 dignitas (standing) for a year. The game calls this the Ordo's (town council's) "cautious path", though no Ordo logic weighs it.

**Suggestion:** Make the silent default "Grant land" when beds are free, the cost is affordable and souls block the petition. Add a "−N souls" chip to the Send option.

*Verification: Design intent, still frustrating. Default is fixed at option 2 (send); expiry checks only cost (src/game/events-catalogue.ts:170). Designed as the cautious option, DESIGN.md:644.*

### The Victory dispatch closes on one stray tap or Esc and can never be reopened

*Medium · Interface · 2 of 10 runs (5, 8)*

**Observation:** Run 5: the Capitolium was dedicated during an unattended 20× run and a scripted tap closed the dispatch. Run 8 closed it via a Space press on the focused "Keep governing" button. Nothing in the Menu, Annales (chronicle) or Res Gestae (goals panel) reopens it. A Fasti (roll of colonies) entry exists, but it omits births, arrivals, works raised and legacy.

**Problem:** The game's closing summary is shown exactly once, and a backdrop tap (tablet and desktop), Esc or Back dismisses it with no confirmation.

**Suggestion:** Make the Fasti entry clickable to reopen the dispatch, and add "Read the dispatch again" to the Menu. Mark it non-closable like the founding letter, so only its buttons dismiss it.

*Verification: Confirmed in code. The Victory modal is closable by default and opens only from a one-shot event (src/ui/dispatch.ts:206). Both playtest losses were harness inputs.*

### The advised remedy plot is unmarked and lost once the mouse moves; no key accepts it

*Medium · Advisors · 2 of 10 runs (1, 10)*

**Observation:** Run 1: "Place it myself" pre-positions the ghost, but it jumps to the cursor once the mouse moves. Run 10 (d3031): "Place a well" showed "+6 houses could evolve" but not where; tries hit "That plot is taken." and "The survey keeps this line for a street." (about 5 attempts). Run 10 (d3434): "until a block near them is cleared" named no block, and 4 gardens were demolished.

**Problem:** The only lasting marker, the laurel, marks a general best slot, not the advised plot, so it can point elsewhere. Mouse players must find the exact plot by trial and error, and nothing shows which block to clear.

**Suggestion:** Pin a marker on the remedy's own plot for the whole placement and let Enter accept it. When a block must be cleared, highlight that block.

*Verification: Confirmed in code. The first hover replaces the pre-set ghost (src/render/view.ts:571-586); the laurel uses the general best slot, not the remedy's tile. No Enter key for placing.*

### 'Water lapsed' means no well within reach, yet appears while stored water rises

*Medium · Advisors · Run 1*

**Observation:** Run 1: the Aedilis (housing advisor) said "4 homes declining: water lapsed" while the top bar showed water at 21 days and rising. "Lapsed" means the house is not within road reach of an open, staffed well, cistern or fountain. Stored water plays no part in any house need, and an unstaffed well covers nothing.

**Problem:** The two messages look contradictory. A newcomer adds water production, which fixes nothing, while the homes keep sliding toward losing a tier after about 80 days.

**Suggestion:** Reword to "4 homes out of reach of a well", and let the card highlight the uncovered homes and the nearest gap in coverage. Mention when a well has no workers.

*Verification: Confirmed in code. The house water need checks only service coverage, never the store (src/game/housing.ts:87).*

### A petition ready mid-absence sits idle; the Ordo (town council) can't carry it

*Medium · Pacing · Run 4*

**Observation:** Run 4: souls reached the Vicus (village rank) threshold around day 2,669, but the petition was made only on return at day 4,258, so up to ~1,590 of the 1,825-day absence (87%) idled at Castra with stores spilling. Municipium sat ready for up to 700+ days. These are upper bounds from souls alone. The away letter says "Rome would hear our petition" but not since when.

**Problem:** Idle players return to find most of their absence wasted on a click only they can make. Meanwhile the Ordo holds the fee aside, which squeezes its spending at later ranks.

**Suggestion:** Add an opt-in Ordo switch "Carry petitions when ready": the Ordo pays the fee and ranks up, and the path choice waits for the player (rankUp is already a separate function). At minimum, store and show "ready since day N".

*Verification: Design intent, still frustrating. Only the Edicta (decrees panel) button calls choosePath (src/ui/tabs/edicta.ts:119); no ready date is stored. Deliberate per DESIGN.md:543.*

### Famine barely shows on the map, and the mentor's death is only a log line

*Medium · Economy & balance · Run 7*

**Observation:** Run 7, days 348-451, safeguards switched off on purpose: grain and water hit 0. Population fell from 27 to 19 and morale from 60 to 13 ("despondent"); the dead included the mentor Decimus Cassius. No one emigrated and no unrest followed. The map stayed sunny with a tiny "!". Recovery took the legion's grain relief, restaffing, the Lex de annona (grain law) back on, and a flood ending.

**Problem:** A famine that kills the mentor should feel like a disaster; here it is numbers in a ticker. Despondent morale has few visible effects, and edict texts warn of "unrest" that has no mechanic.

**Suggestion:** Add persistent map cues (gaunt walkers, empty stalls, desaturation) and a dispatch card for the first starvation death and for Decimus. Departures already exist below morale 25 at 2% per household per day; consider raising that rate.

*Verification: Partly confirmed. Departures exist (src/game/people.ts:580-587); zero in 45-70 days below 25 was 24-40% likely. No game over is by design (DESIGN.md:32).*

### Grain jumps from deficit to overflowing sheds within a week of adding field hands

*Medium · Economy & balance · Run 1*

**Observation:** Run 1: after 4 more field hands, grain went from "−7/day falling" to "sheds overflow, 81/day spills". In a normal start, +4 hands gives +36 a day, then +51 once Aestas (summer) begins; the 600-grain sheds fill in about 6 days. Only 2 hands balance. Meanwhile the Ordo (town council) staffing hint, "The Ordo would assign 6", points at overflow.

**Problem:** The balance point is one hand wide, and lesson 1 (at least 4 hands) and the council's hint both push past it. The field's "6 hands × 6 grain a day" understates the real 11 to 15 a hand.

**Suggestion:** Make "The Ordo would assign N" show the balancing number before the sheds fill, lower lesson 1's target to 2 hands, and correct the field's per-hand figure. Optionally add a target marker on the fields row.

*Verification: Partly confirmed. Simulated on 10 seeds: +4 hands swings −7 to +51 a day, not +81. The hint stays at 6 until stores reach 95% (src/game/ordo/labour.ts:314).*

### Hands-on labour management never beats the Ordo; only good placement speeds the game

*Medium · Economy & balance · Run 3*

**Observation:** Run 3 (veteran) won 10,414 days after founding: 2.7x faster than the Ordo (town council) alone and 15% ahead of the attentive-player target, helped by the Iuppiter vow (Capitolium work ×0.8). The tester credited about 6 well-chosen placements and 3-4 demolish-and-drop moves, and said "Fine-grained labour micro gained nothing." The 2,000-day Capitolium build sat at the 64-builder cap.

**Problem:** A micro-manager expects staffing and coin decisions to pay. Manual labour can at best match the Ordo, and no action turns coin into labour or building speed, so ongoing decisions feel pointless.

**Suggestion:** Give manual control a real edge, such as a bonus for crews the player staffs by hand, or a coin-for-speed lever like hiring builders for one project. Correct the README's "2½–3 times as fast" to DESIGN's 2.3x at victory.

*Verification: Design intent, still frustrating. Ordo staffs by output per hand; manual staffing fills by priority and distance (src/game/ordo/labour.ts:311-339). The 300-day bed stall was fixable; no demolition is required.*

### Keyboard-only players cannot place a building where they choose

*Medium · Interface · Run 8*

**Observation:** Run 8 (desktop), about day 101: Tab and Enter start placement, but only a mouse click commits it. Corrections: arrow keys pan the camera rather than doing nothing, and Enter just restarts placement. Keyboard players are not stuck at lesson II: "Skip this step" appears after 120 seconds, and "Ask the Ordo" (town council) builds at its best site.

**Problem:** Keyboard-only players can never choose a plot and cannot finish the placement lessons (II, III and VII) themselves, while the banner tells them to "click a glowing plot".

**Suggestion:** When Place is activated by keyboard, reuse the touch path: pre-place the ghost on the best plot and show the banner's Place button. Later, let arrow keys step the ghost between plots.

*Verification: Partly confirmed. No Enter or confirm handler; the Place button and auto-placed ghost appear only after touch input. src/ui/mapbar.ts:417-418*

### Labour "Apply once" zeroes rows the council plans 0 for that day, without warning

*Medium · Town council (Ordo) · Run 3*

**Observation:** Run 3, day 2490: the Ordo (town council) labour "Apply once" set Industry and Builders to 0, wiping targets the tester had set by hand for tile kilns and building sites. The Ordo had planned 0 for both that day, likely because industry stores were near full and no site was ready yet.

**Problem:** Rows planned at 0 show a blank hint instead of "would assign 0", and the log after applying leaves them out. A player who hand-staffs some rows gets no warning before or after, and the kilns stop.

**Suggestion:** Show "would assign 0" on those rows, list them when applying, and ask before zeroing a target the player set by hand. Or offer an "apply only to rows the Ordo staffs" option.

*Verification: Partly confirmed. Apply once zeroes all six targets, then copies only planned rows (src/game/ordo/actions.ts:100-101). The Ordo does plan every row; the zeros were its plan. Sites slow, not stop.*

### Lesson I ticks itself when the grain emergency law adds field hands

*Medium · Onboarding · Run 1*

**Observation:** Run 1, day 147: "Put hands on the fields" was ticked when the Lex de annona (grain emergency law) moved 5 hands; the tester never pressed +. The reward said "The grain climbs" while grain ran at −7/day. A headless sim reproduced this on every seed: an untouched colony completes Lesson I on its 32nd day, with the labour duty still unlearned.

**Problem:** The lesson meant to teach staffing passes without the player touching a control, then claims success while stores fall. Lesson IV later cannot offer to hand labour to the Ordo (town council), because labour was never learned.

**Suggestion:** Count only hands the player assigns with + (the labour practice note), not emergency staffing. Make the reward line read the actual grain trend, or hold the lesson until grain is rising.

*Verification: Partly confirmed. Lesson I checks staffed food hands, which emergency hands satisfy (src/game/intro.ts:58). Lesson VIII's early well was the player's own placement, counted by design.*

### Lesson IV ticks "Hand the Ordo a duty" even when the player keeps every duty

*Medium · Town council (Ordo) · Run 10*

**Observation:** Run 10, day 128, lesson IV: four orange "Hand over: X" buttons against a small grey "Keep them all mine" link. Keep showed "✓ Hand the Ordo a duty" and "It works in your name, even while you sleep." Later: up to 4 more offer cards, a "Learned" toast per duty, "Give labour to the Ordo" as first idle-hands remedy, and "The Ordo would assign N" under every labour row.

**Problem:** A player who wants control is told they did the opposite of what they chose, and the hand-over pitch has no off switch, so keeping duties feels like the wrong answer.

**Suggestion:** Reword the job ("Decide who does each duty") and give Keep its own reward line. Style Keep as a real button. After a Keep, offer "Stop suggesting hand-overs?" that hides offer cards and the "would assign" lines.

*Verification: Confirmed in code. Keep fills ordo.answered, which satisfies the lesson check (src/game/intro.ts:81). Steering toward hand-over is intended (docs/DESIGN.md:998); the tick and reward text are a bug.*

### No advisor flags a harmful edict; Run 4 kept heavy taxes on for 11,000 days

*Medium · Advisors · Run 4*

**Observation:** Run 4, day 219: a stray click set Tributum (taxes) to Grave (taxes ×1.4, immigration ×0.8, morale −8). It stayed on until about day 11,400. Spirits held at 57-66, so the one advisor that names "Taxes: Grave" (it needs morale under 50) never spoke. Coin piled up (94k to 155k at Oppidum) while "Colonists come slowly" pointed only at gardens.

**Problem:** One click became a lasting growth penalty that nothing ever mentioned. Through lost morale, immigration ran at about 0.6x the normal rate, not 0.8x, and births fell about 12%. Advisors only ever recommend Grave.

**Suggestion:** When Grave is on and coin is piling up or immigration is slow, have the Quaestor (treasurer) suggest Iustum or Leve with one click. Have "Colonists come slowly" list any edict that cuts immigration.

*Verification: Partly confirmed. Grave's effects confirmed (src/game/data/decisions.ts:77). The lock lasts only to next season, so it was revertible; the morale advisor offers Leve only below 50 morale.*

### On phones the current goal sits in a closed tray, and nothing points to it

*Medium · Mobile & touch · Run 7*

**Observation:** Run 7 (phone landscape, days 98 to 119, intro skipped): the player never learned why there was no Aedificia (build panel) while grain fell 7 a day with 20 days left. The answer, "Raise your first building. The Ordo is already raising one; Aedificia opens once it stands.", sits in the Res Gestae (goals panel) inside the Breviarium (pull-down tray), which stays closed. Portrait phones behave the same.

**Problem:** The game's main "what next" line is off-screen on every phone layout. One tap on any top-bar figure opens the tray, but nothing hints at that, and the tap scrolls past the goal.

**Suggestion:** On both phone layouts, show the current Res Gestae goal as a one-line chip under the top bar that opens the tray at the goal, or put it in the drawer header.

*Verification: Design intent, still frustrating. Reproduced at 750x342. By design all phones keep Res Gestae in the closed tray (docs/DESIGN.md:1248; src/ui/tray.ts:247). Not a landscape-only bug.*

### On phones the pause glyph never changes, speed drops are silent, lesson VII says "Space"

*Medium · Mobile & touch · Run 2*

**Observation:** Run 2 (phone): the pause button shows "❚❚" whether running or paused, with only an orange tint and no ▶. Lesson VII tells a touch player "Space pauses; 1 to 4 set the speed." Speed fell to 2× with no message; only choice cards cause this, and on phones that card is queued out of sight behind another, often a red advisory. Tapping "2×▾" while paused opens the menu correctly.

**Problem:** Touch players can't tell at a glance whether time is running or why the speed changed, and the lesson teaches keys they don't have.

**Suggestion:** Show ▶ when paused. Use touch wording for lesson VII and the speed chip tooltip on touch devices, as the map bar already does. When a choice card slows the game on a phone, bring that card to the front.

*Verification: Partly confirmed. Reproduced on an iPhone profile with real taps; the "chip unpauses" claim was refuted. Pause label is a fixed "❚❚" (src/ui/hud.ts:496).*

### One double-click passes the two-step confirm on permanent choices like path cards

*Medium · Interface · Run 8*

**Observation:** Run 8, day 8,109: one double-click on the "Ius Latii" path card armed and confirmed it, so the Municipium rank-up happened "by an accidental double-click". Verifiers reproduced it on Import "Load" with human timing (150 ms gap). The same gap affects "Found a new colony" on the title screen, "Abandon this colony", "Quit without saving" and Demolish.

**Problem:** The safety step on once-per-game, irreversible choices is skipped by habitual double-clickers or a bouncing mouse. The "Click again to choose. This is for good." note appears only after the first click, so they never read it.

**Suggestion:** Ignore a confirming click that arrives less than ~400 ms after arming. Fix it once in the shared helpers confirm2 and confirmRich, plus the map Demolish check in view.ts.

*Verification: Reproduced. Helpers check only the armed state; the 3 s timer is a maximum, never a minimum (src/ui/tabs/common.ts:87). Human-timed double-click on Load ran the load.*

### Open tooltips and the merchant countdown freeze on old numbers

*Medium · Interface · Run 8*

**Observation:** Run 8, day 91: the grain tooltip still warned "Runs out…" while the tablet beside it showed "▲ +40 · 24 d"; re-hovering fixed it. The Commercium (trade panel) merchant chip read "20 D LEFT" on day 1,705; a deal rebuilt it to "1 D LEFT" and the merchant left on day 1,706. Reproduced: the chip stayed at "30 D LEFT" with 22 days left.

**Problem:** The player checks a number in exactly the place that is stale, and loses a merchant they believed had 20 days left.

**Suggestion:** Rebuild an open tooltip's content on each day tick, and add the merchant chip to the Commercium live updaters, as the caravan and mule-team chips already are.

*Verification: Reproduced. Tooltips are built once when shown; the chip text is outside both the updaters and the panel's rebuild signature. src/ui/tabs/commercium.ts:244*

### Paving streets gives a big, cheap boost to Rome's favour, but no advisor ever suggests it

*Medium · Advisors · Run 1*

**Observation:** Run 1 at Oppidum (town rank) grew only from 324 to 341 souls in 500 days at favour ×2.0 with 80 free beds. Paving ~220 inner-street tiles with the Pave brush for ~450 stone (of ~1,433 idle) raised favour to the ×3.0 cap the same day. Only one line in the souls tooltip mentions paving, and no advisor suggested it.

**Problem:** A key lever out of a population stall is invisible. The Aedilis (housing advisor) speaks only below favour ×1.5 and offers only gardens or the Urbs (city) focus. The brush tooltip says 'desirability +1' and never mentions favour.

**Suggestion:** Add a Pave remedy and have the Aedilis offer it when beds sit empty and stone is idle. Mention Rome's favour in the brush tooltip, and teach paving when the brush unlocks at the Templum (temple) milestone.

*Verification: Partly confirmed. Same-day screenshots and the formula confirm it (src/game/people.ts:614). But ten paved tiles equal one garden, and ×2 to ×3 only makes growth 1.5 times faster.*

### Phone landscape drawer jumps back to the top and to half height on every open

*Medium · Mobile & touch · Run 7*

**Observation:** Run 7, landscape phone: every tab switch scrolled to the top; reaching Tributum (taxes) took 4 swipes and "Hand over all" 6. The building drawer reopened at half height each time, so every build meant open, tab, swipe, Place, with roughly 180 px cards in a 200 px view. Reopening the same tab also resets. The category filter is remembered, so it only needs setting when switching.

**Problem:** On a narrow landscape pane, long ledgers must be re-scrolled on every visit, so navigating takes more of the player's time than deciding.

**Suggestion:** Remember scroll position per tab, reopen the drawer at its last height, and add an anchor index at the top of Edicta (decrees panel) linking to Tributum, Leges (laws) and the duties list.

*Verification: Design intent, still frustrating. Deliberate: every open() rebuilds at scrollTop 0 (src/ui/panels.ts:181, 350-359); the drawer reopens at half unless already full (src/ui/layout.ts:432).*

### Phone save export is a 400 KB all-caps text blob with no file, Paste or share option

*Medium · Saves & sessions · Run 6*

**Observation:** Run 6, Android: the save text was 23,332 characters at day 226 and 413,845 at day 10,742. It uses the Silkscreen pixel font, whose lowercase letters are drawn identical to capitals, so case-sensitive text cannot be read. There is no download, share, file load, or Paste button on the title's Import. A truncated paste armed "Tap again: replace the saved colony" before checking it, then was refused safely.

**Problem:** Moving 400 KB through a phone clipboard is fragile, the text cannot be checked by eye, and a frightening "replace" prompt appears even for text that is not a save.

**Suggestion:** Add Download, Load from file, Web Share and a Paste button on Import. Gzip the export (about 7 times smaller: 413,845 to about 59,644 characters), show it in a monospace font, and validate before arming the replace confirm.

*Verification: Confirmed in code. Font is Silkscreen (src/styles/modals.css:40); the confirm arms before validation (src/ui/modals.ts:134-145). The failed Copy was likely the headless clipboard; real phones copy in one tap.*

### Raising one labour target quietly takes hands from rows further down the list

*Medium · Interface · Run 10*

**Observation:** Run 10 raised Fabri (builders) and later found Materia (materials) staffing down from 2 to 1 and Officinae (workshops) from 2 to 0: "I only noticed by reading every row." Those rows' targets stayed at 2; only their staffed counts fell, turning ember-coloured the next day.

**Problem:** Targets can add up to more hands than exist, and rows fill in a fixed, unstated order. A manual player unstaffs workshops without knowing, which feeds the unstaffed-post trap.

**Suggestion:** When targets exceed the workforce, say so ("targets 34, hands 31") and name the rows that will lose hands. Show the fill order in manual mode, or take only idle hands unless the player confirms.

*Verification: Design intent, still frustrating. Manual staffing fills water, food, services, builders, materials, industry from one pool with no total check (src/game/ordo/labour.ts:38). Only rows after the raised one lose hands.*

### Staffed producers sit idle and rows fall short of target, with no reason given

*Medium · Advisors · Run 10*

**Observation:** Run 10, days ~230 to 595: the quarry at High priority took both Materia (materials) hands while stone sat at 300/300, and the lumber camp had 0 hands. It surfaced only when a 14-item queue stalled at 5 timber. On day 2325, Annona (food) read "26 / 31 · 32" with 36 hands idle and no reason on the row.

**Problem:** Mismatches go unnoticed for a long time. The only hints are a monthly spill line, a stone tooltip suggesting a warehouse, and a generic Fabrum (works advisor) warning that names neither the quarry nor the full store.

**Suggestion:** Add a reason to short rows ("1 field idled by blight until day X"). Add a Fabrum note: "Quarry hands idle: stone store full. Move 2 to the lumber camp?"

*Verification: Partly confirmed. Manual staffing ignores full stores, unlike the Ordo's planner (src/game/ordo/labour.ts:174-178). Fabrum did warn on day 416, generically. The 26/31 gap was likely an event-idled field.*

### The Legacy colony replays the whole tutorial and hides the bonus it was meant to reward

*Medium · Pacing · Run 10*

**Observation:** In Run 10, Colonia Valeria Secunda replayed all 10 lessons and reset all 8 Mandata (duties the Ordo, the town council, can take over). A skip link ("I know the camp: skip the introduction") sits small and grey under the autofocused "Raise the standard". The map is new (fresh seed), yet the castrum, start buildings and camera are identical. The colony tooltip says +10% output; the real bonus is +15%.

**Problem:** A returning player sits through lessons they have mastered for a reward they cannot see. Legacy only nudges population through +2 morale, so the second colony feels like a reset, not a promotion.

**Suggestion:** Default to skipping the introduction at Legacy 1+ and keep learned Mandata. Put the bonus in the founding letter, fix the tooltip to include the +5% Imperium bonus, and add a perk players feel, such as faster immigration or starting buildings.

*Verification: Partly confirmed. newGame always starts with intro on (src/main.ts:289); the tooltip ignores legacyBonus (src/ui/hud.ts:342). "Same map" is wrong: terrain regenerates from a new seed.*

### The Quaestor says the treasury will empty while listing more income than costs

*Medium · Advisors · Run 9*

**Observation:** Run 9, day 158: the Quaestor (treasury advisor) said "The aerarium empties in 40 days. Upkeep 0.2 a day against taxes 0.6 and Rome's stipend of 3". Those lines add up to +3.4 a day. The real drain was caravan purchases, charged in one lump when an import caravan leaves, plus denarii spent on building sites. Neither is named.

**Problem:** The warning contradicts its own numbers, so the player cannot tell what to cut. Its remedies (raise taxes, export, close optional work) ignore the imports and construction actually draining coin.

**Suggestion:** Name every flow behind the forecast: caravans, building sites, debt repayment, emergency grain. State the largest drain in the text and offer a matching remedy, such as pausing an import contract.

*Verification: Confirmed in code. Days-left uses a 30-day average of all coin flows, but the text names only upkeep, taxes and stipend (src/game/advisors/rules-quaestor.ts:81). The HUD coin tooltip shows everything.*

### The housing advisor urges paved streets for years before a hands-on player can pave

*Medium · Advisors · Run 3*

**Observation:** From day 95 in Run 3 the Aedilis (housing advisor) repeated "Gardens and paved streets among the homes draw them; the Ordo raises neither unless you set the Urbs focus". Setting the Urbs (city beauty) focus on day 1523 still left "Paved roads 0": Ordo paving also needs the Consilium (planning) duty handed over. The Pave brush unlocked only with "Res Gestae XIII: Raise a Templum" on day 3437.

**Problem:** A hands-on player is told for years to do something hidden from them. Even the advisor's own Urbs remedy does nothing until Consilium is learned at Vicus and delegated: "dead content for a manual player".

**Suggestion:** Unlock the Pave brush with the first garden, or add "(paving unlocks with the Templum)" to the advice. Have the Urbs card say it needs Consilium handed to the Ordo (town council).

*Verification: Design intent, still frustrating. The brush is gated by milestone 13 and the rank-2 Templum (src/game/objectives.ts:77). The gardens half of the advice works from day 1 and can clear the warning.*

### The same event cards return many times with unchanged text

*Medium · Text & readability · Run 9*

**Observation:** Over Run 9's roughly 28 game years, "Veterans at the gate" fired 14 times (day 541 to 10,017), the Legate 5 times, Fever 4, Drought 3 and floods 2. Each repeat used the same text; Veterans changed only names, skills and family counts. By year 10 the tester clicked through without reading.

**Problem:** Identical prose on every repeat makes choices feel mechanical and trains players to skip the writing the game relies on for its Roman voice.

**Suggestion:** Write 2 or 3 text variants per event, count how often each has fired, and add callbacks or escalation ("the Legate returns"). Lengthen cooldowns or cut weight after repeats; basic cooldowns already exist.

*Verification: Design intent, still frustrating. Each event has one template and only its last fired day is stored (src/game/types.ts:437). Cooldowns work: Veterans gaps were 407+ days. Frequency is designed.*

### Valid building spots are a faint wash, and nothing points to spots off screen

*Medium · Interface · Run 1*

**Observation:** Run 1 found the valid "glowing" plots were faint pale squares and had to zoom out and scan. Valid spots get a cream tint at 18 to 34% opacity with a barely visible pulse, the same at every zoom. On Aestas (summer) straw ground, valid and invalid blocks look almost alike. Placing a rural work from the town view shows no spots on screen at all.

**Problem:** Finding where something can go becomes a scan of the whole map. Zooming out helps only because untinted ground comes into view; when almost every tile is valid, as for a well, the tint is a uniform haze.

**Suggestion:** Give valid spots a stronger outline and pulse, or dim invalid ground instead of tinting valid ground. When no valid spot is on screen, pan to the best one or show an arrow at the screen edge.

*Verification: Partly confirmed. Both checkers found the tint faint at every zoom, not only zoomed in; the slots already pulse, weakly (src/render/placement.ts:164).*

### After petitioning, the petition reserve line, ticker and Augur card stay stale

*Low · Interface · 7 of 10 runs (1, 4, 6, 7, 8, 9, 10)*

**Observation:** Runs 1, 4 and 8: after petitioning, often paused, "Set aside for the petition: 250 den · 100 timber, ready" and the ticker's "Fee ready: petition Rome in Edicta" remained; Run 8 saw them beside "Rome has heard every petition". Runs 7 and 9: the Augur (advisor) card "Rome would hear our petition for …" named the rank just granted. The Edicta (decrees panel) "!" badge does clear at once.

**Problem:** Contradictory calls to action send the player looking for a petition that no longer exists, right when they expect a clean rank-up.

**Suggestion:** Rebuild the council's saving target when a petition is carried, so the line and ticker clear at once even while paused. Retire the petition advisory immediately on rank-up instead of through its 3-day fade.

*Verification: Partly confirmed. Lines read a council report cached once per game day (src/game/ordo/index.ts:85); the Augur card lingers about 4 game days through fade hysteresis.*

### A grain-storage warning hides the "lesson complete" card and its next step

*Low · Onboarding · 5 of 10 runs (1, 4, 5, 6, 10)*

**Observation:** Runs 1, 4, 5, 6 and 10 saw a Cave (warning) card, always "The sheds overflow", take the lesson slot just as a lesson was won. Run 5 believed the tutorial waited on "Begin now", reachable only via the Breviarium (summary tray). The next lesson actually starts itself after 40 to 45 s; the week-long gaps in Runs 5 and 6 were harness day-skips.

**Problem:** The payoff of each early lesson (the tick, the reward line, "Next: …") is hidden behind an advisor nag, so a first-hour player may not see that they succeeded or what comes next.

**Suggestion:** Hold the finished-lesson card for a few seconds before a Cave advisory can take the slot, or show the advisory as a strip beneath it. Relabel the "+3" pip as "3 waiting ▸".

*Verification: Partly confirmed. Only a Periculum (top alarm level) outranks a lesson in progress; a Cave outranks just the finished-lesson card. Auto-advance already exists (src/ui/counsel.ts:112).*

### A reflexive Esc after placing opens the main Menu and pauses the game

*Low · Interface · 5 of 10 runs (1, 3, 8, 9, 10)*

**Observation:** Five of ten testers hit it. Run 1 opened the Menu twice by accident after single placements; Run 9 twice after right-click had already cancelled; Run 10 three times. Run 8 pressed Esc as the bar instructs ("ESC / RIGHT-CLICK TO CANCEL") after placement had already ended. Run 3 said Esc does not always close the Menu; it does, except a held, auto-repeating Esc, which toggles it.

**Problem:** Esc is the reflexive cancel key. Once placement has ended, the next Esc falls through to the Menu, which opens a modal and pauses the game mid-build.

**Suggestion:** Ignore Esc for about 1 s after a placement ends or is cancelled by right-click, and ignore auto-repeated Esc so holding the key cannot toggle the Menu open and shut.

*Verification: Design intent, still frustrating. The Esc chain ending in the Menu is specified (docs/DESIGN.md:1264) with no grace window. Reproduced in browser: a second Esc after cancelling opened the Menu.*

### Felled timber overfills the store, then all the surplus is lost the next day

*Low · Economy & balance · 5 of 10 runs (1, 3, 4, 7, 8)*

**Observation:** Placing buildings or roads on forest fells the trees straight into stores, past the cap. Run 1 reached 1,106/300 timber; Run 3, 1,166/300 and 5,111 against a 1,100 cap; Run 4, 1,022/300; Run 7, 64 to 1,574, then back to 300 days later; Run 8, 12 to 722. The preview only says "fells N timber". Run 3 then saw "The stores are full: timber spills to waste."

**Problem:** The preview advertises a windfall of hundreds or thousands of timber, yet everything above the cap is wiped on the next daily tick. Wasting overflow is by design; the missing warning makes the cap look meaningless.

**Suggestion:** Show the cap in the preview, e.g. "fells 1,540 timber (store holds 300; build a warehouse first)". Or clamp felling to free space, or bank the excess and release it over the build time.

*Verification: Partly confirmed. No cap check when felling (src/game/world/roads.ts:196). The surplus is cut in one step next tick, not over days, and the spill line logs once per 30 days.*

### Staffing rows show '0 / 0' with no reason, so the council's labour plan looks broken

*Low · Town council (Ordo) · 5 of 10 runs (1, 2, 3, 4, 6)*

**Observation:** Runs 1, 2, 3, 4 and 6 saw rows like 'Fabri 0/0' (builders) or 'Materia 0/0 · 43' (materials) while 200-570 hands stood idle under Ordo (town council) staffing. Run 2's builder slider moved from 15% to 40% with no effect. Verifiers found posts stay empty only when stores are 95% full or inputs are missing, and builders arrive within a day.

**Problem:** The council looks broken because the screen never says why a row is empty or why the slider does nothing. Fabrum (works advisor) even suggests 'Builder share +' when it cannot help.

**Suggestion:** Give empty rows a reason ('stores full', 'plan waiting for materials'). Say in the slider text that builders are capped by remaining work and by the 64-strong Capitolium crew, and drop the 'Builder share +' remedy when it has no effect.

*Verification: Partly confirmed. The focus does not limit posts: leftover hands fill any useful post (src/game/ordo/labour.ts:314). Builders are capped by remaining work and the 64 crew (src/game/ordo/labour.ts:265).*

### Minimum zoom is fixed at 16 px per tile on every screen, with no feedback at the limit

*Low · Interface · 4 of 10 runs (1, 2, 5, 9)*

**Observation:** Run 1 (1440x900): the town plus the canabae (outer town ring) did not fit, so the tester relied on the minimap. Run 2 (phone): only about 4.7 to 4.9 blocks fit across at full zoom-out. Run 5 (iPad, d~185): pinch-out and "−" silently did nothing at the limit. Run 9 (1280x720): a 1,300-soul city did not fit; rural land had to be found on the minimap.

**Problem:** Planning at town scale means constant panning, and a gesture that silently does nothing feels broken. The design's reason for having no overview mode (the whole map fits 1080p) is wrong: the map is 1792x1344 CSS px.

**Suggestion:** Scale the minimum zoom to the viewport or add one more zoom-out level. Show a small bounce or a disabled "−" at the limit. On desktop, point players to the Urbs view (C), where both town rings fit.

*Verification: Confirmed in code. ZOOM_LEVELS is fixed at 1 to 5; at the floor zoomBy returns early with no feedback (src/render/view.ts:557). The docked view overflows; the Urbs view fits.*

### The council agenda's "needs N timber" never matches the build card and can jump upward

*Low · Town council (Ordo) · 4 of 10 runs (1, 4, 8, 10)*

**Observation:** Run 8: the Lumber camp card cost 10 timber, but the Ordo (town council) Agenda said "needs 18 timber … We lack 38 timber", then "needs 28 … We lack 48" after timber rose by 12. Run 4 showed "needs 38 timber" beside "waiting for 8 timber". Run 10 showed "needs 4 timber" with 426 in store. Run 1's ticker kept "Saving: 34 timber" at 1,106 timber.

**Problem:** The figure silently adds every reservation queued ahead (requests, plans, petition fee, the next wish), so it never matches the card. In Run 8 it rose because demolishing a granary queued a replacement, which looks like a bug.

**Suggestion:** Show the breakdown, e.g. "camp 10 + reserved for well and granary 38, have 12: need 36 more". Refresh the ticker's saving line live instead of once a day.

*Verification: Partly confirmed. Gaining stock never raises the figure; a headless repro showed +10 timber lowering it 18 to 8. The ticker line refreshes once a day (src/game/ordo/index.ts:61).*

### The works advisor's "garden in 1 day" forecast stays frozen for hundreds of days

*Low · Advisors · 4 of 10 runs (3, 6, 8, 9)*

**Observation:** Run 3 (days 3456 to 4100+), Run 6 (500+ days), Run 8 and Run 9 saw the Fabrum (works advisor) stuck on "The Ordo will raise a garden in 1 day", often with "It has come and gone twice of late", while the Ordo (town council) Agenda counted "builders start in 4 d". Testers took it for one garden re-staked forever. Run 9 saw the same with a well.

**Problem:** The forecast never changes and contradicts the Agenda, so players conclude the Ordo is stuck in a loop. In fact a new garden is built every 6 days; Run 3 ended with 190 of them.

**Suggestion:** Drop the countdown when the rule stops evaluating instead of freezing it. While an Ordo garden is staked, show that site's countdown or say "next garden after the current one".

*Verification: Reproduced. Reproduced in a browser: Fabrum said "1 day" while the Agenda counted 5, 4, 3. The advisor engine keeps the last wait value (src/game/advisors/engine.ts:151-162). No build loop exists.*

### Panning can leave most of the screen as a dark void beyond the map edge

*Low · Interface · 3 of 10 runs (1, 5, 10)*

**Observation:** Run 1: dragging past the edge showed a black void. Run 5 (iPad, d185): the lower 40% of the map view was black, and the player read it as a rendering bug. Run 10: half the screen was black (shot 182: about 39% of the free height was map). The tester panned off the edge on purpose because the placement bar covered the bottom rows.

**Problem:** The camera is clamped, but loosely: only 25% of the visible map area per axis must show map, so at a corner up to about 94% of the screen can be bare dark background. It looks unfinished.

**Suggestion:** Tighten the clamp so the map edge stays near the screen edge, allowing for UI panels, and draw border terrain past the edge. Keep enough slack to pull edge rows out from under the placement bar.

*Verification: Design intent, still frustrating. clampCamera keeps only 25% of the free area on the map (MIN_VISIBLE, src/render/camera.ts:20); off-map is plain #15100d. Documented and covered by tests.*

### Site rules like 'must touch a clay bank' hide in a hover tooltip, not on the build card

*Low · Interface · 3 of 10 runs (1, 8, 10)*

**Observation:** Run 1: the Tile kiln card says 'rural 2×2' but not that it must touch clay; the tester learned it by hovering red plots. Run 10 (d3184) hit 'Olives need dry slopes'. Run 8 (d8183): the Great baths card omits the castellum rule, found only after demolishing 8 gardens. Valid plots do glow and a terrain overlay switches on, but the glow is faint and scrub has no colour.

**Problem:** Siting feels like trial and error. Olive groves need 5 of 9 hill or scrub tiles, but scrub looks like fertile land on the terrain overlay, and the refusal text never states the threshold.

**Suggestion:** Print each site rule on the card face. Outline the full footprint of valid rural plots and strengthen the glow. Give scrub its own terrain colour, separate clay from ore, and say '5 of 9 tiles must be hills or scrub'.

*Verification: Partly confirmed. Rules live only in the hover tooltip (src/ui/tabs/aedificia.ts:59). Placement already glows valid plots and turns on the terrain overlay, so 'no overlay' was wrong.*

### Tapping outside a pinned tooltip also presses the button underneath

*Low · Mobile & touch · 3 of 10 runs (1, 5, 7)*

**Observation:** Run 7: tapping outside a long-press tooltip hit a rail icon and switched panel; reproduced, the dismissing tap also pressed "More Food hands". Run 5 (iPad, d~6200): tapping outside a Bathhouse card opened the Principia (headquarters) card, because cards have no tap-outside close and any map tap selects. The ✕ is 44x44 px on touch, not 24. Run 1 was a second click after the event card closed.

**Problem:** One tap does two things. Players expecting tap-outside-to-close, which the Breviarium (summary tray) honours, open another card instead.

**Suggestion:** Swallow the tap that dismisses a pinned tooltip. Let the first tap on the map close an open card, as the Breviarium tray already does.

*Verification: Partly confirmed. Tooltip pass-through reproduced (src/ui/dom.ts:253-257). Card replacement on map tap is by design (DESIGN.md:1252); ✕ measured 44x44 on iPad.*

### Victory stats show "0 legacy" beside "Legacy 1", and play time in three formats

*Low · Text & readability · 3 of 10 runs (2, 4, 6)*

**Observation:** Runs 2, 4 and 6: the dispatch shows "0 legacy" above the "Legacy 1: +10% output" button. Run 4 saw "57 MIN hours governed" ("57 min" in an all-caps font over the label). Run 6 saw "1.3 hours governed" while the Fasti (roll of colonies) said "1 h 20 min". Time away is never counted, by design; Run 4's 57 min vs ~47 h gap is inflated by the harness.

**Problem:** The climax shows contradictory numbers and undersells a long idle game. The button also says +10% when an Imperium path makes the next colony's bonus +15%.

**Suggestion:** Rename the tile "Legacy earned: 1 (next colony +10% output)". Use one time format everywhere, such as "1 h 20 min at the helm", plus "N h away". Show the real bonus, including Imperium's extra 5%.

*Verification: Confirmed in code. Tile prints the founding legacy level, and minutes or bare decimal hours (src/ui/dispatch.ts:182). Play time grows only while the tab is in front.*

### 'Ask the Ordo' requests can't be cancelled and leave no lasting confirmation

*Low · Town council (Ordo) · 2 of 10 runs (7, 9)*

**Observation:** Run 7 saw 'You asked for a temple…' in the Agenda but nothing after asking for Great baths or a Theatre. Run 9 made an accidental house-plot request and found no cancel. Verifiers reproduced: no successful ask shows a toast, by design; the Agenda line vanishes once the Ordo (town council) builds; request rows have no cancel; three clicks on one card fill all 3 request slots.

**Problem:** The player can't tell whether a wish was queued. A mis-click blocks new asks for up to 180 days, after which the request expires without a word.

**Suggestion:** Add a ✕ to Agenda request rows. Refuse duplicate asks from the card button, as the advisor button already does. Flash 'Queued: great baths' on the card, log expiries, and fix the line 'You asked for a fields'.

*Verification: Reproduced. Browser repro: request rows have no button (src/ui/tabs/common.ts:252); card asks accept duplicates until 'The Ordo already holds 3 requests.'*

### 'Awaiting you' alarms wrap one word per line beside a wide remedy button

*Low · Text & readability · 2 of 10 runs (4, 10)*

**Observation:** Run 4 (d219-464, 1280×720) and Run 10 (d2749, 1440×900) opened the wide ledger view, where the Breviarium (summary column) is 250 px. The works advisor's alarm 'The lumber camp 12 paces south-west of the walls has waited 155 days for 8 timber.' ran about 17 lines, one word each, beside 'Raise the lumber camp first'. Run 10's temple alarm ran 13 lines.

**Problem:** The most urgent alarm becomes the hardest to read, and the column grows long enough to need scrolling.

**Suggestion:** Let the row wrap so the button drops below the text when space is tight, for example with a container query, and give the text a minimum width of about 140 px.

*Verification: Confirmed in code. Enabled remedy buttons never shrink or wrap and have no width cap (src/styles/tray.css:67); only disabled ones get the 45% cap. Screenshots match.*

### 'Place it myself' can glide to a spot far from the area the advisor card names

*Low · Advisors · 2 of 10 runs (9, 10)*

**Observation:** Run 9: the button moved the view to the west suburb while the card said "south-east of the forum". Run 10: "the map I'd carefully framed is gone." Verifiers found the zoom is never changed. The camera glides only the shortest distance needed to show the ghost, and not at all if it is already in view.

**Problem:** The headline names one waiting house, but the ghost goes to the plot that serves the most houses citywide, or to the Ordo's (town council's) best slot anywhere. A glide to an unnamed district is disorienting.

**Suggestion:** Name the destination on the button or card ("near the west suburb"), prefer slots close to the named houses, and offer a "Back" that restores the previous view.

*Verification: Partly confirmed. Zoom kept in a browser repro. The title names the middle waiting house (src/game/advisors/rules-aedilis.ts:111); the slot is chosen citywide or falls back to the best slot.*

### Grain advisor still says 'Ask the Ordo for a granary' when a full granary stands

*Low · Advisors · 2 of 10 runs (1, 8)*

**Observation:** Run 1 saw 'grain rots in open sheds' at 'Stores 99%' after the horreum (granary) was built. Run 8 saw 'a Horreum keeps 5,000 safe' and 'Ask the Ordo for a granary' while one stood full. The rot is real: each horreum holds 4,000 (5,000 with an edict), the sheds add 600, and only grain above the granaries' capacity rots, about 1.7 a day here.

**Problem:** The advice is correct, since a second granary stops the rot, but it reads as if the first one is broken. Nothing shows how full the granaries are compared with the open sheds.

**Suggestion:** When a granary exists, say 'Your horreum is full; another keeps 4,000 more safe' and label the button 'Ask the Ordo for another granary'. Show granary fill and shed fill separately in the grain tooltip.

*Verification: Confirmed in code. Text and button never read how many granaries stand (src/game/advisors/rules-annonae.ts:224). No UI shows granary fill on its own.*

### Great baths say 'No castellum within 18 paces' while one is being built right beside them

*Low · Text & readability · 2 of 10 runs (3, 10)*

**Observation:** Run 3 (d6191-6209) and Run 10 (d6456) tried to place the Great baths next to a castellum (water tower) still under construction and got 'No castellum within 18 paces.' Run 10 then demolished a well and a cistern in a confusing detour. The Aqua (water) overlay draws the 18-tile reach box around the unfinished castellum as well.

**Problem:** The message reads as false. The build card's 'active castellum' does not plainly mean 'finished', and the overlay shows a reach that placement then refuses.

**Suggestion:** When an unfinished castellum is in reach, say 'Castellum under construction (37%): the baths can be placed once it stands'. Grey out or dash the reach box of unfinished castella in the Aqua overlay.

*Verification: Confirmed in code. Only finished castella count (src/game/world/siterules.ts:101), and the refusal text never mentions construction. The overlay draws reach for unfinished ones too.*

### Identical error toasts stack up to four deep

*Low · Interface · 2 of 10 runs (8, 10)*

**Observation:** Run 8 pressed Enter twice on an empty colony name and got two "A name of 1 to 24 letters." toasts. Run 10, day 4,034, got 4 identical red "Only a dirt road can be paved" toasts. That error fires once per drag or click over fully paved road, not per tile, so Run 10 made 4 separate strokes.

**Problem:** Harmless repeats produce a wall of red errors. The pave tool treats an all-paved stroke as an error, while the road tool treats laying road over road as a silent no-op.

**Suggestion:** Merge identical toasts into one with a count, as the "built" toasts already do. Make an all-paved stroke a silent no-op, matching the road tool; the drag preview already shows "0 × 2 stone".

*Verification: Partly confirmed. Toasts are only capped, never merged, except built and evolved batches (src/ui/toasts.ts:48). Mixed paved and dirt drags already skip paved tiles silently.*

### Menu warns 'Storage: Not persistent' with nothing to press beside it

*Low · Saves & sessions · 2 of 10 runs (4, 6)*

**Observation:** Run 4 and Run 6 saw 'Storage: Not persistent: the browser may clear it (keep a copy)' in the Menu, with no action on that row. The game does ask the browser to keep storage once per session after the first save; the browser refused. Export / Import sits in the same Menu, and export reminders exist but fire only after 2 real days.

**Problem:** In an idle game the save is the progress. A bare warning plants worry, and the testers never saw the existing reminders because each session lasted less than 2 real days.

**Suggestion:** Put an 'Export now' button and 'Last export: N days ago' on the storage row; the time is already recorded. Add an export nudge after each rank-up.

*Verification: Partly confirmed. The game does request persistent storage after the first save (src/ui/platform.ts:110). The storage row itself has no button.*

### On phones a successful 'Send the caravan' looks exactly like a missed tap

*Low · Mobile & touch · 2 of 10 runs (6, 7)*

**Observation:** Run 6 (portrait, d2187): the Send button sat at y≈847 in an 839 px screen, one short scroll away. Run 7 (landscape): Send at y=342 of 342, and one of three contracts never appeared; the tap had missed the off-screen button, so nothing was sent. In a phone repro, a successful send left the screen unchanged: no toast, form still filled, new row scrolled away above.

**Problem:** On a muted phone the player cannot tell a sent contract from a missed tap, so a second tap makes a duplicate. In the 342 px landscape drawer it takes about 4 swipes to reach Send.

**Suggestion:** Pin the Send button to the bottom of the sheet. After a successful send, show a toast naming the contract and briefly highlight its new row.

*Verification: Reproduced. Phone repro at 412×839 and 750×342: button unpinned, success gives only a coin sound (src/ui/tabs/commercium.ts:126). No contract fails silently.*

### Reach runs along roads, so close wells miss homes and demolishing gives no warning

*Low · Interface · 2 of 10 runs (5, 10)*

**Observation:** Run 5: a well in the same block did not water the hut on the diagonal plot, which faces another street. Demolitions for baths silently cut water, and gens Vettia's 13-bed stone house fell back to a hut. Run 10: a temple just outside the castrum (starting camp) wall never covered inner houses, because roads cross the wall only at 4 gates. The Aqua (water) and Officia (services) overlays did draw this reach.

**Problem:** Players judge distance in a straight line. A well touching a hut's corner is 6 road steps away against a reach of 4, and a temple 6 tiles away is about 19 steps. Demolishing never says which homes lose service.

**Suggestion:** Show road-step distance to the nearest provider in the house inspector ('nearest well: 6 steps, needs 4'), as DESIGN.md asks. Make the demolish confirm list homes that would lose water or services. Have the ghost count all homes covered, not only those that could evolve.

*Verification: Partly confirmed. Designed road-step rule (DESIGN §7.4), reproduced in browser for wells. Overlays and ghost already draw reach; demolish confirm and house text lack distances (src/ui/tabs/house.ts:31).*

### The clock starts at 1× when the founding letter closes, and lesson cards never pause

*Low · Onboarding · 2 of 10 runs (1, 2)*

**Observation:** Run 1: the letter's "11 days of water" and "23 days of grain" caused instant anxiety, and time ran at 1× while the tester read the first lesson ("Reading = losing time"). Run 2: twice a card swapped under a pending tap while paused. Verifiers: only grain falls (−7.2/day); water rises. Lesson timers count real time even while paused, which causes the swap.

**Problem:** The opening numbers read as countdowns and the clock runs before the player knows the controls. The emergency grain law that catches shortfalls and the pause button are never mentioned, so reading feels punished.

**Suggestion:** Mention the pause button on lesson I's card and say the grain law will step in. Label the letter's figures as stock, not countdowns. Stop lesson breather timers while paused so panels don't swap under a tap.

*Verification: Design intent, still frustrating. Reproduced live: paused under the letter, 1× after "Raise the standard", as DESIGN.md:57 specifies. Play time grows while paused (src/main.ts:604).*

### The suggested-spot laurel can point to canabae land and floats over the wrong plot

*Low · Interface · 2 of 10 runs (4, 7)*

**Observation:** Run 7 (d119, d451): the "Ordo's choice" laurel (the town council's suggested spot) and default ghost for the lumber camp, quarry and hunting lodge sat on plots "SURVEYED FOR THE CANABAE" (future town ring). Verifiers reproduced this with 536 to 881 clean slots free. Run 4 (d~200): the laurel showed on the cistern's plot and hovering it said "That plot is taken."; the suggested plot just south was free.

**Problem:** A marker named for the Ordo (town council) steers players onto land the Ordo itself refuses, blocking future house plots. A marker drawn over the neighbouring plot makes a valid suggestion look broken.

**Suggestion:** Pick the player's laurel and default ghost with the Ordo's own rules, or score canabae land down. Draw the laurel inside or centred on its plot instead of above its top edge.

*Verification: Reproduced. Canabae picks reproduced in two fresh games. Selection never returns a taken plot; the laurel is drawn above its slot (src/render/placement.ts:243), over the plot to the north.*

### "Caravans returned from markets: 1 / 2" counts different markets, not trips

*Low · Text & readability · Run 10*

**Observation:** Run 10, day 1156: after 80+ caravan trips to one market, the Oppidum (rank III) petition row still read "1 / 2", and the tester made duplicate contracts trying to fill it. Only a contract caravan returning from a new market counts; merchants and relief grain never do. The Colonia row for the same quantity is already labelled "Markets traded with by contract".

**Problem:** The label reads like a trip counter, so a number that will not move looks broken, and the Commercium (trade panel) never shows which markets already count.

**Suggestion:** Reuse the Colonia wording: "Markets traded with by contract: 1 / 2", with a hint "send a caravan to a second market". Mark already-counted markets in the Commercium.

*Verification: Confirmed in code. The row shows hubsTraded.length (src/game/decisions.ts:186); a market is added only by a contract caravan from a new hub (src/game/trade.ts:280). Counting markets is designed; only the label misleads.*

### "Hand over all" covers only newly offered duties, not every duty still set to Mine

*Low · Town council (Ordo) · Run 8*

**Observation:** Run 8, about day 153: the banner said "3 chores learned"; "Hand over all" moved Water, Food and House plots, but Operae (staffing) stayed Mine. Correction: the 7 Ordo/Mine toggles were not the cause. The lesson IV "Hand over: Staffing" button already counted as an answer, and any duty answered once leaves the offer list.

**Problem:** Beside a list of every duty, "all" reads as every duty, so a player may believe staffing went to the Ordo (town council). The broader "Hand over all you have learned" button stays hidden while an offer waits.

**Suggestion:** Relabel the offer button "Hand over these 3", or include every learned duty still set to Mine.

*Verification: Partly confirmed. Designed: each new duty is offered once (DESIGN §10.2), and the offer list skips answered duties. Mostly a wording fix. src/game/ordo/duties.ts:173-175*

### "Take only the craftsmen" admits one top-skilled family, farmers included

*Low · Text & readability · Run 9*

**Observation:** Run 9, day 1845: Metellus (fabri 3, building) and Regulus (agri 4, farming) waited at the gate. "Take only the craftsmen" gave "The Reguli join", so the farmer won. On day 6738 only the Silani joined out of two fabri (building) families. Vitellius (lapis 3, stone) vs Scaevola (silva 4, timber) gave "The Scaevola join"; it should be "Scaevolae".

**Problem:** The label promises a filter by trade and more than one family. The rule takes the single family whose head has the highest level in any skill, farming included. The note names the family beforehand, but the label misleads.

**Suggestion:** Rename the option to match the rule, e.g. "Take only the most skilled family", and name the deciding skill in its note. Or change the rule to admit every family with a craft skill. Fix the plural for names ending in -a.

*Verification: Design intent, still frustrating. Matches DESIGN.md:1048 ("the best-skilled family joins free"); the skill check includes agri. Plural uses replace(/us$/,'i'), which leaves "Scaevola" (src/game/events-catalogue.ts:172).*

### A mentor tip tells touch players to "Hover a house"

*Low · Text & readability · Run 7*

**Observation:** Run 7 (touch only, skipped intro), day 348: "What a house wants… Hover a house to see what it needs next". The line is fixed text from the game layer, shown unchanged in the advisor card and the Annales (chronicle) tips. The "speed" tip ("pause to think: Space, 1–4") likewise names keyboard keys to touch players.

**Problem:** Touch players cannot hover. The design's own rule says "the hand in use decides the words", and other panels such as Populus (people panel) already switch between Tap and Hover.

**Suggestion:** Swap "Hover" for "Tap" on touch where the tip is rendered, using touchInput() as Populus does, and drop keyboard keys from the speed tip and the intro reward on touch.

*Verification: Confirmed in code. Hard-coded "Hover a house" with no input check; counsel.ts and annales.ts render it as is. src/game/guide.ts:160*

### A save with a non-numeric day loads as normal and quietly rewinds to day 90

*Low · Saves & sessions · Run 8*

**Observation:** Run 8 fed broken saves into the import box. Garbage, truncated and wrong-prefix saves were refused cleanly. A save with day set to "abc" and timber set to null loaded with the usual "Castra Valeria restored." toast. The day fell from 274 to 90 and buildings stayed. In the verifier's repro timber also dropped from 300 to 0. Seasons and the yearly Fasti line repeat; lessons and events do not.

**Problem:** The player is told the colony restored fine while the calendar rewound, a resource was wiped and Annales (chronicle) entries now sit in the future. Only hand-edited saves hit this; real corruption breaks the file and is refused.

**Suggestion:** Have the loader report what it repaired and show "Restored with repairs: day reset to 90, timber set to 0" instead of the plain toast. Or refuse saves whose day is not a number.

*Verification: Reproduced. Reproduced in Chromium: day "abc" became 90, null timber became 0, toast unchanged. Repair is by design but never reported (src/game/save.ts:217).*

### A standing serious warning can hide a duty's "Hand to the Ordo" offer indefinitely

*Low · Town council (Ordo) · Run 4*

**Observation:** Run 4, days 4,290-4,345: building a shrine taught Officia (services), but no hand-over card appeared. No event card covered it: an Aedilis "Cave" (serious) warning, "9 huts west of the forum would become tiled cottages but lack a market", held the advice card for about 55 days, and Cave outranks duty offers. The player found the offer in Mandata (chores list).

**Problem:** The warning was circular: the Ordo (town council) would build that market itself once it held Officia. The offer still showed in Mandata and the away summary, so "may never hand it over" is overstated.

**Suggestion:** When a Cave warning concerns a duty the player has learned but not handed over, add "Hand Officia to the Ordo" as one of its remedies, or show the offer alongside the warning.

*Verification: Partly confirmed. The advice card shows any Cave before pending duty offers, as DESIGN §10.2 intends (src/ui/counsel.ts:113-116). Events take that slot only on phones.*

### A victory while away shows the Victory dispatch before the away letter leading up to it

*Low · Saves & sessions · Run 4*

**Observation:** Run 4: the Capitolium was dedicated during an absence ending at day 26,560. The Victory dispatch appeared first; after closing it, the away letter underneath said "the Capitolium was dedicated and the clock stopped" ("reads backwards"). The letter opens first and the dispatch stacks over it a frame later. This applies to every victory during an absence, not only the test helper.

**Problem:** The climax is followed by a postscript that refers back to it, so the story of the absence reads in reverse.

**Suggestion:** Open the Victory dispatch when the away letter is closed, instead of stacking it on top, so the letter leads into the victory.

*Verification: Design intent, still frustrating. Deliberate per the comment at src/main.ts:393 ("opens the Victory dispatch over the letter"). Real returns and the dev helper share this path.*

### Advisors never name the real blockers: unreachable baths and the water reserve

*Low · Advisors · Run 9*

**Observation:** Run 9 read roughly 4-5k words, yet no advisor named either stall. "Baths needed" appears in Res Gestae (goals panel) hints, the petition and the house popup, but nothing said no free block near the stone houses could take a bathhouse; three bathhouses went up outside the walls serving nobody. Concrete stopped because the "people first" water reserve gave works zero water, while the queue read "bottleneck: builders".

**Problem:** A player who reads everything still never meets the one sentence that would unstick them, and the Capitolium (final monument) queue points at the wrong bottleneck.

**Suggestion:** Audit advisor rules against real stall causes. Flag stone houses missing several needs, add the spatial line ("no free block within 8 steps can take a bathhouse; clear one"), and make the Capitolium bottleneck count the water-reserve floor so it names concrete.

*Verification: Partly confirmed. Bath rule only fires for houses missing exactly one need (src/game/advisors/rules-aedilis.ts:52); the bottleneck estimate ignores the reserve floor (src/game/construction.ts:226). Bath facts do appear outside advisors.*

### Advisors tab reopens filtered to the last advisor, often a 'nothing to say' page

*Low · Advisors · Run 1*

**Observation:** Run 1 opened the Consiliarii (advisors) tab and got "Quiet: Praefectus Fabrum has nothing to say." Clicking an advisor portrait on a counsel card, or a danger chip in the goals box, filters the tab to that advisor, and the filter sticks for every later open. The filtered view also hides the Ordo (town council) agenda.

**Problem:** The player opens Advisors for live counsel and finds an empty page. The only way back is to click the already-pressed portrait again, and nothing says so.

**Suggestion:** Reset the filter when the tab is opened from the bar or the V key, and add an "All" control. Filter only when opened from a specific portrait or chip.

*Verification: Confirmed in code. The filter is a module variable that survives closing the tab (src/ui/tabs/consiliarii.ts:30); plain opens never reset it.*

### After a victory while away, closing the dispatch reveals a letter opening with chores

*Low · Advisors · Run 2*

**Observation:** Run 2, day 25,694: after "VICTORIA · The Capitolium is dedicated", "Keep governing" revealed a Litterae Ordinis (council letter) whose "AWAITING YOU" list said "3 homes fetch water from the river". The button does not open the letter; it uncovers the one already underneath. This happens only when victory falls during an absence.

**Problem:** The emotional peak is followed by a mundane chore list. Victory is acknowledged in the letter only by a dim header line.

**Suggestion:** After victory, drop the "Awaiting you" advisories from the away letter and show the Fasti (roll of colonies) entry and a short congratulation instead.

*Verification: Partly confirmed. "Awaiting you" takes up to 3 advisories with no victory check (src/game/offline.ts:111). A victory in live play shows no letter.*

### Agenda "Apply once" builds on the council's chosen plot with no preview of where

*Low · Town council (Ordo) · Run 10*

**Observation:** Run 10: "'Apply once' on the Ordo agenda (warehouse) placed it on the very plot I was about to use for my own granary." The Ordo (town council) Agenda line names only the building and reason; its tooltip says "Place the Ordo's wish now as your own site." The Edicta (decrees panel) version shows no location either.

**Problem:** The player loses a planned plot with no say. Undoing costs: the site starts building at once, cannot be moved, refunds 75% after 5 days or any work, and felled forest or laid streets stay.

**Suggestion:** Name the district, as the design doc shows ("Horreum (Praetentura)"), ghost the footprint on hover, and place a movable stake rather than a live site.

*Verification: Confirmed in code. applyOnce builds at the Ordo's tile with no confirmation (src/game/ordo/actions.ts:104-110). Clicking the Agenda row flashes one map tile, but nothing signals that it can.*

### Any closing modal blocks clicks for 160 ms; only machine-speed clicks hit it

*Low · Interface · Run 1*

**Observation:** Run 1: the first click on "Found a new colony" right after closing How to play was ignored. The harness sent it about 35 ms after the close. The fading backdrop stays clickable for 160 ms and swallows clicks: verifiers lost clicks at 2 to 128 ms and got them through at 200 ms and later.

**Problem:** A person rarely clicks within 160 ms of closing a modal, so the impact is negligible. The dead zone follows every modal close in the game, not just the title screen.

**Suggestion:** Add pointer-events: none to .modal-back.modal-out so a fading modal never catches clicks.

*Verification: Reproduced. Reproduced with timed clicks. The backdrop is removed by a 160 ms timeout (src/ui/modals.ts:105) with pointer events still on. No focus trap lingers.*

### At rank-ups on phone, the rank banner and toasts pile up over the panel

*Low · Mobile & touch · Run 2*

**Observation:** Run 2, day 20453 (Colonia rank): the rank banner and the toasts "Res Gestae: Become a Colonia" and "The town wall is laid out" were on screen together. The "Veterans" item was the fixed event row, not a popup. "Learned: Trade" covers the foot of the trade form for 5 s after sending. The Mappae (map overlays) popover stays open after picking an overlay.

**Problem:** Key moments are cluttered, and toasts catch taps meant for buttons beneath them. The overlay popover hides much of the overlay just chosen.

**Suggestion:** Hold toasts until the rank banner clears, show them one at a time, and keep them clear of the panel's buttons. Close the Mappae popover once an overlay is picked.

*Verification: Partly confirmed. Banner and toasts fire in one loop with no queue (src/ui/index.ts:288). None are modal; each expires in 4 to 8 s.*

### Build costs are cut off the right edge of the placing bar on phones

*Low · Mobile & touch · Run 2*

**Observation:** Run 2 (iPhone 13) saw the Temple's tiles cost clipped to "≡ 3"; Run 6 (Pixel 7) saw a similar "≡ 3". At 390 px the Temple's fifth cost (20 concrete) is fully hidden. Ten building types lose cost chips at 390 px and nine at 412 px; Great baths shows only 2 of its 6 chips in full. The Aedificia (build panel) card still lists the full cost.

**Problem:** While placing, the player can't see the whole price. The hidden chip may be the red "short" one that explains why the building will only be a plan, and a hidden chip can't be long-pressed for its tooltip.

**Suggestion:** Let the cost chips wrap to a second line on narrow screens, or drop the Latin name from the placing bar when space runs out.

*Verification: Reproduced. Measured at 390 px: name row ends at x=376, concrete chip sits at 402-452. Row and costs are nowrap with overflow hidden (src/styles/sheet.css:297-300).*

### Completion toasts like 'Well finished' never say the town council built the work

*Low · Town council (Ordo) · Run 1*

**Observation:** Run 1 built a cistern, then got "Well finished" for a well it had not placed. The Ordo (town council) raised it under the Lex de annona emergency switch, which is on by default; in an untouched new game it places a well around day 152 when water falls to 17 days. Run 1 also placed one well itself through an advisor card.

**Problem:** The toast is often the first notice of an Ordo-built work, so it reads as the player's own or as unexplained. When several works finish together, "N works finished" hides ownership further.

**Suggestion:** Name the builder in the toast and the log line, e.g. "The Ordo raised a well (water was short)". Keep the plain wording for the player's own works.

*Verification: Reproduced. A fresh game raised an Ordo well on day 152 with log "Well finished."; the toast uses only the building name (src/ui/index.ts:292).*

### Double-clicking "Begin now" opens the lesson and also shows an error toast

*Low · Onboarding · Run 8*

**Observation:** Run 8, day 153: double-clicking "Begin now" on lesson III opened lesson IV alongside the toast "No lesson is waiting." Reproduced with ordinary double-clicks 120 and 250 ms apart. The card waits 300 ms after a click before redrawing, so the second click hits the stale button. The lesson advances only once, but the error sound plays.

**Problem:** The player gets an error message and sound at the moment they do the right thing, in the middle of the tutorial.

**Suggestion:** Disable "Begin now" after the first press, or make it do nothing when the lesson it offered has already begun.

*Verification: Reproduced. The button handler has no guard, and a 300 ms click guard delays the card redraw. src/ui/counsel.ts:510*

### Field hint says 6 a day per hand while the ledger shows 10 to 12

*Low · Text & readability · Run 8*

**Observation:** Run 8: the grain tooltip's "How to get more" said "Fields: 6 a day for each of 6 hands" while the ledger above read "Fields (1 hand) +11" and "(6 hands) +61". Reproduced: one hand made 10 to 12. The gap comes from the start field's river soil (about ×1.48), tools (×1.2), skill and morale, not the season (×1.0 in Ver, spring).

**Problem:** The planning figure understates output by about 40% on the starting field, so it looks like a bug. A new field on plain grass makes only about 6.3, so no single number is right everywhere.

**Suggestion:** Label the figure as a base ("base 6 a hand, before soil, tools and spirits") and show this colony's actual average per hand beside it.

*Verification: Partly confirmed. The hint prints the bare base from the building data; the ledger shows simulated output. The inspector already itemises the factors. src/game/hints.ts:73*

### Food works raised through 'Ask the Ordo' never let the council take over food

*Low · Town council (Ordo) · Run 1*

**Observation:** Run 1 had a horreum (granary) raised through "Ask the Ordo", but the Annona (food supply) duty stayed locked. The tester found the rule on the Mandata (duties) line in Edicta (decrees panel): "To learn: Raise fields, a hunting lodge, a forage camp or a granary yourself." Works raised on request do not count; "Apply once" in the agenda and "Place it myself" do.

**Problem:** Advisor cards offer "Ask the Ordo" first, so a player who relies on it keeps getting food works but never unlocks food automation. "Yourself" does not obviously exclude a work the player ordered.

**Suggestion:** Warn on the "Ask the Ordo" button and advisor remedy: "The Ordo will build it, but won't learn the duty; place it yourself to hand Annona over later." Or let requested works count.

*Verification: Design intent, still frustrating. Intended per docs/DESIGN.md:667; request-raised works are skipped in src/game/ordo/duties.ts:92. The rule shows on the duty row, not on the ask button.*

### Grain warnings offer an 80-unit import, about a day of food; the big buy is hidden

*Low · Advisors · Run 3*

**Observation:** Run 3, day 1465 (winter famine): a trade contract carries at most 80 units, about one day of grain for 80 souls, and each load raised the price (170, 190, 210 denarii). The "Grain runs out" and winter warnings offer only this 80-unit contract, pre-filled and not sent. An uncapped "Buy N grain now" exists but appears only in famine remedies, with no button in the Commercium (trade tab).

**Problem:** Players conclude trade can't relieve a famine and miss the real lever. The cap is intended and applies only to contracts. Lex de annona (grain law) auto-imports 20 days of grain, and it saved Run 3.

**Suggestion:** Make the trade remedy on the runout and winter warnings a 20-day "Buy now" instead of an 80-unit contract, and add a Buy now button to the Commercium tab. Leave the contract cap as it is.

*Verification: Partly confirmed. 80 cap and price steps confirmed, but warnings clamp their import to 80 (src/game/advisors/util.ts:506) while buyNow takes any quantity.*

### Handing a chore to the Ordo shifts the chore list, so the next click hits the wrong row

*Low · Interface · Run 3*

**Observation:** Run 3, day 4562: in Mandata (the chores list in the Edicta, or decrees panel), switching Aquae (water) from Mine to Ordo removed its "The Ordo would raise: Well… / Apply once" sub-row. The rows below jumped up about 63 px, and the next click, aimed at Domus (housing), landed on Officia (services) and handed it to the Ordo (town council).

**Problem:** The player hands the wrong chore to the council without noticing, since there is no confirmation. Rows can also move with no click at all when a new "Apply once" sub-row appears under another duty the next day.

**Suggestion:** Keep each duty row's height stable: reserve space for the sub-row, or fade its contents out in place. Give Mandata rows a data-key so the existing scroll anchor pins the row under the cursor.

*Verification: Confirmed in code. The sub-row exists only for duties the player holds (src/ui/tabs/edicta.ts:288); rows use data-duty, so the scroll anchor holds only the section. Run 3 screenshots 164-165 match.*

### Handing the colony to a second window silently loses days since the last autosave

*Low · Saves & sessions · Run 6*

**Observation:** Run 6: each handoff to a second tab lost 3-4 days (tab 1 at day 2079, tab 2 resumed around day 2075). A verifier reproduced it: tab 1 at day 114, tab 2 resumed at day 106. The loss equals the time since the last 20-second autosave, so up to about 20 days at 1× and 200 at 10×. A normal tab switch saves on hide and loses nothing.

**Problem:** Only players with two windows visible side by side hit this, but they lose progress with no message, and at high speed it can be months of game time.

**Suggestion:** Use a handshake: the new tab asks, the owning tab saves, then the new tab loads (for example over BroadcastChannel). Saving on yield alone comes too late, because the new tab loads before it claims the save. At minimum, report the days dropped.

*Verification: Reproduced. Reproduced in a fresh browser (7-8 days lost at 1×). The yielding tab may not save after losing ownership (src/main.ts:430, 442-455).*

### House card stops short above the map legend, hiding its remedy buttons at 1280x720

*Low · Interface · Run 4*

**Observation:** Run 4, day 23,301, laptop 1280x720, Domus (housing) overlay on: the tester thought the legend covered "Ask the Ordo" and "Place a market hall". In fact the card stops about 8 px above the legend and scrolls inside. The unmet need is listed after seven met lines, so its remedy buttons fell below the fold. Scrolling revealed them and the tester used them.

**Problem:** The remedy is the most useful part of a house card, and it is the part that gets cut. Nothing obvious says the card scrolls, so players can miss the Ordo (town council) and placement buttons.

**Suggestion:** Let the card overlap the legend, which cannot be clicked, instead of avoiding it. List unmet needs and their remedies first, or pin the remedy buttons at the card's foot. Moving the legend alone will not work, because the card follows its house.

*Verification: Partly confirmed. The card shrinks to avoid #map-tools, which contains the legend; the card paints above it (z 22 vs 14). See src/ui/inspector.ts:210-270.*

### Hovering the camp ditch shows a long wall paragraph and a button you cannot reach

*Low · Interface · Run 1*

**Observation:** Run 1: hovering the fossa (camp ditch) showed a greyed "Lay out the town wall" button and long text in the bottom-left card. Every hover over ditch, rampart or gate tiles adds a 176-character paragraph about walls, until Municipium rank. Moving the mouse toward the card closes it, so the button can never be clicked.

**Problem:** The ditch rings the camp, so the mouse crosses it constantly, flashing clutter in a prominent panel. An unreachable button is confusing.

**Suggestion:** Keep hover cards to terrain facts and one line. Move the wall text and button to the click card, which already has them. Apply the same rule to building hover cards (Close, priority, Demolish).

*Verification: Confirmed in code. The wall block renders before the hover/click split (src/ui/inspector.ts:817); leaving the map clears the card before the button is reached.*

### In the wide phone drawer, the build list fills only the right column

*Low · Mobile & touch · Run 7*

**Observation:** Run 7 (iPhone landscape, full drawer): the Aedificia (build panel) cards sat in the right half while the left half was blank (shots 143/144). Reproduced: a 656 px pane splits into two columns of about 311 px. The left column holds only Agenda, Opera and the tools row, then stays empty for about 5,500 px of the 6,034 px catalogue with the "All" filter.

**Problem:** For about 90% of the scroll, half the screen is empty while cards are squeezed to half width, so the player scrolls far more in a drawer that is already awkward to scroll on a phone.

**Suggestion:** Let the catalogue span both columns (the phone tray variant already uses column-span: all), or split the cards into several sections so the two columns can balance.

*Verification: Reproduced. The generic two-column rule keeps each page section whole, and the whole catalogue is one section. src/styles/tabs.css:257-260*

### Labour "First" buttons spill into the next column in two-column layouts

*Low · Interface · Run 7*

**Observation:** Run 7, landscape phone: in the Operae (labour) rows, "First" buttons overlapped "Souls 24" and "Children 8 · Youths 3…", reading as "First24". Verifiers reproduced it at 750×342 with 22-66 px of overflow. They also found it on desktop 1440×900 in the Tabularium (wide ledger view) People page (42-85 px), at 667×375, and slightly at 768×1024 tablet portrait.

**Problem:** Text from two sections collides, and the live "First" button, which gives a category 30 days of priority, sits on another section's text and invites mis-taps.

**Suggestion:** Let the controls row wrap, or use minmax(0, 1fr) with a wrapping controls row, whenever the panel body splits into columns. Key the fold rule on column width, not the whole panel's 329 px.

*Verification: Reproduced. The fold rule tests whole-panel width (src/styles/tabs.css:270-273) while the body splits into 2 columns from 520 px (src/styles/tabs.css:257).*

### Land across the river counts as territory but is never reachable, and nothing says why

*Low · Interface · Run 3*

**Observation:** Run 3 (forested map): fields need 7 of 9 fertile tiles, and nearby sites were scarce, mostly as land is reserved for the canabae (civilian quarter) or the pomerium (sacred boundary). Across the river the hover said "No road can reach it." That holds all game: roads can't cross the river and there is no bridge tool. Run 3's "3 fields on the north bank" were on the camp side.

**Problem:** The territory overlay includes land the player can never use, and "No road can reach it." doesn't name the river, so players keep waiting for a bridge that never comes.

**Suggestion:** On the far bank, say "Across the river: no road will ever reach it", shade unreachable land out of the territory overlay, and glow the whole 3x3 field footprint instead of one corner tile.

*Verification: Partly confirmed. 30 of 30 seeds had no valid far-bank field, even at Municipium. Map-wide sites are plentiful (63-161). Message at src/game/place.ts:59.*

### Lesson VII looked unticked after a keyboard speed change; the card was frozen

*Low · Onboarding · Run 8*

**Observation:** Run 8, day ~160: key 3 ran the game at 5× for about 35 days, yet "Choose a faster speed" stayed unticked until the tester clicked "2×". Number keys do complete the lesson in the game state. A verifier reproduced the empty box only with the mouse resting on the lesson card; moving the pointer away (as clicking 2× did) redrew it at once.

**Problem:** A mouse-and-keyboard player who leaves the cursor on the card does what the lesson asks and sees no response, so concludes that only the buttons count.

**Suggestion:** Same fix as the Lesson II freeze: let the hover hold pass progress and tick updates for the current lesson, freezing only a swap to a different card.

*Verification: Partly confirmed. Keys and buttons both call setSpeed, which records the practice (src/main.ts:140). The empty box reproduced in browser only with the pointer resting on the card.*

### Long or emoji colony names are cut at 24 characters with no counter or warning

*Low · Interface · Run 8*

**Observation:** Run 8 said clicking the colony name did nothing and only the eagle opened rename. Verifiers found the name does open rename; only the gold rank badge beneath it ("CASTRA") is dead, so this was likely a misclick. The cut is real: typing "Ægypt🦅🏛️ Colonia Julia Augusta Felix" saved "Ægypt🦅🏛️ Colonia Julia" with no message.

**Problem:** The 24 limit counts UTF-16 units, so each emoji uses 2 or 3 of the 24. The name is cut silently, and the error text "A name of 1 to 24 letters." misleads.

**Suggestion:** Show an "n/24" counter in the rename box and count visible characters instead of UTF-16 units. Optionally let the rank badge open rename too.

*Verification: Partly confirmed. Name button opens rename (src/ui/hud.ts:329). Truncation reproduced in Chromium: maxlength and slice both cut at 24 units (src/ui/modals.ts:340).*

### Long paragraphs in the pixel font are tiring to read

*Low · Text & readability · Run 1*

**Observation:** Run 1, reading How to play: "pixel font for long paragraphs is tiring." How to play and the letters are set in Pixelify Sans at 14 px with font smoothing off, in paragraphs of up to about 75 words. Only Run 1 raised it; Run 2 called the parchment letters "beautiful, readable".

**Problem:** A first-time player meets the densest text (How to play, the opening letter, the lessons) before finding the Text size setting, and a hard-edged 14 px face makes that reading slow.

**Suggestion:** Raise How to play and letter prose to at least the 15 px body size, and point new players to Menu, Text size early. If the art direction allows, offer an optional plain reading face for long prose only.

*Verification: Design intent, still frustrating. Deliberate art direction: only pixel faces ship, per the design doc. How to play prose is 14 px, below the 15 px body size (src/styles/modals.css:62).*

### Merchant names ignore their goods: "Pannonian iron peddlers" brought no iron

*Low · Text & readability · Run 10*

**Observation:** Run 10, day 2025: "Pannonian iron peddlers" offered wine, stone and timber. Name and goods are drawn separately, so iron peddlers lack iron about 57% of the time and Greek wine factors lack wine as often. Syrian spice traders and Gallic cattle merchants can never sell their namesake, because spice and cattle are not tradeable goods.

**Problem:** A small but repeated flavour break: the names promise something the offer does not deliver, which makes trade feel random.

**Suggestion:** Always include the namesake good in that merchant's offers, and rename the spice and cattle merchants after goods that exist.

*Verification: Confirmed in code. The name comes from rng.pick(MERCHANT_NAMES) and the goods from an independent shuffle of all 7 trade goods (src/game/trade.ts:345, 304-319).*

### Nothing tells a new player there is a second colony until nearly two-thirds of the way in

*Low · Onboarding · Run 4*

**Observation:** Run 4 called the Imperium vow ("the next colony gets +5% legacy") "the only prestige hook seen all game". It first shows, greyed out, on the Colonia path card from Municipium (day 16,686, about 63% of the way to victory), not day 23,796 when it was picked. The title screen, How to play, founding letter and tips never mention legacy; only the victory letter explains it.

**Problem:** Idle players stay for the prestige loop. Not knowing a bonus-carrying run 2 exists removes a reason to push through the long middle.

**Suggestion:** Add a line to How to play and the founding letter: dedicating the Capitolium lets you found a new colony with a Legacy bonus (+10% output, +2 morale). Show "Victory and a Legacy" in the Res Gestae (goals panel) from the start.

*Verification: Design intent, still frustrating. How to play's five sections never mention legacy (src/ui/modals.ts:325-332); the title button shows Legacy only after a victory, per DESIGN §9.6 and §15.6.*

### On a landscape phone the title screen hides two of its three buttons below the edge

*Low · Mobile & touch · Run 7*

**Observation:** Run 7 (phone landscape, 342 px tall): on the title screen, "Found a new colony" is cut off at the bottom edge, and "How to play" and "Import a save" are fully off-screen. The screen does scroll 148 px to reveal them, but only the clipped button hints at that. The ☰ menu does fit, as a scrolling sheet, but is one column about 2.6 screens tall.

**Problem:** The first screen looks broken, and a player may never find Import or How to play. The menu wastes half the screen width and needs several swipes.

**Suggestion:** Add a short-height rule for the title (smaller eagle emblem, tighter margins) so all three buttons fit at 342 px. Keep the ☰ menu in two columns on landscape phones.

*Verification: Partly confirmed. Reproduced at 750x342: title content is 490 px in a 342 px box with no height query. The menu fits, but goes one-column below 900 px (src/styles/mobile.css:94).*

### On phone, long-pressing a Via menu row starts the tool instead of explaining it

*Low · Mobile & touch · Run 2*

**Observation:** Run 2: long-pressing "Demolish" in the Via (roads) menu entered demolish mode. Checkers reproduced this for every Via row (Road, Pave, Reserve, Demolish); other tool buttons correctly pin a tooltip. The 25% refund does show on touch, in the build-panel Demolish tooltip and on the inspector's "Demolish? 25% back", but not anywhere in the Via demolish flow.

**Problem:** Touch players long-press to ask "what does this do?" and instead arm a destructive tool. The Via demolish path never mentions the refund.

**Suggestion:** Give the Via menu rows tooltips like other tools, and add "25% back" to the banner "TAP A BUILDING, THEN AGAIN TO CONFIRM" or the "Tap again to demolish" label. Say "Tap", not "Click", in the touch tooltip.

*Verification: Partly confirmed. Reproduced on an iPhone profile: Via rows have no tooltip, so release fires a click (src/ui/mapbar.ts:258). The refund is not hover-only.*

### On phones, the Legate's relief card stays hidden after the player asks for it

*Low · Mobile & touch · Run 7*

**Observation:** Run 7 (iPhone landscape), day 451, famine: tapping "Ask the Legate's relief" showed no card. It was found only via "+6", the Breviarium (dispatch list), then "NVNTIVS The Legate's relief 15 d [Read]". Reproduced: pausing is irrelevant. On phones new dispatches arrive folded, and the famine warning outranks them in the advisor line. The drawer did not close in the repro.

**Problem:** The player asks for emergency grain, sees nothing happen, and must dig through a menu mid-famine. If never found, the card auto-accepts only at expiry, so grain arrives after about 20 days instead of 5.

**Suggestion:** When the player triggers a dispatch, open its card at once on phones too, or let it take the advisor line over a Periculum (danger) warning. At least make the greyed relief button lead to the card.

*Verification: Reproduced. Phone layouts fold every new dispatch and hide it; desktop opens it at once. src/ui/choice.ts:110*

### On touch, the effects of other edict options are only shown on a long-press

*Low · Mobile & touch · Run 7*

**Observation:** Run 7 (touch, skipped intro) praised the long-press tooltips in Edicta (decrees panel), e.g. "Saves 3.1 grain a day; costs 6 spirits", but expected most players to miss them. Verifier: the current option's effect always shows, though defaults say little ("The customary tax."). The lock rule already sits in small text at the section head; only "Settled. Next window: Kal. Sept. (in 84 days)" follows the pick.

**Problem:** Touch players pick without seeing the alternatives' costs, and there is no confirm. Once locked, long-pressing the other options shows only the lock reason, so their effects can't be read until the next window.

**Suggestion:** Show each option's one-line effect and measured impact under the buttons by default, put "Locks until Kal. X" next to the buttons before the pick, and keep effects readable while locked.

*Verification: Partly confirmed. Tooltip is the designed home for impact (DESIGN §10.9); touch needs a 450 ms hold, a mouse only an 80 ms hover. src/ui/tabs/edicta.ts:185-188*

### Only two edicts exist in year 1, and the growth edict waits for 50 souls

*Low · Pacing · Run 3*

**Observation:** Run 3: the Edicta (decrees panel) offered only Rationes (rations) and Tributum (taxes) in year 1 ("It may change once a season"). Each edict unlocks with a Res Gestae (goals panel) milestone, and milestones complete in order. The winter milestone waits until about day 424, so Hospites: Patentes (immigration ×1.6) needs that date plus 50 souls. Run 3 reached 50 souls around day 806.

**Problem:** The player needs settlers to unlock the edict that brings settlers. Tributum Leve's immigration ×1.1 is the only growth lever in year 1, and nothing points to it.

**Suggestion:** Let Hospites unlock from its population goal alone, or at a lower count such as 30 souls, so a growth edict arrives in year 1. Have the slow-colonists advisory suggest Tributum Leve.

*Verification: Design intent, still frustrating. Each edict is gated by a milestone (src/game/decisions.ts:268-270), and milestones complete strictly in order, as DESIGN §9.4 and §10.9 specify.*

### Path choices leave little visible trace, and no advisor ever mentions them

*Low · Delight · Run 9*

**Observation:** Run 9 could not see the promised map tells at laptop zoom (haystacks for Pagus, incense for Pietas) and felt Emporium and Pagus changed little because the Ordo (town council) ran trade and food. Verifiers found the rank-up banner does name the path and tooltips show chips like "Pagus rusticus ×1.3". Paused test screenshots could not show incense.

**Problem:** Haystacks are about 24×20 px on screen and absent in spring, Pietas only tints existing temple smoke, and no advisor or event refers to the path. After the banner the choice fades from play.

**Suggestion:** Add path-specific advisor and event lines, give each path one bold visual tell (new incense particles, bigger haystacks), and credit path bonuses in the Annales (chronicle) when Ordo trade or harvests benefit.

*Verification: Partly confirmed. No chosen-path references in src/game/advisors; the rank banner names the path (src/ui/index.ts:360). Haystack sprite is 12×10 px (src/render/art/decor.ts:116).*

### Phone map buttons shift with the sheet, and the Mappae menu stays open after a pick

*Low · Mobile & touch · Run 6*

**Observation:** Run 6, Android: the + − ⌂ Mappae (map overlays) Via (roads) column sat at y 188-380 with the half sheet and y 488-680 closed; "−" taps after closing the sheet hit the map. A verifier also found a third position (y 429-621) with a context card open, and the column hidden at full. Picking an overlay leaves the Mappae popover open; the Via popover closes on choice.

**Problem:** With four positions, a thumb that remembers where "−" was lands on the map. The tap that closes the popover also reaches the map and can open a card, which moves the column again.

**Suggestion:** Keep the thumb-reach placement but reduce the positions, for example by not moving for context cards. Close Mappae after an overlay pick, except for Officia (services), which needs a second choice. Swallow the tap that closes a popover.

*Verification: Design intent, still frustrating. Reproduced on Pixel 7. The column tracks sheet height by design (src/styles/sheet.css:182-184, DESIGN.md §15.7); overlay picks never close the popover (src/ui/mapbar.ts:132-138).*

### Portrait-tablet tabs show Latin only, and the wide Tabularium view is hard to find

*Low · Interface · Run 5*

**Observation:** Run 5, day 14,272, iPad portrait, Large text: an accidental tap opened the Tabularium (wide ledger view): two columns, English under each tab ("Edicta / Decisions"…), all readable. For about 4 hours the tester had used the narrow docked pane, where tabs are Latin only and "Commerciu..." is cut off. Only docked tablets 720-959 px wide hide the English; desktop, phone and iPad landscape show it.

**Problem:** A player who cannot read Latin navigates by guesswork. The view that fixes it is an unlabelled ledger icon whose name appears only in a long-press tooltip, and How to play omits the views for touch players.

**Suggestion:** Show the English subtitles in the docked tablet pane, at least at Large text. Label the Tabularium segment in the view control, and describe the three views in How to play and an opening lesson for touch players.

*Verification: Partly confirmed. src/styles/dock.css:186-187 hides subtitles below 960 px on purpose (DESIGN.md:1258); only the active view segment is labelled (src/styles/hud.css:161-162).*

### Production chains stop mattering once built: one bloomery outruns every iron need

*Low · Economy & balance · Run 3*

**Observation:** Run 3, day 3411: a mine, bloomery, concrete works and smithy built together gave 291 iron in 80 days (about 3.6 a day), so "Smelt 60" takes about 17 days. Later iron needs are small: rank fees of 60 and 120, tool kits at 0.2-0.4 a day, the Capitolium about 0.8 a day. Storage caps were the only recurring limit.

**Problem:** Once a chain is built, the Ordo (town council) stops staffing it at 95% storage and the player forgets it. Later tiers do draw oil, wine, tool kits and Capitolium materials daily, but too little to ever bind.

**Suggestion:** Make later sinks big enough to bind: raise oil and wine use per resident, iron per tool kit, or the Capitolium's material draw. Make price saturation per market hub, so the best market for a good can change.

*Verification: Partly confirmed. Iron rates match code; producers unstaffed at 95% storage (src/game/ordo/labour.ts:190). Daily sinks do exist. The famine was year 4, not year 1. Marble is cut by design.*

### Rank-up banner closes on a fixed 8-second timer, tight for Large-text readers

*Low · Text & readability · Run 5*

**Observation:** Run 5, iPad, Large text: at Vicus (village rank, about day 1000) and Oppidum (town rank, about day 3755) the banner "vanished in ~3 s while I was reading the unlock list". The real timer is 8 seconds plus a short fade; the tester judged it between screenshots. Vicus shows 8 unlock chips, Oppidum 10. A tap already dismisses it, and the unlocks also go to the Annales (chronicle).

**Problem:** Ten chips plus title and subtitle in 8 seconds is tight for a slow reader at Large text. The timer ignores pause, hover and text size, and players may not know the list is saved in the Annales.

**Suggestion:** Hold the banner while it is hovered or the game is paused, lengthen it at Large text or when there are many chips, and add a small "Recorded in the Annales" hint so missing it costs nothing.

*Verification: Partly confirmed. RANK_BANNER_S is 8 (src/game/balance.ts:359), used in src/ui/banner.ts:26; tap dismisses, and unlocks are logged (src/game/decisions.ts:257-258).*

### Tapping the open tab on a phone closes the sheet instead of raising it

*Low · Mobile & touch · Run 6*

**Observation:** Run 6, Android: tapping Edicta (decrees panel) while it was open closed the sheet, twice by accident. This applies to every bottom-bar tab, from half or full height, and the landscape drawer does the same. The trap case: Edicta opened at half by the "Review" chip; the player taps its tab expecting it to rise to full, and it closes instead.

**Problem:** Most mobile tab bars scroll to the top or return to the root when the active tab is tapped. Here the panel disappears, and nothing on the tab hints that it toggles.

**Suggestion:** When the sheet is below the tab's own height, raise it. Close only from that height, or leave closing to the grabber and Back.

*Verification: Design intent, still frustrating. Specified in DESIGN.md:1249 and unit-tested; slotTap returns 'close' whenever the tapped tab is already open (src/ui/layout.ts:214-218).*

### Templated text has grammar slips like "a fields", "1 hands" and "wait for for you"

*Low · Text & readability · Run 9*

**Observation:** Run 9 logged "homes wait for for you", "a fields", "1 hands", "A Oppidum charter", "a insula", "charter from rome", "Caravan from Lutetia break camp", "The Ludi Romani is kept" and "….". Also: Iuppiter vs Jupiter, mixed Latin-first and English-first labels, and advisor text saying "Horreum" with a "Place a granary" button. Verifiers found more, e.g. "a great baths" and "1 home became Insula".

**Problem:** Each slip is small, but they recur in the Annales (chronicle), ticker and dispatches and chip away at the Roman voice the game leans on.

**Suggestion:** Route all names through one helper that handles singular forms, a/an and counts (the advisors' aName already does singulars). Pick one spelling of Jupiter, one label order, and proofread the templates.

*Verification: Confirmed in code. Each slip traced to a template. Example: "Works begin on a fields" comes from src/game/place.ts:389; "1 hands" from src/game/ordo/reasons.ts:56.*

### The Capitolium's site is fixed by design, but players do choose its vow

*Low · Pacing · Run 3*

**Observation:** Run 3, day 8470: the Capitolium appeared on its own on the reserved Area Capitolina, marked by an altar since day 1. Run 3 had just chosen the Colonia vow "Iuppiter Optimus Maximus", and that choice is what starts it. Aeternitas and Imperium are the other vows, each with its own effect and pediment art. Runs 6 and 7 liked not hunting for a site.

**Problem:** Only the site is automatic. The vow is picked in the Edicta (decrees panel) and the building appears elsewhere, so players don't connect the two. The passive wait afterwards comes from the 64-builder cap, not from placement.

**Suggestion:** Make the link visible: when the vow is chosen, pan to the Area Capitolina and show its crowning sprite going up, with a line such as "Your vow to Iuppiter raises the Capitolium here". Keep the site fixed.

*Verification: Partly confirmed. The Capitolium starts only from the Colonia path choice (src/game/decisions.ts:245) and can't be placed by hand. Run 3 picked Iuppiter on day 8470.*

### The Legate's fee discount shows a fake 98-year countdown, "35996 d"

*Low · Interface · Run 9*

**Observation:** Run 9, day 1391: the Res Gestae (goals panel) showed "The Legate's good word: petition fee ×0.85, 35996 d", and its tooltip said "for 35996 more days". The discount, from hosting the Legate's banquet on day 887, really lasts until the next rank petition, but it is stored as expiring 100 years out.

**Problem:** The player sees a nonsense timer on what is a one-use discount, and cannot tell when it will be spent.

**Suggestion:** Mark one-use modifiers as "until used" and show "until your next petition" in the chip and tooltip instead of a day count.

*Verification: Confirmed in code. Expiry set to day + 100 × 365 (src/game/events-catalogue.ts:221); the chip prints days left (src/ui/objective.ts:156). 887 + 36500 − 1391 = 35996.*

### The Legate's relief always becomes a debt, even with cash in hand; the balance is hidden

*Low · Economy & balance · Run 7*

**Observation:** Run 7, day 451: 417 modii of grain for a 1,668 den debt repaid from Kalends (monthly) taxes, while 1,774 den sat in the treasury and the card offered only Accept or Refuse. Numbers verified (417 × 2 × 2 den). The debt is interest-free with no penalty, and the 25% tax share is only about 3 to 15 den a month at that size.

**Problem:** Paying later costs the same as paying now, so no money is lost. But a player with cash reads it as a forced, needless obligation, and the remaining balance is never shown anywhere.

**Suggestion:** Show the outstanding debt (for example in the coin tooltip), add "Pay it off now" when affordable, and say on the card that the loan carries no interest.

*Verification: Partly confirmed. Two options only, by design (DESIGN §8.12); the debt changes only at creation, Kalends repayment and a spill write-off. src/game/events-catalogue.ts:227-252*

### The Oppidum petition always says "Castra Valeria", even after a rename

*Low · Text & readability · Run 8*

**Observation:** Run 8 renamed the colony to "Ægypt… Colonia Julia" on day 274. Events used the new name, but the Oppidum petition still asked "What will Castra Valeria be known for?". Verifiers found this also hits every later Legacy colony, which gets a different default name.

**Problem:** The player's own name is ignored at a ceremonial moment, which reads as a bug and weakens their sense of ownership.

**Suggestion:** Insert the live colony name into the Oppidum petition prompt, as event text already does. It is the only path prompt that contains the name.

*Verification: Confirmed in code. Hard-coded string in src/game/data/decisions.ts:179, shown without substitution by src/ui/tabs/edicta.ts:86.*

### The Ordo (town council) re-stakes a block the player just cleared before they can build

*Low · Town council (Ordo) · Run 4*

**Observation:** Run 4, day 23,301: the tester demolished 4 houses for a market hall. The Ordo staked new house plots there at once, and placing the hall failed with "That plot is taken." It worked only by demolishing and placing while paused. Demolishing occupied houses triggers the Ordo's housing wish, which can fire within 0 to 6 real seconds at 1×.

**Problem:** Manual clearing is undone by the automation. The existing fix, Reserve block (available since Oppidum), is never suggested at the moment of demolishing, and cancelling the stake alone gets re-staked while beds stay short.

**Suggestion:** When the player demolishes on a block, reserve it automatically for some days, or prompt "Reserve this block for your own plans?". The Reserve marker already exists, so no new tool is needed.

*Verification: Design intent, still frustrating. Demolish leaves no hold; the Ordo avoids only reserved or player-planned blocks (src/game/place.ts:86), as DESIGN.md:701 specifies.*

### The Ordo never builds a bloomery, so "Smelt 60 iron" stalls while ore piles up

*Low · Town council (Ordo) · Run 9*

**Observation:** Run 9: the Res Gestae (goals panel) showed "Smelt 60 iron 0/60" while ore reached 524, probably a full store. The Ordo (town council) had built the requested iron mine but no bloomery (smelter). The ore icon in the top bar has no label until hovered.

**Problem:** Municipium needs 60 iron smelted, but no Ordo rule chases that, and Run 9's focus plan had no bloomery. Unsellable ore fills storage, so the Ordo builds warehouses. The explaining hint is hidden at 720 px tall.

**Suggestion:** Have the Ordo raise a bloomery when a petition needs smelted iron, or with any mine request. Add an advisor line like "Ore waits for a bloomery", show the hint at all window heights, and label top-bar resources.

*Verification: Confirmed in code. Requests build only the named building (src/game/ordo/build.ts:655); no rule targets the smelted-iron counter. Hint hidden on desktop under 860 px tall (src/styles/left.css:153).*

### The away letter reports Ordo trades on a duty you kept, without saying why

*Low · Town council (Ordo) · Run 9*

**Observation:** Run 9, day 8142, with Trade set to "Mine": the away letter said "Decided in your name: Selling 80 surplus oil to Vicus Metellianus. (×9)". The cause is "Govern while I am away", on by default, which lets the Ordo (town council) run manual duties while the player is offline. The tester worked this out alone.

**Problem:** A player who chose to run trade personally finds the council acted anyway, with only the heading "Decided in your name" as explanation. That undermines trust in the "Mine" setting.

**Suggestion:** Add a letter line such as "Govern while I am away let the Ordo act on duties you keep", linked to the switch. Note on "Mine" duty rows that the Ordo covers them while you are away.

*Verification: Design intent, still frustrating. Offline trades on a "Mine" duty are tagged decided (src/game/ordo/trade.ts:191); the letter heading never names the switch (src/ui/dispatch.ts:128). Designed per DESIGN.md:690.*

### The food tablet cuts off the run-out date for most dates on desktop

*Low · Text & readability · Run 9*

**Observation:** Run 9 saw "empty a.d. VI Kal. M..." on the red grain tablet, and "two or more" wrapping onto two lines in the Domus map legend. Verifiers measured 262 of 366 run-out dates clipped in the 120 px tablet (windows under 1760 px wide), and 127 still clipped at 1920 px. Only the desktop layout shows this line.

**Problem:** The date is the urgent part of a food warning, and the clipped line looks broken. Days-on-hand stays readable and the full date is in the hover card, which softens it.

**Suggestion:** Show a short form on the tablet, such as "empty in 12 d" or "empty 24 Apr", or let the line wrap. Widen the legend past its 190 px cap or give Domus labels one column.

*Verification: Reproduced. Measured in Chromium with the game's CSS: 72% of dates overflow at 120 px (src/styles/hud.css:57). Legend is 2 columns in 190 px (src/styles/map-ui.css:45).*

### The game never explains where new house land comes from

*Low · Onboarding · Run 7*

**Observation:** Run 7, day 9,898 (Municipium): a road loop on open grass offered only "Well, Cistern, Wayside shrine…", no house plot. New blocks later seemed to appear by themselves. In fact the whole grid is surveyed at founding: Ring 1 opens at Vicus, Ring 2 at Oppidum, and after that the only new house land is the old camp wall line, once a town wall is finished.

**Problem:** Players expect roads to make building land. The fixed supply stays invisible until it runs out, and the Aedilis (works advisor) still says "place a house plot" when every block is full.

**Suggestion:** Explain it where stuck players look: How to play, the Road tooltip, the rank-up banner (name the new ring) and the "No site can take a house plot" toast. Once rings are full, point to "Lay out the town wall", available from Municipium.

*Verification: Design intent, still frustrating. Roads only add road tiles; house plots need a surveyed block inside the pomerium (city boundary). Hints exist only in scattered inspector cards. src/game/place.ts:185*

### The grain tooltip shows two identical "Pagus rusticus ×1.3" chips

*Low · Interface · Run 9*

**Observation:** Run 9, day 2263: the grain tooltip showed "PAGUS RUSTICUS ×1.3" twice. The Pagus rusticus path sets two bonuses, hunting ×1.3 and forage ×1.3, and the tooltip prints one chip per bonus labelled only with the path name. Each bonus applies once to its own building; nothing stacks to ×1.69.

**Problem:** Two identical chips read as a bonus applied twice, and neither says which producer it boosts. They show even when no hunting lodge or forage camp exists.

**Suggestion:** Name the target in each chip ("Pagus rusticus: hunting ×1.3") or merge chips from one source ("Pagus rusticus: hunting, forage ×1.3"). Hide chips for producers the colony lacks. No simulation change needed.

*Verification: Reproduced. Reproduced in Chromium: two chips from the separate hunting and forage keys (src/ui/hud-tips.ts:90). Each building applies its key once (src/game/economy.ts:108).*

### The harsh tax edict is a near-pure penalty for a small colony

*Low · Economy & balance · Run 7*

**Observation:** Run 7, day 618, about 19 souls: Tributum Grave (harsh tax) read "taxes ×1.4, morale −8, immigration ×0.8. About +0.3 den a day." The figure is exact, about 8% of the 3 den/day stipend. The cost is bigger than shown: −8 morale also lowers the immigration factor, so immigration falls to about ×0.48, births to ×0.84.

**Problem:** The Quaestor (treasury advisor) offers it as a first remedy at any size while coin is plentiful. Run 7 never reverted it and then hit a 19 to 48 population plateau over days 720 to 1,656.

**Suggestion:** Demote it in the Quaestor's remedies below a population threshold, or scale the tax gain with size. Show the full immigration effect, morale included, in the tooltip.

*Verification: Design intent, still frustrating. Numbers match the code; the edict is meant for funding the Capitolium late, yet the advisor suggests it early. src/game/advisors/rules-quaestor.ts:84-90*

### The house popup hides its last needs below the fold with no clear scroll cue

*Low · Interface · Run 9*

**Observation:** Run 9 at 1280×720: a Domus parva (small stone house) popup aiming at Insula looked complete after "Place a bathhouse". "○ A market hall", "○ Oil", the charter and the Insula/Domus choice were found only by scrolling inside it. The popup is capped at 560 px or less and lists 10 needs in fixed order.

**Problem:** Unmet needs that block the next house tier, and so the Municipium petition, sit at the bottom. The thin scrollbar was hidden by the headless test browser, but macOS and touch players get no cue either.

**Suggestion:** Add a bottom fade like the event card's, and list unmet needs first so blockers are always in view.

*Verification: Partly confirmed. Height cap and inner scroll are by design (src/ui/inspector.ts:529, src/styles/inspector.css:6). The missing scrollbar was a headless-browser artifact; no fade exists.*

### The lesson card freezes while the mouse rests on it, hiding completed ticks

*Low · Onboarding · Run 4*

**Observation:** Run 4: the cistern finished around day 170 but "Raise a cistern" stayed unticked until the tester clicked "Show me" around day 200. Run 4's screenshots show the "Rising · N%" progress line missing too, and the build panel already offering Lesson III's House plot. Verifiers reproduced it: with the pointer parked on the card, the game marks the lesson done but the card does not redraw.

**Problem:** A player who rests the mouse on the lesson card to watch progress sees a stale card and cannot tell whether the step is done. The test harness's parked cursor made it more frequent.

**Suggestion:** Let the hover hold pass updates that keep the same lesson (progress and the tick), or update the job line in place. Freeze only a swap to a different card.

*Verification: Reproduced. Completion is set from game state every frame; the card's redraw is held while the pointer rests on it for over 2 s (src/ui/steady.ts:144). Reproduced in browser.*

### The next lesson starts while the game is paused

*Low · Onboarding · Run 1*

**Observation:** Run 1 noticed lessons advance during pause. A verifier paused a new colony for 43 s of real time: the game day stayed at 91 but the next lesson began, with a sound, its tab opening and its target pulsing. The 40 to 45 s breather between lessons counts real time paused or not, and so do the 45 s nudge and the 120 s "Skip this step".

**Problem:** A player who pauses to read or think gets the next lesson pushed at them. That contradicts Lesson VII's own advice to "pause to think" and the design goal that the tutorial never rushes the player.

**Suggestion:** Stop the breather, nudge and "Skip this step" timers while paused or while a modal is open. Otherwise keep counting real play time, not game days, as designed.

*Verification: Reproduced. Play time grows every frame unless the tab is hidden, paused or not (src/main.ts:604). Reproduced in browser with a 43 s pause.*

### Unread tip "The thirsty season" returns every summer until Understood is pressed

*Low · Advisors · Run 6*

**Observation:** Run 6, Android: "The thirsty season" appeared on days 1289, 2051 and 4904, all in Aestas (summer). The player's day-2074 save shows it had never been acknowledged; it was read once around day 4904 and never came back. With the phone sheet closed, a tip waits folded to its title, so Understood is easy to miss. The tip that pushed the petition cards down was a different, urgent one.

**Problem:** A tip returning each summer reads as nagging, although the design says each tip shows once per colony. The player never learned that only pressing Understood retires it.

**Suggestion:** Count a tip as seen once it has been shown, folded away or replaced, or stop an unread seasonal tip returning in later years. Separately, never insert any tip above an armed petition or charter card.

*Verification: Partly confirmed. Understood records the tip permanently (src/game/guide.ts:230-237); the "aestas" tip only qualifies in summer (src/game/guide.ts:147-150), so an unread one reappears yearly.*

### Water advisor stayed amber with 4 days of water left and never said how many wells

*Low · Advisors · Run 10*

**Observation:** Run 10, day 6069 (Aestas, summer): water at 4 days, falling 65 a day. The Curator Aquarum (water advisor) stayed amber because severity follows days until empty (about 22), not days on hand; the card showed a grain warning instead. Only the HUD water tablet went red. About 800 days earlier he had gone red and the player added one well. The real fix was 5 wells.

**Problem:** A nearly dry city reads as a mild note, and no text says how big the gap is, so the player fixes it one well at a time.

**Suggestion:** Escalate when days on hand drop below 7 whatever the runway, raise a warning that has stood all season, and state the gap: "We need 5 more wells (10 Aquarii, water-carrier posts)".

*Verification: Partly confirmed. Severity uses stock / net drain (src/game/advisors/rules-aquarum.ts:43). "~2 years without escalating" is wrong: it reached Periculum (red) around day 5269.*

### Winter grain warning says "We need about 0 in store" while warning of a shortfall

*Low · Advisors · Run 3*

**Observation:** Run 3, day 1465: "Hiems is upon us: our lowest would be 10 days of grain … We need about 0 in store by Non. Ian.; we hold 770". Hiems is winter, and Non. Ian. was that same day. The same clash appears before winter: "Hiems in 6 days: our lowest would be 3 days of grain" with "We need about 0 in store by Kal. Dec."

**Problem:** The title warns of low grain while the text says nothing is needed, so the player can't tell whether to act. Mid-winter the "by" date is today, which is useless as a deadline.

**Suggestion:** Compute the need as the grain that lifts the lowest point to the 15-day warning floor, not the bare winter deficit. Once winter has begun, drop or reword the "by" date, and hide the sentence when stock already covers the need.

*Verification: Confirmed in code. Need has no reserve floor while the warning fires under 15 days; reproduced by running the game modules (src/game/advisors/rules-annonae.ts:116-123).*

## What players loved

- **Rank-up banners and parchments that list every unlock delight players** (7 of 10 runs (1, 2, 4, 5, 6, 7, 10)). Praised in 7 runs. Run 1: "Rank-up banner is lovely: lists every unlock". Run 4: "CASTRA VALERIA FIT OPPIDVM", "Banner great". Run 5: Greek-key parchments and "You will see" promises. Run 6: gold ceremony cards "very satisfying on a phone". Run 7: unlock chips. Run 10: "Fun banner", "satisfying". Run 2: the walled town at Oppidum was "a big visual payoff".
- **The house inspector's "To become …" checklist with one-tap fixes** (6 of 10 runs (3, 4, 5, 7, 9, 10)). Run 3: "the best UI in the game" ("○ A market hall within 10 steps [Ask the Ordo][Place…][Import oil]"). Run 4: it finally explained 0/4 and 7/12. Run 5: "the clearest screen in the game", clean at Large text. Run 7: "first-class". Run 9: the only way the missing shrine and baths were found. Run 10: with the Census it makes "manual play possible".
- **Number tooltips explain cause and effect** (6 of 10 runs (1, 2, 3, 7, 9, 10)). Run 1: souls tooltip "favour ×2.2 of ×3". Run 2: a long-press tooltip ("When: … the Capitolium"). Run 3: grain, morale and edict trade-off breakdowns. Run 7: "Below 28 families begin to leave". Run 9: the grain tooltip's year-ahead chart, "superb". Run 10: stock tooltips with "HOW TO GET MORE" and the Census housing block.
- **Placement preview shows "+N houses could evolve" and good-ground hints** (5 of 10 runs (1, 2, 3, 5, 6)). Run 1: "Place it myself" pans to a pre-positioned ghost ("remedy flow is excellent"). Run 2: tap-to-place with a smart auto-ghost and "Good ground · 24 arches". Run 3: "the single most useful tool", though found by accident. Run 5: "+30%" gold tiles and "+5/+11 HOUSES COULD EVOLVE". Run 6: "+3 houses" and the arch line preview.
- **No JavaScript errors across five full runs, and player-typed names are safely escaped** (5 of 10 runs (2, 4, 6, 8, 9)). Run 4: the error log was empty at every check. Run 8: no errors over about 13,600 days despite corrupt saves, emoji and HTML in names, and window resizes; names were escaped everywhere. Run 9: no errors over 13,480 days. Runs 2 and 6 also logged none, Run 6 across three reloads and a tab handoff.
- **The town visibly grows from tents and huts to a marble Capitolium** (4 of 10 runs (2, 5, 6, 9)). Run 2: huts became cottages then insulae (apartment blocks), with stone walls, a paved forum, aqueduct arches and a quadriga on the Capitolium. Run 5: a snowy Saturnalia town, the theatre, great baths and the marble Capitolium. Run 6: the old castrum (army camp) becoming the inner city. Run 9: Oppidum walls turning to stone, "a great visual payoff".
- **The Litterae Ordinis away letter is a highlight for returning players** (4 of 10 runs (2, 4, 6, 9)). The Litterae Ordinis (the town council's letter on what happened while you were away) won praise. Run 2: "beautiful, readable, pixel icons". Run 4: souls went from 775 to 1,257, with about 100 works listed and green and red changes. Run 6: the best moment of coming back. Run 9: "superb", showing the lowest point of the absence and a "Decided in your name" list.
- **Res Gestae story lines, petition checklists and the Fata card give closure** (3 of 10 runs (1, 2, 9)). Run 1: the Fata (fates) card "FATA · EVERY PATH IS CHOSEN" was "a nice touch". Run 2: petition checklists with ✔/○ and live counts, and the "Your story" sentences. Run 9: the five-line Res Gestae Nostrae ("our deeds", the story section) was "lovely closure".
- **The victory dispatch, Fasti and parchment letters give the game real closure** (3 of 10 runs (1, 8, 9)). Run 1: the Victory dispatch and Legacy flow "work well". Run 8: the founding letter, away report, victory dispatch and Fasti (the chronicle's year list) are "excellent closure". Run 9: the "Your story" record and the "Senatus Populusque Romanus" sign-off made the tester proud.
- **The Commercium (trade panel) is clear, characterful and fun to use** (3 of 10 runs (1, 2, 3)). Run 1: the form shows price against base price, trip length in game days and real time, and "A mule team is free: it leaves on the next day." Run 2: the Commercium unlock and a one-tap shop row felt good. Run 3: "Commercium is a joy": markets have personalities, prices rise with each purchase, and paused contracts say why.
- **Advice that names both the problem and the fix earns trust** (2 of 10 runs (4, 7)). Run 4: the Curator Aquarum's (water advisor's) "No free block within 18 paces of the castellum can take the great baths … Clear a block near the castellum" was "exactly right"; baths and theatre were up within 40 days. "The Ordo has nothing in hand…" was "honest, useful". Run 7: the Hiems (winter) warning was "clearly telegraphed", and the fountain refusal text was "the best placement feedback".
- **Saving holds up to reloads, tab switches and bad imports** (2 of 10 runs (6, 8)). Run 6: three reloads returned to the exact day, the save on closing the tab beat the autosave, the title screen backdrop shows the player's own city, and the one-tab-at-a-time handoff worked. Run 8: garbage imports were refused cleanly, and Load takes two steps.
- **Touch basics are solid and the layout survives any window resize** (2 of 10 runs (2, 8)). Run 2 (iPhone portrait): buttons are at least 44 px, pinch and pan work, demolish mode is clearly marked, and there were no errors. Run 8: resizing from 1440 px wide down to 1024, 800 and 390 px and back never broke the layout or game state; the phone layout is tidy.
- **Small touches reward careful players: two-click charter, precise remedies, instant deals** (2 of 10 runs (1, 10)). Run 1: the Lex coloniae (colony charter) choice says "Click again to choose. This is for good.", which felt reassuring. Run 10 liked the same two-click step, the Mandata (duties list) overview, the Fabrum (works advisor) remedy "Put 3 more hands on …", labour targets above capacity, the Legate banquet, instant "Strike the deal" offers, and the "Pause on Periculum" (pause on critical warning) setting.
- **Urbs focus visibly beautifies the town, but players miss the link to their choice** (Run 5). Run 5 set the Ordo's (town council's) Urbs ("city beautiful") focus on day 236. By about day 1450 the busiest streets were paved grey stone and houses wore garlands, noticed only when zoomed in. The game does say it: the focus text promises "paves 2 busy streets a month" and the Annales (chronicle) logs each paving, but there is no toast or map link.
- **The Roman flavour writing charms and moves narrative players** (Run 9). Run 9: the Legate's opening letter with correct Roman dating ("charmed"); the Robigalia, Parilia and Saturnalia festivals, omens and weddings; named births and deaths, and the mentor's fever ("genuinely moving"); veterans settling at the Porta Praetoria (the camp's main gate) and the vow to Apollo Medicus.
- **Hand-over cards and "Hand over all" make delegating to the Ordo feel rewarding** (Run 4). Run 4 (idle player): the "Learned: Staffing" toast was a "great hook". Cards offering the timber, stone and trade duties to the Ordo (town council) appeared unprompted, and the player used "Hand over all" on day 219 and day 4,345.
- **Event cards with a countdown and an "if silent" default suit idle play** (Run 4). Run 4, day 2,433: a Drought card gave a 29-day countdown and tagged "Ration the wells" as the "if silent" choice, so an absent player still gets a sensible outcome. A Fever card offered a vow to Apollo.
- **Panel hotkeys and the H home key speed up play for veterans** (Run 3). Run 3 (veteran player): "E V B P T L panel keys are nice once unlocked" and "The H home key is great." H recentres the map on the forum.
- **Keyboard basics are good: slider arrows, clear focus rings, focus kept inside dialogs** (Run 8). Run 8 (keyboard-only probing): sliders respond to the arrow keys and End, focus rings are clear, Tab stays inside open dialogs, and toggles stay in sync.
- **The Capitolium progress line packs stage, percent, bottleneck and time into one row** (Run 1). Run 1 judged the Capitolium (the final temple) line "Podium rising · 21% · bottleneck: builders · next stage ≈ 90 d" excellent. Other runs found the bottleneck part wrong at times: in Run 2 it sat at 46% for about 1,800 days while saying "bottleneck: builders".

## Reported but not confirmed

Tester reports that the code check or a reproduction did not bear out.

- **"The Ordo would assign 8" above 6 posts was a misread digit in a tiny font** (Run 10). The suggestion is capped by each post's slots (src/game/ordo/labour.ts:145). A 5-seed, 300-day headless run found no suggestion above capacity.
- **Ordo (town council) reportedly laid out no house plots for 500+ days; not reproduced** (Run 1). Code and a sim run on Run 6's save: the Ordo staked ring-1 canabae plots on days 6186 and 6192. Only silent case is no valid plot (src/game/ordo/build.ts:369).
- **"Show me" does single out the Food row, but the glow lasts only 3 s** (Run 1). Refuted by code and Run 1's screenshot 006-showme.png: the Food row gets a solid pulsing gold outline, brighter than the section glow (src/ui/counsel.ts:237).
- **WASD pan and wheel zoom do work, also in placement; reports came from instant test taps** (4 of 10 runs (1, 3, 9, 10)). Both verifiers refuted it in a live browser. Only defect: the unclamped first-frame time step in src/ui/keys.ts:44 makes tiny taps pan backwards.
- **Updating advisor cards do not swallow first clicks; reports came from test timing** (2 of 10 runs (1, 6)). Both verifiers refuted it live. Rebuilds wait during a press, for 300 ms after it, and under a resting mouse (src/ui/steady.ts:116-155).
- **Rank-up ceremony seemed to be skipped, but it always shows and vanishes after 8 seconds** (2 of 10 runs (6, 9)). Both checkers refuted it: every rank-up shows the banner, which hides on an 8 s wall-clock timer (src/ui/banner.ts:26). The testers' screenshots came too late.
- **Ghost text on the advisor card at rank-up was the new card fading in** (Run 1). Both checkers refuted it: one card exists across every rebuild; the fade is the designed entrance animation (src/styles/left.css:66).
- **A 'Place' mis-hit came from a test script; build cards are well spaced** (Run 1). Both checkers measured cards at 1440x900 and found wide gaps (src/styles/tabs.css:150); the harness clicked by text match.
- **A long Pave drag seemed to pave 2 tiles; it actually paved every dirt tile on the line** (Run 3). Both checkers refuted it: the drag paves every dirt tile on the L-path and skips paved ones (src/game/place.ts:445-456). A browser drag paved 11 of 11.
- **"Desirability +4 within 3" isn't a verdict on blocked spots; it shows only off the map** (Run 3). Benefit text shows only when there is no placement check; every map tile runs the check and shows its red reason (src/ui/mapbar.ts:412-416).
- **The tab bar did not reflow when Annales appeared; the stray edict click had another cause** (Run 4). Screenshots 037-038 show the same bar height and Tributum position. Tabs use a fixed 3-column grid (src/styles/panels.css:20-21).
- **Post-victory goals XXI-XXIV all log on the Capitolium day; this is intended, not misdating** (Run 4). Goals are checked every day, away catch-up included; XXI-XXIV open only after XX by design and are tested (src/game/objectives.ts:135-155).
- **The game is paused behind the Menu, but the speed control still shows it running** (Run 5). Reproduced pause: any open dialog stops the clock (src/main.ts:530), but the HUD speed control reads only the player's own pause flag (src/ui/hud.ts:518-527).
- **A pinch did not open the house card; the real nit is a close button that scrolls away** (Run 5). Both verifiers refuted it; a second finger clears the tap (src/render/input.ts:85-91). The ✕ sits in a non-sticky header inside the scrolling card (src/styles/inspector.css:6).
- **Cancelling a placement already restores the sheet's earlier height, as designed** (Run 6). Reproduced on a Pixel 7 profile: all three heights restored. restore() returns the kept height (src/ui/layout.ts:845-852), as DESIGN.md:1253 specifies.
- **Faded advisor line was a 0.35 s fade-in caught by screenshots, not lasting translucency** (Run 7). Both verifiers refuted it; opacity returns to 1 when the 0.35 s counselIn entrance animation ends. src/styles/sheet.css:79
- **Slider thumbs do drag on touch; Run 7's failed drags most likely missed the slider** (Run 7). Native range inputs; no game code blocks the touch, and panel rebuilds pause during a drag. src/ui/steady.ts:157-178
- **Populus is not skipped in Tab order; arrow keys switch tabs, but nothing says so** (Run 8). Roving tabindex per the WAI-ARIA tabs pattern, reproduced in a browser. src/ui/panels.ts:314-315
- **Not reproduced: the house popup does refresh after picking Insula or Domus** (Run 9). Both verifiers saw the header update in Chromium (measured 450 ms); the card rebuilds on preference change (src/ui/inspector.ts:86). The stale view came from the harness reading too soon.
- **Lost placement click was a click on the placement banner, not a game bug** (Run 10). Reproduced in a browser: a click on the banner (src/ui/mapbar.ts:432) does nothing; a click on the ghost places on the first try (src/main.ts:493).

## Method

- Each tester decided from what was on screen, not from the game state. Time was compressed the way a player compresses it: 10× or 20×, closing the tab (the game's own absence simulation), or skipping blocks of days as a stand-in for leaving the game running. The first two game years were played at 1×–5×.
- Not measured: frame rate and real-time speed (several browsers shared four CPUs). Findings that may come from the test harness say so.
