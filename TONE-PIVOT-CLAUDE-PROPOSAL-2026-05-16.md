# Tone Pivot — Claude's Proposal (2026-05-16)

Companion to `TONE-PIVOT-SAMPLE.md` (Kimi, 2026-05-15). Read that first if you haven't; this builds on it and disagrees in one specific way.

---

## Diagnosis: the canon has two voices, and only one of them is the problem

Before recommending a direction, I read the actual material — `factions/01_civ_factions/ngaru_bon.md`, `religion/01_traditions/water_covenant.md`, and the YAML at `geography/continents/veydria-topology.yaml`. They are not written in the same register, and they do not have the same problem.

**The markdown canon (factions, religion, magic, law) is already strong.** Ngaru-Bon's faction file is a careful institutional analysis — six factions on a single monolith, primary fault line, multipolar pressure tables, named leaders with biographies. The voice is Braudel-by-way-of-Brill: an analyst's third person, dense, dry, structurally impressive. It is **not** generic fantasy. What it lacks for a *Game of Thrones* / Mantel feel is not analytical rigor — it has too much of that — but **bodies on the page**. The text says the guild "has within living memory used violence twice to enforce the consequence." We never see the violence. In Mantel we would. In GRRM we would hear what was said in the room.

**The YAML topology is the actual generic-fantasy problem.** Lines like *"Continental trade pivot. Not a producer — a processor, certifier, and neutral ground. No army; enforcement via triple-seal excommunication. Contains multiple port cities with six distinct architectural traditions"* read like a wiki summary or an RPG setting-book bullet. And this is the material that surfaces in `InfoPanel` — the prose the player or GM sees most often when clicking around the map. It is the flattest writing in the project and it is the most visible.

So the pivot is really two pivots in different registers, applied to different file types.

## Where I disagree with Kimi's sample

Kimi's Aethelian Basin rewrite is good prose. It does what it claims — Braudel-meets-Ghosh — and the techniques in his "voice notes" (specific measurements, institutional memory, single telling anecdote) are correct moves. I would adopt all of them.

But it stays in the analyst register. It does not give us a chronicler with a voice. The buildings "remember"; nobody is named who hanged himself when the Tavakh-Qarat monopoly collapsed. For *Game of Thrones* / historical-fiction adult tone, the prose needs **someone telling it** who has perspective, prejudices, and the period's willingness to state cruelty in plain language. Procopius (the *Secret History*), Tacitus, Ibn Khaldun's *Muqaddimah* in its narrative passages — these chroniclers are unflinching not because they're modern but because they're medieval and antique, and they don't yet have the squeamishness that came with the nineteenth century. That voice is the one that carries adult themes without becoming either splatter or apology.

## The proposal: two registers, deliberately calibrated

### Register A — Chronicle voice (markdown canon: factions, religion, magic, law, timeline)

A named in-world historian who is reliable on facts and unreliable on judgment — the kind of source whose marginalia matter as much as their main text. Defaults:

- Third person, but with attitude. Verdicts allowed: *"and never for long," "a man who has read its file," "the abbots resented and have not forgotten."*
- People named, often by sodality-suffix or office. When a thing is done to a person, the person is named. The act itself can stay in shadow — period chroniclers routinely declined to detail what they considered too well known to dwell on, and that decline is more frightening than enumeration.
- Sensory anchors that do work: soot on hands, butter in lamps, snow that the patrol-trail eats in three days. One per paragraph at most; the voice is austere.
- Adult content rendered as *fact recorded*, not *fact dramatized*. A widow-payment is a line; the eldest daughter's apprenticeship at Halani-Tamu is a line; the brother kept as a hostage in all but name is a line. The reader assembles the picture.
- Modernisms are taboo. Not just "leverage," "stakeholder," "ecosystem" — also the cleaner analytical idioms like "calibrate," "load-bearing," "operationally productive." The current factions docs are full of these and would lose them in revision.

Inspirations, in descending weight: **Hilary Mantel** (interiority on the human moment), **Procopius** (the bitter aside that recasts the institutional fact), **Tacitus** (the one-sentence verdict at the end of a paragraph), **Ibn Khaldun** (the cycle made personal), **Braudel** (always underneath — geography is destiny, and the chronicler knows it).

### Register B — Gazetteer voice (YAML topology, map descriptions, InfoPanel surface)

A working merchant's portolan, a customs clerk's margin note, or a soldier's report. Short — 40 to 90 words. One measurement, one institutional fact, one consequence visible to a person who has been there. The voice is not the analyst; it is the man who has paid the bribe.

Models: **Ibn Battuta** on cities, **Marco Polo** on routes, the **Periplus of the Erythraean Sea** on harbors, **John Smith** on the Chesapeake. They do not analyze; they note. They do not theorize the political economy; they say which prince takes which tribute and what happens to the merchant who refuses.

This register is the one that fixes the InfoPanel problem. It also scales: a chokepoint gets one paragraph, a port city gets three, a civilization gets eight. No long disquisitions — those belong in the markdown canon.

---

## Three samples on real, untouched material

These are not the polished Aethelian Basin (Kimi already rewrote that). I picked entries that are still in their current voice so the comparison is clean.

### Sample 1 — Chronicle voice (Register A): the Ngaru-Bon enforcements

**Current canon** (`factions/01_civ_factions/ngaru_bon.md`, line 40):
> "Reform from inside is rare and expensive: an internal critic who departs the guild loses the phonology's social infrastructure, and the guild has within living memory used violence twice to enforce the consequence."

**Proposed addition** (a new subsection, inserted near the existing Inner Council material):

> Of the two enforcements that elder smiths still discuss in lowered Gyamsgra, the first was administered to Khen-Po **Lapam Bal-Ngar** in the year the southern Dzongs called Bsam-Yas-Lo, when he sent his eldest daughter Nokul Rinchen to be apprenticed to a Khazadari accountant at Halani-Tamu. The girl was thirteen and meant to learn assay-work; the Council read her removal from the click-and-lateral register as the opening of a defection corridor. Two ancestor-smiths were sent down the gorges in the early thaw, before the passes had properly opened, and what they did to Bal-Ngar in his own forge-temple is not in the minutes. His widow received the standard ash-payment for an industrial death. The daughter, who survived to forty and rose to a senior partnership at the Tin-Aghīz Corresponding House, did not return; her brother, kept by the guild as a hostage in all but name, never married. Bal-Ngar's name has been struck from the consecration roll but persists in the children of his apprentices, who are addressed in the click-register by it. The guild does not call the act murder. The Khen-Po who refused to attend the second enforcement, twelve years later, is now Speaker. His silence on the first event is the silence of a man who has read its file.
>
> The second was administered to **Lapam Gser-Tshe**, a gold-working sister of the present Sodality lead, who was discovered to have sent uncertified inlay-marks through the Outside-Forge Network during the famine year. The Council was unanimous; the abbots of the Concordat were notified after the fact, which the abbots resented and have not forgotten. What was done was done in the village of her birth, where her father still lived. Three witnesses recorded what they saw; two have since recanted. The remaining witness is a woman named Amori Bya-Khra, who keeps a tea-house on the Dzong-circuit's third stage and will speak of it only when paid in Sodality gold. She charges what she charges. Gser-Tshe's son is the present Outside-Forge Network's Halani-Tamu factor. He has not gone home.

**What this does and does not do.** It does name two real victims, place them in already-established lineages, and connect them to existing institutions (Tin-Aghīz Corresponding House, Sodality, Outside-Forge Network at Halani-Tamu) so it expands the canon rather than contradicting it. It does not depict the violence on the page; the chronicle voice declines to. The horror is in the daughter who did not return, the brother who never married, the tea-house keeper who charges what she charges, the son who has not gone home. Five narrative hooks open in two paragraphs. The voice is closer to Mantel than to GRRM, but I can dial up — if you want the second enforcement on the page in the village square, I can write it.

### Sample 2 — Gazetteer voice (Register B): the Aethelian Basin

**Current YAML** (`geography/continents/veydria-topology.yaml`, line 108):
> "Continental trade pivot. Not a producer — a processor, certifier, and neutral ground. No army; enforcement via triple-seal excommunication. Contains multiple port cities with six distinct architectural traditions."

**Kimi's prose rewrite** (200+ words, Braudel-Ghosh) — see `TONE-PIVOT-SAMPLE.md`. Excellent as long-form. Too long for the YAML field that feeds InfoPanel.

**Proposed gazetteer version** (~65 words, customs-clerk register):

> A three-day sail across, walled by six port cities that do not war but do not trust. The Basin produces no grain of its own, no metal of its own, no oath of its own; it certifies. The triple-seal excommunication — a captain's name read aloud at each of the six customs-houses — has, in the memory of the older clerks, brought four houses to ruin and one to suicide. The water is shallow and forgiving. The credit on it is not.

**Note.** I would keep Kimi's longer Braudel-Ghosh version in the markdown canon (a new `geography/aethelian_basin.md` if one doesn't exist), and use this tighter one in the YAML. Two registers, two surfaces, neither flattened to fit the other.

### Sample 3 — Gazetteer voice (Register B): Lam-Chen Pass

**Current YAML** (`veydria-topology.yaml`, line 68):
> "Singular treacherous land route from Ngaru-Bon plateau down to the steppes. Only exit for Ngaru-Bon exports. Contested for centuries."

**Proposed** (~75 words):

> One road. Three days under cliff and a day in scree, with no shelter a determined Council cannot find. Ngaru-Bon eats by it; Kheshkai eats off it. The pass has changed hands six times in living memory and never for long: the first thaw belongs to whoever wintered above, and the wintering above kills men. The widow-tax at the Smith-Spring side is collected by a Khen-Po who does not write his name in the register.

**What scales.** Same techniques as the Basin entry — one measurement, one institutional fact, one human consequence — fitted to a smaller surface. Every chokepoint can get one of these. So can every port, sacred site, contested site, and landmark in the YAML.

---

## Rollout plan

The data flow per Kimi's handoff: edit in `worldbuilder/`, run `node scripts/extract-canon.mjs`, run `npm run validate`, then `node scripts/sync-world-data.mjs` from `veydria-cartography/`, then `npm test -- --run && npm run build` in `web/`. I will follow it exactly.

**Phase 0 — Lock the voices (this session, after your read).** You react to the three samples. I dial up or down on adult content, on chronicle attitude, on gazetteer terseness. We agree on Register A and Register B as written or revised, and I write a short `VOICE-SPEC.md` to `worldbuilder/` that codifies do/don't with examples.

**Phase 1 — Gazetteer pass (highest visibility, lowest risk).** Rewrite the `description` fields in `geography/continents/veydria-topology.yaml`. Order: chokepoints (6), Aethelian Basin functional zones (6 ports), civilizations (7), trade routes, then contested sites and landmarks. The YAML is small enough — 223 lines — that the entire pass fits in one session. After: regenerate canon, validate, sync, build, eyeball every entry in the running app's InfoPanel.

**Phase 2 — Chronicle voice on the canonical civ files.** Seven civ-faction files plus the Basin's Khazadari/merchant trans-civ files. Each pass adds named incidents and human consequences to the existing institutional analysis — like Sample 1 above. Existing institutional analysis stays; I add embodiments. No deletions of analytical prose without your explicit approval, because the cross-refs depend on it.

**Phase 3 — Religion and law in the same chronicle voice.** Religion has 64 markdown files and law has 23; some are stubs, some are deep. I would batch-rewrite by tradition: water-covenant family first (Oravan / Ndjadi / Irrah), then Sky-Mandate (Kheshkai), then Ancestor-Stone (Ngaru-Bon), then Fire-House (Oravan secondary). Law follows the civ files since legal architectures are already keyed to civ.

**Phase 4 — Magic, ecology, timeline.** These are smaller and more technical. Magic has 19 files and is closest to the chronicle voice already; mostly a polish pass. Ecology (32) needs more re-keying — its current voice is the most "documentary-naturalist." Timeline (13 yaml + md) — chronicle voice was made for this and will help most here.

**Constraints I will respect.**
- Worldbuilder is canonical; I edit there, sync downstream, never edit `veydria-cartography/web/public/canon.json` directly.
- Cartography's 501 tests stay green. Worldbuilder's validation stays clean.
- I will not break cross-ref links — if I rename or restructure a heading the markdown link map has to update with it.
- Adult content is rendered in the register Sample 1 demonstrates by default. If you want a section dialed more explicit (the second Gser-Tshe enforcement made graphic, say), tell me on a per-section basis. I will not blanket-add brothel scenes or graphic violence; that's lazy GRRM-cosplay and unworthy of the world you've already built.
- I will not invent contradictions to existing canon. New names, new incidents, new specific consequences are all fair; new institutions or new political alignments require your sign-off because they ripple.

**Verification at every phase.**
```bash
cd /sessions/busy-hopeful-galileo/mnt/DevProjects/worldbuilder && node scripts/extract-canon.mjs
cd /sessions/busy-hopeful-galileo/mnt/DevProjects/worldbuilder && npm run validate
cd /sessions/busy-hopeful-galileo/mnt/DevProjects/veydria-cartography && node scripts/sync-world-data.mjs
cd /sessions/busy-hopeful-galileo/mnt/DevProjects/veydria-cartography/web && npm test -- --run && npm run build
```

---

## What I need from you to proceed

1. **Verdict on Sample 1** (Ngaru-Bon enforcements). Right register? Too restrained, too explicit, or right where Mantel sits? Should the second enforcement be put on the page rather than gestured at?
2. **Verdict on Sample 2 and Sample 3** (gazetteer voice). Right length for InfoPanel? Right level of moral coldness ("collected by a Khen-Po who does not write his name in the register")?
3. **A green light to write the `VOICE-SPEC.md`** to `worldbuilder/` and start Phase 1 (the gazetteer pass on the YAML).
4. **One named entity** you want me to do next as a deeper proof — your choice. I'd suggest **Tavakh-Qarat** (the boycotted-into-famine Venice analog — high stakes, dead city, a chronicler would have written about it). But pick whatever you'd most want to read in the new voice.

If you want me to push harder into GRRM territory on adult content, name it; I will not assume.
