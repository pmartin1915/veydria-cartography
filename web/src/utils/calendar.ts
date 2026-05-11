/**
 * calendar.ts — Veydrian civilizational calendar
 *
 * Calendar events tied to civilizations, seasons, and day-of-year.
 * ~50 researched canon events for all 6 civilizations + Basin-wide
 * institutions, drawn from worldbuilder/timeline/calendar/*.yaml.
 *
 * All days are 1-based (1 = first day of the year, 365 = last day).
 */

import type { Season } from './journey-graph'
import { VEYDRIA_CALENDAR_EVENTS } from '../generated/calendar-events'

export type CalendarEventType =
  | 'festival'
  | 'harvest'
  | 'monsoon'
  | 'religious'
  | 'political'
  | 'trade'
  | 'misc'

export interface CalendarEvent {
  id: string
  name: string
  civilization: string | 'all'
  type: CalendarEventType
  /** 1-based day of year (1–365) */
  startDay: number
  durationDays: number
  description: string
  /** Optional mechanical effect for GMs */
  effect?: string
  /** Season affinity — used for filtering when no departure date is set */
  season: Season | 'all'
}

/* ─── Day-of-year helpers ─────────────────────────────────────────── */

const DAYS_IN_YEAR = 365

export function clampDayOfYear(d: number): number {
  return Math.max(1, Math.min(DAYS_IN_YEAR, Math.round(d)))
}

/** Which season does a given day-of-year fall into? Approximate. */
export function dayToSeason(day: number): Season {
  const d = clampDayOfYear(day)
  if (d <= 80 || d >= 356) return 'winter'
  if (d <= 172) return 'spring'
  if (d <= 264) return 'summer'
  return 'autumn'
}

const MONTH_RANGES = [
  { name: 'January', start: 1, end: 31 },
  { name: 'February', start: 32, end: 59 },
  { name: 'March', start: 60, end: 90 },
  { name: 'April', start: 91, end: 120 },
  { name: 'May', start: 121, end: 151 },
  { name: 'June', start: 152, end: 181 },
  { name: 'July', start: 182, end: 212 },
  { name: 'August', start: 213, end: 243 },
  { name: 'September', start: 244, end: 273 },
  { name: 'October', start: 274, end: 304 },
  { name: 'November', start: 305, end: 334 },
  { name: 'December', start: 335, end: 365 },
]

/** Approximate real-world month and period for a day-of-year. */
export function dayToApproximateDate(day: number): { month: string; period: string } {
  const d = clampDayOfYear(day)
  for (const m of MONTH_RANGES) {
    if (d >= m.start && d <= m.end) {
      const dayInMonth = d - m.start + 1
      const monthLength = m.end - m.start + 1
      const third = monthLength / 3
      let period: string
      if (dayInMonth <= third) {
        period = 'early'
      } else if (dayInMonth <= 2 * third) {
        period = 'mid'
      } else {
        period = 'late'
      }
      return { month: m.name, period }
    }
  }
  return { month: 'January', period: 'early' }
}

/** Format a day-of-year as "Day N (Season ~period Month)". */
export function formatDayOfYear(day: number): string {
  const d = clampDayOfYear(day)
  const season = dayToSeason(d)
  const approx = dayToApproximateDate(d)
  return `Day ${d} (${season} ~${approx.period} ${approx.month})`
}

/* ─── Event queries ───────────────────────────────────────────────── */

/** Return true if `day` falls within [startDay, startDay + durationDays). */
export function eventActiveOn(event: CalendarEvent, day: number): boolean {
  const d = clampDayOfYear(day)
  const s = event.startDay
  if (event.durationDays >= DAYS_IN_YEAR) return true
  const rawEnd = s + event.durationDays - 1
  const e = (rawEnd % DAYS_IN_YEAR) || DAYS_IN_YEAR
  if (rawEnd <= DAYS_IN_YEAR) {
    return d >= s && d <= e
  }
  // Wraps around year end (e.g. startDay 350, duration 30)
  return d >= s || d <= e
}

/** Get all events active on a specific day-of-year. */
export function getEventsForDay(
  day: number,
  events: readonly CalendarEvent[] = VEYDRIA_CALENDAR
): CalendarEvent[] {
  return events.filter(e => eventActiveOn(e, day))
}

/** Get events active across a day range [startDay, startDay + durationDays).
 *  Returns a Map from day-of-year → active events.
 */
export function getEventsForRange(
  startDay: number,
  durationDays: number,
  events: readonly CalendarEvent[] = VEYDRIA_CALENDAR
): Map<number, CalendarEvent[]> {
  const out = new Map<number, CalendarEvent[]>()
  for (let i = 0; i < durationDays; i++) {
    const d = ((startDay - 1 + i) % DAYS_IN_YEAR) + 1
    const active = getEventsForDay(d, events)
    if (active.length > 0) out.set(d, active)
  }
  return out
}

/** Get events that match a given season (for when no departure date is set). */
export function getSeasonalEvents(
  season: Season | undefined,
  events: readonly CalendarEvent[] = VEYDRIA_CALENDAR
): CalendarEvent[] {
  if (!season) return []
  return events.filter(e => e.season === season || e.season === 'all')
}

/* ─── Researched canon calendar ────────────────────────────────────
 * Drawn from data/calendar-events.yaml (auto-generated from
 * worldbuilder timeline/calendar/*.yaml). Run `npm run generate:calendar`
 * to regenerate web/src/generated/calendar-events.ts after editing.
 */

export const VEYDRIA_CALENDAR: CalendarEvent[] = VEYDRIA_CALENDAR_EVENTS as CalendarEvent[]

/* ─── Event type styling helpers ──────────────────────────────────── */

export const CALENDAR_EVENT_COLORS: Record<CalendarEventType, string> = {
  festival: '#c4a862',
  harvest: '#4a9a3a',
  monsoon: '#3a7ca5',
  religious: '#a060c0',
  political: '#c06060',
  trade: '#d49040',
  misc: '#888888',
}

export const CALENDAR_EVENT_ICONS: Record<CalendarEventType, string> = {
  festival: '🎉',
  harvest: '🌾',
  monsoon: '🌧',
  religious: '⛪',
  political: '🏛',
  trade: '⚖',
  misc: '📌',
}
