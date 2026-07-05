/**
 * session-prep.ts — Persistent session-prep ordering and done-state for starred features.
 *
 * Prep order is stored under `veydria.prepOrder.v1`.
 * Done-state IDs are stored under `veydria.prepDone.v1`.
 */

import { kvStore } from '../persistence/kv-store'
import { saveTextFile, type FileExportResult } from '../persistence/file-export'

const ORDER_KEY = 'veydria.prepOrder.v1'
const DONE_KEY = 'veydria.prepDone.v1'
const ACTIVE_KEY = 'veydria.sessionActive.v1'

function readOrder(): string[] {
  try {
    const raw = kvStore.getString(ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed
    }
  } catch {
    // ignore
  }
  return []
}

function writeOrder(ids: string[]): void {
  kvStore.setString(ORDER_KEY, JSON.stringify(ids))
}

function readDone(): string[] {
  try {
    const raw = kvStore.getString(DONE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed
    }
  } catch {
    // ignore
  }
  return []
}

function writeDone(ids: string[]): void {
  kvStore.setString(DONE_KEY, JSON.stringify(ids))
}

export function getPrepOrder(): string[] {
  return readOrder()
}

export function setPrepOrder(ids: string[]): void {
  writeOrder(ids)
}

export function movePrepItem(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= ids.length) return ids
  if (toIndex < 0 || toIndex >= ids.length) return ids
  const next = [...ids]
  const [removed] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, removed)
  writeOrder(next)
  return next
}

export function getPrepDoneIds(): string[] {
  return readDone()
}

/**
 * Replace the done-state list while preserving invariants: strings only,
 * dedupe keeping first occurrence (order preserved). No cap by design.
 */
export function setPrepDoneIds(ids: string[]): void {
  const seen = new Set<string>()
  const filtered: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue
    seen.add(id)
    filtered.push(id)
  }
  writeDone(filtered)
}

export function togglePrepDone(featureId: string): boolean {
  const ids = readDone()
  const idx = ids.indexOf(featureId)
  if (idx >= 0) {
    ids.splice(idx, 1)
    writeDone(ids)
    return false
  }
  ids.push(featureId)
  writeDone(ids)
  return true
}

export function clearPrepDone(): void {
  kvStore.remove(DONE_KEY)
}

/**
 * Keep prep order in sync with the starred list.
 * - Removes any prep-order items that are no longer starred.
 * - Appends newly-starred items to the end.
 */
export function syncPrepOrder(starredIds: string[]): string[] {
  const current = readOrder()
  const filtered = current.filter((id) => starredIds.includes(id))
  const existing = new Set(filtered)
  for (const id of starredIds) {
    if (!existing.has(id)) {
      filtered.push(id)
      existing.add(id)
    }
  }
  writeOrder(filtered)
  return filtered
}

/**
 * Keep done-state in sync with the starred list.
 * - Removes any done items that are no longer starred.
 */
export function syncPrepDone(starredIds: string[]): string[] {
  const current = readDone()
  const filtered = current.filter((id) => starredIds.includes(id))
  writeDone(filtered)
  return filtered
}

export interface PrepItem {
  id: string
  name: string
  category: string
  done: boolean
  note?: string
  hookTags?: string[]
}

export interface HexPrepNote {
  label: string
  body: string
}

export interface HexPrepItem {
  hexLabel: string
  notes: HexPrepNote[]
}

function baseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.href.split('#')[0]
  }
  return 'https://veydria.com'
}

/**
 * Export the session prep list as a markdown checklist.
 */
export function exportPrepMarkdown(items: PrepItem[], hexItems: HexPrepItem[] = []): string {
  if (items.length === 0 && hexItems.length === 0) return ''

  let md = `# Veydria Session Prep\n\n`
  md += `*Generated on ${new Date().toLocaleDateString()} from [Veydria Cartography](${baseUrl()})*\n\n`

  if (items.length > 0) {
    const remaining = items.filter((i) => !i.done).length
    md += `## Prep List (${remaining} / ${items.length} remaining)\n\n`

    for (const item of items) {
      const check = item.done ? 'x' : ' '
      const cat = item.category.replace(/_/g, ' ')
      md += `- [${check}] **${item.name}** (${cat})\n`
      if (item.note) {
        md += `  - *Note:* ${item.note}\n`
      }
      if (item.hookTags && item.hookTags.length > 0) {
        md += `  - *Hooks:* ${item.hookTags.join(', ')}\n`
      }
    }
  }

  if (hexItems.length > 0) {
    md += `\n## Hex Notes\n\n`
    for (const hi of hexItems) {
      md += `### ${hi.hexLabel}\n\n`
      for (const n of hi.notes) {
        md += `- **${n.label}**\n`
        if (n.body) {
          md += `  ${n.body}\n`
        }
      }
      md += `\n`
    }
  }

  md += `---\n\n*Exported from Veydria Cartography*\n`
  return md
}

/**
 * Check whether a session is currently active.
 */
export function isSessionActive(): boolean {
  try {
    return kvStore.getString(ACTIVE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSessionActive(active: boolean): void {
  try {
    if (active) {
      kvStore.setString(ACTIVE_KEY, '1')
    } else {
      kvStore.remove(ACTIVE_KEY)
    }
  } catch {
    // ignore
  }
}

export function downloadPrepList(
  items: PrepItem[],
  hexItems: HexPrepItem[] = [],
): Promise<FileExportResult> | void {
  const md = exportPrepMarkdown(items, hexItems)
  if (!md) return
  const date = new Date().toISOString().slice(0, 10)
  return saveTextFile(`veydria-session-prep-${date}.md`, md, 'text/markdown', {
    name: 'Markdown',
    extensions: ['md'],
  })
}
