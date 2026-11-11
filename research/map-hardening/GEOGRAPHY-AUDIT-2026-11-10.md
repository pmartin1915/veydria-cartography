# Geography audit: what each named feature physically is (2026-11-10)

Read-only canon audit run by a Sonnet subagent for the map-hardening plan, then spot-checked by Opus
against the primary sources (the MAP-PROMPT precedence clause and the canonical schematic were
verified directly). Citations are relative to `worldbuilder/geography/` unless marked.
Abbreviations: SPINE = `continents/veydria-climate-spine.md`, TOPO = `continents/veydria-topology.yaml`
(the master copy; cartography's `data/veydria-topology.yaml` is stale), MP = `MAP-PROMPT.md`,
loc/x = `locations/x.md`.

This is the evidence table for Phase 2's validator: every named point gets a physical class
(inland / coast-on-Basin with shore / outer-ocean coast / island / open water / strait) checked
against the generated terrain.

## The finding that reshaped the plan

The cartography app draws the **retired April layout**. The canonical layout is the climate spine
(Rulings 6 and 7) drawn in `veydria-schematic.svg` (redrawn 2026-09-29). MP lines 33-40: where MP
and those two disagree, they win. Cartography's coordinates match the April display fractions in
`continents/veydria-travel-graph.yaml` exactly (e.g. Tavakh-Qarat 0.5,0.3625 = 600,290). On the April
layout, several canon facts cannot all hold at once (Khulut at the delta's head 200+ units from the
delta; the braid Hassag-Nganin north of its own port; Breath-of-Cloud east while the waystations of
its crossing sit west). Perry ruled on 2026-11-10: converge cartography onto the canonical layout.

## Classification (canonical meaning; positions to be re-derived from the schematic)

| Feature | Physical class | Cite |
|---|---|---|
| Lam-Chen Pass | Inland pass off the plateau down to the steppe; three days under cliff, a day in scree | loc/lam-chen-pass; MP |
| A-Tzalan Ford | Inland river ford at the foot of Kheshkai's wall, steppe meets delta flood-flats | loc/a-tzalan-ford ~26-28; TOPO |
| Smith-Spring | Inland hot ore spring at the foot of the Ngaru-Bon escarpment; gravel plains | loc/smith-spring; TOPO |
| Breath-of-Cloud | Inland fog-fed cloud forest on the crest of Kheshkai's south wall, near its WESTERN end, above the neck | SPINE ~205-215; MP |
| Qollari Cliff Roads | Inland highland switchbacks; three descents (west coast, delta, NE past Apu-Yana to the neck) | MP; TOPO sub_routes |
| Halkar Straits | STRAIT: the Basin's only mouth, west side, half a march wide | loc/halkar-straits |
| Ki-Mbuhari | Basin SOUTH shore at the delta mouths; marsh, mangrove; lazaretto on an outer island | MP §2; loc/ki-mbuhari:77 |
| Tavakh-Qarat | Basin NORTH shore on the northern arm; limestone, salt pans | MP §2 |
| Halani-Tamu | Basin EAST shore; coral docks | MP §2; loc/halani-tamu |
| Dzong-Tamu | Basin SOUTHEAST inner shore, a day's coasting from Ki-Mbuhari, near Khulut | MP §2 ~62-64; loc/dzong-tamu:73 |
| Qhabal-Ur | Island/shoal in the Basin centre; stepped limestone platform half-submerged at high tide | loc/qhabal-ur |
| Veyd-Kirrha | Basin south shore WEST of Ki-Mbuhari; volcanic vent on a coastal road | MP §2; loc/veyd-kirrha |
| Qarat al-Fidda | Inland, centre of Irrah's northern lobe, on the Spine | loc/qarat-al-fidda |
| Ghadam-Thalla | Inland on the escarpment lip at the lobe's W/NW end | loc/ghadam-thalla |
| Tin-Mashraq | Inland, east end of the Spine, semiarid margin under Kheshkai's flank | loc/tin-mashraq |
| Khulut | Inland, south tip of the northern lobe, at the delta's head | loc/khulut; MP |
| Zin-Iferis | Inland, edge of the great white sabkha | loc/zin-iferis |
| Ayn-Salqat | Inland; canon says deliberately "not on the map" | loc/ayn-salqat |
| Zang-Ri | Inland hematite ridge, terraced strip mines (Ngaru-Bon) | loc/zang-ri |
| Apu-Yana | Inland volcano on Qollari's eastern flank above the floodplain | loc/apu-yana; MP |
| Kha-Tepet | Inland steppe peak | regions/kheshkai-steppe.yaml:44-47 |
| Ki-Jenga | Delta land; its cut lies below A-Tzalan near the wall | TOPO; regions/ndjadi-floodplains.yaml:54 |
| Hassag-Nganin | Delta: braided channels, alluvial islands, near the Basin shore | loc/hassag-nganin ~10-12 |
| Volata-Xal | Inland steppe near the ford; stranded catamaran yard | loc/volata-xal |
| Wasi-Puma | Qollari fortified settlement | regions/qollari-highlands.yaml:49-52 |
| Halkar | Oravan capital, the island nearest the straits | MP; settlements/oravan_settlements |
| First Caldera | Seawater-filled caldera on an inner Oravan island | religion/05_.../salt_and_shell_circuit.md:48-52 |
| Kelata / Kelata-Tamu | Oravan obsidian island and its outer sister-island across a tidal channel | regions/oravan-archipelago.yaml:39-42; loc/kelata-tamu |
| Tavakh-Rubat | Sandbar relay just inside the Basin mouth | loc/aethelian-basin ~112; MP §2 |
| Wasi-Pukya | Inland Qollari cliff-road ledge spring | loc/wasi-pukya |
| Tepet-Apu | Inland shelf where steppe gives way to cloud-forest scrub on the Breath-of-Cloud descent | loc/tepet-apu |
| Kalli-Xal | Inland steppe rise east of Tepet-Apu | loc/kalli-xal |
| Dzong-Kha | Inland, southern foot of Lam-Chen | loc/dzong-kha |
| Zang-Kalli | Inland steppe between A-Tzalan and Lam-Chen | loc/zang-kalli |
| Rubat al-Darb | Inland caravanserai on the open desert east of the Basin | cartography coordinate-manifest:488 |

New canonical features the April manifest lacks: Tin-Aghiz (frankincense port, Irrah SE lobe), Morina
and Arokar (north and south ends of the Oravan chain), the neck, the two lesser Basin harbours, the
western route and the Aethelian Basin Hub route.

## Physical constraints for the terrain (from canon)

- **Basin.** Shallow, about 400-500 thousand km2, a three-day sail across, roughly oval and narrowing
  to the single west mouth (SPINE ~165; TOPO; MP §2). Salt pans on the arid S/SE margins, salt-marsh
  on the north, grey mangrove on the south shore.
- **Ndjadi.** A slowly sinking alluvial trough, 0-50 m, along the foot of Kheshkai's wall. It drains
  west along the wall's foot, north through the neck, then splits into five distributaries fanning
  NORTHWEST into the Basin at Ki-Mbuhari (MP Ndjadi "Rivers"; edges/ndjadi_edges.md:127, 121). No
  channel runs south. Tributaries come off the wall (north side) and off Qollari (west).
- **Southern rim.** A low upland, 300-900 m (to 1,500 m at the frankincense escarpments), with a
  short steep seaward face cut by quick rivers (SPINE ~173-190).
- **Kheshkai.** Lip 2,000-2,500 m over the wall, rising north to an interior of 3,500-4,500 m
  (Changtang-like, dry). The wall is the sharpest break on the map; its upper face is cloud forest.
  The wall ends at the floodplain's east edge; east of that it is lower and drier (MP Kheshkai).
  Named: Xal-Tzintla (a depression), Xo-Tlan (gas seeps), Poch-Kalli kurgan, Kostkai.
- **Ngaru-Bon.** Shelf 1,200-2,000 m on the south face of a crown of 3,500-4,800 m; tsetse foothill
  belt below the shelf; gorge rivers south off the plateau; Ngon-Tso (frozen lake), Ngar-Chu (Forge
  River), Lha-Drak cliff. Do not stretch the plateau across the top of the map (MP).
- **Irrah.** Two lobes (Ruling 7). North lobe: gravel plateau, erg between Tin-Mashraq and Qarat
  al-Fidda, the Iferis sabkha by Zin-Iferis, silica-glass fields, wadis only, no rivers. SE lobe:
  thorn-steppe rising to limestone frankincense escarpments to ~1,500 m on the SE coast; Tin-Aghiz.
- **Qollari.** The C's southwest arm, 2,500-4,500 m, cloud-forest belt, terraces, hard frost above
  ~3,500 m. Its NE foothills face Kheshkai's lip across the neck; the two uplands do not join
  (Ruling 6). Kori-Mayu (Golden River), Suya-Rimak valley.
- **Oravan.** A volcanic island chain N-S in open ocean west of the Basin mouth, eight islands on the
  schematic, peaks to 3,000 m; Tevalu (sacred peak), Hineta (active vent), First Caldera.

## Settled by precedence (not open questions)

MP lines 33-40 make the spine and schematic govern, which settles: Halkar Straits at the Basin mouth
with Oravan beyond it; Qollari and Kheshkai facing across the neck without joining; six Basin ports
(four great, two lesser; Perry's 2026-09-28 ruling).

## Still open (none blocks the terrain)

- **Distances.** Canon prose distances do not all fit one drawing (Tavakh-Qarat to Halani-Tamu "a
  single day along the shore", Ki-Mbuhari to Dzong-Tamu "a day's coasting", Tavakh-Qarat to
  Ki-Mbuhari "a three-day sail"). The travel graph takes days from prose and states display coords
  have no real-world scale, while the schematic carries a 400 km bar. A canon item, not a terrain one.
- **Volata-Xal's water access** (a yard for catamarans where the sea never reached). Unexplained.
- **Tavakh-Rubat** "mid-route" vs "just inside the mouth": reconcilable if mid-route means near the
  mouth.
