#!/usr/bin/env node
/**
 * Sync Lore Index
 *
 * Crawls worldbuilder/ and veydria-atlas/ to build a lightweight JSON index
 * mapping geojson feature IDs → related lore snippets.
 *
 * Matching strategy:
 *   - Explicit civilization/tag matches score highest
 *   - Broad files matching >4 features are deprioritized
 *   - Per-feature cap of 12 entries
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { join, relative } from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '')
const WORLDBUILDER_PATH = process.env.WORLDBUILDER_PATH || join(REPO_ROOT, '..', 'worldbuilder')
const ATLAS_PATH = process.env.ATLAS_PATH || join(REPO_ROOT, '..', 'veydria-atlas')
const OUTPUT_PATH = join(REPO_ROOT, 'web', 'public', 'veydria-lore.json')

const KNOWN_FEATURE_IDS = new Set([
  'ngaru_bon', 'irrah', 'kheshkai', 'ndjadi', 'qollari', 'oravan',
  'aethelian_basin',
  'lam_chen_pass', 'a_tzalan_ford', 'qollari_cliff_roads', 'halkar_straits',
  'smith_spring', 'breath_of_cloud',
  'ki_mbuhari', 'tavakh_qarat', 'halani_tamu', 'dzong_tamu',
  'copper_for_steel_road', 'highland_steppe_corridor', 'highland_relay',
  'coastal_monsoon', 'caravan_thread', 'scribal_ladder',
])

// Files that are too broad to assign to specific features (continent overviews, etc.)
const BROAD_FILE_PATTERNS = [
  /continents\/veydria-topology\.ya?ml$/,
  /continents\/veydria\.ya?ml$/,
  /continents\/veydria-overview\.ya?ml$/,
  /geography-veydria\.ya?ml$/,
  /veydria-overview\.ya?ml$/,
  /00_overview\.md$/,
  /ARCHITECTURE-PROPOSAL/,
  /resource-map\.ya?ml$/,
  /contact-.*\.ya?ml$/,
]

function isBroadFile(relPath) {
  return BROAD_FILE_PATTERNS.some(p => p.test(relPath))
}

// Manual mappings for files that don't auto-match cleanly
const MANUAL_FILE_MAPPINGS = {
  'factions/03_crises/harbor_oath_war.md': ['oravan', 'ndjadi', 'irrah', 'aethelian_basin'],
  'factions/03_crises/metal_interdict.md': ['ngaru_bon', 'oravan', 'kheshkai', 'lam_chen_pass'],
  'factions/03_crises/calendar_schism.md': ['qollari', 'ndjadi', 'irrah', 'kheshkai'],
  'factions/02_trans_civ/basin_merchant_dynasties.md': ['aethelian_basin'],
  'factions/02_trans_civ/khazadari_internals.md': ['aethelian_basin'],
  'factions/02_trans_civ/three_tithe_pool.md': ['aethelian_basin'],
  'factions/02_trans_civ/tongue_guild.md': ['aethelian_basin'],
  'geography/locations/aethelian-basin.yaml': ['aethelian_basin'],
  'geography/locations/aethelian-basin.md': ['aethelian_basin'],
}

// ---------------------------------------------------------------------------
// File crawling
// ---------------------------------------------------------------------------

async function findFiles(dir, extSet) {
  const results = []
  async function walk(current) {
    if (!existsSync(current)) return
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        await walk(full)
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf('.'))
        if (extSet.has(ext)) results.push(full)
      }
    }
  }
  await walk(dir)
  return results
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser
// ---------------------------------------------------------------------------

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: null, body: text }
  const end = text.indexOf('---', 3)
  if (end === -1) return { frontmatter: null, body: text }
  const yamlBlock = text.slice(3, end).trim()
  const body = text.slice(end + 3).trim()
  return { frontmatter: parseSimpleYaml(yamlBlock), body }
}

function parseSimpleYaml(yaml) {
  const result = {}
  const lines = yaml.split('\n')
  let currentKey = null
  let currentList = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim() || line.trim().startsWith('#')) continue

    const listMatch = line.match(/^(\s*)-\s+(.+)$/)
    if (listMatch && currentKey && currentList !== null) {
      currentList.push(listMatch[2].trim())
      continue
    }

    const kvMatch = line.match(/^(\s*)([\w_]+)\s*:\s*(.*)$/)
    if (kvMatch) {
      const [, , key, val] = kvMatch
      const trimmedVal = val.trim()
      if (trimmedVal === '') {
        currentKey = key
        currentList = []
        result[key] = currentList
      } else {
        result[key] = trimmedVal.replace(/^["'](.*)["']$/, '$1')
        currentKey = key
        currentList = null
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Summary extraction
// ---------------------------------------------------------------------------

function extractMarkdownSummary(body, maxLen = 420) {
  let cleaned = body.replace(/^---+$/gm, '')
  const headingMatch = cleaned.match(/^(#{1,2})\s+(.+)$/m)
  let content = cleaned
  if (headingMatch) {
    const idx = cleaned.indexOf(headingMatch[0])
    content = cleaned.slice(idx + headingMatch[0].length)
  }
  const paragraphs = content.split('\n\n')
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    // F8 audit fix: markdown tables (paragraphs whose lines are pipe-delimited)
    // flatten into unreadable "| col | col | |---|---| | r1 | r2 |" runs after
    // newline collapse below. Skip them and try the next paragraph — the body
    // renderer handles tables correctly when the full entry is opened.
    const lines = trimmed.split('\n')
    const pipeLines = lines.filter(l => /^\s*\|.*\|\s*$/.test(l))
    if (pipeLines.length >= 2 && pipeLines.length === lines.length) continue
    const plain = trimmed
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\n+/g, ' ')
    if (plain.length < 20) continue
    if (plain.length > maxLen) return plain.slice(0, maxLen).trim() + '…'
    return plain
  }
  return ''
}

function extractYamlSummary(obj, maxLen = 420) {
  for (const key of ['identity', 'description', 'summary', 'physical', 'overview']) {
    const val = obj[key]
    if (typeof val === 'string' && val.length > 30) {
      return val.length > maxLen ? val.slice(0, maxLen).trim() + '…' : val
    }
  }
  if (obj.identity && typeof obj.identity === 'object') {
    const str = JSON.stringify(obj.identity).replace(/[{}"]/g, ' ')
    if (str.length > 30) return str.length > maxLen ? str.slice(0, maxLen).trim() + '…' : str
  }
  return ''
}

// ---------------------------------------------------------------------------
// Feature ID matching with scoring
// ---------------------------------------------------------------------------

function normalizeId(str) {
  return str.toLowerCase().replace(/[-\s]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function scoreMatch(relPath, frontmatter, body, yamlObj, fid) {
  let score = 0
  const pathLower = relPath.toLowerCase()
  const fm = frontmatter || yamlObj || {}

  // 1. Explicit civilization field (strongest signal)
  const civ = fm.civilization || ''
  if (normalizeId(civ) === fid) score += 10

  // 2. File path contains feature name
  const pathVariants = [fid, fid.replace(/_/g, '-'), fid.replace(/_/g, '')]
  for (const v of pathVariants) {
    if (pathLower.includes(v)) { score += 5; break }
  }

  // 3. Tags
  const tags = fm.tags || []
  for (const tag of tags) {
    const t = normalizeId(String(tag))
    if (t === fid) { score += 4; break }
    if (t.includes(fid) || fid.includes(t)) {
      if (t.length > 2 && fid.length > 2) { score += 2; break }
    }
  }

  // 4. Cross refs
  const refs = fm.cross_refs || []
  for (const ref of refs) {
    const r = String(ref).toLowerCase()
    if (r.includes(fid.replace(/_/g, '.')) || r.includes(fid.replace(/_/g, '-'))) {
      score += 3
      break
    }
  }

  // 5. Body mention (first 5000 chars only)
  const bodyPrefix = (body || '').slice(0, 5000).toLowerCase()
  const bodyVariants = [fid, fid.replace(/_/g, ' '), fid.replace(/_/g, '-')]
  for (const v of bodyVariants) {
    if (bodyPrefix.includes(v)) { score += 1; break }
  }
  // 5b. Stem match for compound names (e.g. lam_chen_pass → lam-chen)
  const stem = fid.replace(/_(pass|ford|roads|straits|route|road|site)$/, '').replace(/_/g, '-')
  if (stem !== fid && stem.length > 3 && bodyPrefix.includes(stem)) {
    score += 1
  }

  return score
}

function findFeatureIds(relPath, frontmatter, body, yamlObj) {
  // Check manual mappings first (key is suffix of relPath)
  for (const [pattern, fids] of Object.entries(MANUAL_FILE_MAPPINGS)) {
    if (relPath.includes(pattern)) return fids.map(f => ({ fid: f, score: 10 }))
  }

  const scored = []
  for (const fid of KNOWN_FEATURE_IDS) {
    const s = scoreMatch(relPath, frontmatter, body, yamlObj, fid)
    if (s > 0) scored.push({ fid, score: s })
  }

  // Deprioritize overly broad files
  if (isBroadFile(relPath)) {
    for (const entry of scored) entry.score = Math.max(0, entry.score - 8)
  }

  // If a file matches many features, only keep matches with score >= 3
  // (prevents continent overviews from polluting every civ)
  if (scored.length > 4) {
    return scored.filter(s => s.score >= 3)
  }

  return scored.filter(s => s.score >= 1)
}

// ---------------------------------------------------------------------------
// Category detection
// ---------------------------------------------------------------------------

function detectCategory(filePath) {
  const p = filePath.replace(/\\/g, '/').toLowerCase()
  if (p.includes('/magic/')) return 'magic'
  if (p.includes('/religion/')) return 'religion'
  if (p.includes('/factions/')) return p.includes('/crises/') ? 'crisis' : 'factions'
  if (p.includes('/ecology/')) return 'ecology'
  if (p.includes('/geography/')) return 'geography'
  if (p.includes('/linguistics/')) return 'linguistics'
  if (p.includes('/economy/')) return 'economy'
  if (p.includes('/timeline/')) return 'timeline'
  return 'lore'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Syncing lore index...')
  console.log('  worldbuilder:', WORLDBUILDER_PATH)
  console.log('  atlas:', ATLAS_PATH)

  const files = []
  if (existsSync(WORLDBUILDER_PATH)) {
    files.push(...await findFiles(WORLDBUILDER_PATH, new Set(['.md', '.yaml', '.yml'])))
  }
  if (existsSync(ATLAS_PATH)) {
    files.push(...await findFiles(ATLAS_PATH, new Set(['.md', '.yaml', '.yml'])))
  }

  console.log(`  Found ${files.length} source files`)

  // Collect all entries with scores
  const rawEntries = [] // { fid, score, entry: {title, category, source, summary} }

  for (const filePath of files) {
    const relPath = relative(REPO_ROOT, filePath).replace(/\\/g, '/')
    const text = readFileSync(filePath, 'utf-8')

    let frontmatter = null
    let body = text
    let yamlObj = null
    let title = null
    const ext = filePath.slice(filePath.lastIndexOf('.'))

    if (ext === '.md') {
      const parsed = parseFrontmatter(text)
      frontmatter = parsed.frontmatter
      body = parsed.body
      title = frontmatter?.id || frontmatter?.title || null
      if (!title) {
        const h1 = body.match(/^#\s+(.+)$/m)
        if (h1) title = h1[1].trim()
      }
    } else {
      try {
        yamlObj = parseSimpleYaml(text)
        title = yamlObj.name || yamlObj.id || null
      } catch {
        yamlObj = null
      }
    }

    if (!title) {
      const base = relPath.split('/').pop().replace(/\.[^.]+$/, '')
      title = base.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }

    const scoredMatches = findFeatureIds(relPath, frontmatter, body, yamlObj)
    if (scoredMatches.length === 0) continue

    let summary = ext === '.md'
      ? extractMarkdownSummary(body)
      : extractYamlSummary(yamlObj || {})

    if (!summary && ext === '.md') {
      const firstLine = body.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'))
      if (firstLine) summary = firstLine.trim().slice(0, 420)
    }

    if (!summary) continue

    const category = detectCategory(relPath)
    const entry = { title, category, source: relPath, summary }

    for (const { fid, score } of scoredMatches) {
      rawEntries.push({ fid, score, entry })
    }
  }

  // Group by feature, sort by score, dedupe by source, cap at 12
  const index = {}
  for (const fid of KNOWN_FEATURE_IDS) index[fid] = []

  const byFeature = new Map()
  for (const { fid, score, entry } of rawEntries) {
    if (!byFeature.has(fid)) byFeature.set(fid, [])
    byFeature.get(fid).push({ score, entry })
  }

  for (const [fid, items] of byFeature) {
    // Sort by score descending
    items.sort((a, b) => b.score - a.score)
    const seenSources = new Set()
    for (const { score, entry } of items) {
      if (seenSources.has(entry.source)) continue
      seenSources.add(entry.source)
      index[fid].push({ ...entry, _score: score })
      if (index[fid].length >= 12) break
    }
    // Remove scoring metadata before output
    for (const e of index[fid]) delete (e)._score
  }

  // Sort within each feature by category
  const categoryOrder = {
    geography: 1, ecology: 2, factions: 3, crisis: 4, magic: 5, religion: 6,
    economy: 7, linguistics: 8, timeline: 9, lore: 10,
  }
  for (const fid in index) {
    index[fid].sort((a, b) => {
      const oa = categoryOrder[a.category] || 99
      const ob = categoryOrder[b.category] || 99
      if (oa !== ob) return oa - ob
      return a.source.localeCompare(b.source)
    })
  }

  const pruned = {}
  let totalSnippets = 0
  for (const [fid, entries] of Object.entries(index)) {
    if (entries.length > 0) {
      pruned[fid] = entries
      totalSnippets += entries.length
    }
  }

  const stats = {
    generatedAt: new Date().toISOString(),
    totalFeatures: Object.keys(pruned).length,
    totalSnippets,
    sourcesScanned: files.length,
  }

  const output = { _meta: stats, features: pruned }
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))

  console.log(`\n✓ Wrote ${OUTPUT_PATH}`)
  console.log(`  Features with lore: ${stats.totalFeatures}`)
  console.log(`  Total snippets: ${stats.totalSnippets}`)

  for (const [fid, entries] of Object.entries(pruned).sort((a, b) => b[1].length - a[1].length)) {
    const cats = [...new Set(entries.map(e => e.category))]
    console.log(`  ${fid}: ${entries.length} entries (${cats.join(', ')})`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
