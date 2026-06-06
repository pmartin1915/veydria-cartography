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
