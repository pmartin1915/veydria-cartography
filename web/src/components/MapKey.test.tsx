// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MapKey from './MapKey'
import type { LayerVisibility } from '../App'

// vitest globals aren't enabled, so testing-library's auto-cleanup isn't
// registered — unmount between tests so renders don't accumulate in the DOM.
afterEach(cleanup)

const NONE: LayerVisibility = {
  terrain_cell: false,
  civilization: false,
  water: false,
  chokepoint: false,
  port: false,
  oasis: false,
  contested_site: false,
  hex_grid: false,
  trade_route: false,
  landmark: false,
  river: false,
  faction_control: false,
  terrain_cost: false,
  biome_colors: false,
  explored: false,
}
const layers = (o: Partial<LayerVisibility>): LayerVisibility => ({ ...NONE, ...o })

describe('MapKey', () => {
  it('renders nothing when no documented layer is on', () => {
    const { container } = render(<MapKey layers={layers({ water: true, trade_route: true, river: true })} />)
    expect(container.querySelector('.map-key')).toBeNull()
  })

  it('shows a feature row only for active point layers', () => {
    render(<MapKey layers={layers({ port: true })} />)
    expect(screen.queryByText('Port')).not.toBeNull()
    expect(screen.queryByText('Oasis')).toBeNull()
    expect(screen.queryByText('Landmark')).toBeNull()
  })

  it('maps the underscore civ slug to its hyphenated display name', () => {
    render(<MapKey layers={layers({ faction_control: true })} />)
    // CIV_COLORS key is `ngaru_bon`; CIV_LABELS key is `ngaru-bon`.
    expect(screen.queryByText('Ngaru-Bon')).not.toBeNull()
    expect(screen.queryByText('Oravan')).not.toBeNull()
  })

  it('gates the biome section on hex_grid AND biome_colors', () => {
    const { rerender } = render(<MapKey layers={layers({ hex_grid: true })} />)
    expect(screen.queryByText('Biomes')).toBeNull()
    rerender(<MapKey layers={layers({ hex_grid: true, biome_colors: true })} />)
    expect(screen.queryByText('Biomes')).not.toBeNull()
    expect(screen.queryByText('Cloud forest')).not.toBeNull()
  })

  it('shows the elevation key when a terrain layer is on', () => {
    render(<MapKey layers={layers({ terrain_cell: true })} />)
    expect(screen.queryByText('Elevation')).not.toBeNull()
    expect(screen.queryByText('Lowland')).not.toBeNull()
    expect(screen.queryByText('Peak')).not.toBeNull()
  })

  it('shows a fog row when the explored layer is on', () => {
    render(<MapKey layers={layers({ explored: true })} />)
    expect(screen.queryByText('Dimmed = unexplored')).not.toBeNull()
  })

  it('collapses the body when the toggle is clicked', () => {
    render(<MapKey layers={layers({ port: true })} />)
    expect(screen.queryByTestId('map-key-body')).not.toBeNull()
    fireEvent.click(screen.getByTestId('map-key-toggle'))
    expect(screen.queryByTestId('map-key-body')).toBeNull()
  })
})
