/**
 * sim-passage-report.ts — Batch evaluator for the Passage choice layer.
 *
 * Plays the choice layer at scale, forks every signature instance, and reports
 * whether choices matter (differentiated, non-dominant, outcome-impactful) and
 * whether the crossing is balanced (death-march rate, severe-beat coverage,
 * repetition). Output: output/sim/passage-report.md.
 *
 * Usage:
 *   cd web
 *   npm run sim:passage -- --limit 60
 *   npm run sim:passage -- --seasons spring,summer --modes direct --out ./report.md
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { SIGNATURE_CHOICES } from '../../web/src/utils/passage'
import { resolveRepoRel, type Instance, type BranchOutcome } from './passage-run'
import {
  CIVS,
  SEASONS,
  SUPPLY_PRESETS,
  makePassageOpts,
  initPassage,
  walkWithForks,
  countSignatureFiresPerCrossing,
  allInitialEncounters,
  computePerKeyMetrics,
  median,
  loadGraph,
} from './passage-run'
import {
  cautious,
  getBasePolicy,
  DOWNSTREAM_BASE,
  DOWNSTREAM_CHOICE,
} from './passage-policies'
import type { BasePolicy } from './passage-run'
import type { Season, RouteMode } from '../../web/src/utils/journey-graph'
import type { Encounter } from '../../web/src/utils/encounters'

/* ─── CLI ─── */

interface CliArgs {
  limit: number | undefined
  seasons: Season[]
  modes: RouteMode[]
  outPath: string
  baseName: string
  base: BasePolicy
}

function parseListArg(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function parseArgs(argv: string[]): CliArgs {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const has = (k: string): boolean => argv.includes(`--${k}`)

  const seasonsRaw = parseListArg(get('seasons'))
  const modesRaw = parseListArg(get('modes'))
  const limitRaw = get('limit')

  return {
    limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    seasons: (seasonsRaw ?? SEASONS).filter((s): s is Season =>
      SEASONS.includes(s as Season),
    ),
    modes: (modesRaw ?? ['direct', 'cheapest']).filter((m): m is RouteMode =>
      ['direct', 'cheapest', 'fastest', 'safest'].includes(m as string),
    ),
    outPath: resolveRepoRel(get('out') ?? 'output/sim/passage-report.md'),
    baseName: get('base') ?? 'survive',
    base: getBasePolicy(get('base') ?? 'survive'),
  }
}

/* ─── Formatting ─── */

function cellMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '–'
  return `${((num / denom) * 100).toFixed(1)}%`
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---').join(' | ')
  return `| ${headers.join(' | ')} |\n| ${sep} |\n${rows.map(r => `| ${r.map(cellMd).join(' | ')} |`).join('\n')}\n`
}

/* ─── Grid construction ─── */

interface GridCell {
  from: string
  to: string
  season: Season
  mode: RouteMode
  supplyPreset: string
}

function buildGrid(args: CliArgs): GridCell[] {
  const grid: GridCell[] = []
  for (const from of CIVS) {
    for (const to of CIVS) {
      if (from === to) continue
      for (const season of args.seasons) {
        for (const mode of args.modes) {
          for (const supplyPreset of Object.keys(SUPPLY_PRESETS)) {
            grid.push({ from, to, season, mode, supplyPreset })
          }
        }
      }
    }
  }
  return grid
}

/* ─── Per-crossing result ─── */

interface CrossingResult {
  cell: GridCell
  routeFound: boolean
  outcome: 'arrived' | 'aborted' | 'perished' | 'unknown'
  instances: Instance[]
  signatureFires: Map<string, number>
  initialEncounters: Encounter[]
}

function runCrossing(cell: GridCell, graph: ReturnType<typeof loadGraph>, base: BasePolicy): CrossingResult {
  const supply = SUPPLY_PRESETS[cell.supplyPreset]
  const opts = makePassageOpts(
    graph,
    cell.from,
    cell.to,
    cell.season,
    cell.mode,
    supply,
  )
  if (!opts) {
    return {
      cell,
      routeFound: false,
      outcome: 'unknown',
      instances: [],
      signatureFires: new Map(),
      initialEncounters: [],
    }
  }
  const state0 = initPassage(opts)
  const { finalState, instances } = walkWithForks(
    state0,
    base,
    cautious,
    DOWNSTREAM_BASE,
    DOWNSTREAM_CHOICE,
  )
  return {
    cell,
    routeFound: true,
    outcome: finalState.outcome === 'in-progress' ? 'unknown' : finalState.outcome,
    instances,
    signatureFires: countSignatureFiresPerCrossing(state0),
    initialEncounters: allInitialEncounters(state0),
  }
}

/* ─── Report sections ─── */

function sectionPerKeyTables(allInstances: Instance[]): string {
  if (allInstances.length === 0) {
    return '## Per-signature-key branch tables\n\n_(no signature instances in this batch)_\n'
  }
  const metrics = computePerKeyMetrics(allInstances)
  const sections: string[] = ['## Per-signature-key branch tables\n']
  const outcomeOrder = ['arrived', 'aborted', 'perished'] as const
  for (const key of Object.keys(SIGNATURE_CHOICES)) {
    const agg = metrics.get(key)
    if (!agg || agg.instances === 0) {
      sections.push(`### ${key}\n\n_N instances = 0_\n`)
      continue
    }
    const headers = [
      'index',
      'label',
      'risk',
      'completion',
      'med water',
      'med rations',
      'med days',
      'arrived',
      'aborted',
      'perished',
    ]
    const rows: string[][] = []
    const sortedIndices = [...agg.branchStats.keys()].sort((a, b) => a - b)
    for (const idx of sortedIndices) {
      const stats = agg.branchStats.get(idx)!
      const outcomes = stats.outcomes
      rows.push([
        String(idx),
        stats.label,
        stats.risk,
        pct(stats.completed, agg.instances),
        median(stats.finalWaters).toFixed(1),
        median(stats.finalRations).toFixed(1),
        median(stats.totalDays).toFixed(1),
        String(outcomes.get('arrived') ?? 0),
        String(outcomes.get('aborted') ?? 0),
        String(outcomes.get('perished') ?? 0),
      ])
    }
    sections.push(`### ${key} (${agg.instances} instances)\n`)
    sections.push(table(headers, rows))
  }
  return sections.join('\n')
}

function sectionDominance(allInstances: Instance[]): string {
  if (allInstances.length === 0) {
    return '## Dominance / dead-choice flags\n\n_(no signature instances)_\n'
  }
  const metrics = computePerKeyMetrics(allInstances)
  const lines: string[] = ['## Dominance / dead-choice flags\n']
  for (const key of Object.keys(SIGNATURE_CHOICES)) {
    const agg = metrics.get(key)
    if (!agg || agg.instances === 0) continue
    lines.push(`### ${key}`)
    const rows: string[][] = []
    const sortedIndices = [...agg.branchStats.keys()].sort((a, b) => a - b)
    let hasDominant = false
    let hasDead = false
    for (const idx of sortedIndices) {
      const stats = agg.branchStats.get(idx)!
      const domCount = agg.dominanceFrequency.get(idx) ?? 0
      const deadCount = agg.deadFrequency.get(idx) ?? 0
      const domPct = (domCount / agg.instances) * 100
      const deadPct = (deadCount / agg.instances) * 100
      if (domPct >= 80) hasDominant = true
      if (deadPct >= 80) hasDead = true
      rows.push([
        String(idx),
        stats.label,
        `${domCount}/${agg.instances} (${domPct.toFixed(0)}%)`,
        `${deadCount}/${agg.instances} (${deadPct.toFixed(0)}%)`,
      ])
    }
    rows.push([]) // placeholder; we'll append flag row separately
    const flagNotes: string[] = []
    if (hasDominant) flagNotes.push('**DOMINANT CHOICE (fun-killer)**')
    if (hasDead) flagNotes.push('**DEAD CHOICE**')
    if (flagNotes.length === 0) flagNotes.push('_no dominance / dead flags_')
    rows[rows.length - 1] = ['flags', flagNotes.join(' · '), '', '']
    lines.push(table(['index', 'label', 'dominance freq', 'dead freq'], rows))
  }
  return lines.join('\n')
}

function sectionOutcomeImpact(allInstances: Instance[]): string {
  if (allInstances.length === 0) {
    return '## Outcome impact\n\n_(no signature instances)_\n'
  }
  const metrics = computePerKeyMetrics(allInstances)
  const rows: string[][] = []
  for (const key of Object.keys(SIGNATURE_CHOICES)) {
    const agg = metrics.get(key)
    if (!agg || agg.instances === 0) {
      rows.push([key, '0', '0%', 'n/a'])
      continue
    }
    const frac = agg.outcomeImpactFraction
    const note = frac < 0.1 ? 'choices rarely change the ending here (often slack supply)' : ''
    rows.push([
      key,
      String(agg.instances),
      `${(frac * 100).toFixed(1)}%`,
      note,
    ])
  }
  return [
    '## Outcome impact\n',
    'Fraction of instances whose branches yield two or more distinct terminal outcomes.',
    table(['key', 'instances', 'impact %', 'note'], rows),
  ].join('\n')
}

function sectionDifferentiation(allInstances: Instance[]): string {
  if (allInstances.length === 0) {
    return '## Differentiation\n\n_(no signature instances)_\n'
  }
  const metrics = computePerKeyMetrics(allInstances)
  const rows: string[][] = []
  for (const key of Object.keys(SIGNATURE_CHOICES)) {
    const agg = metrics.get(key)
    if (!agg || agg.instances === 0) {
      rows.push([key, '0', '0', '0', '0', '0', '0%', '0/0/0', 'n/a'])
      continue
    }
    // The genuine recurring tradeoff = biting instances where every branch
    // still ARRIVED (different leftover supply, i.e. a real no-resupply-ahead
    // window). Perish-flip (mixed) is a death-cliff; all-perish is dead-march
    // noise. Report the all-arrive slice as the fraction of TOTAL instances.
    const liveFrac = agg.instances === 0 ? 0 : agg.bitingAllArrive / agg.instances
    rows.push([
      key,
      String(agg.instances),
      agg.medianWaterDiff.toFixed(1),
      agg.medianRationsDiff.toFixed(1),
      agg.maxWaterDiff.toFixed(1),
      agg.maxRationsDiff.toFixed(1),
      `${(agg.fracBitingInstances * 100).toFixed(0)}%`,
      `${agg.bitingAllArrive}/${agg.bitingMixed}/${agg.bitingAllPerish}`,
      `${(liveFrac * 100).toFixed(0)}%`,
    ])
  }
  return [
    '## Differentiation\n',
    'Median (and max) across instances of (max − min) final water / final rations among ' +
      'the branches. **biting%** = fraction of instances where either range ≥ 2. ' +
      '**tail split** = biting instances by terminal-outcome composition: ' +
      'allArrive / mixed (perish-flip) / allPerish. ' +
      '**live%** = allArrive ÷ all instances — the genuine recurring tradeoff ' +
      '(a no-resupply-ahead window where every branch still arrives, with different leftover). ' +
      'mixed is a death-cliff (= outcome-impact); allPerish is dead-march noise.',
    table(
      [
        'key', 'instances', 'med water', 'med rations', 'max water', 'max rations',
        'biting%', 'tail split (arr/mix/perish)', 'live%',
      ],
      rows,
    ),
  ].join('\n')
}

function sectionRepetition(results: CrossingResult[]): string {
  const withRoute = results.filter(r => r.routeFound)
  const keyTotals = new Map<string, number>()
  const keyDistribution = new Map<string, Map<number, number>>()
  let anyRepeatCrossings = 0
  for (const r of withRoute) {
    let hasRepeat = false
    for (const [key, count] of r.signatureFires) {
      keyTotals.set(key, (keyTotals.get(key) ?? 0) + count)
      let dist = keyDistribution.get(key)
      if (!dist) {
        dist = new Map()
        keyDistribution.set(key, dist)
      }
      dist.set(count, (dist.get(count) ?? 0) + 1)
      if (count >= 2) hasRepeat = true
    }
    if (hasRepeat) anyRepeatCrossings++
  }

  const rows: string[][] = []
  for (const key of Object.keys(SIGNATURE_CHOICES)) {
    const total = keyTotals.get(key) ?? 0
    const dist = keyDistribution.get(key) ?? new Map()
    const distParts: string[] = []
    for (const [count, n] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
      distParts.push(`${count}×:${n}`)
    }
    rows.push([key, String(total), distParts.join(' ') || '0'])
  }

  return [
    '## Repetition\n',
    `Signature fires are counted from each crossing's initial encounter schedule (supply-independent). ` +
      `Crossings with any same-key repeat: ${anyRepeatCrossings}/${withRoute.length} ` +
      `(${pct(anyRepeatCrossings, withRoute.length)}).\n`,
    table(['key', 'total fires', 'fires-per-crossing distribution'], rows),
  ].join('\n')
}

function sectionSevereBeatCoverage(results: CrossingResult[]): string {
  const signatureKeys = new Set(Object.keys(SIGNATURE_CHOICES))
  const nonInteractive: Encounter[] = []
  const interactive: Encounter[] = []
  for (const r of results) {
    if (!r.routeFound) continue
    for (const enc of r.initialEncounters) {
      if (enc.severity !== 'moderate' && enc.severity !== 'severe') continue
      if (enc.key && signatureKeys.has(enc.key)) {
        interactive.push(enc)
      } else {
        nonInteractive.push(enc)
      }
    }
  }

  const freq = new Map<string, number>()
  for (const enc of nonInteractive) {
    freq.set(enc.narrative, (freq.get(enc.narrative) ?? 0) + 1)
  }
  const top = [...freq.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
    .slice(0, 10)

  return [
    '## Severe-beat coverage\n',
    `Moderate+severe encounters generated: ${interactive.length} interactive (signature) · ` +
      `${nonInteractive.length} non-interactive (flavor-only).\n`,
    '### Top non-interactive moderate / severe beats\n',
    top.length === 0
      ? '_(none)_\n'
      : table(
          ['count', 'narrative'],
          top.map(([narrative, count]) => [String(count), narrative]),
        ),
  ].join('\n')
}

function sectionDeathMarch(results: CrossingResult[], baseName: string): string {
  const groupKeys = new Set<string>()
  for (const r of results) {
    if (!r.routeFound) continue
    groupKeys.add(`${r.cell.supplyPreset}|${r.cell.mode}`)
  }
  const sortedGroups = [...groupKeys].sort()
  const rows: string[][] = []
  for (const g of sortedGroups) {
    const [supplyPreset, mode] = g.split('|')
    const group = results.filter(
      r => r.routeFound && r.cell.supplyPreset === supplyPreset && r.cell.mode === mode,
    )
    const denominator = group.length
    const noChoice = group.filter(r => r.instances.length === 0)
    const perished = noChoice.filter(r => r.outcome === 'perished').length
    const aborted = noChoice.filter(r => r.outcome === 'aborted').length
    const total = perished + aborted
    rows.push([
      supplyPreset, mode, String(denominator),
      `${perished} (${pct(perished, denominator)})`,
      `${aborted} (${pct(aborted, denominator)})`,
      pct(total, denominator),
    ])
  }
  return [
    '## Death-march rate (choices never reached)\n',
    'Per (supply preset × mode): crossings that terminated WITHOUT ever presenting a signature ' +
      'choice, split by cause. Denominator = crossings that produced a route.\n',
    '> **Read with care — this is policy-dependent.** It is measured under a single base player ' +
      `(\`${baseName}\`), which is deliberately simple (rations only at supply ≤2; never force-marches ` +
      'or forecasts). **perished** = the game killed the party (the balance signal). **aborted** = the ' +
      'player chose to turn back before a choice (skilled play, not unfairness) — do NOT read these as ' +
      '"the game is too hard". For calibration, the engine 5-policy `sim-fun-report` shows standard/' +
      'cheapest *completes* ~42.8%, so the choice layer is reachable far more often with better play ' +
      'than the `survive` figure alone implies. Bound it by re-running with `--base headlong`.\n',
    table(['supply', 'mode', 'crossings', 'perished (no choice)', 'aborted (no choice)', 'combined rate'], rows),
  ].join('\n')
}

/* ─── Main ─── */

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const graph = loadGraph()
  const grid = buildGrid(args)
  const total = grid.length
  const limit = args.limit
  const toRun = limit !== undefined && limit < grid.length ? grid.slice(0, limit) : grid

  if (limit !== undefined && limit < grid.length) {
    process.stderr.write(`capped: ran ${toRun.length} of ${total} crossings\n`)
  }

  const results: CrossingResult[] = []
  for (const cell of toRun) {
    results.push(runCrossing(cell, graph, args.base))
  }

  const allInstances: Instance[] = []
  for (const r of results) allInstances.push(...r.instances)

  const sections: string[] = []
  sections.push('# Passage choice-layer playtest report\n')
  sections.push(`Generated: ${new Date().toISOString()}`)
  sections.push(`Grid: ${toRun.length} crossings run ` +
    `(supply presets: ${Object.keys(SUPPLY_PRESETS).join(', ')}; modes: ${args.modes.join(', ')}; seasons: ${args.seasons.join(', ')})`)
  sections.push(`Baseline policy: base=${args.baseName}, choice=cautious. ` +
    `Fork downstream policy: base=survive, choice=cautious. ` +
    `This measures choice quality **under that policy**, not under all policies.\n`)
  sections.push(sectionPerKeyTables(allInstances))
  sections.push(sectionDominance(allInstances))
  sections.push(sectionOutcomeImpact(allInstances))
  sections.push(sectionDifferentiation(allInstances))
  sections.push(sectionRepetition(results))
  sections.push(sectionSevereBeatCoverage(results))
  sections.push(sectionDeathMarch(results, args.baseName))

  const md = sections.join('\n\n') + '\n'
  const outPathAbs = resolveRepoRel(args.outPath)
  const outDir = dirname(outPathAbs)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(outPathAbs, md, 'utf-8')
  process.stderr.write(`wrote ${outPathAbs}\n`)
}

/* Gate auto-run so tests can import without invoking main(). */
if (!process.env.VITEST) main()
