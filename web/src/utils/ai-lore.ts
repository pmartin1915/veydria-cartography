/**
 * ai-lore.ts — Generative content per feature (rumours, NPCs, local tensions)
 *
 * Supports two modes:
 *   1. Mock mode (default) — deterministic seeded placeholders, no API key needed
 *   2. Live mode — calls an OpenAI-compatible chat endpoint with a structured prompt
 *
 * Content is cached per feature ID + lore type in localStorage.
 * Settings (API key, endpoint, model) are also persisted.
 */

import { kvStore } from '../persistence/kv-store'
import { djb2Hash, mulberry32 } from './encounters'
import type { GeoJSONFeature } from '../App'

export type AiLoreType = 'orientation' | 'rumors' | 'npcs' | 'tensions'

export interface AiLoreSettings {
  apiKey: string | null
  endpoint: string
  model: string
  temperature: number
}

export interface AiLoreResult {
  content: string
  cached: boolean
}

const SETTINGS_KEY = 'veydria.aiLoreSettings.v1'
const CACHE_KEY = 'veydria.aiLoreCache.v1'
const CACHE_VERSION = 1

const DEFAULT_SETTINGS: AiLoreSettings = {
  apiKey: null,
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  temperature: 0.7,
}

/* ─── Settings persistence ─── */

export function loadAiLoreSettings(): AiLoreSettings {
  try {
    const raw = kvStore.getString(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AiLoreSettings>
    return {
      apiKey: parsed.apiKey ?? DEFAULT_SETTINGS.apiKey,
      endpoint: parsed.endpoint ?? DEFAULT_SETTINGS.endpoint,
      model: parsed.model ?? DEFAULT_SETTINGS.model,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : DEFAULT_SETTINGS.temperature,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveAiLoreSettings(settings: AiLoreSettings): void {
  try {
    kvStore.setString(SETTINGS_KEY, JSON.stringify(settings))
  } catch { /* quota / private mode */ }
}

/* ─── Cache persistence ─── */

interface CacheEntry {
  orientation?: string
  rumors?: string
  npcs?: string
  tensions?: string
  timestamp: number
}

interface CacheStore {
  version: number
  entries: Record<string, CacheEntry>
}

function loadCache(): CacheStore {
  try {
    const raw = kvStore.getString(CACHE_KEY)
    if (!raw) return { version: CACHE_VERSION, entries: {} }
    const parsed = JSON.parse(raw) as Partial<CacheStore>
    if (parsed.version !== CACHE_VERSION) return { version: CACHE_VERSION, entries: {} }
    return { version: CACHE_VERSION, entries: parsed.entries ?? {} }
  } catch {
    return { version: CACHE_VERSION, entries: {} }
  }
}

function saveCache(cache: CacheStore): void {
  try {
    kvStore.setString(CACHE_KEY, JSON.stringify(cache))
  } catch { /* quota / private mode */ }
}

function cacheKey(featureId: string, type: AiLoreType): string {
  return `${featureId}#${type}`
}

export function getCachedLore(featureId: string, type: AiLoreType): string | null {
  const cache = loadCache()
  const entry = cache.entries[featureId]
  if (!entry) return null
  return entry[type] ?? null
}

export function setCachedLore(featureId: string, type: AiLoreType, content: string): void {
  const cache = loadCache()
  if (!cache.entries[featureId]) {
    cache.entries[featureId] = { timestamp: Date.now() }
  }
  cache.entries[featureId][type] = content
  cache.entries[featureId].timestamp = Date.now()
  saveCache(cache)
}

export function clearAiLoreCache(): void {
  try {
    kvStore.remove(CACHE_KEY)
  } catch { /* ignore */ }
}

/* ─── Prompt builder ─── */

function buildFeatureContext(feature: GeoJSONFeature): string {
  const p = feature.properties
  const lines: string[] = []

  lines.push(`Name: ${p.name ?? 'Unknown'}`)
  lines.push(`Category: ${p.category ?? 'unknown'}`)

  if (p.description) lines.push(`Description: ${p.description}`)
  if (p.type) lines.push(`Type: ${p.type}`)
  if (p.location) lines.push(`Location: ${p.location}`)
  if (p.function) lines.push(`Function: ${p.function}`)
  if (p.etymology) lines.push(`Etymology: ${p.etymology}`)
  if (p.commodities) lines.push(`Commodities: ${p.commodities}`)
  if (p.bottleneck) lines.push(`Bottleneck: ${p.bottleneck}`)
  if (p.consequence_if_closed) lines.push(`If closed: ${p.consequence_if_closed}`)
  if (p.strategic_value) lines.push(`Strategic value: ${p.strategic_value}`)
  if (p.cardinal) lines.push(`Cardinal position: ${p.cardinal}`)
  if (p.elevation) lines.push(`Elevation: ${p.elevation}`)
  if (p.terrain) lines.push(`Terrain: ${p.terrain}`)
  if (p.basin_access) lines.push(`Basin access: ${p.basin_access}`)
  if (p.connects && Array.isArray(p.connects)) lines.push(`Connects: ${p.connects.join(', ')}`)
  if (p.endpoints && Array.isArray(p.endpoints)) lines.push(`Endpoints: ${p.endpoints.join(', ')}`)
  if (p.path_description) lines.push(`Route: ${p.path_description}`)
  if (p.opening) lines.push(`Geography: ${p.opening}`)
  if (p.real_world_parallel) lines.push(`Real-world analog: ${p.real_world_parallel}`)

  return lines.join('\n')
}

export function buildPrompt(feature: GeoJSONFeature, type: AiLoreType): string {
  const ctx = buildFeatureContext(feature)
  const worldCtx = `Veydria is a roughly C-shaped fantasy continent wrapped around an enclosed sea, the Aethelian Basin. The basin is the continent's trade pivot — a neutral processor and certifier, not a producer. Six port cities with distinct architectural traditions ring it. Outside the basin: highland steppes north, oasis chains in the southern desert, archipelagos west of the Halkar Straits. Trade routes are specific economic relationships that drive faction tension.`

  const instructions: Record<AiLoreType, string> = {
    orientation: `In plain, concrete language, explain what this place is to someone who has never heard of it and is trying to picture it. Write 2 to 3 short paragraphs. Say plainly: what it physically is and what it would look like; who is there and what they actually do; what it is known for; and what tension or pressure it currently sits under. Stay concrete and grounded — favour everyday words. Do NOT use flowery, literary, or "purple" prose. Do NOT use in-world jargon or invented terms unless you immediately explain them in everyday words.`,
    rumors: `Generate 3 short, concrete rumours (2-3 sentences each) that a traveller might hear about this location. Each rumour should be specific enough to spark a scene, vague enough to leave room for the GM, and grounded in the location's actual function and relationships. Number them 1, 2, 3.`,
    npcs: `Generate 3 memorable NPCs associated with this location. For each, give: a name (culturally appropriate to the location), a one-line role, and a secret or tension. Keep each to 2-3 sentences. Number them 1, 2, 3.`,
    tensions: `Generate 3 local tensions, conflicts, or pressures currently acting on this location. These should be situation hooks — not full adventures, but friction that could escalate. Ground them in trade, geography, or faction relationships. 2-3 sentences each. Number them 1, 2, 3.`,
  }

  return `${worldCtx}\n\nLocation context:\n${ctx}\n\n${instructions[type]}\n\nRespond in plain text. No markdown formatting, no bold, no italics.`
}

/* ─── Live API call ─── */

export async function fetchAiLore(
  feature: GeoJSONFeature,
  type: AiLoreType,
  settings: AiLoreSettings,
): Promise<AiLoreResult> {
  const id = (feature.properties.id as string) || (feature as unknown as Record<string, unknown>).id as string || 'unknown'

  const cached = getCachedLore(id, type)
  if (cached) return { content: cached, cached: true }

  if (!settings.apiKey) {
    const mock = generateMockLore(feature, type)
    setCachedLore(id, type, mock)
    return { content: mock, cached: false }
  }

  const prompt = buildPrompt(feature, type)

  const res = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: settings.temperature,
      max_tokens: 800,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`AI lore request failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) throw new Error('AI lore returned empty content')

  setCachedLore(id, type, content)
  return { content, cached: false }
}

/* ─── Mock generator (deterministic, no API needed) ─── */

const RUMOR_TEMPLATES: Record<string, string[]> = {
  port: [
    'A {name} longshoreman swears he saw a ship with no sails glide into harbour at midnight, its hull covered in barnacles that glowed faintly blue. The harbourmaster wrote it off as monsoon-madness, but three other crews reported the same thing.',
    'The Tavakh Qarat have quietly raised the {name} anchorage fee for vessels carrying Qollari goods. Oravan merchants are threatening to boycott the port until the rate is reversed.',
    'A Ndajdi grain-factor at {name} has been selling futures he cannot cover; when the monsoon breaks, someone is going to be short a hundred tonnes of rice and very angry about it.',
  ],
  chokepoint: [
    'A Kheshkai scout reported smoke signals above {name} last week — the old Ngaru-Bon warning code, not used since before the Calendar Schism. No one claims to have lit them.',
    'The {name} toll-collector has started accepting payment in Qollari chuño instead of coin. The Khazadari accountants are furious, but the caravans love it.',
    'A collapsed cairn at {name} revealed a stone marker with a date from three centuries ago — predating every known claim to the pass. Every nearby power has sent a surveyor.',
  ],
  oasis: [
    'The {name} well-keeper claims the water tastes of copper since the last sandstorm. He has stopped selling to outsiders until an Irrah water-diviner can inspect it.',
    'A dying camel wandered into {name} with saddlebags full of Khazadari steel seals — each one stamped with a khatt who died twenty years ago. No rider, no tracks.',
    'Nomads at {name} speak of a new spring that opened three days\' ride east, in territory no one has claimed since the last frontier war.',
  ],
  contested_site: [
    'Both garrison commanders at {name} have received identical anonymous letters threatening to "drown the step" if neither side withdraws by the solstice.',
    'An Oravan surveyor at {name} claims the submerged foundations extend twice as far as previously mapped — suggesting the site was built when the Basin\'s water level was far lower.',
    'A Ndajdi scribe at {name} has begun teaching local children to read a pre-Basin script found on the lower steps. Religious authorities in three civilizations have taken notice.',
  ],
  civilization: [
    'A faction within {name} is pushing to unilaterally lower export tariffs before the next Triple-Seal Court session. The old guard calls it economic suicide; the young merchants call it survival.',
    'Rumour says {name}\'s current leadership secured power through a secret pact with a Khazadari banking house. The evidence — if it exists — is locked in a strongbox somewhere in the highland plateau.',
    'A plague of locusts is devouring the {name} eastern harvest. Foreign aid is being offered, but every donor attaches political conditions that the council cannot publicly accept.',
  ],
  trade_route: [
    'A new guide claims to know a parallel path to {name} that avoids the bottleneck entirely. Three caravans have tried it; only one returned, and its survivors will not speak of what they saw.',
    'The {name} commodity ratio has shifted: copper now buys half the steel it did last season. Ngaru-Bon smiths are hoarding ingots, and Ndjadi traders are panicking.',
    'A Khazadari inspector on {name} discovered that one in five "river-certified" copper ingots is actually lead-cored. The resulting recall has stranded three convoys in the steppe.',
  ],
  water: [
    'Fishermen on the {name} report that the usual seasonal migration of deep-water species has not occurred. Marine scholars blame the warming current; old sailors blame something older.',
    'A floating market has appeared in the {name} near the Halkar Straits — no flag, no registry, and prices in a currency no one recognises. It vanishes by dawn.',
    'The {name} Triple-Seal Court has received a petition to recognise a seventh port authority. The existing six are united in opposition, which observers say is the only thing they have agreed on in a century.',
  ],
  landmark: [
    'A traveller returned from {name} with a stone that hums when placed near salt water. Scholars dismiss it as piezoelectric trickery; the traveller insists it whispers names.',
    'The {name} has developed a new crack since the last monsoon. Local elders measure it weekly and keep the results secret, but one apprentice claims the rate of spread is accelerating.',
    'A religious order from Irrah has begun pilgrimage to {name}, claiming it matches a description in a pre-schism text. The local authorities are unsure whether to welcome them or turn them back.',
  ],
  river: [
    'The {name} is running higher than any recorded spring. Downstream irrigation systems are failing, and the Ndjadi water-allocation council has called an emergency session.',
    'A body drifted down {name} last week — no marks, no identification, dressed in clothing from a civilization that does not border the river. The case has been officially closed and unofficially classified.',
    'Engineers on the {name} have proposed a canal that would cut two weeks off the delta-to-Basin journey. Every city it bypasses has formed a coalition to block the plan.',
  ],
  default: [
    'Locals near {name} speak of unusual activity — more traffic, more strangers, more questions. Something is shifting, but no one can say what.',
    'A merchant who passed through {name} last month claims the usual arrangements have changed. Prices, permits, and protections are all in flux.',
    'An old document surfaced near {name} — faded, water-damaged, and written in a hand no one recognises. Its contents are being debated in whispers.',
  ],
}

const NPC_TEMPLATES: Record<string, string[]> = {
  port: [
    'Captain Yaro — a retired Ndajdi river-pilot who now brokers passage for foreigners. Secret: he still reports to the Ndjadi water ministry, and his ledgers contain coded shipping schedules.',
    'Mira al-Qatt — a Tavakh Qarat junior inspector who takes bribes in information rather than coin. Tension: she is being blackmailed by a smuggler who knows she forged her credentials.',
    'Old Teshin — a blind Oravan wave-reader who claims to smell storms three days before they arrive. He is never wrong, and he is never consulted by the harbourmaster until after disaster strikes.',
  ],
  chokepoint: [
    'Sergeant Khel — a Kheshkai conscript who has guarded {name} for eight years. Secret: he has been teaching himself to read the old Ngaru-Bon cairn-marks, and he suspects the pass was once a trade road, not a border.',
    'Dahab the Toll-keeper — she inherited the {name} booth from her mother, who inherited it from hers. Tension: a new Khazadari accounting standard threatens to eliminate her family\'s hereditary position.',
    'The Mule-Trader — no one knows his real name. He passes {name} twice a month with identical cargo manifests. The caravans trust him because his mules never spook, even when the pass is fogged in.',
  ],
  oasis: [
    'Well-Mother Sufi — she has kept the {name} water-tally for thirty years and remembers every drought. Secret: she has been diluting the well with a hidden secondary spring to hide the declining output.',
    'Young Rasul — an Irrah caravaneer who broke his contract to settle at {name}. Tension: his former employer has placed a lien on his share of the oasis cooperative, and the debt compounds monthly.',
    'The Dune-Walker — a Qalībin guide who arrives at {name} only during sandstorms. She speaks to no one, buys only salt and water, and vanishes into the white-out. The nomads say she is looking for something buried.',
  ],
  contested_site: [
    'Commander Oris — the Oravan garrison officer at {name}. Secret: she has been privately negotiating with a Ndajdi scribe to share access, against explicit orders from her khatt.',
    'Scribe-Adjunct Mela — a Ndajdi scholar who has spent seven years cataloguing {name}\'s lower steps. Tension: she has found evidence that challenges the official founding narrative of both claimants.',
    'The Watcher — a silent figure who appears at {name} during high tide and observes from the waterline. No one knows which side they serve, or if they serve anyone at all.',
  ],
  civilization: [
    'Minister Vey — a rising voice in {name}\'s trade council. Secret: her family fortune was built on smuggling during the last Metal Interdict, and the records still exist.',
    'Tomas the Interpreter — he speaks five languages and translates for every delegation that visits {name}. Tension: he has begun inserting subtle inaccuracies into sensitive negotiations, and no one has noticed yet.',
    'Elder Koss — the longest-serving member of {name}\'s governing body. He publicly supports the alliance with Khazadari bankers. Privately, he has been funding the opposition.',
  ],
  trade_route: [
    'The Factor — a nameless representative of the Khazadari Trade Authority who travels {name} twice yearly. Secret: he carries a sealed letter of credit that could buy the route outright if ever presented.',
    'Guide-Master Tenzin — she knows every variation of {name} and claims to have walked it in every season. Tension: she is going blind, and her newest apprentice does not yet know the spring ford crossings.',
    'Caravan-Boss Yara — she runs the largest convoy on {name}, forty wagons at peak season. Last month, one wagon went missing. She reported grain spoilage. The wagon contained something else entirely.',
  ],
  water: [
    'Admiral-Registrar Khen — the Basin Authority\'s record-keeper for {name}. Secret: the official shipping logs and his private ledger do not match, and the discrepancy grows every season.',
    'The Net-Mender — an elderly fisherman who has worked {name} for sixty years. He speaks to no one except his cat, but every harbourmaster consults him before setting seasonal quotas.',
    'Pilot-Candidate Lira — a young Oravan who failed her wave-tithe examination twice. Tension: she has been secretly charting unmapped currents in {name}, and her unofficial maps are more accurate than the Navy\'s.',
  ],
  landmark: [
    'The Custodian — the only permanent resident of {name}, maintained by a small endowment from three civilizations. Secret: the endowment dried up two years ago, and he has been living on stored provisions he refuses to explain.',
    'Survey-Student Perrin — a Kheshkai geologist mapping {name}\'s structural integrity. Tension: her preliminary report recommends immediate closure to pilgrims, but the local economy depends on visitation fees.',
    'The Pilgrim — an anonymous visitor who returns to {name} every solstice, performs a brief ritual, and leaves. This year, she brought a second person — the first time in twenty years.',
  ],
  river: [
    'Lock-Master Duru — he controls the central sluice on {name} and has held the post for fifteen years. Secret: he has been subtly altering flow rates to favour downstream farms owned by his in-laws.',
    'The Ferry-Woman — she crosses {name} at a point where no bridge exists and charges half the official rate. The authorities tolerate her because she saves lives during flood season.',
    'Engineer-Contrarian Mika — she proposed the controversial canal project on {name}. Tension: her original design was stolen and modified by a rival house; the current proposal is technically hers but politically toxic.',
  ],
  default: [
    'The Stranger — arrived at {name} two weeks ago, asking questions no one else thought to ask. Pays well, listens more than he speaks, and disappears before dusk.',
    'Old Keeper — has watched over {name} longer than anyone can remember. Knows every stone, every shadow, every seasonal change. Refuses to write anything down.',
    'The Apprentice — young, eager, and newly assigned to {name}. Full of ideas from the capital that do not fit local conditions. Either going to revolutionise the place or get herself killed.',
  ],
}

const TENSION_TEMPLATES: Record<string, string[]> = {
  port: [
    'The {name} docking queues have tripled since the new Khazadari tariff schedule took effect. Ships are idling in the outer harbour, captains are running out of fresh water, and the Tavakh Qarat are threatening to turn away non-essential traffic.',
    'A dockworkers\' guild at {name} is demanding recognition as a legal bargaining entity. The port authority has refused; the guild has begun a work-to-rule slowdown that is already backing up grain shipments.',
    'The monsoon forecast is worse than usual, and {name}\'s breakwater has not been repaired since the last storm. If the engineers do not start soon, the southern quay will not survive the season.',
  ],
  chokepoint: [
    'Ngaru-Bon and Kheshkai have both sent military surveyors to {name} in the past month. Neither side acknowledges the other\'s presence, but the cairn-marks are being quietly replaced on both sides of the pass.',
    'The {name} toll revenue has dropped forty percent since the new coastal shipping lanes opened. The toll-keepers are raising rates on the remaining traffic, which is driving more caravans to risk the sea route.',
    'A landslide last spring narrowed {name} to single-file traffic. The two civilisations that control its ends cannot agree on who pays for clearing it, and winter is coming.',
  ],
  oasis: [
    'The {name} water-table has dropped three years in a row. The headman is enforcing rationing, but the Irrah caravans — who have treaty rights — are demanding their full allocation.',
    'A new well has been dug ten kilometres from {name}, on disputed frontier land. Both nearby civilisations claim it; neither has sent armed force yet, but both have mobilised reserves.',
    'The date-palm blight that struck {name} last season has returned. The first grove is already dying. If it spreads to the secondary orchards, the oasis will not survive the next dry season.',
  ],
  contested_site: [
    'The Oravan garrison at {name} has received reinforcements — small, but symbolic. The Ndajdi scribes have responded by bringing in a team of senior archivists, which the garrison interprets as a provocation.',
    'A joint-research proposal for {name} was rejected by both claimants\' foreign ministries. The scholars who drafted it have gone rogue and are fundraising privately to continue their work without official sanction.',
    'The tide-gauge at {name} shows an anomalous reading: the water level is rising faster than the seasonal pattern predicts. If the trend continues, the lower steps will be permanently submerged within two years.',
  ],
  civilization: [
    'The {name} treasury is running low after three consecutive poor harvests. The leadership is considering devaluing the currency or defaulting on Khazadari loans — either choice risks internal revolt.',
    'A generational divide has opened in {name}: the young favour closer integration with the Basin trade network; the elders insist on traditional self-sufficiency. Both sides are recruiting allies, and the debate is turning violent.',
    'A foreign disease has reached {name} via the trade routes. The medical infrastructure is unprepared, and quarantine would require closing the very passes and ports that keep the economy alive.',
  ],
  trade_route: [
    'The {name} bottleneck is operating at one hundred ten percent of safe capacity. Caravan bosses are bribing schedulers for priority slots, and the safety margins that once protected against weather delays have vanished.',
    'A new maritime route now bypasses {name} entirely for three months of the year. The overland operators are slashing prices to compete, but their margins are already razor-thin. Bankruptcies are beginning.',
    'The {name} commodity trade has become a proxy for a larger political dispute. Neither side can afford to let the route close, but both are using tariff and inspection policy to inflict pain on the other.',
  ],
  water: [
    'The {name} salinity gradient is shifting. Marine biologists warn that the change could collapse the local fishery within a decade; the fishing guilds blame foreign trawlers and are threatening to arm their boats.',
    'A proposal to dredge a deeper channel in {name} has divided the port cities. The project would benefit large vessels but destroy traditional shallow-water fishing grounds that have sustained coastal communities for generations.',
    'The {name} Triple-Seal Court enforcement fleet is underfunded and understaffed. Piracy — or what the victims call piracy and the perpetrators call "retaliatory confiscation" — is rising in the outer basin.',
  ],
  landmark: [
    'The {name} structural integrity is degrading faster than the custodians can repair it. A conservation coalition wants to restrict access; the local economy depends on unrestricted pilgrimage and tourism.',
    'A religious sect has declared {name} sacred and is demanding that all non-believers be barred entry. The secular authority that manages the site has refused, and the sect\'s followers have begun peaceful — but intimidating — occupation.',
    'The materials used to build {name} are running out. The quarries that supplied the original stone are exhausted, and modern substitutes are visibly different. Every repair makes the structure less authentic and more controversial.',
  ],
  river: [
    'Upstream dam proposals on {name} would triple irrigation capacity but halve downstream flow. The cities at the delta are mobilising diplomatic and economic pressure to block construction.',
    'A toxic effluent — source unknown — has appeared in the {name} lower reaches. The contamination is still below lethal levels, but fish are dying and downstream communities are demanding answers no one can provide.',
    'The {name} flood-control system was designed for a different climate. The last three flood seasons have exceeded its rated capacity, and the engineering corps admits they do not have a solution that does not require relocating two towns.',
  ],
  default: [
    'Something has changed at {name} — subtle, but noticed by the old hands. Routines are off, timings are wrong, and the usual authorities are making decisions that do not match their previous patterns.',
    'A power vacuum is forming around {name}. The figure who once mediated disputes has stepped back — voluntarily or otherwise — and no successor has emerged. Competitors are circling.',
    'Resources at {name} are dwindling. Whether it is water, patience, money, or goodwill, the reserve is running lower than anyone wants to admit. The next crisis will not be met from surplus.',
  ],
}

function seededPick<T>(arr: T[], seed: number): T {
  const rng = mulberry32(seed)
  return arr[Math.floor(rng() * arr.length)]
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function generateMockLore(feature: GeoJSONFeature, type: AiLoreType): string {
  // Orientation is not a flavour-template pick — it is a plain-language
  // restatement of the feature's own canon fields, so it works offline and
  // stays faithful to the data rather than inventing.
  if (type === 'orientation') return generateMockOrientation(feature)

  const id = (feature.properties.id as string) || (feature as unknown as Record<string, unknown>).id as string || 'unknown'
  const name = (feature.properties.name as string) || 'this place'
  const category = (feature.properties.category as string) || 'default'

  const baseSeed = djb2Hash(id)
  const typeSeed = djb2Hash(type)
  const seed = baseSeed + typeSeed

  const templatesByType: Record<Exclude<AiLoreType, 'orientation'>, Record<string, string[]>> = {
    rumors: RUMOR_TEMPLATES,
    npcs: NPC_TEMPLATES,
    tensions: TENSION_TEMPLATES,
  }

  const templates = templatesByType[type]
  const pool = templates[category] ?? templates.default

  // Pick 3 distinct templates (or fewer if pool is small)
  const shuffled = seededShuffle(pool, seed)
  const picked = shuffled.slice(0, Math.min(3, pool.length))

  // If we somehow got fewer than 3, fall back to default pool
  if (picked.length < 3) {
    const defaultShuffled = seededShuffle(templates.default, seed + 1)
    picked.push(...defaultShuffled.slice(0, 3 - picked.length))
  }

  const lines: string[] = []
  picked.forEach((tpl, i) => {
    lines.push(`${i + 1}. ${tpl.replace(/\{name\}/g, name)}`)
  })

  return lines.join('\n\n')
}

/* ─── Orientation mock (plain-language, built from the feature's own canon fields) ─── */

const CATEGORY_NOUNS: Record<string, string> = {
  port: 'port city on the Aethelian Basin',
  chokepoint: 'chokepoint — a narrow passage that controls who and what can get through',
  oasis: 'oasis settlement out in the desert',
  civilization: 'civilization',
  trade_route: 'trade route',
  contested_site: 'contested site that more than one power lays claim to',
  water: 'body of water',
  landmark: 'landmark',
  river: 'river',
  default: 'place on the map',
}

// Present a canon field as a clean sentence: trim, and add a full stop only if
// it does not already end in terminal punctuation. Fields are shown VERBATIM
// (no case-folding) so proper nouns like "Venice" survive intact.
function asSentence(value: unknown): string {
  const t = String(value).trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/**
 * Plain-language orientation built directly from the feature's canon properties.
 * Deterministic, offline, and faithful — it restates what is recorded rather than
 * inventing flavour, and presents each field verbatim under a plain label so messy
 * or list-style canon entries still read cleanly. The live API path (buildPrompt)
 * produces a smoother prose version.
 */
export function generateMockOrientation(feature: GeoJSONFeature): string {
  const p = feature.properties
  const name = (p.name as string) || 'This place'
  const category = (p.category as string) || 'default'
  const noun = CATEGORY_NOUNS[category] ?? CATEGORY_NOUNS.default

  const place: string[] = []
  if (p.location) place.push(String(p.location))
  else if (p.cardinal) place.push(`${String(p.cardinal)} of the Basin`)
  if (p.terrain) place.push(String(p.terrain))
  const placePhrase = place.length ? `, ${place.join(', ')}` : ''

  const paras: string[] = []

  // Lead sentence: what it is and roughly where.
  let intro = `${name} is a ${noun}${placePhrase}.`
  if (p.description) intro += ` ${asSentence(p.description)}`
  paras.push(intro)

  // Labelled facts, presented verbatim so list-style canon fields stay clean.
  const facts: string[] = []
  if (p.function) facts.push(`What it's known for: ${asSentence(p.function)}`)
  if (p.commodities) facts.push(`Goods through it: ${asSentence(p.commodities)}`)
  if (Array.isArray(p.connects) && p.connects.length) facts.push(`It links ${(p.connects as unknown[]).join(' and ')}.`)
  if (Array.isArray(p.endpoints) && p.endpoints.length) facts.push(`The route runs between ${(p.endpoints as unknown[]).join(' and ')}.`)
  if (p.path_description) facts.push(asSentence(p.path_description))
  if (p.strategic_value) facts.push(`Why it matters: ${asSentence(p.strategic_value)}`)
  if (p.bottleneck) facts.push(`The pinch point: ${asSentence(p.bottleneck)}`)
  if (p.consequence_if_closed) facts.push(`If it were shut: ${asSentence(p.consequence_if_closed)}`)
  if (p.real_world_parallel) facts.push(`Real-world parallel: ${asSentence(p.real_world_parallel)}`)
  if (facts.length) paras.push(facts.join(' '))

  // Almost-empty fallback.
  if (paras.length === 1 && !p.description) {
    paras.push(`Beyond its place on the map, little is recorded about ${name} yet — which makes it a good spot to flesh out.`)
  }

  return paras.join('\n\n')
}
