// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TravelVignette from './TravelVignette'
import type { JourneyRoute, JourneyNode, JourneyEdge } from '../../utils/journey-graph'

// vitest globals aren't enabled, so register cleanup manually (see MapKey.test).
afterEach(cleanup)

function node(id: string, civ?: string): JourneyNode {
  return { id, name: id, category: 'port', x: 0, y: 0, civ }
}
function edge(from: string, to: string): JourneyEdge {
  return { from, to, distanceSvg: 1, type: 'trade_route', name: `${from}-${to}` }
}
function route(nodes: JourneyNode[], edges: JourneyEdge[]): JourneyRoute {
  return { nodes, edges, totalDistanceSvg: 1, totalKm: 1, estimatedDays: 1, bottlenecks: [], seasonalWarnings: [] }
}

describe('TravelVignette', () => {
  it('renders nothing without a route', () => {
    const { container } = render(
      <TravelVignette route={null} edgeBiomes={undefined} selectedSegmentIdx={0} season={undefined} />,
    )
    expect(container.querySelector('.travel-vignette')).toBeNull()
  })

  it('renders nothing for an edge-less route', () => {
    const { container } = render(
      <TravelVignette route={route([node('a')], [])} edgeBiomes={undefined} selectedSegmentIdx={0} season={undefined} />,
    )
    expect(container.querySelector('.travel-vignette')).toBeNull()
  })

  it('shows the selected segment region + attested mode', () => {
    const r = route([node('a', 'irrah'), node('b', 'irrah')], [edge('a', 'b')])
    render(<TravelVignette route={r} edgeBiomes={[undefined]} selectedSegmentIdx={0} season={'summer'} />)
    const el = screen.getByTestId('travel-vignette')
    expect(el.getAttribute('data-mode')).toBe('camel')
    expect(el.getAttribute('data-backdrop')).toBe('desert-oasis')
    expect(el.getAttribute('data-season')).toBe('summer')
    expect(screen.getByTestId('travel-vignette-region').textContent).toBe('Irrah')
    expect(screen.getByTestId('travel-vignette-mode').textContent).toBe('Camel caravan')
  })

  it('tracks the selected segment index across legs', () => {
    const r = route(
      [node('a', 'kheshkai'), node('b', 'kheshkai'), node('c', 'oravan')],
      [edge('a', 'b'), edge('b', 'c')],
    )
    const { rerender } = render(
      <TravelVignette route={r} edgeBiomes={[undefined, undefined]} selectedSegmentIdx={0} season={undefined} />,
    )
    expect(screen.getByTestId('travel-vignette').getAttribute('data-mode')).toBe('horse')
    rerender(<TravelVignette route={r} edgeBiomes={[undefined, undefined]} selectedSegmentIdx={1} season={undefined} />)
    // b(kheshkai) → c(oravan) crossing: water civ wins → sea-ship
    expect(screen.getByTestId('travel-vignette').getAttribute('data-mode')).toBe('sea-ship')
  })

  it('clamps an out-of-range segment index to the last leg', () => {
    const r = route([node('a', 'qollari'), node('b', 'qollari')], [edge('a', 'b')])
    render(<TravelVignette route={r} edgeBiomes={[undefined]} selectedSegmentIdx={99} season={undefined} />)
    expect(screen.getByTestId('travel-vignette').getAttribute('data-mode')).toBe('llama')
  })

  it('defaults season to "none" when unset', () => {
    const r = route([node('a', 'ndjadi'), node('b', 'ndjadi')], [edge('a', 'b')])
    render(<TravelVignette route={r} edgeBiomes={[undefined]} selectedSegmentIdx={0} season={undefined} />)
    expect(screen.getByTestId('travel-vignette').getAttribute('data-season')).toBe('none')
  })
})

describe('TravelVignette — sea sighting overlay', () => {
  const oravanLeg = () => route([node('a', 'oravan'), node('b', 'oravan')], [edge('a', 'b')])
  const sighting = { faunaId: 'ecology.fauna.oravan.sperm_whale', name: 'Mohala, the deep-diver' }

  it('renders the silhouette + caption when a sea leg has a sighting', () => {
    const { container } = render(
      <TravelVignette route={oravanLeg()} edgeBiomes={[undefined]} selectedSegmentIdx={0} season={undefined} sighting={sighting} isSea />,
    )
    expect(screen.getByTestId('travel-vignette-sighting').textContent).toBe('Sighting: Mohala, the deep-diver')
    expect(container.querySelector('.tv-sighting')).not.toBeNull()
  })

  it('renders no overlay when there is no sighting', () => {
    const { container } = render(
      <TravelVignette route={oravanLeg()} edgeBiomes={[undefined]} selectedSegmentIdx={0} season={undefined} sighting={null} isSea />,
    )
    expect(screen.queryByTestId('travel-vignette-sighting')).toBeNull()
    expect(container.querySelector('.tv-sighting')).toBeNull()
  })

  it('keeps the caption em-dash-free (VOICE-SPEC Option B)', () => {
    render(
      <TravelVignette route={oravanLeg()} edgeBiomes={[undefined]} selectedSegmentIdx={0} season={undefined} sighting={sighting} isSea />,
    )
    expect(screen.getByTestId('travel-vignette-sighting').textContent).not.toContain('—')
  })

  it('coerces a non-boat scene to the sea scene on a sea leg (basin↔inland)', () => {
    const r = route([node('a', 'aethelian_basin'), node('b', 'irrah')], [edge('a', 'b')])
    render(<TravelVignette route={r} edgeBiomes={[undefined]} selectedSegmentIdx={0} season={undefined} isSea />)
    expect(screen.getByTestId('travel-vignette').getAttribute('data-mode')).toBe('sea-ship')
    expect(screen.getByTestId('travel-vignette').getAttribute('data-backdrop')).toBe('volcanic-reef')
  })
})
