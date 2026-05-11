import { describe, it, expect } from 'vitest'
import {
  clampDayOfYear,
  dayToSeason,
  formatDayOfYear,
  eventActiveOn,
  getEventsForDay,
  getEventsForRange,
  getSeasonalEvents,
  VEYDRIA_CALENDAR,
  CALENDAR_EVENT_COLORS,
} from './calendar'
import type { CalendarEvent } from './calendar'

describe('calendar utilities', () => {
  describe('clampDayOfYear', () => {
    it('clamps below 1 to 1', () => {
      expect(clampDayOfYear(0)).toBe(1)
      expect(clampDayOfYear(-5)).toBe(1)
    })
    it('clamps above 365 to 365', () => {
      expect(clampDayOfYear(366)).toBe(365)
      expect(clampDayOfYear(999)).toBe(365)
    })
    it('passes through valid days', () => {
      expect(clampDayOfYear(1)).toBe(1)
      expect(clampDayOfYear(200)).toBe(200)
      expect(clampDayOfYear(365)).toBe(365)
    })
  })

  describe('dayToSeason', () => {
    it('maps winter correctly', () => {
      expect(dayToSeason(1)).toBe('winter')
      expect(dayToSeason(365)).toBe('winter')
      expect(dayToSeason(80)).toBe('winter')
    })
    it('maps spring correctly', () => {
      expect(dayToSeason(81)).toBe('spring')
      expect(dayToSeason(172)).toBe('spring')
    })
    it('maps summer correctly', () => {
      expect(dayToSeason(173)).toBe('summer')
      expect(dayToSeason(264)).toBe('summer')
    })
    it('maps autumn correctly', () => {
      expect(dayToSeason(265)).toBe('autumn')
      expect(dayToSeason(355)).toBe('autumn')
    })
  })

  describe('formatDayOfYear', () => {
    it('includes day number and season', () => {
      expect(formatDayOfYear(1)).toContain('Day 1')
      expect(formatDayOfYear(1)).toContain('winter')
      expect(formatDayOfYear(150)).toContain('Day 150')
      expect(formatDayOfYear(150)).toContain('spring')
    })
  })

  describe('eventActiveOn', () => {
    it('detects active days within a non-wrapping event', () => {
      const ev: CalendarEvent = {
        id: 'test',
        name: 'Test',
        civilization: 'all',
        type: 'festival',
        startDay: 100,
        durationDays: 5,
        description: '',
        season: 'spring',
      }
      expect(eventActiveOn(ev, 100)).toBe(true)
      expect(eventActiveOn(ev, 104)).toBe(true)
      expect(eventActiveOn(ev, 99)).toBe(false)
      expect(eventActiveOn(ev, 105)).toBe(false)
    })

    it('detects active days for a year-wrapping event', () => {
      const ev: CalendarEvent = {
        id: 'wrap',
        name: 'Wrap',
        civilization: 'all',
        type: 'festival',
        startDay: 360,
        durationDays: 10,
        description: '',
        season: 'winter',
      }
      expect(eventActiveOn(ev, 360)).toBe(true)
      expect(eventActiveOn(ev, 365)).toBe(true)
      expect(eventActiveOn(ev, 1)).toBe(true)
      expect(eventActiveOn(ev, 4)).toBe(true)
      expect(eventActiveOn(ev, 5)).toBe(false)
      expect(eventActiveOn(ev, 359)).toBe(false)
    })

    it('treats year-long (or longer) events as always active', () => {
      const ev: CalendarEvent = {
        id: 'perma',
        name: 'Permanent',
        civilization: 'all',
        type: 'misc',
        startDay: 200,
        durationDays: 365,
        description: '',
        season: 'all',
      }
      expect(eventActiveOn(ev, 1)).toBe(true)
      expect(eventActiveOn(ev, 200)).toBe(true)
      expect(eventActiveOn(ev, 365)).toBe(true)
    })
  })

  describe('getEventsForDay', () => {
    it('returns events active on a given day', () => {
      const events = [
        { id: 'a', name: 'A', civilization: 'all', type: 'festival' as const, startDay: 100, durationDays: 3, description: '', season: 'spring' as const },
        { id: 'b', name: 'B', civilization: 'all', type: 'harvest' as const, startDay: 102, durationDays: 2, description: '', season: 'spring' as const },
      ]
      expect(getEventsForDay(100, events).map(e => e.id)).toEqual(['a'])
      expect(getEventsForDay(101, events).map(e => e.id)).toEqual(['a'])
      expect(getEventsForDay(102, events).map(e => e.id)).toEqual(['a', 'b'])
    })

    it('returns empty array when no events match', () => {
      expect(getEventsForDay(200, [])).toEqual([])
      expect(getEventsForDay(200, VEYDRIA_CALENDAR)).toEqual(
        expect.arrayContaining([])
      )
    })
  })

  describe('getEventsForRange', () => {
    it('maps days to active events across a range', () => {
      const events = [
        { id: 'a', name: 'A', civilization: 'all', type: 'festival' as const, startDay: 50, durationDays: 5, description: '', season: 'spring' as const },
      ]
      const map = getEventsForRange(48, 10, events)
      expect(map.has(50)).toBe(true)
      expect(map.has(51)).toBe(true)
      expect(map.has(54)).toBe(true)
      expect(map.has(48)).toBe(false)
      expect(map.has(55)).toBe(false)
    })

    it('wraps around year end', () => {
      const events = [
        { id: 'wrap', name: 'Wrap', civilization: 'all', type: 'festival' as const, startDay: 360, durationDays: 10, description: '', season: 'winter' as const },
      ]
      // 10-day range starting at 358 covers: 358, 359, 360, 361, 362, 363, 364, 365, 1, 2
      const map = getEventsForRange(358, 10, events)
      expect(map.has(358)).toBe(false)
      expect(map.has(360)).toBe(true)
      expect(map.has(365)).toBe(true)
      expect(map.has(1)).toBe(true)
      expect(map.has(2)).toBe(true)
      // Day 3 is at i=10, outside the 10-day range
      expect(map.has(3)).toBe(false)
    })
  })

  describe('getSeasonalEvents', () => {
    it('filters by season', () => {
      const spring = getSeasonalEvents('spring')
      expect(spring.length).toBeGreaterThan(0)
      expect(spring.every(e => e.season === 'spring' || e.season === 'all')).toBe(true)
    })
    it('returns empty for undefined season', () => {
      expect(getSeasonalEvents(undefined)).toEqual([])
    })
  })

  describe('VEYDRIA_CALENDAR', () => {
    it('has unique event IDs', () => {
      const ids = VEYDRIA_CALENDAR.map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('has valid day ranges', () => {
      for (const ev of VEYDRIA_CALENDAR) {
        expect(ev.startDay).toBeGreaterThanOrEqual(1)
        expect(ev.startDay).toBeLessThanOrEqual(365)
        expect(ev.durationDays).toBeGreaterThanOrEqual(1)
      }
    })

    it('has every event type mapped to a color', () => {
      for (const ev of VEYDRIA_CALENDAR) {
        expect(CALENDAR_EVENT_COLORS[ev.type]).toBeDefined()
      }
    })
  })
})
