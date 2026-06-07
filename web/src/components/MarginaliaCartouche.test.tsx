// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MarginaliaCartouche from './MarginaliaCartouche'
import type { Asterism } from '../utils/asterisms'

// vitest globals aren't enabled, so testing-library's auto-cleanup isn't
// registered — unmount between tests so renders don't accumulate in the DOM.
afterEach(cleanup)

const CARTOUCHE: Asterism = {
  id: 'religion.tradition.star_register.serakar_oath',
  civ: 'oravan',
  kind: 'cartouche',
  placement: 'sky',
  prose_label: 'By the star that watches',
  gloss: 'Nakhoda chart-oath sworn on Serakar.',
  etymology: 'pidgin oath; sera + kar',
  illustration_ref: null,
}

describe('MarginaliaCartouche', () => {
  it('renders nothing when the layer is hidden', () => {
    const { container } = render(<MarginaliaCartouche cartouche={CARTOUCHE} visible={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no cartouche has loaded', () => {
    const { container } = render(<MarginaliaCartouche cartouche={null} visible={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the oath name-plate when visible, with an inline SVG and no raster', () => {
    const { container } = render(<MarginaliaCartouche cartouche={CARTOUCHE} visible={true} />)
    expect(screen.getByTestId('marginalia-cartouche')).toBeTruthy()
    expect(screen.getByText('By the star that watches')).toBeTruthy()
    // Canon rail: the glyph is inline SVG (a star), never a raster image.
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})
