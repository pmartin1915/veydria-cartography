/**
 * sim-regret-model.ts — Linear-model regret analysis on existing summary.csv.
 *
 * Tests the predecessor's "combination of small effects" theory: four static
 * route-geometry probes (segment count / encounter density / civ_stops_on_route
 * / max_resupply_gap_km) have all come back direction-correct but
 * magnitude-modest individually. If the combination of those features
 * predicts cell-level regret pp well (high cell-regret R²), the static-
 * geometry story closes and no new column is needed. If R² is low, the next
 * data-justified probe is dynamic (resupply_fires_count).
 *
 * Model:
 *   y = completed (0/1)    — row-level linear probability model
 *   X = [total_km, encounter_density_per_100km, civ_stops_on_route,
 *        max_resupply_gap_km, endpoints_only_flag]
 *   Closed-form OLS via normal equations + Gauss-Jordan invert. Features
 *   z-standardized so coefficients are comparable across scales.
 *
 * Headline: caravan preset (where the regret signal lives). Sanity pass
 * across all presets included.
 *
 * Per-mode reconstruction (the actual hypothesis test):
 *   For each (from, to, season, supply_preset=caravan) cell, predict each
 *   mode's completion rate from its mean feature vector. Cell predicted
 *   regret pp = max_mode_pred − min_mode_pred. Compare against actual
 *   regret pp computed the same way as sim-fun-report.ts's
 *   computeModeRegretWorst (best_rate − worst_rate × 100). Report R² of
 *   predicted-vs-actual regret pp across cells.
 *
 * Usage:
 *   cd web
 *   npm run sim:regret-model
 *   npm run sim:regret-model -- --in ../output/sim --out ../output/sim/sim-regret-model.md
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

import { readCsv, table, type Row } from './report-utils'

/* ─── CLI args ─── */

interface CliArgs {
  inDir: string
  outPath: string
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
  return {
    inDir: resolveRepoRel(get('in') ?? 'output/sim'),
    outPath: resolveRepoRel(get('out') ?? 'output/sim/sim-regret-model.md'),
  }
}

/* ─── Feature extraction ─── */

export const FEATURE_NAMES = [
  'total_km',
  'enc_density_per_100km',
  'civ_stops_on_route',
  'max_resupply_gap_km',
  'endpoints_only_flag',
] as const
export type FeatureName = typeof FEATURE_NAMES[number]

/** Returns the 5 features for a row, or null if the row is unusable
 *  (no route, or missing/zero total_km — encounter density would divide by zero). */
export function extractFeatures(r: Row): number[] | null {
  if (r.route_found !== 'true') return null
  const totalKm = Number(r.total_km)
  if (!Number.isFinite(totalKm) || totalKm <= 0) return null
  const civStops = Number(r.civ_stops_on_route)
  const maxGap = Number(r.max_resupply_gap_km)
  const encounters = Number(r.encounters_total)
  if (!Number.isFinite(civStops) || !Number.isFinite(maxGap) || !Number.isFinite(encounters)) return null
  const density = (encounters / totalKm) * 100
  const endpointsOnly = maxGap / totalKm >= 0.95 ? 1 : 0
  return [totalKm, density, civStops, maxGap, endpointsOnly]
}

/* ─── OLS via normal equations ─── */

/** Solve XᵀXβ = Xᵀy for β. X includes an intercept column at index 0.
 *  Returns coefficients in the same ordering. Throws if normal-equation
 *  matrix is singular (collinear features). */
export function ols(X: number[][], y: number[]): number[] {
  const n = X.length
  if (n === 0) throw new Error('ols: empty design matrix')
  const p = X[0].length
  /* XᵀX (p×p) */
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  for (let i = 0; i < n; i++) {
    const xi = X[i]
    for (let j = 0; j < p; j++) {
      const xij = xi[j]
      for (let k = 0; k < p; k++) XtX[j][k] += xij * xi[k]
    }
  }
  /* Xᵀy (p) */
  const Xty = new Array<number>(p).fill(0)
  for (let i = 0; i < n; i++) {
    const yi = y[i]
    for (let j = 0; j < p; j++) Xty[j] += X[i][j] * yi
  }
  /* Solve via Gauss-Jordan on augmented [XtX | Xty]. */
  const A: number[][] = []
  for (let i = 0; i < p; i++) A.push([...XtX[i], Xty[i]])
  for (let col = 0; col < p; col++) {
    /* Pivot: largest |A[row][col]| in rows ≥ col. */
    let pivot = col
    let pivotAbs = Math.abs(A[col][col])
    for (let row = col + 1; row < p; row++) {
      const a = Math.abs(A[row][col])
      if (a > pivotAbs) { pivot = row; pivotAbs = a }
    }
    if (pivotAbs < 1e-9) throw new Error(`ols: singular matrix at column ${col} (collinear features?)`)
    if (pivot !== col) { const tmp = A[col]; A[col] = A[pivot]; A[pivot] = tmp }
    const piv = A[col][col]
    for (let k = col; k <= p; k++) A[col][k] /= piv
    for (let row = 0; row < p; row++) {
      if (row === col) continue
      const f = A[row][col]
      if (f === 0) continue
      for (let k = col; k <= p; k++) A[row][k] -= f * A[col][k]
    }
  }
  return A.map(r => r[p])
}

export interface FitResult {
  /** Coefficients in standardized feature space, intercept at index 0. */
  betaStd: number[]
  /** R² on the training data. */
  r2: number
  /** Residual SD (sqrt of mean squared residual). */
  residSd: number
  /** Per-feature mean (used to back-transform). */
  featureMean: number[]
  /** Per-feature SD (used to back-transform). */
  featureSd: number[]
  /** Mean of y (training set). */
  yMean: number
  /** Number of rows used. */
  n: number
}

/** Fit OLS on raw features after z-standardizing. Adds intercept.
 *  Features with near-zero variance are dropped from the solve (β set to 0)
 *  to avoid a singular normal-equation matrix. */
export function fitStandardized(rows: number[][], y: number[]): FitResult {
  const n = rows.length
  if (n === 0) throw new Error('fitStandardized: empty input')
  const p = rows[0].length
  const featureMean = new Array<number>(p).fill(0)
  const featureSd = new Array<number>(p).fill(0)
  for (let j = 0; j < p; j++) {
    let s = 0
    for (let i = 0; i < n; i++) s += rows[i][j]
    featureMean[j] = s / n
  }
  /* Live features = those with non-zero variance; constants get β=0. */
  const liveIdx: number[] = []
  for (let j = 0; j < p; j++) {
    let ss = 0
    for (let i = 0; i < n; i++) { const d = rows[i][j] - featureMean[j]; ss += d * d }
    const sd = Math.sqrt(ss / n)
    featureSd[j] = sd
    if (sd > 1e-9) liveIdx.push(j)
  }
  if (n <= liveIdx.length + 1) {
    throw new Error(`fitStandardized: too few rows (${n}) for ${liveIdx.length} live features`)
  }
  /* Standardized design matrix with intercept, only live columns. */
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    const xi: number[] = [1]
    for (const j of liveIdx) xi.push((r[j] - featureMean[j]) / featureSd[j])
    X.push(xi)
  }
  const betaLive = ols(X, y)
  /* Expand back to full p+1 ordering (intercept + p features); constants → 0. */
  const betaStd = new Array<number>(p + 1).fill(0)
  betaStd[0] = betaLive[0]
  for (let k = 0; k < liveIdx.length; k++) betaStd[liveIdx[k] + 1] = betaLive[k + 1]
  /* R² */
  let yMean = 0
  for (let i = 0; i < n; i++) yMean += y[i]
  yMean /= n
  let ssTot = 0, ssRes = 0
  for (let i = 0; i < n; i++) {
    let yhat = betaLive[0]
    for (let k = 0; k < liveIdx.length; k++) yhat += X[i][k + 1] * betaLive[k + 1]
    const r = y[i] - yhat
    ssRes += r * r
    const dt = y[i] - yMean
    ssTot += dt * dt
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
  const residSd = Math.sqrt(ssRes / n)
  return { betaStd, r2, residSd, featureMean, featureSd, yMean, n }
}

/** Predict y for a raw (unstandardized) feature row. */
export function predictRaw(rawX: number[], fit: FitResult): number {
  let s = fit.betaStd[0]  /* intercept */
  for (let j = 0; j < rawX.length; j++) {
    /* Skip features that had zero variance during fit — their β is 0. */
    if (fit.featureSd[j] <= 1e-9) continue
    const zj = (rawX[j] - fit.featureMean[j]) / fit.featureSd[j]
    s += fit.betaStd[j + 1] * zj
  }
  return s
}

/* ─── Per-mode reconstruction (the hypothesis test) ─── */

interface CellModeStats {
  features: number[]  /* mean feature vector for this (cell, mode) bucket */
  actualRate: number  /* completion rate in this bucket */
  n: number
}

export interface CellRegret {
  cellKey: string  /* from|to|season */
  predictedRegretPp: number
  actualRegretPp: number
  bestModeActual: string
  worstModeActual: string
}

/** For each (from, to, season) cell (caravan preset only): compute per-mode
 *  mean features + actual completion rate. Then predict completion rate per
 *  mode via `fit`, derive predicted vs actual regret pp, and return per-cell
 *  pairs.
 *
 *  `rows` should already be filtered to caravan preset (or whatever cohort
 *  the fit was on); each row's features come from `extractFeatures(row)`. */
export function reconstructCellRegret(
  rows: Row[],
  modes: string[],
  fit: FitResult,
): CellRegret[] {
  /* Bucket: from|to|season → mode → {sumFeatures, completedCount, total} */
  const byCell = new Map<string, Map<string, { sum: number[]; completed: number; total: number }>>()
  for (const r of rows) {
    const feats = extractFeatures(r)
    if (!feats) continue
    const cellKey = `${r.from}|${r.to}|${r.season}`
    let cell = byCell.get(cellKey)
    if (!cell) { cell = new Map(); byCell.set(cellKey, cell) }
    let bucket = cell.get(r.mode)
    if (!bucket) {
      bucket = { sum: new Array<number>(feats.length).fill(0), completed: 0, total: 0 }
      cell.set(r.mode, bucket)
    }
    for (let j = 0; j < feats.length; j++) bucket.sum[j] += feats[j]
    bucket.total++
    if (r.completed === 'true') bucket.completed++
  }
  const out: CellRegret[] = []
  for (const [cellKey, cell] of byCell.entries()) {
    const perMode: CellModeStats[] = []
    const modesPresent: string[] = []
    for (const mode of modes) {
      const b = cell.get(mode)
      if (!b || b.total === 0) continue
      const meanFeats = b.sum.map(v => v / b.total)
      perMode.push({ features: meanFeats, actualRate: b.completed / b.total, n: b.total })
      modesPresent.push(mode)
    }
    if (perMode.length < 2) continue  /* need at least 2 modes for regret */
    let predBest = -Infinity, predWorst = Infinity
    let actBest = -Infinity, actWorst = Infinity
    let bestModeAct = modesPresent[0], worstModeAct = modesPresent[0]
    for (let i = 0; i < perMode.length; i++) {
      const pred = predictRaw(perMode[i].features, fit)
      if (pred > predBest) predBest = pred
      if (pred < predWorst) predWorst = pred
      const a = perMode[i].actualRate
      if (a > actBest) { actBest = a; bestModeAct = modesPresent[i] }
      if (a < actWorst) { actWorst = a; worstModeAct = modesPresent[i] }
    }
    out.push({
      cellKey,
      predictedRegretPp: (predBest - predWorst) * 100,
      actualRegretPp: (actBest - actWorst) * 100,
      bestModeActual: bestModeAct,
      worstModeActual: worstModeAct,
    })
  }
  return out
}

/** R² of predicted vs actual regret pp across cells (no intercept, simple
 *  one-variable agreement). Returns 0 if degenerate. */
export function cellRegretR2(cells: CellRegret[]): number {
  if (cells.length === 0) return 0
  let actMean = 0
  for (const c of cells) actMean += c.actualRegretPp
  actMean /= cells.length
  let ssTot = 0, ssRes = 0
  for (const c of cells) {
    const dt = c.actualRegretPp - actMean
    ssTot += dt * dt
    const r = c.actualRegretPp - c.predictedRegretPp
    ssRes += r * r
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot
}

/* ─── Report rendering ─── */

function formatBeta(name: string, betaStd: number, sdFeature: number, sdY: number): string {
  /* Standardized β is unitless; "contribution per 1 sd" = betaStd; back-
   * transformed β = betaStd / sdFeature × sdY would give a raw coefficient.
   * We report the standardized β directly. */
  void sdFeature; void sdY
  return betaStd.toFixed(4)
}

interface PresetFit {
  preset: string
  n: number
  fit: FitResult
  cellRegret: CellRegret[]
  cellRegretR2: number
}

function fitForPreset(rows: Row[], preset: string, modes: string[]): PresetFit | null {
  const filtered = rows.filter(r => r.supply_preset === preset)
  const feats: number[][] = []
  const y: number[] = []
  const usableRows: Row[] = []
  for (const r of filtered) {
    const f = extractFeatures(r)
    if (!f) continue
    feats.push(f)
    y.push(r.completed === 'true' ? 1 : 0)
    usableRows.push(r)
  }
  if (feats.length < 50) return null
  const fit = fitStandardized(feats, y)
  const cellRegret = reconstructCellRegret(usableRows, modes, fit)
  return { preset, n: feats.length, fit, cellRegret, cellRegretR2: cellRegretR2(cellRegret) }
}

function renderPresetSection(pf: PresetFit, isHeadline: boolean): string {
  const heading = isHeadline ? `## Headline: ${pf.preset} preset` : `## ${pf.preset} preset`
  const fit = pf.fit
  const betaRows = FEATURE_NAMES.map((name, j) => [
    name,
    formatBeta(name, fit.betaStd[j + 1], fit.featureSd[j], 0),
    fit.featureMean[j].toFixed(2),
    fit.featureSd[j].toFixed(2),
  ])
  betaRows.unshift(['(intercept)', fit.betaStd[0].toFixed(4), '–', '–'])
  const sortedCells = [...pf.cellRegret].sort((a, b) => b.actualRegretPp - a.actualRegretPp)
  const topRows = sortedCells.slice(0, 10).map(c => {
    const [from, to, season] = c.cellKey.split('|')
    return [
      `${from} → ${to}`,
      season,
      c.actualRegretPp.toFixed(1),
      c.predictedRegretPp.toFixed(1),
      (c.actualRegretPp - c.predictedRegretPp).toFixed(1),
      `${c.bestModeActual} / ${c.worstModeActual}`,
    ]
  })
  /* Residual diagnostics: actual mean, predicted mean, mean residual. */
  const cells = pf.cellRegret
  let aSum = 0, pSum = 0
  for (const c of cells) { aSum += c.actualRegretPp; pSum += c.predictedRegretPp }
  const actMean = cells.length === 0 ? 0 : aSum / cells.length
  const predMean = cells.length === 0 ? 0 : pSum / cells.length
  return [
    heading,
    '',
    `- Rows used (route_found + total_km > 0): **${pf.n}**`,
    `- Row-level R²: **${fit.r2.toFixed(3)}**  (linear probability model on completed ∈ {0,1})`,
    `- Residual SD: ${fit.residSd.toFixed(3)}`,
    `- Cells with ≥2 modes: **${pf.cellRegret.length}**`,
    `- Mean actual regret pp: ${actMean.toFixed(2)} · Mean predicted regret pp: ${predMean.toFixed(2)}`,
    `- **Cell-level regret R² (predicted vs actual): ${pf.cellRegretR2.toFixed(3)}**`,
    '',
    '### Standardized β (per-1-sd contribution to completed probability)',
    '',
    table(['feature', 'β_std', 'mean', 'sd'], betaRows),
    '',
    '### Top-10 cells by actual regret pp',
    '',
    table(
      ['cell', 'season', 'actual pp', 'predicted pp', 'residual pp', 'best/worst mode'],
      topRows,
    ),
  ].join('\n')
}

function renderVerdict(headline: PresetFit): string {
  const r2 = headline.cellRegretR2
  let verdict: string
  let next: string
  if (r2 >= 0.6) {
    verdict = `**CONFIRMED — combination of small effects explains direct's regret amplification.**`
    next = `Static-route-geometry story closes at four probes. No new column needed. Next probes shift away from "what route feature differs across modes" toward decision-time interactions (encounter-aware policies, mode-choice UX).`
  } else if (r2 >= 0.3) {
    verdict = `**PARTIAL — combination explains some, not most, of cell regret variance.**`
    next = `Worth the dynamic resupply_fires_count probe: it separates "stop exists geometrically" from "restore branch actually fired" and may carry the missing variance. If that probe also lands < 0.6, the answer is truly multivariate dynamic and a different framing is needed.`
  } else {
    verdict = `**REJECTED — combination of static features does NOT explain regret.**`
    next = `Static-geometry budget is fully spent. Next probe must be dynamic: resupply_fires_count is the predecessor's option 1. Thread resupplyTier through SupplyDay → Trace.days[]; touches web/src/utils/journey-supply.ts.`
  }
  return [
    '## Verdict',
    '',
    verdict,
    '',
    `Headline cell-level regret R² (${headline.preset} preset): **${r2.toFixed(3)}**`,
    '',
    next,
  ].join('\n')
}

/* ─── Main ─── */

export function buildReport(rows: Row[]): string {
  const modes = [...new Set(rows.map(r => r.mode))].sort()
  const presets = [...new Set(rows.map(r => r.supply_preset))].sort()
  const presetFits = new Map<string, PresetFit>()
  for (const p of presets) {
    const pf = fitForPreset(rows, p, modes)
    if (pf) presetFits.set(p, pf)
  }
  /* Headline = caravan if present; else first preset with data. */
  const headline = presetFits.get('caravan') ?? [...presetFits.values()][0]
  if (!headline) return '# sim:regret-model\n\n_(no usable rows)_\n'

  const sections: string[] = []
  sections.push(`# sim:regret-model`)
  sections.push(`Generated: ${new Date().toISOString()}`)
  sections.push(`Total rows: ${rows.length} · Presets fitted: ${[...presetFits.keys()].join(', ')}`)
  sections.push('')
  sections.push(`Tests the predecessor's "combination of small effects" theory on direct mode's regret amplification: do total_km, encounter density, civ_stops_on_route, max_resupply_gap_km, and endpoints_only_flag jointly predict cell-level regret pp on caravan rows?`)
  sections.push('')
  sections.push(renderPresetSection(headline, true))
  for (const [name, pf] of presetFits) {
    if (name === headline.preset) continue
    sections.push('')
    sections.push(renderPresetSection(pf, false))
  }
  sections.push('')
  sections.push(renderVerdict(headline))
  return sections.join('\n') + '\n'
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const csvPath = resolve(args.inDir, 'summary.csv')
  if (!existsSync(csvPath)) {
    process.stderr.write(`summary.csv not found at ${csvPath}\n`)
    process.stderr.write(`Run: npm run sim:batch -- --policy all  (or specify --in <dir>)\n`)
    process.exit(1)
  }
  const { rows, header } = readCsv(csvPath)
  if (!header.includes('civ_stops_on_route') || !header.includes('max_resupply_gap_km')) {
    process.stderr.write(`${csvPath} predates the geometry columns (commit 4b5786b / 314635d). Re-run sim:batch.\n`)
    process.exit(1)
  }
  const md = buildReport(rows)
  const outDir = dirname(args.outPath)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(args.outPath, md, 'utf-8')
  process.stderr.write(`wrote ${args.outPath}\n`)
  /* Also echo verdict line to stderr so the answer is visible without
   * opening the file. */
  const m = md.match(/^\*\*(CONFIRMED|PARTIAL|REJECTED)[^\n]*\*\*/m)
  if (m) process.stderr.write(m[0] + '\n')
}

if (!process.env.VITEST) main()
