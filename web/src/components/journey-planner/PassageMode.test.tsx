// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PassageLedger } from './PassageMode'

// vitest globals aren't enabled, so testing-library's auto-cleanup isn't
// registered — unmount between tests so renders don't accumulate in the DOM.
afterEach(cleanup)

describe('PassageLedger: scar legibility', () => {
  it('shows current days-of-supply and no cap line when unscarred', () => {
    const { container } = render(
      <PassageLedger
        rationsLeft={8}
        waterLeft={5}
        scarRations={0}
        scarWater={0}
        startingRations={12}
        startingWater={6}
      />,
    )
    expect(container.querySelectorAll('.passage-ledger-cap')).toHaveLength(0)
    expect(container.textContent).toContain('8.0d')
    expect(container.textContent).toContain('5.0d')
  })

  it('surfaces the lowered water cap and scar delta when water is scarred', () => {
    const { container } = render(
      <PassageLedger
        rationsLeft={8}
        waterLeft={4}
        scarRations={0}
        scarWater={2}
        startingRations={12}
        startingWater={6}
      />,
    )
    const caps = container.querySelectorAll('.passage-ledger-cap')
    expect(caps).toHaveLength(1) // only water is scarred
    expect(caps[0].textContent).toContain('cap 4.0d') // startingWater 6 - scarWater 2
    expect(container.querySelector('.passage-scar-delta')?.textContent).toContain('2')
  })

  it('surfaces a rations cap independently of water', () => {
    const { container } = render(
      <PassageLedger
        rationsLeft={6}
        waterLeft={5}
        scarRations={1}
        scarWater={0}
        startingRations={12}
        startingWater={6}
      />,
    )
    const caps = container.querySelectorAll('.passage-ledger-cap')
    expect(caps).toHaveLength(1)
    expect(caps[0].textContent).toContain('cap 11.0d') // startingRations 12 - scarRations 1
  })
})
