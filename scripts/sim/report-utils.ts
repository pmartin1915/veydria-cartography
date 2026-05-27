/**
 * report-utils.ts — Shared helpers for sim-*-report.ts CLIs.
 *
 * Pure utilities: CSV parsing, markdown table rendering, percent formatting,
 * grouped completion counting. No fs I/O beyond what readCsv needs.
 */

import { readFileSync } from 'node:fs'

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

export function readCsv(path: string): { rows: Row[]; header: string[] } {
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

/* ─── Formatting + aggregation ─── */

export function pct(num: number, denom: number): string {
  if (denom === 0) return '–'
  return `${((num / denom) * 100).toFixed(1)}%`
}

export function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---').join(' | ')
  return `| ${headers.join(' | ')} |\n| ${sep} |\n${rows.map(r => `| ${r.join(' | ')} |`).join('\n')}\n`
}

export function completionByGroup(rows: Row[], groupFn: (r: Row) => string): Map<string, { total: number; completed: number }> {
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
