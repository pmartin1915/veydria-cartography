// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TrailMode from './TrailMode'
import type { JourneyRoute, PartyConfig } from '../../utils/journey-graph'
import type { SupplyConfig } from '../../utils/journey-supply'

afterEach(cleanup)

const defaultParty: PartyConfig = { pace: 'normal', mount: 'foot', size: 'medium', forcedMarch: false }
const defaultSupply: SupplyConfig = { rationsPerPerson: 12, waterPerPerson: 6, encumbrance: 'normal', packAnimals: 'none' }

const basicRoute: JourneyRoute = {
  nodes: [
    { id: 'basic-a', name: 'Start', category: 'settlement', x: 0, y: 0, civ: 'irrah' },
    { id: 'basic-b', name: 'End', category: 'settlement', x: 100, y: 0, civ: 'irrah' },
  ],
  edges: [
    { from: 'basic-a', to: 'basic-b', distanceSvg: 100, type: 'trade_route', name: 'Test Road', segmentDays: 3 },
  ],
  totalDistanceSvg: 100,
  totalKm: 100,
  estimatedDays: 3,
  bottlenecks: [],
  seasonalWarnings: [],
}

const huntRoute: JourneyRoute = {
  nodes: [
    { id: 'hunt-a', name: 'Start', category: 'settlement', x: 0, y: 0, civ: 'irrah' },
    { id: 'hunt-b', name: 'End', category: 'settlement', x: 100, y: 0, civ: 'irrah' },
  ],
  edges: [
    { from: 'hunt-a', to: 'hunt-b', distanceSvg: 100, type: 'trade_route', name: 'Test Road', segmentDays: 5 },
  ],
  totalDistanceSvg: 100,
  totalKm: 100,
  estimatedDays: 5,
  bottlenecks: [],
  seasonalWarnings: [],
}

const signatureRoute: JourneyRoute = {
  nodes: [
    { id: 'sig-a', name: 'Start', category: 'settlement', x: 0, y: 0, civ: 'irrah' },
    { id: 'sig-b', name: 'End', category: 'settlement', x: 100, y: 0, civ: 'irrah' },
  ],
  edges: [
    { from: 'sig-a', to: 'sig-b', distanceSvg: 100, type: 'trade_route', name: 'Test Road', segmentDays: 1 },
  ],
  totalDistanceSvg: 100,
  totalKm: 100,
  estimatedDays: 1,
  bottlenecks: [],
  seasonalWarnings: [],
}

const deathRoute: JourneyRoute = {
  nodes: [
    { id: 'death-a', name: 'Start', category: 'settlement', x: 0, y: 0, civ: 'irrah' },
    { id: 'death-b', name: 'End', category: 'settlement', x: 100, y: 0, civ: 'irrah' },
  ],
  edges: [
    { from: 'death-a', to: 'death-b', distanceSvg: 100, type: 'trade_route', name: 'Test Road', segmentDays: 20 },
  ],
  totalDistanceSvg: 100,
  totalKm: 100,
  estimatedDays: 20,
  bottlenecks: [],
  seasonalWarnings: [],
}

function beginRun(route: JourneyRoute, props: Partial<Parameters<typeof TrailMode>[0]> = {}) {
  render(
    <TrailMode
      route={route}
      mode="direct"
      party={defaultParty}
      supply={defaultSupply}
      onExit={() => {}}
      initialSeed={1}
      {...props}
    />,
  )
  fireEvent.click(screen.getByTestId('trail-begin-btn'))
}

function getLogLines(): string[] {
  return screen.queryAllByTestId(/^trail-log-line-/).map(el => el.textContent ?? '')
}

describe('TrailMode: setup card', () => {
  it('renders the default roster row count from party size', () => {
    render(
      <TrailMode
        route={basicRoute}
        mode="direct"
        party={{ ...defaultParty, size: 'small' }}
        supply={defaultSupply}
        onExit={() => {}}
        initialSeed={1}
      />,
    )
    expect(screen.getByTestId('trail-roster-name-0')).toBeTruthy()
    expect(screen.getByTestId('trail-roster-name-1')).toBeTruthy()
    expect(screen.getByTestId('trail-roster-name-2')).toBeTruthy()
    expect(screen.queryByTestId('trail-roster-name-3')).toBeNull()
  })

  it('lets the user edit member names and keeps civ/role tags', () => {
    render(
      <TrailMode
        route={basicRoute}
        mode="direct"
        party={defaultParty}
        supply={defaultSupply}
        onExit={() => {}}
        initialSeed={1}
      />,
    )
    const input = screen.getByTestId('trail-roster-name-0') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Tamir' } })
    expect(input.value).toBe('Tamir')
    expect(screen.getByText(/irrah/)).toBeTruthy()
  })

  it('allows adding and removing rows within [2,5]', () => {
    render(
      <TrailMode
        route={basicRoute}
        mode="direct"
        party={defaultParty}
        supply={defaultSupply}
        onExit={() => {}}
        initialSeed={1}
      />,
    )
    expect(screen.queryAllByTestId(/^trail-roster-name-/)).toHaveLength(4)
    fireEvent.click(screen.getByTestId('trail-roster-add'))
    expect(screen.queryAllByTestId(/^trail-roster-name-/)).toHaveLength(5)
    fireEvent.click(screen.getByTestId('trail-roster-remove-4'))
    expect(screen.queryAllByTestId(/^trail-roster-name-/)).toHaveLength(4)
    fireEvent.click(screen.getByTestId('trail-roster-remove-0'))
    fireEvent.click(screen.getByTestId('trail-roster-remove-0'))
    expect(screen.queryAllByTestId(/^trail-roster-name-/)).toHaveLength(2)
    expect((screen.getByTestId('trail-roster-remove-0') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('TrailMode: active run', () => {
  it('begins a run and shows the journal after clicking Begin', () => {
    beginRun(basicRoute)
    expect(screen.getByTestId('trail-journal')).toBeTruthy()
    expect(screen.queryByTestId('trail-begin-btn')).toBeNull()
  })

  it('logs arrival after enough Continue presses (engine logs events, not every day)', () => {
    beginRun(basicRoute)
    // trail.ts appends log lines on EVENTS (illness, death, arrival…), not on
    // quiet travel days — drive to the 3-segmentDays arrival and assert on it.
    let safety = 0
    while (safety < 10 && screen.queryByTestId('trail-action-continue')) {
      fireEvent.click(screen.getByTestId('trail-action-continue'))
      safety++
    }
    const log = getLogLines()
    expect(log.some(line => line.includes('Arrived'))).toBe(true)
    expect(screen.getByTestId('trail-outcome-headline').textContent).toBe('You have arrived.')
  })

  it('auto-resolves hunt pending on Continue without showing a choice card', () => {
    beginRun(huntRoute, { edgeBiomes: ['Forest'] })
    fireEvent.click(screen.getByTestId('trail-action-continue'))
    expect(screen.queryByTestId('trail-choice-cards')).toBeNull()
    expect(screen.queryAllByTestId(/^trail-log-line-/).length).toBeGreaterThan(0)
  })

  it('resolves hunt choiceIndex 0 when the Hunt button is pressed', () => {
    beginRun(huntRoute, { edgeBiomes: ['Forest'] })
    fireEvent.click(screen.getByTestId('trail-action-hunt'))
    expect(screen.queryByTestId('trail-choice-cards')).toBeNull()
    const log = getLogLines()
    expect(log.some(line => line.includes('Hunting'))).toBe(true)
  })

  it('renders signature choice cards and appends the chosen log line', () => {
    beginRun(signatureRoute, { edgeBiomes: ['Sabkha'] })
    fireEvent.click(screen.getByTestId('trail-action-continue'))
    expect(screen.getByTestId('trail-choice-0')).toBeTruthy()
    expect(screen.getByTestId('trail-choice-1')).toBeTruthy()
    fireEvent.click(screen.getByTestId('trail-choice-0'))
    expect(screen.queryByTestId('trail-choice-0')).toBeNull()
    expect(screen.queryAllByTestId(/^trail-log-line-/).length).toBeGreaterThan(0)
  })
})

describe('TrailMode: death and outcomes', () => {
  it('shows a grave-marker card and struck-through roster when a member dies', () => {
    beginRun(deathRoute, {
      edgeBiomes: ['Steppe'],
      party: { pace: 'normal', mount: 'foot', size: 'large', forcedMarch: true },
      supply: { rationsPerPerson: 1, waterPerPerson: 12, encumbrance: 'normal', packAnimals: 'none' },
      initialSeed: 0,
    })
    let safety = 0
    while (safety < 10 && screen.queryAllByTestId('trail-grave').length === 0) {
      const btn = screen.queryByTestId('trail-action-continue')
      if (!btn) break
      fireEvent.click(btn)
      safety++
    }
    expect(screen.queryAllByTestId('trail-grave').length).toBeGreaterThan(0)
    const nameEl = screen.queryByTestId('trail-member-name-m0')
    expect(nameEl?.querySelector('s')).toBeTruthy()
  })

  it('shows the score screen and calls onExit when the run ends', () => {
    const onExit = vi.fn()
    beginRun(signatureRoute, { edgeBiomes: ['Sabkha'], onExit })
    fireEvent.click(screen.getByTestId('trail-action-continue'))
    fireEvent.click(screen.getByTestId('trail-choice-0'))
    expect(screen.getByTestId('trail-score-rank')).toBeTruthy()
    expect(screen.getByTestId('trail-score-survivors')).toBeTruthy()
    expect(screen.getByTestId('trail-score-days')).toBeTruthy()
    expect(screen.getByTestId('trail-score-supply')).toBeTruthy()
    fireEvent.click(screen.getByTestId('trail-return-btn'))
    expect(onExit).toHaveBeenCalled()
  })
})

describe('TrailMode: determinism', () => {
  it('produces identical log arrays for identical props and action sequences', () => {
    const props = {
      route: basicRoute,
      mode: 'direct' as const,
      party: defaultParty,
      supply: defaultSupply,
      onExit: () => {},
      initialSeed: 42,
    }

    const run = () => {
      render(<TrailMode {...props} />)
      fireEvent.click(screen.getByTestId('trail-begin-btn'))
      fireEvent.click(screen.getByTestId('trail-action-continue'))
      fireEvent.click(screen.getByTestId('trail-action-continue'))
      const lines = screen.queryAllByTestId(/^trail-log-line-/).map(el => el.textContent ?? '')
      cleanup()
      return lines
    }

    const first = run()
    const second = run()
    expect(first).toEqual(second)
  })
})
