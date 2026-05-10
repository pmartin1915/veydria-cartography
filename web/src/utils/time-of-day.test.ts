// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type TimeOfDay,
  TIME_OF_DAY_ORDER,
  TIME_OF_DAY_FILTERS,
  TIME_OF_DAY_LABELS,
  cycleTimeOfDay,
  loadTimeOfDay,
  saveTimeOfDay,
} from './time-of-day'

describe('time-of-day', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
  })

  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
  })

  it('has four ordered modes', () => {
    expect(TIME_OF_DAY_ORDER).toEqual(['day', 'dawn', 'dusk', 'night'])
  })

  it('has a filter string for every mode', () => {
    for (const mode of TIME_OF_DAY_ORDER) {
      expect(typeof TIME_OF_DAY_FILTERS[mode]).toBe('string')
      expect(TIME_OF_DAY_FILTERS[mode].length).toBeGreaterThan(0)
    }
    expect(TIME_OF_DAY_FILTERS.day).toBe('none')
  })

  it('has a label for every mode', () => {
    expect(TIME_OF_DAY_LABELS.day).toBe('Day')
    expect(TIME_OF_DAY_LABELS.dawn).toBe('Dawn')
    expect(TIME_OF_DAY_LABELS.dusk).toBe('Dusk')
    expect(TIME_OF_DAY_LABELS.night).toBe('Night')
  })

  it('cycles forward through modes', () => {
    expect(cycleTimeOfDay('day')).toBe('dawn')
    expect(cycleTimeOfDay('dawn')).toBe('dusk')
    expect(cycleTimeOfDay('dusk')).toBe('night')
    expect(cycleTimeOfDay('night')).toBe('day')
  })

  it('returns day by default when localStorage is empty', () => {
    expect(loadTimeOfDay()).toBe('day')
  })

  it('loads a valid stored value', () => {
    window.localStorage.setItem('veydria.timeOfDay.v1', 'night')
    expect(loadTimeOfDay()).toBe('night')
  })

  it('falls back to day for invalid stored values', () => {
    window.localStorage.setItem('veydria.timeOfDay.v1', 'midday')
    expect(loadTimeOfDay()).toBe('day')
  })

  it('saves value to localStorage', () => {
    saveTimeOfDay('dusk')
    expect(window.localStorage.getItem('veydria.timeOfDay.v1')).toBe('dusk')
  })

  it('round-trips through save and load', () => {
    const modes: TimeOfDay[] = ['day', 'dawn', 'dusk', 'night']
    for (const mode of modes) {
      saveTimeOfDay(mode)
      expect(loadTimeOfDay()).toBe(mode)
    }
  })
})
