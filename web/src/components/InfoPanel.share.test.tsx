// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import InfoPanel from './InfoPanel'
import type { GeoJSONFeature } from '../App'

afterEach(cleanup)

const feature = (category: string, properties: Record<string, unknown>) =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Test', category, ...properties } }) as unknown as GeoJSONFeature

const CHOKE = feature('chokepoint', { description: 'PUBLIC-DESC', strategic_value: 'GM-STRATEGIC' })
const ROUTE = feature('trade_route', { path_description: 'PUBLIC-PATH', bottleneck: 'GM-BOTTLENECK', consequence_if_closed: 'GM-CLOSED' })

function html(f: GeoJSONFeature, shareMode: boolean) {
  const { container } = render(<InfoPanel feature={f} open onClose={() => {}} shareMode={shareMode} />)
  return container.textContent ?? ''
}

describe('InfoPanel share mode', () => {
  it('hides GM-only fields from players', () => {
    const a = html(CHOKE, true)
    expect(a).toContain('PUBLIC-DESC')
    expect(a).not.toContain('GM-STRATEGIC')
    cleanup()
    const b = html(ROUTE, true)
    expect(b).toContain('PUBLIC-PATH')
    expect(b).not.toContain('GM-BOTTLENECK')
    expect(b).not.toContain('GM-CLOSED')
  })
  it('shows them to the GM', () => {
    expect(html(CHOKE, false)).toContain('GM-STRATEGIC')
    cleanup()
    const b = html(ROUTE, false)
    expect(b).toContain('GM-BOTTLENECK')
    expect(b).toContain('GM-CLOSED')
  })
})
