/**
 * sim-fun-report.ts — Phase 4: decision-space metrics for "fun".
 *
 * Mines existing output/sim/{summary.csv, traces.jsonl} for the four
 * questions the roadmap pinned to Phase 4:
 *   1. Mode regret — which (route mode, route) combinations punish you most
 *      vs the best alternative mode? (CSV-only.)
 *   2. Pivot rate — across (from, to, season, supply, party, mode), what
 *      fraction of cells have non-trivial spread across policies (i.e.
 *      decisions had consequences)? Complement of sim-policy-report's
 *      convergence count, but bucketed by supply × mode for actionability.
 *      (CSV-only.)
 *   3. Surprise rate — what fraction of simulated days saw a
 *      moderate-or-severe encounter, and does action-mix shift on those
 *      days vs routine days? (Traces.)
 *   4. Recovery distance — among traces that hit a supply warning, what
 *      fraction recovered (warning lifted to '') vs failed vs arrived
 *      under sustained pressure? Median days-to-recover / -to-failure.
 *      (Traces.)
 *
 * Output: output/sim/sim-fun-report.md — the GM-facing 1-pager.
 *
 * Usage:
 *   cd web
 *   npm run sim:fun-report                # uses output/sim/{summary.csv, traces.jsonl}
 *   npm run sim:fun-report -- --in ../output/sim --out ../output/sim/sim-fun-report.md
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

import {
  pct,
  readCsv,
  table,
  type Row,
} from './report-utils'

/* ─── CLI args ─── */

interface CliArgs {
  inDir: string
  outPath: string
  /** Spread threshold for "decisions mattered" (default 5 pp). */
  epsilon: number
  /** Top-N cells to surface in the regret-worst list. */
  topN: number
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
  const outPath = resolveRepoRel(get('out') ?? 'output/sim/sim-fun-report.md')
  const eps = get('eps')
  const topN = get('top')
  return {
    inDir,
    outPath,
    epsilon: eps !== undefined ? Number(eps) : 0.05,
    topN: topN !== undefined ? Number(topN) : 20,
  }
}

/* ─── Trace shape (subset we read from traces.jsonl) ─── */

export interface TraceDay {
  dayNum: number
  rationsLeft: number
  waterLeft: number
  supplyWarning?: string
  action?: string
  encounters: Array<{ severity: string }>
}

export interface Trace {
  inputs: {
    from: string
    to: string
    season?: string
    mode: string
    policy?: string
    supply: {
      rationsPerPerson: number
      waterPerPerson: number
      encumbrance: string
      packAnimals: string
    }
  }
  days: TraceDay[]
  summary: {
    daysCount: number
    completed: boolean
    finishedReason: 'arrived' | 'water-out' | 'rations-out' | 'no-route' | 'aborted'
  }
}

export function readTraces(path: string): Trace[] {
  const txt = readFileSync(path, 'utf-8')
  const out: Trace[] = []
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue
    out.push(JSON.parse(line) as Trace)
  }
  return out
}

/* ─── Metric 1: Mode regret ─── */

/** Group rows by an arbitrary key, returning {key → completion-rate}. */
function rateByKey(rows: Row[], keyFn: (r: Row) => string): Map<string, number> {
  const counts = new Map<string, { c: number; n: number }>()
  for (const r of rows) {
    const k = keyFn(r)
    let v = counts.get(k)
    if (!v) { v = { c: 0, n: 0 }; counts.set(k, v) }
    v.n++
    if (r.completed === 'true') v.c++
  }
  const out = new Map<string, number>()
  for (const [k, v] of counts.entries()) out.set(k, v.n === 0 ? 0 : v.c / v.n)
  return out
}

export interface ModeRegretRow {
  from: string
  to: string
  season: string
  supplyPreset: string
  modeRates: Record<string, number>
  bestMode: string
  bestRate: number
  worstMode: string
  worstRate: number
  spreadPp: number
}

/** Top-N (from, to, season, supply_preset) cells by mode spread.
 *  Aggregates each cell's per-mode completion rate across policies × parties. */
export function computeModeRegretWorst(rows: Row[], modes: string[], topN: number): ModeRegretRow[] {
  const cellKey = (r: Row): string => `${r.from}|${r.to}|${r.season}|${r.supply_preset}`
  /* For each cell, group by mode and compute completion rate. */
  const byCell = new Map<string, Map<string, { c: number; n: number }>>()
  for (const r of rows) {
    const k = cellKey(r)
    let cell = byCell.get(k)
    if (!cell) { cell = new Map(); byCell.set(k, cell) }
    let m = cell.get(r.mode)
    if (!m) { m = { c: 0, n: 0 }; cell.set(r.mode, m) }
    m.n++
    if (r.completed === 'true') m.c++
  }
  const cells: ModeRegretRow[] = []
  for (const [k, modeMap] of byCell.entries()) {
    const [from, to, season, supplyPreset] = k.split('|')
    const modeRates: Record<string, number> = {}
    for (const mode of modes) {
      const v = modeMap.get(mode)
      modeRates[mode] = v && v.n > 0 ? v.c / v.n : 0
    }
    let bestMode = modes[0], bestRate = -Infinity
    let worstMode = modes[0], worstRate = Infinity
    for (const mode of modes) {
      const r = modeRates[mode]
      if (r > bestRate) { bestRate = r; bestMode = mode }
      if (r < worstRate) { worstRate = r; worstMode = mode }
    }
    cells.push({
      from, to, season, supplyPreset,
      modeRates, bestMode, bestRate, worstMode, worstRate,
      spreadPp: (bestRate - worstRate) * 100,
    })
  }
  cells.sort((a, b) => b.spreadPp - a.spreadPp)
  return cells.slice(0, topN)
}

/** Mean regret per mode, bucketed by supply preset. */
export function computeModeRegretByPreset(
  rows: Row[],
  modes: string[],
  presets: string[],
): Map<string, Map<string, number>> {
  /* For each (preset, cell): find best mode rate. Then for each (preset, mode):
   * average across cells of (bestRate − thisModeRate). */
  const cellKey = (r: Row): string => `${r.from}|${r.to}|${r.season}|${r.party_preset}|${r.policy}`
  const result = new Map<string, Map<string, number>>()
  for (const preset of presets) {
    const subset = rows.filter(r => r.supply_preset === preset)
    /* Build cell→mode→rate */
    const cells = new Map<string, Map<string, { c: number; n: number }>>()
    for (const r of subset) {
      const k = cellKey(r)
      let cell = cells.get(k)
      if (!cell) { cell = new Map(); cells.set(k, cell) }
      let m = cell.get(r.mode)
      if (!m) { m = { c: 0, n: 0 }; cell.set(r.mode, m) }
      m.n++
      if (r.completed === 'true') m.c++
    }
    const regretSum: Record<string, number> = {}
    const regretCount: Record<string, number> = {}
    for (const mode of modes) { regretSum[mode] = 0; regretCount[mode] = 0 }
    for (const cell of cells.values()) {
      let best = 0
      for (const mode of modes) {
        const v = cell.get(mode)
        const r = v && v.n > 0 ? v.c / v.n : 0
        if (r > best) best = r
      }
      for (const mode of modes) {
        const v = cell.get(mode)
        const r = v && v.n > 0 ? v.c / v.n : 0
        regretSum[mode] += (best - r)
        regretCount[mode] += 1
      }
    }
    const inner = new Map<string, number>()
    for (const mode of modes) {
      inner.set(mode, regretCount[mode] === 0 ? 0 : regretSum[mode] / regretCount[mode])
    }
    result.set(preset, inner)
  }
  return result
}

export function sectionModeRegret(
  rows: Row[],
  modes: string[],
  presets: string[],
  topN: number,
): string {
  const byPreset = computeModeRegretByPreset(rows, modes, presets)
  const worst = computeModeRegretWorst(rows, modes, topN)

  /* Headline table: rows = preset, cols = modes, cells = mean regret pp. */
  const headlineHeaders = ['supply preset', ...modes.map(m => `${m} (mean regret)`)]
  const headlineRows = presets.map(p => {
    const row: string[] = [p]
    const inner = byPreset.get(p)
    for (const mode of modes) {
      const r = inner?.get(mode) ?? 0
      row.push(`${(r * 100).toFixed(1)} pp`)
    }
    return row
  })

  /* Top-N cells table. */
  const worstHeaders = ['from', 'to', 'season', 'supply', 'best mode', 'best %', 'worst mode', 'worst %', 'spread pp']
  const worstRows = worst.map(c => [
    c.from, c.to, c.season, c.supplyPreset,
    c.bestMode, `${(c.bestRate * 100).toFixed(0)}%`,
    c.worstMode, `${(c.worstRate * 100).toFixed(0)}%`,
    c.spreadPp.toFixed(0),
  ])

  return [
    '## Mode regret\n',
    'How much completion-rate do you lose by picking a suboptimal route mode? ' +
    'Aggregated across policies and party presets. **Higher = mode choice matters more.**\n',
    '### Mean regret per (supply preset × mode)\n',
    table(headlineHeaders, headlineRows),
    `### Top-${topN} (from, to, season, supply) cells by mode spread\n`,
    worst.length === 0
      ? '_(no cells with non-zero spread)_'
      : table(worstHeaders, worstRows),
  ].join('\n')
}

/* ─── Metric 1b: Mode regret breakdown ─── */

export interface ModeBreakdownRow {
  mode: string
  meanKm: number
  meanEncountersTotal: number
  meanModerateSevere: number
  encountersPer100Km: number
  meanCompletion: number
  meanRegretPp: number
}

/** Parse encounters_by_severity_json (e.g. `{"mild":2,"moderate":1}`). Returns
 *  zeros on empty / malformed input. */
export function parseSeverityCounts(s: string): { mild: number; moderate: number; severe: number } {
  if (!s) return { mild: 0, moderate: 0, severe: 0 }
  try {
    const o = JSON.parse(s) as Record<string, number>
    return {
      mild: Number(o.mild ?? 0),
      moderate: Number(o.moderate ?? 0),
      severe: Number(o.severe ?? 0),
    }
  } catch {
    return { mild: 0, moderate: 0, severe: 0 }
  }
}

/** Per-mode decomposition of regret for a single supply preset.
 *  Returns mean km / encounter density / severity mix / regret pp per mode,
 *  so a reader can tell whether mode-regret is driven by route length (more
 *  encounter rolls) or by encounter density per km (biome composition). */
export function computeModeBreakdown(
  rows: Row[],
  modes: string[],
  supplyPreset: string,
): ModeBreakdownRow[] {
  const subset = rows.filter(r => r.supply_preset === supplyPreset)

  /* Regret: bestRate − thisModeRate per cell, averaged across cells. */
  const cellKey = (r: Row): string => `${r.from}|${r.to}|${r.season}|${r.party_preset}|${r.policy}`
  const cells = new Map<string, Map<string, { c: number; n: number }>>()
  for (const r of subset) {
    const k = cellKey(r)
    let cell = cells.get(k)
    if (!cell) { cell = new Map(); cells.set(k, cell) }
    let m = cell.get(r.mode)
    if (!m) { m = { c: 0, n: 0 }; cell.set(r.mode, m) }
    m.n++
    if (r.completed === 'true') m.c++
  }
  const regretSum: Record<string, number> = {}
  const regretCount: Record<string, number> = {}
  for (const mode of modes) { regretSum[mode] = 0; regretCount[mode] = 0 }
  for (const cell of cells.values()) {
    let best = 0
    for (const mode of modes) {
      const v = cell.get(mode)
      const r = v && v.n > 0 ? v.c / v.n : 0
      if (r > best) best = r
    }
    for (const mode of modes) {
      const v = cell.get(mode)
      const r = v && v.n > 0 ? v.c / v.n : 0
      regretSum[mode] += (best - r)
      regretCount[mode] += 1
    }
  }

  /* Per-mode means: km, encounters, severity mix, completion. */
  const out: ModeBreakdownRow[] = []
  for (const mode of modes) {
    const modeRows = subset.filter(r => r.mode === mode)
    if (modeRows.length === 0) {
      out.push({
        mode, meanKm: 0, meanEncountersTotal: 0, meanModerateSevere: 0,
        encountersPer100Km: 0, meanCompletion: 0, meanRegretPp: 0,
      })
      continue
    }
    let kmSum = 0, encSum = 0, modSevSum = 0, compSum = 0
    for (const r of modeRows) {
      kmSum += Number(r.total_km || 0)
      encSum += Number(r.encounters_total || 0)
      const sev = parseSeverityCounts(r.encounters_by_severity_json || '')
      modSevSum += sev.moderate + sev.severe
      if (r.completed === 'true') compSum++
    }
    const n = modeRows.length
    const meanKm = kmSum / n
    out.push({
      mode,
      meanKm,
      meanEncountersTotal: encSum / n,
      meanModerateSevere: modSevSum / n,
      encountersPer100Km: meanKm === 0 ? 0 : (encSum / n) / meanKm * 100,
      meanCompletion: compSum / n,
      meanRegretPp: regretCount[mode] === 0 ? 0 : (regretSum[mode] / regretCount[mode]) * 100,
    })
  }
  return out
}

export function sectionModeBreakdown(rows: Row[], modes: string[], presets: string[]): string {
  const headers = ['mode', 'mean km', 'encounters', 'mod+sev', 'enc / 100km', 'completion', 'regret pp']
  const presetSections: string[] = []
  for (const preset of presets) {
    const breakdown = computeModeBreakdown(rows, modes, preset)
    const tableRows = breakdown.map(b => [
      b.mode,
      b.meanKm.toFixed(0),
      b.meanEncountersTotal.toFixed(1),
      b.meanModerateSevere.toFixed(1),
      b.encountersPer100Km.toFixed(2),
      `${(b.meanCompletion * 100).toFixed(1)}%`,
      b.meanRegretPp.toFixed(1),
    ])
    presetSections.push(`### ${preset} preset\n\n${table(headers, tableRows)}`)
  }
  return [
    '## Mode regret breakdown — segment count vs encounter density\n',
    'Decomposes mode regret into possible drivers. **Read column-by-column:** ' +
    '`mean km` is route length; `mod+sev` is the count of encounters with mechanical supply cost ' +
    '(mild are cosmetic); `enc / 100km` is encounter density per unit distance. ' +
    'If a high-regret mode has the largest `mean km` but similar `enc / 100km`, the penalty is a ' +
    '**length effect** (more rolls per trip). If it has comparable km but larger `enc / 100km` or ' +
    '`mod+sev`, the penalty is **biome / route composition** (denser danger per km).\n',
    presetSections.join('\n'),
  ].join('\n')
}

/* ─── Metric 2: Pivot rate ─── */

export interface PivotRateCell {
  supplyPreset: string
  mode: string
  decisionsMattered: number
  total: number
}

/** % of cells (from, to, season, supply_preset, party_preset, mode) where
 *  the spread across policies is ≥ epsilon. */
export function computePivotRate(
  rows: Row[],
  policies: string[],
  presets: string[],
  modes: string[],
  epsilon: number,
): PivotRateCell[] {
  const out: PivotRateCell[] = []
  for (const supplyPreset of presets) {
    for (const mode of modes) {
      const subset = rows.filter(r => r.supply_preset === supplyPreset && r.mode === mode)
      /* Group by (from, to, season, party_preset) then compute per-policy rate. */
      const cells = new Map<string, Map<string, { c: number; n: number }>>()
      for (const r of subset) {
        const k = `${r.from}|${r.to}|${r.season}|${r.party_preset}`
        let cell = cells.get(k)
        if (!cell) { cell = new Map(); cells.set(k, cell) }
        let v = cell.get(r.policy)
        if (!v) { v = { c: 0, n: 0 }; cell.set(r.policy, v) }
        v.n++
        if (r.completed === 'true') v.c++
      }
      let mattered = 0
      for (const cell of cells.values()) {
        const rates = policies.map(p => {
          const v = cell.get(p)
          return v && v.n > 0 ? v.c / v.n : 0
        })
        const spread = Math.max(...rates) - Math.min(...rates)
        if (spread >= epsilon) mattered++
      }
      out.push({ supplyPreset, mode, decisionsMattered: mattered, total: cells.size })
    }
  }
  return out
}

export function sectionPivotRate(
  rows: Row[],
  policies: string[],
  presets: string[],
  modes: string[],
  epsilon: number,
): string {
  const cells = computePivotRate(rows, policies, presets, modes, epsilon)
  const headers = ['supply preset', ...modes.map(m => `${m}`)]
  const tableRows = presets.map(preset => {
    const row: string[] = [preset]
    for (const mode of modes) {
      const cell = cells.find(c => c.supplyPreset === preset && c.mode === mode)
      if (!cell || cell.total === 0) row.push('–')
      else row.push(pct(cell.decisionsMattered, cell.total))
    }
    return row
  })
  const totalMattered = cells.reduce((a, c) => a + c.decisionsMattered, 0)
  const totalCells = cells.reduce((a, c) => a + c.total, 0)
  return [
    '## Decisions matter? (pivot rate)\n',
    `For each (from, to, season, supply, party, mode) cell, did the choice of policy ` +
    `change the outcome? A cell is **decision-mattered** when per-policy completion ` +
    `spread ≥ ${(epsilon * 100).toFixed(0)} pp.\n`,
    `Overall: **${pct(totalMattered, totalCells)}** of ${totalCells} cells.\n`,
    table(headers, tableRows),
  ].join('\n')
}

/* ─── Metric 3: Surprise rate ─── */

const NON_CONTINUE_ACTIONS = new Set(['ration', 'force-march', 'turn-back', 'reroute', 'rest'])

function isSurprisingDay(d: TraceDay): boolean {
  for (const e of d.encounters) {
    if (e.severity === 'moderate' || e.severity === 'severe') return true
  }
  return false
}

export interface SurpriseRow {
  policy: string
  totalDays: number
  surprisingDays: number
  surprisingNonContinue: number
  routineNonContinue: number
  routineDays: number
}

export function computeSurprise(traces: Trace[]): Map<string, SurpriseRow> {
  const m = new Map<string, SurpriseRow>()
  for (const t of traces) {
    const policy = t.inputs.policy ?? 'none'
    let v = m.get(policy)
    if (!v) {
      v = { policy, totalDays: 0, surprisingDays: 0, surprisingNonContinue: 0, routineDays: 0, routineNonContinue: 0 }
      m.set(policy, v)
    }
    /* Next-day attribution: a surprise on day N can only influence the action
     * the policy picks at the start of day N+1, because day N's action is
     * already chosen by the time the encounter rolls (mid-day). Skip the
     * final day — no "tomorrow" to attribute its action to. */
    for (let i = 0; i < t.days.length - 1; i++) {
      const today = t.days[i]
      const tomorrow = t.days[i + 1]
      v.totalDays++
      const surp = isSurprisingDay(today)
      const nonCont = tomorrow.action !== undefined && NON_CONTINUE_ACTIONS.has(tomorrow.action)
      if (surp) {
        v.surprisingDays++
        if (nonCont) v.surprisingNonContinue++
      } else {
        v.routineDays++
        if (nonCont) v.routineNonContinue++
      }
    }
  }
  return m
}

export function sectionSurprise(traces: Trace[], policies: string[]): string {
  const data = computeSurprise(traces)
  const headers = ['policy', 'total days', 'surprising %', 'non-continue on surprising', 'non-continue on routine', 'shift pp']
  const tableRows = policies.map(p => {
    const v = data.get(p)
    if (!v) return [p, '0', '–', '–', '–', '–']
    const surpRate = v.totalDays === 0 ? 0 : v.surprisingDays / v.totalDays
    const surpAct = v.surprisingDays === 0 ? 0 : v.surprisingNonContinue / v.surprisingDays
    const routAct = v.routineDays === 0 ? 0 : v.routineNonContinue / v.routineDays
    const shift = (surpAct - routAct) * 100
    return [
      p,
      String(v.totalDays),
      `${(surpRate * 100).toFixed(1)}%`,
      `${(surpAct * 100).toFixed(1)}%`,
      `${(routAct * 100).toFixed(1)}%`,
      `${shift >= 0 ? '+' : ''}${shift.toFixed(1)}`,
    ]
  })
  return [
    '## Surprise rate\n',
    'A day is **surprising** if it contained a moderate-or-severe encounter. ' +
    'Action-shift = P(non-continue **on next day** | surprising today) − P(non-continue **on next day** | routine today). ' +
    'Next-day attribution because the policy chooses each day\'s action at day-start, before the encounter rolls. ' +
    '**Larger shift = surprises actually drive decisions.**\n',
    table(headers, tableRows),
  ].join('\n')
}

/* ─── Metric 4: Recovery distance ─── */

const OUT_WARNINGS = new Set(['water-out', 'rations-out'])

export interface RecoveryRow {
  policy: string
  supplyPreset: string
  warned: number
  recovered: number
  failed: number
  arrivedUnderPressure: number
  recoveryDays: number[]
  failureDays: number[]
}

/** Classify each trace into recovered/failed/arrived-under-pressure. */
export function computeRecovery(traces: Trace[]): Map<string, RecoveryRow> {
  const m = new Map<string, RecoveryRow>()
  for (const t of traces) {
    const policy = t.inputs.policy ?? 'none'
    /* Supply preset is derivable from inputs.supply.rationsPerPerson:
     * 3 → tight, 12 → standard, 14 → caravan (matches the grid). */
    const r = t.inputs.supply.rationsPerPerson
    const supplyPreset = r === 3 ? 'tight' : r === 12 ? 'standard' : r === 14 ? 'caravan' : 'other'
    const days = t.days
    /* Find first day with a non-empty supplyWarning. */
    let firstWarnIdx = -1
    for (let i = 0; i < days.length; i++) {
      if ((days[i].supplyWarning ?? '').length > 0) { firstWarnIdx = i; break }
    }
    if (firstWarnIdx < 0) continue   /* no pressure: not part of this metric */

    const key = `${policy}|${supplyPreset}`
    let v = m.get(key)
    if (!v) {
      v = { policy, supplyPreset, warned: 0, recovered: 0, failed: 0, arrivedUnderPressure: 0, recoveryDays: [], failureDays: [] }
      m.set(key, v)
    }
    v.warned++

    /* Did supply warning ever fully lift after first warning? */
    let recoveryIdx = -1
    for (let i = firstWarnIdx + 1; i < days.length; i++) {
      if (!days[i].supplyWarning) { recoveryIdx = i; break }
    }

    if (recoveryIdx >= 0) {
      v.recovered++
      v.recoveryDays.push(recoveryIdx - firstWarnIdx)
    } else if (t.summary.finishedReason === 'arrived') {
      v.arrivedUnderPressure++
    } else {
      v.failed++
      v.failureDays.push(days.length - 1 - firstWarnIdx)
    }
  }
  return m
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

export function sectionRecovery(traces: Trace[], policies: string[], presets: string[]): string {
  const data = computeRecovery(traces)
  const headers = ['policy', 'supply', 'warned', 'recovered %', 'failed %', 'arrived-under-pressure %', 'median days to recover', 'median days to failure']
  const tableRows: string[][] = []
  for (const policy of policies) {
    for (const preset of presets) {
      const v = data.get(`${policy}|${preset}`)
      if (!v || v.warned === 0) {
        tableRows.push([policy, preset, '0', '–', '–', '–', '–', '–'])
        continue
      }
      tableRows.push([
        policy,
        preset,
        String(v.warned),
        pct(v.recovered, v.warned),
        pct(v.failed, v.warned),
        pct(v.arrivedUnderPressure, v.warned),
        v.recoveryDays.length === 0 ? '–' : String(median(v.recoveryDays)),
        v.failureDays.length === 0 ? '–' : String(median(v.failureDays)),
      ])
    }
  }
  return [
    '## Recovery distance\n',
    'Of traces that hit at least one supply warning: did the warning lift again (recovered), ' +
    'did the trace fail (failed), or did it arrive without the warning ever lifting ' +
    '(arrived-under-pressure)? Days-to-recover counts from first-warning to first-clear-after.',
    'Days-to-failure counts from first-warning to end of trace.\n',
    table(headers, tableRows),
  ].join('\n')
}

/* ─── TL;DR ─── */

export function computeTLDR(
  modeWorst: ModeRegretRow[],
  pivotCells: PivotRateCell[],
  surprise: Map<string, SurpriseRow>,
  recovery: Map<string, RecoveryRow>,
  policies: string[],
): string[] {
  const bullets: string[] = []

  /* 1. Worst single mode-regret cell. */
  if (modeWorst.length > 0) {
    const top = modeWorst[0]
    bullets.push(
      `**Worst mode pick:** ${top.from} → ${top.to} (${top.season}, ${top.supplyPreset}): ` +
      `${top.bestMode} completes ${(top.bestRate * 100).toFixed(0)}% but ${top.worstMode} only ` +
      `${(top.worstRate * 100).toFixed(0)}% — **${top.spreadPp.toFixed(0)} pp** swing on mode alone.`,
    )
  }

  /* 2. Where do decisions matter most? */
  if (pivotCells.length > 0) {
    const sorted = pivotCells
      .filter(c => c.total > 0)
      .map(c => ({ ...c, rate: c.decisionsMattered / c.total }))
      .sort((a, b) => b.rate - a.rate)
    if (sorted.length > 0) {
      const top = sorted[0]
      bullets.push(
        `**Decisions matter most:** ${top.supplyPreset} + ${top.mode} — ` +
        `${(top.rate * 100).toFixed(0)}% of cells diverge across policies ` +
        `(${top.decisionsMattered}/${top.total}).`,
      )
    }
  }

  /* 3. Largest absolute action-shift, but only among policies that actually
   * mix actions. A policy that's always-continue or always-non-continue has
   * zero shift by construction — surfacing it would be misleading. */
  const shifts: Array<{ policy: string; shift: number; overallNonCont: number }> = []
  for (const p of policies) {
    const v = surprise.get(p)
    if (!v || v.totalDays === 0) continue
    const surpAct = v.surprisingDays === 0 ? 0 : v.surprisingNonContinue / v.surprisingDays
    const routAct = v.routineDays === 0 ? 0 : v.routineNonContinue / v.routineDays
    const overall = (v.surprisingNonContinue + v.routineNonContinue) / v.totalDays
    shifts.push({ policy: p, shift: (surpAct - routAct) * 100, overallNonCont: overall })
  }
  /* Filter to policies with meaningful action variance: between 1% and 99%
   * non-continue overall. Then rank by absolute shift magnitude. */
  const meaningful = shifts.filter(s => s.overallNonCont > 0.01 && s.overallNonCont < 0.99)
  if (meaningful.length > 0) {
    meaningful.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))
    const top = meaningful[0]
    const direction = top.shift >= 0 ? 'more' : 'fewer'
    bullets.push(
      `**Surprise-driven decisions:** ${top.policy} shifts ${Math.abs(top.shift).toFixed(1)} pp ${direction} non-continue actions on surprising days. ` +
      `${top.shift < 0 ? '(Negative shift suggests supply pressure, not encounters, drives most decisions.)' : ''}`.trim(),
    )
  }

  /* 4. Recovery summary on the standard preset. */
  let totalWarned = 0, totalRecovered = 0
  for (const v of recovery.values()) {
    if (v.supplyPreset !== 'standard') continue
    totalWarned += v.warned
    totalRecovered += v.recovered
  }
  if (totalWarned > 0) {
    bullets.push(
      `**Standard-preset recovery:** ${pct(totalRecovered, totalWarned)} of warned traces recovered ` +
      `(${totalRecovered}/${totalWarned}). The rest either failed or arrived under sustained pressure.`,
    )
  }

  return bullets
}

/* ─── Main ─── */

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const csvPath = resolve(args.inDir, 'summary.csv')
  const jsonlPath = resolve(args.inDir, 'traces.jsonl')
  if (!existsSync(csvPath)) {
    process.stderr.write(`summary.csv not found at ${csvPath}\n`)
    process.stderr.write(`Run: npm run sim:batch -- --policy all  (or specify --in <dir>)\n`)
    process.exit(1)
  }
  if (!existsSync(jsonlPath)) {
    process.stderr.write(`traces.jsonl not found at ${jsonlPath}\n`)
    process.exit(1)
  }
  const { rows, header } = readCsv(csvPath)
  if (!header.includes('policy')) {
    process.stderr.write(`${csvPath} is the legacy-schema CSV (no 'policy' column).\n`)
    process.exit(1)
  }
  const traces = readTraces(jsonlPath)

  const policies = [...new Set(rows.filter(r => r.policy).map(r => r.policy))].sort()
  const modes = [...new Set(rows.map(r => r.mode))].sort()
  const presets = [...new Set(rows.map(r => r.supply_preset))].sort()

  const modeWorst = computeModeRegretWorst(rows, modes, args.topN)
  const pivotCells = computePivotRate(rows, policies, presets, modes, args.epsilon)
  const surprise = computeSurprise(traces)
  const recovery = computeRecovery(traces)
  const tldr = computeTLDR(modeWorst, pivotCells, surprise, recovery, policies)

  const sections: string[] = []
  sections.push(`# sim:fun report\n`)
  sections.push(`Generated: ${new Date().toISOString()}`)
  sections.push(`Input: \`${args.inDir}\` (${rows.length} CSV rows, ${traces.length} traces, ${policies.length} policies)\n`)
  sections.push('## TL;DR — Top tuning signals\n')
  sections.push(tldr.length === 0 ? '_(no signals — empty or degenerate input)_' : tldr.map(b => `- ${b}`).join('\n'))
  sections.push(sectionModeRegret(rows, modes, presets, args.topN))
  sections.push(sectionModeBreakdown(rows, modes, presets))
  sections.push(sectionPivotRate(rows, policies, presets, modes, args.epsilon))
  sections.push(sectionSurprise(traces, policies))
  sections.push(sectionRecovery(traces, policies, presets))

  const md = sections.join('\n\n') + '\n'
  const outDir = dirname(args.outPath)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(args.outPath, md, 'utf-8')
  process.stderr.write(`wrote ${args.outPath}\n`)
}

/* Gate auto-run so tests can import this module without invoking main(). */
if (!process.env.VITEST) main()
