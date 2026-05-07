import { describe, it, expect } from 'vitest'
import { generateEncounters, encounterTypeIcon, encounterSeverityLabel } from './encounters'
import type { JourneyRoute } from './journey-graph'

function fakeRoute(): JourneyRoute {
  return {
    nodes: [
      { id: 'a', name: 'A', category: 'port', x: 0, y: 0 },
      { id: 'b', name: 'B', category: 'civilization', x: 100, y: 0 },
      { id: 'c', name: 'C', category: 'oasis', x: 200, y: 0 },
    ],
    edges: [
      { from: 'a', to: 'b', distanceSvg: 100, type: 'trade_route', name: 'AB', segmentDays: 2 },
      { from: 'b', to: 'c', distanceSvg: 100, type: 'chokepoint', name: 'BC', segmentDays: 3 },
    ],
    totalDistanceSvg: 200,
    totalKm: 200,
    estimatedDays: 5,
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

describe('encounters', () => {
  it('is deterministic across calls', () => {
    const r = fakeRoute()
    const a = generateEncounters(r, 'spring', 'direct')
    const b = generateEncounters(r, 'spring', 'direct')
    expect(a).toEqual(b)
  })

  it('changes when season changes', () => {
    const r = fakeRoute()
    const spring = generateEncounters(r, 'spring', 'direct')
    const winter = generateEncounters(r, 'winter', 'direct')
    expect(spring).not.toEqual(winter)
  })

  it('returns clean unicode (no emoji) icons for markdown export', () => {
    // Markdown export depends on encounterTypeIcon returning string glyphs
    // that survive copy-paste; surrogate pairs from emoji fonts ruin alignment.
    const icons = ['social', 'environmental', 'combat', 'opportunity'] as const
    for (const t of icons) {
      const icon = encounterTypeIcon(t)
      expect(icon.length).toBeLessThanOrEqual(2)
    }
  })

  it('severity labels are non-empty', () => {
    expect(encounterSeverityLabel('mild')).toBe('Mild')
    expect(encounterSeverityLabel('moderate')).toBe('Moderate')
    expect(encounterSeverityLabel('severe')).toBe('Severe')
  })
})
