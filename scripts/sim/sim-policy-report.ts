/**
 * sim-policy-report.ts — Phase 3b: aggregate a multi-policy sim:batch run.
 *
 * Reads a policy-shape summary.csv (the one written by `sim:batch --policy …`)
 * and emits a markdown report. Headline question: do decisions matter, and
 * by how much, across (preset × season × mode × civ-pair)?
 *
 * Example:
 *   cd web
 *   npm run sim:batch -- --policy all
 *   npm run sim:policy-report
 *
 *   # Or with explicit paths:
 *   npm run sim:policy-report -- --in ../output/sim --out ../output/sim/report.md
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

interface CliArgs {
  inDir: string
  outPath: string
  convergenceEpsilon: number
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../..')
}

function resolveRepoRel(p: string): string {
  return isAbsolute(p) ? p : resolve(repoRoot(), p)
}

function parseArgs(argv: string[]): CliArgs {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const inDir = resolveRepoRel(get('in') ?? 'output/sim')
  const outPath = resolveRepoRel(get('out') ?? 'output/sim/sim-policy-report.md')
  const eps = get('eps')
  return {
    inDir,
    outPath,
    convergenceEpsilon: eps !== undefined ? Number(eps) : 0.05,
  }
}

/* ─── CSV reader (handles quoted fields with embedded commas) ─── */

export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') { inQ = false }
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

export type Row = Record<string, string>

function readCsv(path: string): { rows: Row[]; header: string[] } {
  const txt = readFileSync(path, 'utf-8')
  const lines = txt.split('\n').filter(l => l.length > 0)
  if (lines.length === 0) throw new Error(`empty CSV: ${path}`)
  const header = parseCsvLine(lines[0])
  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const row: Row = {}
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? ''
    rows.push(row)
  }
  return { rows, header }
}

/* ─── Aggregation helpers ─── */

function pct(num: number, denom: number): string {
  if (denom === 0) return '–'
  return `${((num / denom) * 100).toFixed(1)}%`
}

function completionByGroup(rows: Row[], groupFn: (r: Row) => string): Map<string, { total: number; completed: number }> {
  const m = new Map<string, { total: number; completed: number }>()
  for (const r of rows) {
    const key = groupFn(r)
    let v = m.get(key)
    if (!v) { v = { total: 0, completed: 0 }; m.set(key, v) }
    v.total++
    if (r.completed === 'true') v.completed++
  }
  return m
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---').join(' | ')
  return `| ${headers.join(' | ')} |\n| ${sep} |\n${rows.map(r => `| ${r.join(' | ')} |`).join('\n')}\n`
}

const ACTION_KEYS = [
  'action_continue', 'action_rest', 'action_force_march',
  'action_ration', 'action_turn_back', 'action_reroute',
] as const

/* ─── Report sections ─── */

export function sectionHeadline(rows: Row[], policies: string[]): string {
  const byPolicy = completionByGroup(rows, r => r.policy)
  const rates = policies.map(p => {
    const v = byPolicy.get(p) ?? { total: 0, completed: 0 }
    return v.total === 0 ? 0 : v.completed / v.total
  })
  const max = Math.max(...rates)
  const min = Math.min(...rates)
  const spread = (max - min) * 100
  const rowsOut = policies.map(p => {
    const v = byPolicy.get(p) ?? { total: 0, completed: 0 }
    return [p, String(v.total), String(v.completed), pct(v.completed, v.total)]
  })
  return [
    '## Headline\n',
    `Spread (max − min completion rate across policies): **${spread.toFixed(1)} pp**\n`,
    table(['policy', 'runs', 'completed', 'rate'], rowsOut),
  ].join('\n')
}

function sectionByDim(
  rows: Row[],
  policies: string[],
  dimKey: keyof Row,
  dimValues: string[],
  dimLabel: string,
): string {
  const headers = [dimLabel, ...policies]
  const tableRows = dimValues.map(dv => {
    const cell: string[] = [dv]
    for (const p of policies) {
      const filtered = rows.filter(r => r[dimKey] === dv && r.policy === p)
      const completed = filtered.filter(r => r.completed === 'true').length
      cell.push(pct(completed, filtered.length))
    }
    return cell
  })
  return [
    `## By ${dimLabel}\n`,
    table(headers, tableRows),
  ].join('\n')
}

export function sectionActionMix(rows: Row[], policies: string[]): string {
  /* Per-policy: total days across all runs, then % of each action kind. */
  const headers = ['policy', 'total_days', ...ACTION_KEYS.map(k => k.replace('action_', ''))]
  const tableRows = policies.map(p => {
    const filtered = rows.filter(r => r.policy === p)
    let totalDays = 0
    const tallies: Record<string, number> = {}
    for (const k of ACTION_KEYS) tallies[k] = 0
    for (const r of filtered) {
      totalDays += Number(r.days_count || 0)
      for (const k of ACTION_KEYS) tallies[k] += Number(r[k] || 0)
    }
    const cells: string[] = [p, String(totalDays)]
    for (const k of ACTION_KEYS) cells.push(pct(tallies[k], totalDays))
    return cells
  })
  return [
    '## Action mix\n',
    'Share of each action across all simulated days, per policy.\n',
    table(headers, tableRows),
  ].join('\n')
}

function sectionExhaustion(rows: Row[], policies: string[]): string {
  const tableRows = policies.map(p => {
    const values = rows
      .filter(r => r.policy === p)
      .map(r => Number(r.exhaustion_final || 0))
      .sort((a, b) => a - b)
    const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
    const p90 = values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(values.length * 0.9))]
    const max = values.length === 0 ? 0 : values[values.length - 1]
    return [p, String(values.length), mean.toFixed(1), String(p90), String(max)]
  })
  return [
    '## Final exhaustion\n',
    table(['policy', 'runs', 'mean', 'p90', 'max'], tableRows),
  ].join('\n')
}

export function sectionConvergence(rows: Row[], policies: string[], eps: number): string {
  /* Group by (from, to, season). For each group, compute completion rate per policy
   * (over modes × supply × party). Flag groups where (max − min) < eps. */
  const groups = new Map<string, Map<string, { total: number; completed: number }>>()
  for (const r of rows) {
    const key = `${r.from}|${r.to}|${r.season}`
    let g = groups.get(key)
    if (!g) { g = new Map(); groups.set(key, g) }
    let v = g.get(r.policy)
    if (!v) { v = { total: 0, completed: 0 }; g.set(r.policy, v) }
    v.total++
    if (r.completed === 'true') v.completed++
  }
  const convergent: Array<{ from: string; to: string; season: string; rate: number }> = []
  for (const [key, g] of groups.entries()) {
    const rates = policies.map(p => {
      const v = g.get(p)
      return v && v.total > 0 ? v.completed / v.total : 0
    })
    const spread = Math.max(...rates) - Math.min(...rates)
    if (spread < eps) {
      const [from, to, season] = key.split('|')
      convergent.push({ from, to, season, rate: rates[0] })
    }
  }
  convergent.sort((a, b) => a.from === b.from
    ? (a.to === b.to ? a.season.localeCompare(b.season) : a.to.localeCompare(b.to))
    : a.from.localeCompare(b.from))
  const tableRows = convergent.map(c => [c.from, c.to, c.season, `${(c.rate * 100).toFixed(1)}%`])
  return [
    '## Convergence (decisions don\'t matter)\n',
    `Triples where the spread across all policies is below ${(eps * 100).toFixed(0)} pp.`,
    `Count: **${convergent.length}** / ${groups.size} triples.\n`,
    convergent.length === 0
      ? '_(no convergent triples — every (from, to, season) shows policy-sensitivity)_'
      : table(['from', 'to', 'season', 'common_rate'], tableRows),
  ].join('\n')
}

/* ─── Main ─── */

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const csvPath = resolve(args.inDir, 'summary.csv')
  if (!existsSync(csvPath)) {
    process.stderr.write(`summary.csv not found at ${csvPath}\n`)
    process.stderr.write(`Run: npm run sim:batch -- --policy all  (or specify --in <dir>)\n`)
    process.exit(1)
  }
  const { rows, header } = readCsv(csvPath)
  if (!header.includes('policy')) {
    process.stderr.write(`${csvPath} is the legacy-schema CSV (no 'policy' column).\n`)
    process.stderr.write(`Run sim:batch with --policy all (or csv) to produce the policy-shape CSV.\n`)
    process.exit(1)
  }

  /* Drop no-route rows from rate calculations — they're not the policies' fault. */
  const policies = [...new Set(rows.filter(r => r.policy).map(r => r.policy))].sort()
  if (policies.length === 0) {
    process.stderr.write(`no policy rows in ${csvPath}\n`)
    process.exit(1)
  }
  const seasons = [...new Set(rows.map(r => r.season).filter(Boolean))].sort()
  const modes = [...new Set(rows.map(r => r.mode))].sort()
  const presets = [...new Set(rows.map(r => r.supply_preset))].sort()

  const sections: string[] = []
  sections.push(`# sim:batch policy report\n`)
  sections.push(`Generated: ${new Date().toISOString()}`)
  sections.push(`Input: \`${csvPath}\` (${rows.length} rows, ${policies.length} policies)\n`)
  sections.push(sectionHeadline(rows, policies))
  sections.push(sectionByDim(rows, policies, 'supply_preset', presets, 'supply preset'))
  sections.push(sectionByDim(rows, policies, 'season', seasons, 'season'))
  sections.push(sectionByDim(rows, policies, 'mode', modes, 'route mode'))
  sections.push(sectionActionMix(rows, policies))
  sections.push(sectionExhaustion(rows, policies))
  sections.push(sectionConvergence(rows, policies, args.convergenceEpsilon))

  const md = sections.join('\n\n') + '\n'
  const outDir = dirname(args.outPath)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(args.outPath, md, 'utf-8')
  process.stderr.write(`wrote ${args.outPath}\n`)
}

/* Gate auto-run so tests can import this module without invoking main(). */
if (!process.env.VITEST) main()
