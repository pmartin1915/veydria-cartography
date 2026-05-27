/**
 * sim-regret-model.test.ts — Unit tests for the OLS implementation +
 * feature extraction + per-mode reconstruction.
 *
 * No fs I/O. Synthetic data exercises every helper.
 */

import { describe, it, expect } from 'vitest'
import {
  extractFeatures,
  ols,
  fitStandardized,
  predictRaw,
  reconstructCellRegret,
  cellRegretR2,
  buildReport,
} from './sim-regret-model'
import type { Row } from './report-utils'

function row(over: Partial<Row>): Row {
  return {
    from: 'a', to: 'b', season: 'spring', mode: 'direct', policy: 'naive',
    party_preset: 'standard', supply_preset: 'caravan',
    route_found: 'true', completed: 'false', finished_reason: 'water-out',
    total_km: '1000', estimated_days: '10', days_count: '10',
    encounters_total: '2',
    civ_stops_on_route: '3', resupply_stops_on_route: '5', max_resupply_gap_km: '500',
    error: '',
    ...over,
  }
}

describe('extractFeatures', () => {
  it('returns 7-element vector for a healthy row', () => {
    const f = extractFeatures(row({
      total_km: '1000', encounters_total: '2',
      civ_stops_on_route: '3', max_resupply_gap_km: '500',
      resupply_fires_full_count: '2', resupply_fires_water_count: '4',
    }))
    expect(f).not.toBeNull()
    /* density = 2/1000*100 = 0.2; gap/km = 0.5 < 0.95 → endpoints flag 0 */
    expect(f).toEqual([1000, 0.2, 3, 500, 0, 2, 4])
  })

  it('returns null when route_found=false', () => {
    expect(extractFeatures(row({ route_found: 'false' }))).toBeNull()
  })

  it('returns null on zero or non-finite total_km', () => {
    expect(extractFeatures(row({ total_km: '0' }))).toBeNull()
    expect(extractFeatures(row({ total_km: '' }))).toBeNull()
  })

  it('endpoints_only_flag boundary at 0.95', () => {
    const justBelow = extractFeatures(row({ total_km: '1000', max_resupply_gap_km: '949' }))
    const atBoundary = extractFeatures(row({ total_km: '1000', max_resupply_gap_km: '950' }))
    const above = extractFeatures(row({ total_km: '1000', max_resupply_gap_km: '1000' }))
    expect(justBelow![4]).toBe(0)
    expect(atBoundary![4]).toBe(1)
    expect(above![4]).toBe(1)
  })

  it('defaults resupply_fires_* columns to 0 when missing (back-compat with pre-Phase-4 CSVs)', () => {
    /* Row omits the two new columns. The base row() helper sets them via the
     * spread but here we override-with-undefined to simulate an older CSV. */
    const r = row({})
    delete (r as Partial<Row>).resupply_fires_full_count
    delete (r as Partial<Row>).resupply_fires_water_count
    const f = extractFeatures(r)
    expect(f).not.toBeNull()
    expect(f!.length).toBe(7)
    expect(f![5]).toBe(0)
    expect(f![6]).toBe(0)
  })
})

describe('ols', () => {
  it('recovers known coefficients on noise-free data', () => {
    /* y = 1 + 2x1 - 0.5x2 (intercept-included design matrix) */
    const X = [
      [1, 1, 2],
      [1, 2, 1],
      [1, 3, 4],
      [1, 4, 3],
      [1, 5, 5],
    ]
    const y = X.map(r => 1 * r[0] + 2 * r[1] - 0.5 * r[2])
    const beta = ols(X, y)
    expect(beta[0]).toBeCloseTo(1, 6)
    expect(beta[1]).toBeCloseTo(2, 6)
    expect(beta[2]).toBeCloseTo(-0.5, 6)
  })

  it('throws on singular (collinear) design matrix', () => {
    const X = [
      [1, 1, 2],
      [1, 2, 4],
      [1, 3, 6],  /* x2 = 2*x1 */
    ]
    const y = [1, 2, 3]
    expect(() => ols(X, y)).toThrow(/singular/)
  })
})

describe('fitStandardized', () => {
  it('R² = 1.0 on perfect linear data', () => {
    /* y = 2 + x1 + x2 (perfect linear in raw features). 20 points. */
    const rows: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 20; i++) {
      const x1 = i
      const x2 = i * 0.5 + (i % 3)
      rows.push([x1, x2, 0, 0, 0])  /* pad to 5 features; constants will collapse to z=0 */
      y.push(2 + x1 + x2)
    }
    const fit = fitStandardized(rows, y)
    expect(fit.r2).toBeCloseTo(1, 4)
  })

  it('R² ≈ 0 on pure noise Y', () => {
    /* Deterministic pseudo-random — splitmix to keep tests reproducible. */
    let s = 0xc0ffee
    const rand = (): number => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = ((z ^ (z >>> 16)) * 0x85ebca6b) >>> 0
      z = ((z ^ (z >>> 13)) * 0xc2b2ae35) >>> 0
      return ((z ^ (z >>> 16)) >>> 0) / 0x100000000
    }
    const rows: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 500; i++) {
      rows.push([rand(), rand(), rand(), rand(), rand()])
      y.push(rand())
    }
    const fit = fitStandardized(rows, y)
    /* With 5 features and 500 rows of independent noise, R² should be
     * near zero — bound loose enough to never flake. */
    expect(Math.abs(fit.r2)).toBeLessThan(0.05)
  })

  it('predictRaw round-trips a fitted point', () => {
    /* y = 1 + 2*x1 perfectly. predict on a training point → exact y. */
    const rows: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 30; i++) {
      const x1 = i + 1
      rows.push([x1, i % 5, 0, 0, 0])
      y.push(1 + 2 * x1)
    }
    const fit = fitStandardized(rows, y)
    const yhat = predictRaw(rows[10], fit)
    expect(yhat).toBeCloseTo(y[10], 4)
  })
})

describe('reconstructCellRegret + cellRegretR2', () => {
  it('produces positive predicted regret when fast-mode rows have favourable features', () => {
    /* Synthetic 2 cells × 2 modes × 10 rows per (cell,mode) with within-bucket
     * jitter so features have actual variance (real CSV data does). */
    const jit = (i: number, base: number, spread: number): number =>
      base + ((i * 17) % spread) - spread / 2
    const mkRow = (cell: string, mode: string, idx: number, good: boolean, completed: boolean): Row => row({
      from: cell, to: 'z', season: 'spring', mode,
      total_km: String(jit(idx, good ? 800 : 1100, 100)),
      encounters_total: String(jit(idx, good ? 2 : 6, 4)),
      civ_stops_on_route: String(jit(idx, good ? 4 : 1, 4)),
      max_resupply_gap_km: String(jit(idx, good ? 300 : 950, 200)),
      completed: completed ? 'true' : 'false',
    })
    const rows: Row[] = []
    for (let i = 0; i < 10; i++) {
      rows.push(mkRow('A', 'fastest', i, true, i % 4 !== 0))
      rows.push(mkRow('A', 'direct', i, false, i % 5 === 0))
      rows.push(mkRow('B', 'fastest', i, true, i % 4 !== 0))
      rows.push(mkRow('B', 'direct', i, false, i % 5 === 0))
    }
    const feats: number[][] = []
    const y: number[] = []
    for (const r of rows) {
      const f = extractFeatures(r)
      if (!f) continue
      feats.push(f)
      y.push(r.completed === 'true' ? 1 : 0)
    }
    const fit = fitStandardized(feats, y)
    const cells = reconstructCellRegret(rows, ['direct', 'fastest'], fit)
    expect(cells.length).toBe(2)
    for (const c of cells) {
      /* Both modes' actual completion rates differ in the same way; predicted
       * should also show fastest > direct (positive regret). */
      expect(c.bestModeActual).toBe('fastest')
      expect(c.predictedRegretPp).toBeGreaterThan(0)
    }
  })

  it('skips cells with fewer than 2 modes', () => {
    const targetCellRows: Row[] = [
      row({ from: 'X', mode: 'direct', completed: 'true' }),
      row({ from: 'X', mode: 'direct', completed: 'false' }),
    ]
    /* Pad with varied synthetic rows for a different from-key so we can fit. */
    const jit = (i: number, base: number, spread: number): number =>
      base + ((i * 17) % spread) - spread / 2
    const feats: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 40; i++) {
      feats.push([jit(i, 1000, 200), jit(i, 0.3, 0.4), jit(i, 3, 4), jit(i, 400, 300), i % 6 === 0 ? 1 : 0])
      y.push(i % 2)
    }
    const fit = fitStandardized(feats, y)
    const cells = reconstructCellRegret(targetCellRows, ['direct', 'fastest'], fit)
    expect(cells.length).toBe(0)
  })
})

describe('buildReport', () => {
  it('returns no-data placeholder on empty rows', () => {
    expect(buildReport([])).toMatch(/no usable rows/)
  })

  it('produces a report with verdict when given enough rows', () => {
    /* 100 caravan rows × 2 modes. Add within-mode jitter so features aren't
     * perfectly collinear (real summary.csv data has this naturally). */
    const rows: Row[] = []
    const j = (i: number, base: number, spread: number): string =>
      String(base + ((i * 7) % spread) - spread / 2)
    for (let i = 0; i < 50; i++) {
      rows.push(row({
        from: `c${i % 10}`, mode: 'fastest', completed: i % 4 !== 0 ? 'true' : 'false',
        total_km: j(i, 800, 100),
        encounters_total: j(i, 2, 4),
        civ_stops_on_route: j(i, 4, 4),
        max_resupply_gap_km: j(i, 350, 200),
      }))
      rows.push(row({
        from: `c${i % 10}`, mode: 'direct', completed: i % 5 === 0 ? 'true' : 'false',
        total_km: j(i, 1100, 100),
        encounters_total: j(i, 6, 4),
        civ_stops_on_route: j(i, 2, 4),
        max_resupply_gap_km: j(i, 950, 200),
      }))
    }
    const md = buildReport(rows)
    expect(md).toMatch(/Headline: caravan preset/)
    expect(md).toMatch(/## Verdict/)
    expect(md).toMatch(/(CONFIRMED|PARTIAL|REJECTED)/)
  })

  it('only fits caravan rows in the headline when other presets present', () => {
    const rows: Row[] = []
    const j = (i: number, base: number, spread: number): string =>
      String(base + ((i * 7) % spread) - spread / 2)
    for (let i = 0; i < 60; i++) {
      rows.push(row({
        from: `c${i % 6}`, mode: 'fastest', supply_preset: 'caravan',
        completed: i % 3 !== 0 ? 'true' : 'false',
        total_km: j(i, 1000, 100),
        encounters_total: j(i, 2, 4),
        civ_stops_on_route: j(i, 4, 4),
        max_resupply_gap_km: j(i, 350, 200),
      }))
      rows.push(row({
        from: `c${i % 6}`, mode: 'direct', supply_preset: 'caravan',
        completed: i % 4 === 0 ? 'true' : 'false',
        total_km: j(i, 1200, 100),
        encounters_total: j(i, 6, 4),
        civ_stops_on_route: j(i, 2, 4),
        max_resupply_gap_km: j(i, 1100, 200),
      }))
      rows.push(row({
        from: `c${i % 6}`, mode: 'fastest', supply_preset: 'tight',
        completed: 'false',
        total_km: j(i, 1000, 100),
        encounters_total: j(i, 2, 4),
        civ_stops_on_route: j(i, 4, 4),
        max_resupply_gap_km: j(i, 350, 200),
      }))
    }
    const md = buildReport(rows)
    /* Headline is caravan; tight gets its own section. */
    expect(md).toMatch(/Headline: caravan preset/)
    expect(md).toMatch(/## tight preset/)
  })
})
