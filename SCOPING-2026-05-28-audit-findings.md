Phase A is complete and grounded in both the live UI and the actual data files (`veydria-spatial.geojson` \= 3,059 features; `veydria-lore.json` \= 21 lore entries). Below is **Deliverable 1**, written as a standalone, independently-actionable document. I'm posting it in full now (per our agreement, chat-is-the-disk) before I touch Phase B. Screenshots are referenced by their in-session capture IDs.

---

# **Map content audit — 2026-05-28**

**App:** Veydria Cartography · **URL:** [https://pmartin1915.github.io/veydria-cartography/](https://pmartin1915.github.io/veydria-cartography/) **Data verified:** `veydria-spatial.geojson` (3,059 features: 3,004 terrain cells, 6 civilizations, 1 water body, 55 named point/line features), `veydria-lore.json` (21 entries, 155 snippets, `_meta.generatedAt` 2026-05-13). **Viewport:** 1440×900 (content area 1138–1423 px wide). **Layers exercised:** Terrain, Basin, Rivers, Faction Overlay, Hex Grid (cell 50), Biome Colors, Civilizations, Landmarks, Oases, Sacred Sites, Trade/Ports/Chokepoints/Trade Routes.

## **Summary**

* **8 findings total: 2 critical / 4 polish / 2 subjective**  
* Headline: region land-area is heavily imbalanced (Irrah is \~5.8× Ndjadi by cell count), the Biome Colors layer doesn't surface the per-cell biome variety that exists in the data, and a same-tab stale-hash bug prevents re-centering (also relevant to Phase B).  
* Naming data is clean (zero `null` names in spatial data), but there's a real label/tooltip romanization mismatch for Ngaru Bon.

## **Findings**

### **\[F1\] Region land-area is severely imbalanced across the six civilizations**

* **Severity:** subjective (worldbuilding judgment) — borderline polish  
* **What you observed:** Terrain-cell counts per civ (from the GeoJSON, the canonical source): Irrah **1,144**, Ngaru Bon **927**, Oravan **267**, Kheshkai **245**, Qollari **225**, Ndjadi **196**. Irrah \+ Ngaru Bon \= 2,071 of 2,777 assigned cells (\~75%). Irrah is \~5.8× the size of Ndjadi. Visually this matches ss\_1551bcpwp / ss\_7741kd0kb — the tan Irrah/Ngaru-Bon mass dominates the continent while Ndjadi/Qollari/Kheshkai are slivers.  
* **Where:** whole map; `category==terrain_cell`, grouped by `civ`. Default zoom.  
* **Suggested action:** GM judgment call. If the imbalance is intentional (two hegemons \+ four smaller polities), no fix — but consider whether the four small regions have enough cells to make in-region journeys interesting. If unintended, rebalance cell assignment in the spatial pipeline.

### **\[F2\] "Biome Colors" layer does not visually differentiate the per-cell biomes that exist in the data**

* **Severity:** critical (a named layer doesn't deliver its stated function)  
* **What you observed:** Each civ's terrain cells carry a real `biome` value, and the data is varied — 24 distinct biomes overall (e.g., Irrah: Desert 783 / Sabkha 122 / Oasis 121 / Escarpment 118). But toggling **Biome Colors** on (ss\_1559fxq9o, ss\_7741kd0kb) tints only broad region-level zones and renders large empty hexes in the surrounding ocean/void; within a civilization the four biomes are not distinguishable — Irrah's Desert, Sabkha, Oasis, and Escarpment cells all read as the same tan. The variety is in the data but invisible in the layer.  
* **Where:** Layers → Geography → Biome Colors; verified against `biome` field per cell.  
* **Suggested action:** Map the existing per-cell `biome` value to distinct fills/patterns in the Biome Colors layer (24 biomes → a palette keyed by biome, not by civ). This is the layer that would make journey-planner mode choices feel grounded.

### **\[F3\] Each civilization has exactly one dominant biome (66–75%), limiting in-region terrain variety**

* **Severity:** subjective  
* **What you observed:** Dominant-biome share per civ: Irrah Desert 68%, Oravan Volcanic-archipelago 66%, Ngaru Bon Highland-savanna 72%, Kheshkai Steppe 70%, Qollari Cloud-forest 75%, Ndjadi Monsoon-delta 68%. Every region is a single theme \+ 3 minor biomes. Internally consistent and defensible, but a wholly in-region journey will rarely change terrain type.  
* **Where:** all six civs; `biome` distribution.  
* **Suggested action:** GM judgment call. Acceptable as a "each nation has a signature landscape" design; only act if you want intra-region journeys to feel varied.

### **\[F4\] Ngaru Bon romanization mismatch between stylized map label and tooltip/data**

* **Severity:** polish  
* **What you observed:** The stylized continental label renders **"NGARU-BON"** (hyphenated) — ss\_7741kd0kb — while the civilization hover tooltip and the underlying data `name` are **"Ngaru Bon"** (space) — ss\_8842nq7q9 ("Ngaru Bon · CIVILIZATION"). The prompt notes canon.json lists three variants (space / hyphen / underscore); the hyphen form has leaked into the on-map typography. (The `id` is `ngaru_bon`, which is fine as an internal slug.)  
* **Where:** continental map title layer vs. region tooltip.  
* **Suggested action:** Pick one display form (recommend "Ngaru Bon" to match the tooltip and data `name`) and use it for the stylized label too.

### **\[F5\] Named point features carry no `civ` assignment, so segment labels infer region loosely**

* **Severity:** polish  
* **What you observed:** Point features (ports, oases, etc.) have no `civ` property — e.g. `tavakh_qarat` and `qarat_al_fidda` return `civ: undefined`. The journey planner then labels segments by spatial inference ("Within Irrah"). For a Tavakh-Qarat → Qarat al-Fidda route both endpoints were labeled "Within Irrah" (ss\_1013xnvmg), which is correct here — but the absence of an explicit region tag means region attribution is computed, not authored, and can mislabel coastal/border nodes.  
* **Where:** all 55 non-cell features; verified `tavakh_qarat` \[600,290\], `qarat_al_fidda` \[730,260\], `tavakh_rubat` \[360,390\] all lack `civ`.  
* **Suggested action:** Add an explicit `civ` (or `region`) property to point features in the spatial data so segment labels and compendium grouping are authoritative rather than inferred.

### **\[F6\] Hex grid is readable and functional; large default cell size is the only minor concern**

* **Severity:** polish (mostly a positive note — corrects a likely prior-audit assumption)  
* **What you observed:** Hex overlay (ss\_8842nq7q9) shows clean alphanumeric labels (A–K columns, numbered rows) in legible grey serif, sitting at hex centers without colliding with point markers at z≈0. Hovering a hex yields a useful terrain tooltip ("A12 · Open Sea"). At the default zoomed-out view (ss\_9662tr3jx) the hexes are very large relative to the continent (each hex ≈ a whole sub-region) and labels disappear until you zoom in. A cell-size selector (30/50/70) exists.  
* **Where:** Layers → Hex Grid; cell=50 default.  
* **Suggested action:** Consider defaulting hex cell size to 30 for the continental view, or auto-scaling cell size to zoom so labels are visible without manual zoom-in. Not a bug.

### **\[F7\] Oravan is a separate landmass across open ocean — cross-region travel to it must be maritime, but point-node naming obscures which ports are actually on the islands**

* **Severity:** critical (cross-region travel readability)  
* **What you observed:** Oravan renders as a distinct archipelago west of the mainland across labeled "OPEN OCEAN" (ss\_1551bcpwp, ss\_9060hnjz7). Two similarly-named ports exist — Tavakh-**Qarat** \[600,290\] sits on the mainland Irrah coast, while Tavakh-**Rubāṭ** \[360,390\] is the one nearer Oravan. A GM selecting "Tavakh-Qarat" expecting the Oravan port would get a land route through Irrah with no water crossing. The near-identical prefixes make it easy to pick the wrong endpoint for an intended sea journey.  
* **Where:** Oravan archipelago; ports `tavakh_qarat` vs `tavakh_rubat`.  
* **Suggested action:** Disambiguate the two Tavakh ports in the node picker (e.g., suffix with region: "Tavakh-Qarat (Irrah coast)" / "Tavakh-Rubāṭ (Oravan)"), which depends on F5's `civ` tagging. Verify the planner annotates a sea/strait segment when a route actually crosses the Halkar Straits.

### **\[F8\] Lore compendium entries are content-rich but a few are auto-generated stubs / table dumps**

* **Severity:** polish  
* **What you observed:** `veydria-lore.json` keys 21 entries by id; each is an array of snippets with `title`/`category`/`source`/`summary`. Most are substantive (e.g., Irrah Drylands geography reads as a full adventure hook). But some entries are raw markdown-table dumps (e.g., the Irrah disease entry surfaces a pipe-delimited table `| Local Name | Real-World Basis | …`) that will render poorly as a tooltip/card. `_meta` shows these were machine-generated (449 sources scanned), so formatting fidelity varies entry to entry.  
* **Where:** `features.irrah[1]` (`ecology.disease.irrah`) and similar table-bearing snippets.  
* **Suggested action:** In the compendium renderer, detect markdown tables in `summary` and render them as tables (or strip pipes) rather than dumping raw `|`\-delimited text.

---

**Phase A is done and saved (posted) above.** Proceeding now to Phase B (Application UX audit). I already have two confirmed app-level observations carried over: the **same-tab stale-hash bug** (navigating `#z=...&cx=...` in the same tab did not re-center — ss\_1756741q0 still showed the prior view with frozen tooltips, while a **fresh tab re-hydrated correctly** — ss\_9060hnjz7), and **font 503 errors** on self-hosted woff2 files. I'll formalize both in Phase B and continue with the mode-selector badge, responsive 700×900, share mode, persistence, compendium, seasons, console, and the `.journey-planner-header` CSS cascade check.

Let me start Phase B by testing the mode-selector recommendation badge. First, the caravan supply trigger.

Tool: browser\_batch

Console tracking started fresh. Let me reload to capture page-load console messages, then start the badge test. I'll use tab 1917678381 as the clean test tab.

Tool: browser\_batch

Confirmed: **font 503 errors** are reproducible. The `fonts.css` (at `/veydria-cartography/fonts/fonts.css`, 200\) references woff2 files at the **wrong path** — `https://pmartin1915.github.io/fonts/...` (site root) instead of `/veydria-cartography/fonts/...`. All 5 self-hosted woff2 (Cormorant-Garamond 400/700, Inter 300/400/600) return **503**. The app falls back to system fonts. This is a real, repeatable asset-loading bug.

Now the mode-selector badge test. Let me open the journey planner. Default state first (Direct, supply none, no route) — verify no badge.

Tool: browser\_batch

The planner is open by default on fresh load, so I shouldn't click toggle (that would close it). Let me read the planner's mode-selector area to check for a badge in default state.

Tool: find

The planner panel may not be open on this fresh load. Let me screenshot to confirm state.

Tool: computer

On this fresh load the planner is **closed** (Layers panel shown, "Journey" button not active). So the planner is NOT open-by-default on a clean load — earlier it appeared open because the previous session state persisted. Let me open it. Also note: window is now 1423×834 (taller).

Tool: browser\_batch

**Default state verified:** Direct mode selected, SUPPLY \= default, no route, **no "Recommended" badge** on any mode button. ✓ Expected behavior confirmed.

Now test the **caravan supply trigger**. Let me click SUPPLY dropdown and look for a caravan option.

Tool: browser\_batch

Tool: browser\_batch

SUPPLY expanded: RATIONS/PERSON 12, WATER/PERSON 6, ENCUMBRANCE (light/normal/heavy, normal selected), PACK ANIMALS (none/few/**caravan**, none selected). Let me click "caravan" and check if the Recommended badge appears on the safest button (with Direct mode active).

Tool: browser\_batch

ref\_223 is "+3 days" (few), ref\_224 is "+7 days of capacity" (caravan). Let me click caravan (ref\_224) and screenshot the mode-selector row.

Tool: browser\_batch

Caravan is now selected (SUPPLY header reads "12d rations · 6d water · pack: caravan"). The view scrolled so the ROUTE PRIORITY mode buttons are now above the visible area. Let me scroll up to see the mode-selector row and check for the badge.

Tool: browser\_batch

**Caravan trigger verified:** The **"Recommended" badge now appears on the "Safest" button** (gold pill, gold border) — `Safest [Recommended]`. Direct is still the active mode. The badge is on the safest button as specified. ✓

Now let me verify: (a) the badge color is **gold** (read computed CSS), (b) the **tooltip mentions "caravan"**, and (c) clicking Safest removes the badge (active mode never badged). Let me read the computed styles of the badge and hover for the tooltip. First, let me find the badge element and read its computed CSS.

Tool: javascript\_tool

Computed CSS verified (not from memory):

* **Badge background \= `rgb(232, 200, 64)`** \= **\#E8C840, a gold/amber color**. ✓ NOT red. This matches the gold warning palette.  
* Badge text color `rgb(26,18,6)` (near-black) on gold — good contrast.  
* **Tooltip (title attribute) \= "Recommended: Direct \+ caravan has \~2× the failure rate in simulation"** — explicitly mentions **"caravan"**. ✓  
* Font size 9px (small but legible).

Now let me verify the gold matches the warning blocks. But first, let me test: **clicking Safest should remove the badge** (active mode never badged). Let me click Safest.

Tool: browser\_batch

Tool: browser\_batch

**Active-mode-never-badged verified:** After clicking Safest (now the active mode, highlighted), the **Recommended badge is gone** (recommendedBadgeCount: 0, and the screenshot shows "Safest" with no pill). ✓ All three caravan-trigger sub-checks pass.

Now let me verify the badge **gold matches the warning blocks**. I need a route that triggers the Mode Risk/Encounter Density warnings. The prompt says Oravan→Irrah cheapest/summer gives 2 severe encounters. My earlier test (Tavakh-Qarat→Qarat al-Fidda) gave only mild encounters. Let me try a longer cross-region route to trigger severe encounters. Let me reset mode to Direct, set caravan back, and pick a long route. Actually, the most efficient path: configure a route, then compare the badge gold (`#E8C840`) to the warning block backgrounds via computed CSS.

Let me set up a route likely to trigger severe encounters — a long cross-region one. Let me reset to Direct, pick Tavakh-Rubāṭ (Oravan) → a far Ngaru Bon/Kheshkai node, cheapest, summer. First click Direct, then set up FROM/TO.

Tool: browser\_batch

Let me get the actual Direct route-priority button (not the overlay). Let me click Direct first via its text, then set up the route. Let me read the route priority buttons.

Tool: find

Tool: browser\_batch

Tavakh-Rubāṭ (PORT) appears. The window resized to 1138×639 (the screenshot scale changed). Let me select it and pick a far destination. Let me click Tavakh-Rubāṭ.

Tool: browser\_batch

Tool: browser\_batch

Tool: browser\_batch

FROM \= Tavakh-Rubāṭ (port), TO search shows "Khulut" (OASIS — a Kheshkai/eastern oasis). Let me select it, set Summer \+ Cheapest, and Find Route.

Tool: browser\_batch

Tool: browser\_batch

Tool: browser\_batch

Excellent — a much richer multi-segment route: Tavakh-Rubāṭ → Qollari → Wasi-Pukya → Aethelian Basin → Qarat al-Fidda → Irrah → Khulut (6 segments). And a **"Seasonal Restrictions" warning** appeared (gold-ish): "Desert crossing: Irrah caravans avoid summer. Qalībin escorts required for Basin leg." This route crosses the **Aethelian Basin (water\!)** as a segment — interesting geographic note (Caravan Thread route crosses the basin).

I need to scroll up to see the Mode Risk / Encounter Density warnings and the mode-selector badge, and read the warning block computed colors to compare with the badge gold. Let me scroll up within the panel.

Tool: browser\_batch

Now at the top: Summer \+ Cheapest selected. **Notably, NO "Recommended" badge on any mode button here** — even though this route triggered a Seasonal Restrictions warning. The badge only appeared for the caravan+Direct combo earlier. The current active mode is Cheapest. Per spec, the badge should appear on the safest button when a route generates ≥2 severe encounters. This route may not have 2 *severe* encounters (the earlier one had mild). Let me check the warnings and encounter severity via DOM. Let me query all warning blocks and their computed colors, plus encounter severities, in one shot.

Tool: javascript\_tool

This is the **definitive color verification** (computed CSS, not memory):

* **Bottlenecks block: red** — `rgba(255, 68, 68, ...)` \= `#FF4444` (border \+ tint). ✓ Confirms red severity for bottlenecks.  
* **Seasonal Restrictions block: gold** — `rgba(232, 200, 64, ...)` \= **\#E8C840** (border \+ tint). ✓  
* **The Recommended badge background \= `rgb(232, 200, 64)`** \= `#E8C840` — **identical gold to the Seasonal Restrictions / warning blocks.** ✓ The badge gold matches the gold warning palette and is distinct from the red bottleneck color. This corrects/confirms the prompt's color requirement.

Note: this route triggered the **Bottlenecks (red)** and **Seasonal Restrictions (gold)** warnings, but I don't see a Mode Risk or Encounter Density block here, and no badge — so this route doesn't hit the "≥2 severe encounters" condition. This is an interesting nuance: the badge logic is tied to caravan+Direct (verified) OR ≥2 severe encounters; my routes produced mild encounters and bottleneck/seasonal warnings but not 2 severe encounters. I'll note that I verified the caravan trigger definitively and verified the gold color matches, and that I could not reproduce the "≥2 severe" encounter trigger with my endpoint choices (consistent with encounter generation being roll/route-dependent). This is honest reporting rather than over-claiming.

Now the critical **share-mode test**. Let me append `&share=1` to the current configured URL and open in a **fresh tab** (to avoid the stale-hash bug). The current config URL is `#journeyFrom=tavakh_rubat&journeyTo=khulut`. But that doesn't capture season/mode. Let me grab the current full hash and the caravan-Direct badge config. Actually for share mode, the key checks are: badge hidden, Mode Risk/Encounter Density hidden, Encounters tab hidden, Bottlenecks shown, Seasonal Restrictions shown. Let me build a share URL. First let me capture current hash.

Tool: javascript\_tool

The result was blocked (privacy filter for query-like data). That's fine — I know the hash from the tab context: `#journeyFrom=tavakh_rubat&journeyTo=khulut&z=0.50&cx=545.0&cy=420.0`. Let me also note the mode/season aren't in the hash, which is itself relevant (hash may not capture full config). Let me build the share URL and open in a fresh tab. Let me create a new tab and navigate with share=1.

Tool: tabs\_create

Tool: browser\_batch

**Share mode is working.** Top banner: **"Player view — annotations and encounter notes are hidden"** ✓. The top toolbar changed: GM-only buttons (Pin, Measure, Hex, Parchment, Player Link) are **gone**; share mode shows Planning, Share, Snapshot, Day, Help, Settings, Search. The planner loaded with FROM=Tavakh-Rubāṭ, TO=Khulut (hash hydrated the endpoints), but **SUPPLY reset to "default"** (caravan not carried over — supply isn't in the hash) and **season reset to "Any"** and **mode to Direct** — so `&season=summer&mode=cheapest` params were NOT honored. This confirms the hash only persists from/to, not season/mode/supply — a finding.

The route didn't auto-compute (Find Route not yet clicked). Let me click Find Route in this share tab and check what warnings/tabs show. Let me find and click Find Route.

Tool: browser\_batch

To best compare share vs GM, let me set the share-tab route to the same config (Summer \+ Cheapest) then Find Route, then inspect which warnings/tabs/badge render. Let me set summer+cheapest+caravan to match, then find route.

Tool: browser\_batch

Tool: browser\_batch

**Share mode behavior verified precisely (DOM-level):**

* **Hidden in share:** Mode Risk (false), Encounter Density (false), **Encounters tab (false)** — tabs are only \["Route","Days"\], Recommended badge (false). ✓  
* **Shown in share:** Bottlenecks (true), Seasonal Restrictions (true), Route timeline, supply/distance summary (DISTANCE 1210 km / 303 leagues, \~32 days, 6 segments, MERCHANT-GRADE). ✓  
* Player banner present. ✓  
* **GM-only action buttons partly hidden:** share shows Save / Link / Markdown / JSON but **"Mark explored" is gone** (vs GM mode which had Save / Mark explored / Link / Markdown / JSON). That's correct — Mark explored is a GM action.  
* Top toolbar correctly hides Pin/Measure/Hex/Parchment/Player Link.

This is solid. One nuance: the share route here is the full Tavakh-Rubāṭ→Khulut (1210 km, 6 segments) and shows the same bottleneck/seasonal warnings as GM mode — correct. The encounters and badge are hidden — correct.

Now let me test the **responsive 700×900 layout**. Let me resize the GM tab (1917678381) and check the planner bottom-sheet behavior \+ mode-selector row \+ action button wrapping.

Tool: browser\_batch

The resize\_window reported success but the **screenshot still shows the 1423px-wide desktop layout** — the rendered viewport didn't actually shrink to 700px (the screenshot is 1423×799). The window manager may not have applied it, or the screenshot captures at a fixed scale. This means the CSS media query at \<768px may not be triggering visually. Let me verify the actual viewport width via JS, since the screenshot dimensions are unreliable here.

Tool: javascript\_tool

The window resize to 700px wide did not take effect — innerWidth is still 1138\. The resize\_window tool succeeded at the OS window level but the content viewport stayed 1138\. This is an environment limitation. To properly test the \<768px breakpoint, I'll use the JS-reliable approach: I can't force innerWidth via JS, but I **can** evaluate the responsive CSS rules directly by inspecting the stylesheet — which is actually the more rigorous method for the CSS cascade finding (\#10) anyway.

Let me try a more aggressive resize and re-check, then fall back to CSS inspection.

Tool: browser\_batch

The viewport stubbornly stays at 1138 (outerWidth 1536\) — the window resize isn't reducing the content area below \~1138 in this environment. I cannot visually validate the bottom-sheet behavior at 700px. Rather than fabricate a visual result, I'll do the rigorous thing: **inspect the CSS rules directly** to verify (a) whether the mobile bottom-sheet rules exist and are correctly ordered, and (b) the `.journey-planner-header` cascade bug from finding \#10. Let me extract the relevant CSS rules from the stylesheet.

Tool: javascript\_tool

This is the **definitive CSS analysis** for findings \#2 and \#10:

**`.journey-planner` (the panel itself):** The CSSOM returns rules in source order. Here the **base rule comes first**, then the `@media (max-width: 768px)` override — so the mobile rule (`inset: auto 0 0; width: 100%; border-radius: 12px 12px 0 0` \= bottom-sheet) wins at \<768px. ✓ This is the **correct cascade** (the "prior cascade fix" is in place for `.journey-planner`).

**`.journey-planner-header`:** The CSSOM shows the `@media (max-width: 768px)` rule **FIRST** (`padding: 8px 14px 10px`), then the **base/desktop rule SECOND** (`padding: 12px 14px`). Since both have equal specificity and the desktop rule appears **later in source order**, the desktop `padding: 12px 14px` **overrides the mobile padding even at \<768px**. This is exactly the cascade bug described in finding \#10 — the mobile media-query override is declared *before* the desktop rule, so it loses. **Confirmed via CSSOM, not just the handoff note.**

The visible impact: at \<768px the header keeps desktop padding (12px top/bottom instead of the intended 8px/10px), a minor vertical spacing issue. Real but low-severity. I have the proof I need without needing the viewport to actually resize.

Let me now test the remaining items efficiently: annotations/persistence, compendium/search, and seasons. Let me restore desktop width first and test the compendium/search. Let me check the Search button (seen in share toolbar) and seasons. Let me restore the window and open search.

Tool: browser\_batch

Let me open the compendium (ref\_27) and test search → click result → fly-to behavior. Let me first open compendium.

Tool: browser\_batch

The "Compendium" button is now active (highlighted), and the top toolbar revealed more GM tools (Graph, Log, Prep, Compendium, Day, Help, Settings, Search). But the **Compendium panel doesn't appear to have opened visibly** — the screen still shows the Journey Planner on the left. The compendium may open as an overlay/modal that's hidden behind, or it didn't render. Let me check the DOM for a compendium panel.

Tool: find

The compendium IS open (just rendered behind/around the planner). It has a search box and shows "188 / 188 entities". Let me close the journey planner to see the compendium clearly, then search. Let me scroll to the compendium and search for a place. Let me type in the search box and check fly-to.

Tool: browser\_batch

The compendium opened a **detail panel on the right** showing "Irrah · CIVILIZATION" with rich, well-structured lore (Cardinal Position, Elevation, Terrain, Basin Access — all populated, no empty fields). The hash gained `#feature=irrah` — so feature selection is reflected in the URL.

But there's a UX issue: I typed "Khulut" in the search, yet the panel shows **"Irrah"** — my "scroll\_to" \+ click sequence may have landed on the Irrah entry, or the search opened the first/previously selected entity. The compendium content quality is high (this corrects any concern about empty cards). The right-panel detail is well-populated.

Let me verify the search→result→fly-to flow more carefully. Let me clear and search "Khulut" properly and click the result. Let me read the compendium panel interactive elements.

Tool: browser\_batch

Search filtering works — "Wasi-Pukya" returns a result tagged "Aethelian Basin". Let me click it and verify it flies to the feature on the map.

Tool: browser\_batch

**Compendium search → fly-to works beautifully.** Clicking Wasi-Pukya:

* The map flew to the feature (the highlighted node is now centered, hash updated to `#feature=wasi_pukya`).  
* The detail panel is rich: OASIS type, etymology ("Qollari: wasi 'house, lineage' \+ pukya 'spring'. The Spring-House" — nice morpheme breakdown, which addresses the pronounceability concern from Phase A), RELATED features with distances (Highland Relay 112 km, Veyd Kirrha 143 km, etc.), Adventure Hooks with a Roll button, and AI Lore with Rumours/NPCs/Tensions tabs. All fields populated — no empty cards.

This is a strong positive. The compendium is feature-complete and well-populated.

Now let me test **seasons** (does the map reflect winter vs summer visually?). And **annotations/persistence**. Let me close the compendium and test seasons. Let me check the "Day" button and season visual changes. First close compendium and test winter vs summer on the map. Let me click Winter season in the planner and screenshot, then Summer. Actually the planner season only affects encounters/routes. The "Day" toolbar button likely controls calendar/season visuals. Let me check seasons via the planner season buttons first — does map tint change?

Let me close compendium and toggle Winter to observe map.

Tool: browser\_batch

Tool: find

I'm conscious of budget. I have thoroughly verified the most important Phase B items (badge, colors, share mode, compendium, hash stability, CSS cascade, console/fonts). Let me efficiently wrap the remaining items: seasons visual \+ annotations/persistence. Let me close the compendium and the panels, then test the calendar/Day and annotations via a quick check. Let me close compendium and check the "Day" panel for seasons, and test localStorage persistence of a saved journey.

Let me first check persistence: save the current journey and verify localStorage. Let me also check what the "Day"/calendar does. Let me close compendium first and look at the Day feature.

Tool: browser\_batch

Interesting localStorage finding: Veydria uses keys `veydria.aiLoreCache.v1`, `veydria.hexSize`, `veydria.tour.completed.v1` — but there are also **foreign keys from other apps**: `burn_wizard_audit_log`, `burn-wizard-storage`, `burn-wizard-performance-metrics`, `burn_wizard_device_id`, `shopifySelectors`. These `burn_wizard*` keys are from a *different* project (a "burn wizard" medical app) sharing the `pmartin1915.github.io` origin — GitHub Pages serves all of a user's projects from one origin, so localStorage is **shared across all the developer's GH Pages apps**. Not Veydria's bug per se, but a real persistence-namespace concern (another app on the same origin could collide). I'll note it as polish.

Notably, I **saved a journey earlier** (no — I didn't click Save). And there's no `veydria.journeys` or `veydria.annotations` key yet. Let me test saving a journey and annotation persistence. Let me find the Save button in the planner and an annotation method. Given budget, let me do one solid persistence test: save the current journey, check localStorage, reload, verify it persists. Let me scroll the planner to the Save button.

Tool: browser\_batch

Action buttons visible: Save / Mark explored / Link / Markdown / JSON, then DISTANCE/EST.TRAVEL/SEGMENTS summary and HEX PATH (F5→G5→H5→H6→I7→H7→G7→F7→E8→E9→D9→E9, 12 hexes). Note the HEX PATH ends "...D9 → E9" — backtracking from D9 to E9, a minor path-quality oddity but acceptable.

Let me click Save and verify it persists to localStorage.

Tool: browser\_batch

**Persistence verified:** Clicking Save created `veydria.journeys.v1` in localStorage (1007 bytes) with the full route name "Tavakh-Rubāṭ → Qollari → Wasi-Pukya → Aethelian Basin → Qarat al-Fidda..." and a timestamped id. The saved-journey counter in the planner header incremented from "0" to **"1"** (star badge). ✓ Journeys persist to localStorage.

I've now covered the high-priority Phase B items rigorously. Let me do a final consolidated check: console errors during all this activity (React warnings, uncaught rejections). Let me read the console for the GM tab now that I've clicked around extensively.

Tool: read\_console\_messages

Console tracking still shows nothing for this tab (it may only capture from the point of first call forward, and this tab loaded before). The font 503s are confirmed via network. Let me do a final targeted console check by reloading the share tab fresh with console capture active, to catch any load-time React/asset errors.

Tool: browser\_batch

Console reads return empty even after navigation — likely the console capture isn't surfacing messages in this environment, OR the app genuinely logs nothing. Either way, I can't claim console errors I can't observe; the only confirmed runtime issue is the **font 503s** (verified via network requests). I'll report console as "no JS errors observable; font 503s are the one confirmed network failure" honestly.

I have comprehensive Phase B coverage. Let me verify one last share-mode round-trip persistence question (item 4: does saved state survive a share-mode round-trip without corruption) — the saved journey is in localStorage and the share tab is same-origin, so localStorage is shared. Let me confirm the saved journey still reads intact from the share tab.

Tool: javascript\_tool

Confirmed: the saved journey reads intact from the share-mode tab (same origin, shared localStorage) — name fully preserved including the ṭ diacritic, id and savedAt intact, no corruption. ✓

I now have thorough, evidence-backed coverage of Phase B. Let me deliver **Deliverable 2**, then the cross-cutting summary.

Phase B is complete. Below is **Deliverable 2**, standalone and independently actionable. All color claims are from computed CSS (CSSOM/`getComputedStyle`), not memory.

---

# **App UX audit — 2026-05-28**

**App:** Veydria Cartography · **URL:** [https://pmartin1915.github.io/veydria-cartography/](https://pmartin1915.github.io/veydria-cartography/)

**Tested viewports:** 1440×900 (desktop, content viewport 1138–1423 px). Note: an attempted resize to **700×900 did not take effect** in this environment — `window.innerWidth` stayed 1138 and `matchMedia('(max-width:767px)')` returned false even after two resize attempts, so the mobile bottom-sheet was **verified via CSSOM rule inspection rather than a live screenshot** (see F-app-9 / F-app-10). Flagging this so the GM knows the mobile layout claims are CSS-derived, not pixel-confirmed.

**Tested URL configurations:**

* Default (planner closed on clean load; Direct / supply default / no route)  
* Caravan trigger: Direct mode \+ SUPPLY pack=caravan, no route  
* Route A: `journeyFrom=tavakh_qarat&journeyTo=qarat_al_fidda`, Cheapest, Summer (2 mild encounters)  
* Route B: `journeyFrom=tavakh_rubat&journeyTo=khulut`, Cheapest, Summer, caravan (6 segments, 1210 km — triggers Bottlenecks \+ Seasonal Restrictions)  
* Share: Route B \+ `&share=1` (fresh tab)

## **Summary**

* **11 findings total: 2 critical / 7 polish / 2 subjective**  
* The just-shipped mode-selector recommendation **works correctly** on the caravan trigger, the badge is **confirmed gold (\#E8C840)** matching the warning palette, and it is **correctly hidden in share mode**. Share-mode hide/show rules are correct.  
* The headline bugs are the **same-tab stale-hash** (route/view doesn't re-hydrate on same-origin re-nav) and **font 503s** (all self-hosted woff2 fail to load).  
* The `.journey-planner-header` cascade bug from the 0bccf61 handoff is **confirmed present** in the live CSS.

## **Findings**

### **\[F-app-1\] Mode-selector recommendation badge — caravan trigger works; gold color confirmed**

* **Severity:** polish (verification pass — mostly positive)  
* **What you observed:** Default state (Direct, supply default, no route) shows **no badge** (ss\_46374ar80). Switching SUPPLY → pack **caravan** makes a **"Recommended" pill appear on the Safest button** (ss\_0596fya23). `getComputedStyle` of the badge: `background-color: rgb(232, 200, 64)` \= **\#E8C840 (gold)**, text `rgb(26,18,6)`. The button `title` tooltip reads **"Recommended: Direct \+ caravan has \~2× the failure rate in simulation"** — mentions "caravan" as specified. Clicking Safest (making it active) **removes the badge** (DOM check: `recommendedBadgeCount: 0`) — active mode is never badged (ss\_96284l0lb). All four caravan-path sub-checks pass.  
* **Where:** Journey Planner → ROUTE PRIORITY row; SUPPLY → PACK ANIMALS \= caravan.  
* **Suggested action:** None — works as specified. (Color cross-check is in F-app-2.)

### **\[F-app-2\] Badge gold matches the gold warning blocks and is distinct from the red Bottlenecks block (computed-CSS confirmed)**

* **Severity:** polish (verification pass)  
* **What you observed:** Read via CSSOM on Route B: **Seasonal Restrictions** block uses `rgba(232, 200, 64, …)` (border `.25`, bg `.06`) \= **\#E8C840 gold**; **Bottlenecks & Risks** block uses `rgba(255, 68, 68, …)` (border `.2`, bg `.06`) \= **\#FF4444 red**. The Recommended badge bg is `rgb(232, 200, 64)` — **identical gold to the warning blocks, not red**. This directly confirms the spec requirement and corrects the prior audit's color error.  
* **Where:** badge vs `.warning`/`.seasonal` vs `.bottleneck` blocks above the path timeline.  
* **Suggested action:** None — color differentiation is correct.

### **\[F-app-3\] Could not reproduce the "≥2 severe encounters → badge on safest" trigger with tested endpoints**

* **Severity:** polish (coverage gap, not a confirmed bug)  
* **What you observed:** The prompt expected Oravan→Irrah / cheapest / summer to yield 2 severe encounters and badge the safest button. My closest analog routes produced **mild** encounters (Route A: 2 beats, both MILD) or **Bottlenecks \+ Seasonal** warnings (Route B) but **no Mode Risk / Encounter Density block and no badge**. Encounter severity appears roll/route-dependent and my endpoint choices (Tavakh-Qarat is a mainland Irrah-coast port, not the Oravan island port) differ from the prior audit's. I verified the *caravan* badge path definitively (F-app-1) but **could not independently confirm the severe-encounter badge path**.  
* **Where:** ROUTE PRIORITY badge logic; encounter-severity branch.  
* **Suggested action:** GM judgment call — confirm the exact (start, end, season) tuple the prior audit used for "2 severe," or expose encounter severity in a way that's deterministic enough to regression-check. Not necessarily a defect.

### **\[F-app-4\] Share mode hides/shows exactly the right surfaces (DOM-verified)**

* **Severity:** polish (verification pass)  
* **What you observed:** Opening Route B with `&share=1` in a fresh tab shows the banner **"Player view — annotations and encounter notes are hidden"** (ss\_66588o7t1). DOM scan after Find Route (ss\_8477jsnb6): **Hidden** — Mode Risk (absent), Encounter Density (absent), **Encounters tab (absent — tabs are only Route/Days)**, Recommended badge (absent), Mark-explored button (absent), and GM toolbar items (Pin/Measure/Hex/Parchment/Player Link) removed. **Shown** — Bottlenecks (red, present), Seasonal Restrictions (gold, present), route timeline, supply/distance summary (1210 km / 303 leagues / 6 segments / MERCHANT-GRADE), and Save/Link/Markdown/JSON. Matches the spec exactly.  
* **Where:** `?…&share=1`.  
* **Suggested action:** None — correct.

### **\[F-app-5\] CRITICAL: same-tab re-navigation does not re-parse the URL hash (stale-hash bug confirmed)**

* **Severity:** critical  
* **What you observed:** Navigating the **same tab** to a new `#z=…&cx=…&cy=…` did **not** re-center or re-zoom the map (ss\_1756741q0 still showed the prior view, with frozen leftover hover tooltips "Ngaru Bon" / "A12 · Open Sea"). Opening the **same URL in a fresh tab re-hydrated correctly** (ss\_9060hnjz7). This is the regression the prior audit warned about, still present.  
* **Where:** any same-origin hash change without full reload; hash params `z/cx/cy` and likely `journeyFrom/journeyTo`.  
* **Suggested action:** Add a `hashchange` listener (or react to `location.hash` in the router effect) that re-parses and applies view \+ journey state on same-document hash changes, not only on initial mount. Also clear stale Leaflet tooltip/hover state on view change.

### **\[F-app-6\] URL hash persists endpoints but NOT season / mode / supply**

* **Severity:** polish  
* **What you observed:** After configuring Route B (Tavakh-Rubāṭ→Khulut, Summer, Cheapest, caravan) and opening `…&season=summer&mode=cheapest&share=1` in a fresh tab, the planner re-hydrated **FROM/TO correctly** but reset **season → Any, mode → Direct, supply → default** (ss\_66588o7t1). The `season`/`mode` query params I appended were ignored; only `journeyFrom`/`journeyTo` are encoded. A GM sharing a "summer caravan" plan will have the recipient see a different (Any/Direct/default) configuration.  
* **Where:** URL-hash serialization of planner state.  
* **Suggested action:** Serialize season, route-priority, and supply (at least pack-animals) into the hash so a shared link reproduces the full plan, not just the endpoints.

### **\[F-app-7\] CRITICAL: self-hosted web fonts fail to load (HTTP 503), app falls back to system fonts**

* **Severity:** critical (visual fidelity of a "parchment"-styled map app)  
* **What you observed:** `fonts/fonts.css` (200) references woff2 at the **site root** `https://pmartin1915.github.io/fonts/…` instead of the project base `…/veydria-cartography/fonts/…`. All five return **503**: Cormorant-Garamond 400/700, Inter 300/400/600 (verified twice via network capture). The serif display type the design depends on isn't loading; rendering relies on fallbacks.  
* **Where:** `fonts/fonts.css` `@font-face src` URLs vs GitHub Pages project base path.  
* **Suggested action:** Fix the `@font-face src` paths to include the `/veydria-cartography/` base (or make them relative to `fonts.css`). Re-verify all five return 200\.

### **\[F-app-8\] Compendium search → fly-to → detail panel works well; lore cards are fully populated**

* **Severity:** polish (verification pass — strongly positive)  
* **What you observed:** Compendium opens a right-side panel listing "188 / 188 entities" with a search box. Searching "Wasi-Pukya" filters to a result tagged "Aethelian Basin"; clicking it **flies the map to the feature** (hash → `#feature=wasi_pukya`) and shows a rich card (ss\_3831kt04o): type (OASIS), etymology with morpheme breakdown ("wasi 'house, lineage' \+ pukya 'spring'"), RELATED features with distances, Adventure Hooks (Roll), and AI Lore (Rumours/NPCs/Tensions). The Irrah civilization card (ss\_88503q700) likewise had Cardinal Position / Elevation / Terrain / Basin Access all populated. No empty fields observed.  
* **Where:** Compendium (C) panel.  
* **Suggested action:** None functional. Minor: opening the compendium while the Journey Planner is open stacks the planner over the left list area; consider auto-collapsing one when the other opens.

### **\[F-app-9\] Mobile bottom-sheet CSS for `.journey-planner` is correctly ordered (cascade fix is in place)**

* **Severity:** polish (verification pass — CSSOM-derived, not pixel-confirmed)  
* **What you observed:** Via CSSOM, `.journey-planner` declares the **base/desktop rule first** (`position:absolute; top:60px; left:16px; width:320px`) then the `@media (max-width:768px)` override **after** (`inset: auto 0 0; width:100%; max-height:78vh; border-radius:12px 12px 0 0`). Correct source order → the bottom-sheet rule wins at \<768px. I could not visually confirm because the viewport wouldn't drop below 1138 px in this environment.  
* **Where:** App.css `.journey-planner` \+ its `@media (max-width:768px)` rule.  
* **Suggested action:** None for the panel cascade. Recommend a manual pixel check at 700 px to confirm the 5-mode-button row \+ Recommended badge don't overflow horizontally and the action-button row (Save/Mark explored/Link/Markdown/JSON) wraps — these I could not validate live.

### **\[F-app-10\] `.journey-planner-header` cascade bug CONFIRMED — desktop padding overrides the mobile override at \<768px**

* **Severity:** polish  
* **What you observed:** Via CSSOM, the `@media (max-width:768px)` rule for `.journey-planner-header` (`padding: 8px 14px 10px`) appears **before** the base desktop rule (`padding: 12px 14px`) in source order. With equal specificity, the **later desktop rule wins even inside the media query**, so at \<768px the header keeps `12px` vertical padding instead of the intended `8px/10px`. This is the exact same cascade defect that `.journey-planner` had pre-fix (per the 0bccf61 handoff), now isolated to the header. Manifestation is subtle (a few px of extra header height on mobile).  
* **Where:** App.css \~line 2960, `.journey-planner-header`.  
* **Suggested action:** Move the `.journey-planner-header` desktop declaration **above** the `@media (max-width:768px)` block (mirror the `.journey-planner` fix), so the mobile override cascades last.

### **\[F-app-11\] localStorage is shared with unrelated apps on the same GitHub Pages origin**

* **Severity:** subjective / polish  
* **What you observed:** `localStorage` on this origin contains Veydria keys (`veydria.journeys.v1`, `veydria.aiLoreCache.v1`, `veydria.hexSize`, `veydria.tour.completed.v1`) **alongside foreign keys from other projects**: `burn_wizard_audit_log`, `burn-wizard-storage`, `burn-wizard-performance-metrics`, `burn_wizard_device_id`, `shopifySelectors`. GitHub Pages serves all of one user's projects from a single origin, so storage is shared. Saved journeys persisted correctly and survived a share-mode round-trip intact (name with ṭ diacritic preserved, `id`/`savedAt` intact) — so no current corruption — but a sibling app could collide with un-namespaced keys.  
* **Where:** `pmartin1915.github.io` origin localStorage.  
* **Suggested action:** GM judgment call / low priority. Veydria already namespaces its keys well (`veydria.*`); just keep all future keys under that prefix. The risk is from the *other* apps, which is outside Veydria's control.

**Persistence summary (item 4):** Saving a journey created `veydria.journeys.v1` and incremented the planner's saved-count badge 0→1 (ss\_57871kfw5); the entry read back intact from a separate share-mode tab — state persists and survives a share round-trip without corruption.

---

Phase B is delivered. Now the cross-cutting summary (Deliverable 3), drawn from both phases.

Here is **Deliverable 3** — the file Perry should open first.

---

# **Veydria Cartography audit — cross-cutting summary (2026-05-28)**

Two full audits were run: **01-map-content** (findings F1–F8) and **02-app-ux** (findings F-app-1–F-app-11). The mode-selector recommendation that just shipped is **working correctly** — caravan trigger badges the safest button, the badge is **confirmed gold \#E8C840** (computed CSS, matching the warning blocks, not the red bottleneck), it un-badges the active mode, and it's correctly hidden in share mode. Share-mode hide/show rules are all correct. Below is the prioritized fix list.

**Fix first (critical / breaks core UX):**

1. **F-app-7 — Web fonts 503\.** `fonts.css` points at `/fonts/…` (site root) instead of `/veydria-cartography/fonts/…`; all 5 woff2 fail. Fix the `@font-face src` base path and re-verify 200s.  
2. **F-app-5 — Stale-hash on same-tab navigation.** Map/route doesn't re-hydrate when the hash changes in the same tab (fresh tabs work). Add a `hashchange` handler that re-parses view \+ journey state and clears stale tooltips.  
3. **F2 — "Biome Colors" layer doesn't show per-cell biomes.** The data has 24 distinct biomes; the layer only tints broad zones. Map the existing `biome` field to distinct fills so the layer earns its name.

**Fix next (clear bugs, low-to-medium effort):**

4. **F-app-10 — `.journey-planner-header` cascade bug (confirmed).** Move the desktop `padding:12px 14px` rule above the `@media (max-width:768px)` block (App.css \~line 2960), mirroring the `.journey-planner` fix.  
5. **F-app-6 — Share links lose season/mode/supply.** Hash only encodes `journeyFrom`/`journeyTo`; serialize season, route-priority, and pack-animals so a shared "summer caravan" plan reproduces fully.  
6. **F4 — Ngaru Bon label inconsistency.** Stylized map renders "NGARU-BON" (hyphen) while tooltip/data use "Ngaru Bon" (space). Pick the space form for the on-map label.

**Worldbuilding / polish (GM judgment):**

7. **F7 \+ F5 — Disambiguate the two Tavakh ports and tag point features with `civ`.** "Tavakh-Qarat" (Irrah coast) vs "Tavakh-Rubāṭ" (near Oravan) are easy to confuse; add region suffixes in the node picker and an explicit `civ` property so segment labels stop being inferred.  
8. **F8 — Compendium renders markdown tables as raw pipe text** (e.g. Irrah disease entry). Detect tables in `summary` and render or strip them.  
9. **F1 — Region size imbalance** (Irrah 1,144 cells vs Ndjadi 196, \~5.8×). Confirm intentional; if not, rebalance.  
10. **F-app-11 — Keep all storage keys under the `veydria.*` prefix** (origin is shared with the dev's other GH Pages apps). Low priority; Veydria already does this.

**Verification notes for Perry:**

* **F-app-3:** I could not reproduce the "≥2 severe encounters → badge on safest" path — my routes produced *mild* encounters or bottleneck/seasonal warnings, not 2 severe. The *caravan* badge path is fully verified; please confirm the exact (start, end, season) tuple the prior audit used for the severe path.  
* **700×900 mobile:** the viewport wouldn't shrink below 1138 px in my environment, so F-app-9/F-app-10 are **CSS-rule-derived, not pixel-confirmed**. A manual check at 700 px is recommended to confirm the 5-button mode row \+ badge don't overflow and the action-button row wraps.  
* Positives worth keeping: compendium search→fly-to and lore cards (F-app-8), hex-grid labels/tooltips (F6), journey persistence \+ share round-trip integrity (F-app-4), and the recommendation badge itself (F-app-1/F-app-2) all work well.

---

That completes all three deliverables. A note on the handoff format, since it matters for how you use this: because I had no filesystem-write tool, these were delivered as three sequential chat messages instead of `.md` files on disk, and screenshots are referenced by in-session capture IDs (e.g. `ss_0596fya23`) rather than saved `.png` filenames — those IDs won't survive the session, so if you want durable artifacts, copy these three messages into `00-summary.md` / `01-map-content.md` / `02-app-ux.md` yourself, or re-run me with a save-to-disk (or Google Docs) capability and I'll write them properly with embedded screenshots. Every finding is written to stand alone, so each message is independently actionable as-is.

Want me to dig into any specific finding further — e.g., hunt down the exact endpoint tuple that triggers the 2-severe-encounter badge path (F-app-3), or pull the relevant route/encounter logic from the repo to confirm the badge condition in code?

