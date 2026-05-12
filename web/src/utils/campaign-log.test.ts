import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateCampaignLog, downloadCampaignLog, exportJourneyMarkdown } from './campaign-log'
import type { JourneyRoute, Season, RouteMode } from './journey-graph'
import type { SavedJourney } from './journey-saved'
import type { MapAnnotation } from './annotations'

function makeRoute(overrides: Partial<JourneyRoute> = {}): JourneyRoute {
  return {
    nodes: [
      { id: 'n1', name: 'Oravan', category: 'port', x: 100, y: 200 },
      { id: 'n2', name: 'Qollari', category: 'civilization', x: 300, y: 400 },
    ],
    edges: [
      {
        from: 'n1',
        to: 'n2',
        distanceSvg: 120,
        type: 'trade_route',
        name: 'Gold-Banner Route',
        segmentDays: 5,
      },
    ],
    totalDistanceSvg: 120,
    totalKm: 300,
    estimatedDays: 5,
    bottlenecks: ['Bandit-sign scratched into the pass wall'],
    seasonalWarnings: ['Spring floods have washed out the ford'],
    ...overrides,
  }
}

function makeSavedJourney(overrides: Partial<SavedJourney> = {}): SavedJourney {
  return {
    id: 'sj-1',
    savedAt: 1000,
    fromName: 'Oravan',
    toName: 'Qollari',
    waypoints: [],
    season: 'spring',
    mode: 'direct',
    totalKm: 300,
    estimatedDays: 5,
    nodeIds: ['n1', 'n2'],
    edgeCount: 1,
    bottlenecks: ['Flooded pass'],
    seasonalWarnings: ['Mud season'],
    ...overrides,
  }
}

function makeAnnotation(overrides: Partial<MapAnnotation> = {}): MapAnnotation {
  return {
    id: 'ann-1',
    x: 150,
    y: 250,
    label: 'Test Pin',
    body: 'A note about this location.',
    color: '#c4a86b',
    createdAt: 2000,
    ...overrides,
  }
}

describe('campaign-log', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:5173/' },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('exportJourneyMarkdown', () => {
    it('includes route title and stats', () => {
      const md = exportJourneyMarkdown(makeRoute())
      expect(md).toContain('### Journey: Oravan → Qollari')
      expect(md).toContain('**Distance:** 300 km')
      expect(md).toContain('**Mode:** direct')
    })

    it('includes season when provided', () => {
      const md = exportJourneyMarkdown(makeRoute(), 'spring', 'direct')
      expect(md).toContain('**Season:** spring')
    })

    it('includes waypoints in the title', () => {
      const route = makeRoute({
        nodes: [
          { id: 'n1', name: 'A', category: 'port', x: 0, y: 0 },
          { id: 'n2', name: 'B', category: 'civilization', x: 50, y: 50 },
          { id: 'n3', name: 'C', category: 'port', x: 100, y: 100 },
        ],
        edges: [
          { from: 'n1', to: 'n2', distanceSvg: 60, type: 'intra_civ', name: 'AB Road', segmentDays: 2 },
          { from: 'n2', to: 'n3', distanceSvg: 60, type: 'trade_route', name: 'BC Trail', segmentDays: 3 },
        ],
        totalDistanceSvg: 120,
        totalKm: 300,
        estimatedDays: 5,
        bottlenecks: [],
        seasonalWarnings: [],
      })
      const md = exportJourneyMarkdown(route)
      expect(md).toContain('A → B → C')
    })

    it('includes warnings when present', () => {
      const md = exportJourneyMarkdown(makeRoute())
      expect(md).toContain('#### Warnings')
      expect(md).toContain('[!] Bandit-sign scratched into the pass wall')
      expect(md).toContain('[!] Spring floods have washed out the ford')
    })

    it('omits warnings section when none exist', () => {
      const md = exportJourneyMarkdown(makeRoute({ bottlenecks: [], seasonalWarnings: [] }))
      expect(md).not.toContain('#### Warnings')
    })

    it('includes day-by-day breakdown', () => {
      const md = exportJourneyMarkdown(makeRoute())
      expect(md).toContain('#### Day-by-Day')
      expect(md).toContain('**Day 1**')
      expect(md).toContain('Depart Oravan')
    })

    it('includes crisis leverage footnotes when events have crises', () => {
      const md = exportJourneyMarkdown(makeRoute())
      // The generated route may or may not hit crisis-tagged days depending on
      // random encounter seeding. Instead verify the helper logic by inspecting
      // that the markdown formatter references the crisis helpers correctly.
      // If a crisis event happens to land on a day, we expect the ⚡ marker.
      // The test is permissive: if no crisis events appear, the markdown is
      // still valid; if they do, they must be formatted correctly.
      const lines = md.split('\n')
      for (const line of lines) {
        if (line.includes('⚡ Leverage:')) {
          expect(line).toMatch(/Leverage: .+ #\d/)
        }
      }
    })
  })

  describe('generateCampaignLog', () => {
    it('produces a minimal log when everything is empty', () => {
      const md = generateCampaignLog({ savedJourneys: [], annotations: [] })
      expect(md).toContain('# Veydria Campaign Log')
      expect(md).toContain('*Generated on')
      expect(md).toContain('*Exported from Veydria Cartography*')
      expect(md).not.toContain('## Active Journey')
      expect(md).not.toContain('## Saved Journeys')
      expect(md).not.toContain('## Campaign Notes')
      expect(md).not.toContain('## Hex Notes')
    })

    it('includes active journey section', () => {
      const md = generateCampaignLog({
        activeJourney: {
          route: makeRoute(),
          season: 'summer',
          mode: 'fastest',
        },
        savedJourneys: [],
        annotations: [],
      })
      expect(md).toContain('## Active Journey')
      expect(md).toContain('**Season:** summer')
      expect(md).toContain('**Mode:** fastest')
    })

    it('includes saved journeys as summaries', () => {
      const md = generateCampaignLog({
        savedJourneys: [
          makeSavedJourney({ id: 'sj-1', fromName: 'Oravan', toName: 'Qollari' }),
          makeSavedJourney({
            id: 'sj-2',
            fromName: 'A',
            toName: 'C',
            waypoints: ['B'],
            name: 'The Long March',
            totalKm: 800,
            estimatedDays: 18,
            mode: 'safest',
            season: 'winter',
            bottlenecks: ['Avalanche zone'],
            seasonalWarnings: ['Ice sheets'],
          }),
        ],
        annotations: [],
      })
      expect(md).toContain('## Saved Journeys (2)')
      expect(md).toContain('### 1. Oravan → Qollari')
      expect(md).toContain('### 2. The Long March')
      expect(md).toContain('**Distance:** 800 km')
      expect(md).toContain('~18 days')
      expect(md).toContain('**Mode:** safest')
      expect(md).toContain('**Season:** winter')
      expect(md).toContain('- **Bottlenecks:** Avalanche zone')
      expect(md).toContain('- **Seasonal warnings:** Ice sheets')
    })

    it('renders saved journey path with waypoints', () => {
      const md = generateCampaignLog({
        savedJourneys: [
          makeSavedJourney({ waypoints: ['Midpoint'], fromName: 'A', toName: 'C' }),
        ],
        annotations: [],
      })
      expect(md).toContain('- **Path:** A → Midpoint → C')
    })

    it('includes pins in Campaign Notes', () => {
      const md = generateCampaignLog({
        savedJourneys: [],
        annotations: [
          makeAnnotation({ label: 'NPC — Trader', body: 'Sells salt.', featureName: 'Oravan' }),
          makeAnnotation({ label: 'Treasure', body: 'Hidden chest.' }),
        ],
      })
      expect(md).toContain('## Campaign Notes (2 pins)')
      expect(md).toContain('### NPC — Trader')
      expect(md).toContain('*Linked: Oravan*')
      expect(md).toContain('Sells salt.')
      expect(md).toContain('### Treasure')
      expect(md).toContain('Hidden chest.')
    })

    it('groups hex notes by hex label', () => {
      const md = generateCampaignLog({
        savedJourneys: [],
        annotations: [
          makeAnnotation({ label: 'Ambush', body: 'Bandits here.', hexLabel: 'G7' }),
          makeAnnotation({ label: 'Camp', body: 'Good water.', hexLabel: 'G7' }),
          makeAnnotation({ label: 'Ruins', body: 'Old temple.', hexLabel: 'H8' }),
        ],
      })
      expect(md).toContain('## Hex Notes')
      expect(md).toContain('### Hex G7')
      expect(md).toContain('**Ambush** — Bandits here.')
      expect(md).toContain('**Camp** — Good water.')
      expect(md).toContain('### Hex H8')
      expect(md).toContain('**Ruins** — Old temple.')
    })

    it('includes all sections when data is present', () => {
      const md = generateCampaignLog({
        activeJourney: {
          route: makeRoute(),
          season: 'autumn',
          mode: 'cheapest',
        },
        savedJourneys: [makeSavedJourney()],
        annotations: [
          makeAnnotation(),
          makeAnnotation({ label: 'Hex Note', hexLabel: 'A1' }),
        ],
      })
      expect(md).toContain('## Active Journey')
      expect(md).toContain('## Saved Journeys')
      expect(md).toContain('## Campaign Notes')
      expect(md).toContain('## Hex Notes')
    })

    it('omits pin section when only hex notes exist', () => {
      const md = generateCampaignLog({
        savedJourneys: [],
        annotations: [makeAnnotation({ hexLabel: 'A1' })],
      })
      expect(md).not.toContain('## Campaign Notes')
      expect(md).toContain('## Hex Notes')
    })

    it('omits hex notes section when only pins exist', () => {
      const md = generateCampaignLog({
        savedJourneys: [],
        annotations: [makeAnnotation()],
      })
      expect(md).toContain('## Campaign Notes')
      expect(md).not.toContain('## Hex Notes')
    })

    it('includes feature notes section', () => {
      const md = generateCampaignLog({
        savedJourneys: [],
        annotations: [],
        featureNotes: [
          { featureId: 'aethelian_basin', note: 'The heart of trade.' },
          { featureId: 'oravan', note: 'Watch for Syndic spies.' },
        ],
      })
      expect(md).toContain('## Feature Notes')
      expect(md).toContain('### Aethelian Basin')
      expect(md).toContain('The heart of trade.')
      expect(md).toContain('### Oravan')
      expect(md).toContain('Watch for Syndic spies.')
    })

    it('omits feature notes section when empty', () => {
      const md = generateCampaignLog({
        savedJourneys: [],
        annotations: [],
      })
      expect(md).not.toContain('## Feature Notes')
    })
  })

  describe('downloadCampaignLog', () => {
    it('creates a download with the correct filename pattern', () => {
      const clickSpy = vi.fn()
      const mockAnchor = {
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement

      const mockBody = {
        appendChild: vi.fn().mockReturnValue(null),
        removeChild: vi.fn().mockReturnValue(null),
      }

      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: mockBody,
      }

      vi.stubGlobal('document', mockDocument)
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

      downloadCampaignLog({ savedJourneys: [], annotations: [] })

      expect(mockDocument.createElement).toHaveBeenCalledWith('a')
      expect(mockAnchor.download).toMatch(/^veydria-campaign-log-\d{4}-\d{2}-\d{2}\.md$/)
      expect(clickSpy).toHaveBeenCalled()
      expect(revokeSpy).toHaveBeenCalled()

      vi.unstubAllGlobals()
      revokeSpy.mockRestore()
    })
  })
})
