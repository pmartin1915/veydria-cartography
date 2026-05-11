/**
 * calendar.ts — Veydrian civilizational calendar
 *
 * Calendar events tied to civilizations, seasons, and day-of-year.
 * Placeholder events are defined here; replace with researched canon
 * from worldbuilder when available.
 *
 * All days are 1-based (1 = first day of the year, 365 = last day).
 */

import type { Season } from './journey-graph'

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

/** Format a day-of-year as "Day N (Season)". */
export function formatDayOfYear(day: number): string {
  const d = clampDayOfYear(day)
  const season = dayToSeason(d)
  return `Day ${d} (${season})`
}

/* ─── Event queries ───────────────────────────────────────────────── */

/** Return true if `day` falls within [startDay, startDay + durationDays). */
export function eventActiveOn(event: CalendarEvent, day: number): boolean {
  const d = clampDayOfYear(day)
  const s = event.startDay
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

/* ─── Placeholder calendar data ─────────────────────────────────────
 * Replace with researched canon from worldbuilder.
 * Each civilization should have festivals, harvests, trade fairs, etc.
 */

export const VEYDRIA_CALENDAR: CalendarEvent[] = [
  // ── Oravan (maritime, monsoon-gated) ─────────────────────────────
  {
    id: 'oravan-spice-harvest',
    name: 'Spice Harvest',
    civilization: 'oravan',
    type: 'harvest',
    startDay: 130,
    durationDays: 21,
    description: 'Oravan archipelago spice harvest aligns with the sailing window.',
    effect: 'Spice prices halved in Oravan ports. Maritime traffic peaks.',
    season: 'spring',
  },
  {
    id: 'oravan-monsoon-departure',
    name: 'Monsoon Departure',
    civilization: 'oravan',
    type: 'monsoon',
    startDay: 90,
    durationDays: 14,
    description: 'SE trade season opens. Fleet captains race to be first through Halkar Straits.',
    season: 'spring',
  },
  {
    id: 'oravan-wave-tithe',
    name: 'Wave-Tithe',
    civilization: 'oravan',
    type: 'religious',
    startDay: 200,
    durationDays: 7,
    description: 'Annual tribute to the sea. Queen-church collects from every vessel.',
    season: 'summer',
  },

  // ── Ndjadi (equatorial grain basin) ──────────────────────────────
  {
    id: 'ndjadi-planting',
    name: 'Delta Planting',
    civilization: 'ndjadi',
    type: 'harvest',
    startDay: 60,
    durationDays: 14,
    description: 'Stone barays are opened and the delta fields are sown.',
    effect: 'Labour shortages as every hand is in the fields.',
    season: 'spring',
  },
  {
    id: 'ndjadi-first-flood',
    name: 'First Flood',
    civilization: 'ndjadi',
    type: 'misc',
    startDay: 160,
    durationDays: 10,
    description: 'The A-Tzalan tributaries swell. River traffic becomes unpredictable.',
    season: 'summer',
  },

  // ── Irrah (arid interior, caravans) ──────────────────────────────
  {
    id: 'irrah-date-harvest',
    name: 'Date Harvest',
    civilization: 'irrah',
    type: 'harvest',
    startDay: 250,
    durationDays: 18,
    description: 'Irrah oasis date harvest. Caravans load for the Basin markets.',
    effect: 'Date prices collapse locally; Basin markets see glut in 2–3 weeks.',
    season: 'autumn',
  },
  {
    id: 'irrah-sand-still',
    name: 'Sand Still',
    civilization: 'irrah',
    type: 'religious',
    startDay: 1,
    durationDays: 5,
    description: 'New year observance. No caravan moves for five days.',
    season: 'winter',
  },

  // ── Kheshkai (highland steppes, metallurgy) ──────────────────────
  {
    id: 'kheshkai-smelt-bloom',
    name: 'Smelt Bloom',
    civilization: 'kheshkai',
    type: 'trade',
    startDay: 110,
    durationDays: 12,
    description: 'Highland furnaces reach peak output. Steel flows to the Basin.',
    effect: 'Metal prices drop 20% while bloom lasts.',
    season: 'spring',
  },
  {
    id: 'kheshkai-shaman-conclave',
    name: 'Shaman Conclave',
    civilization: 'kheshkai',
    type: 'religious',
    startDay: 330,
    durationDays: 7,
    description: 'Triennial gathering of Kheshkai shamans at the Cloud-Steppe Border.',
    effect: 'Calendar-keepers from Qollari attend. Border towns swell.',
    season: 'winter',
  },

  // ── Qollari (cloud forest, calendar-keepers) ─────────────────────
  {
    id: 'qollari-calendar-rite',
    name: 'Calendar Rite',
    civilization: 'qollari',
    type: 'religious',
    startDay: 80,
    durationDays: 5,
    description: 'Calendar-keepers recalibrate the continental relay schedule.',
    effect: 'Pass access may be restricted during the rite.',
    season: 'spring',
  },
  {
    id: 'qollari-mist-market',
    name: 'Mist Market',
    civilization: 'qollari',
    type: 'trade',
    startDay: 180,
    durationDays: 10,
    description: 'Cloud-forest medicinal barks and dyes sold before the monsoon closes the passes.',
    season: 'summer',
  },

  // ── Ngaru-Bon (alpine, metallurgical exports) ────────────────────
  {
    id: 'ngaru-bon-ice-road',
    name: 'Ice Road Opening',
    civilization: 'ngaru-bon',
    type: 'trade',
    startDay: 45,
    durationDays: 20,
    description: 'High-altitude ice roads become passable. Ore caravans descend.',
    effect: 'Ngaru-Bon metallurgical exports reach Basin markets.',
    season: 'spring',
  },
  {
    id: 'ngaru-bon-long-night',
    name: 'Long Night',
    civilization: 'ngaru-bon',
    type: 'religious',
    startDay: 355,
    durationDays: 11,
    description: 'Deep winter festival. Fires burn on every ridge.',
    season: 'winter',
  },

  // ── Aethelian Basin (pan-civ port network) ───────────────────────
  {
    id: 'basin-convocation',
    name: 'Port Convocation',
    civilization: 'all',
    type: 'political',
    startDay: 140,
    durationDays: 7,
    description: 'The six port cities convene to set tariffs and resolve disputes.',
    effect: 'Trade policy shifts. Some routes may be newly taxed or exempted.',
    season: 'spring',
  },
  {
    id: 'basin-monsoon-shift',
    name: 'Monsoon Shift',
    civilization: 'all',
    type: 'monsoon',
    startDay: 270,
    durationDays: 21,
    description: 'NW monsoon begins. Maritime routes to Oravan become marginal.',
    effect: 'Coastal travel slower. Cyclone risk at transition.',
    season: 'autumn',
  },
]

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
  political: '⚖',
  trade: '⚖',
  misc: '📌',
}
