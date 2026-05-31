export type TimeOfDay = 'day' | 'dawn' | 'dusk' | 'night'

export const TIME_OF_DAY_ORDER: TimeOfDay[] = ['day', 'dawn', 'dusk', 'night']

export const TIME_OF_DAY_FILTERS: Record<TimeOfDay, string> = {
  day: 'none',
  dawn: 'brightness(0.9) sepia(0.2) hue-rotate(-15deg) saturate(1.05)',
  dusk: 'brightness(0.75) sepia(0.1) hue-rotate(20deg) saturate(0.9)',
  night: 'brightness(0.5) contrast(1.05) hue-rotate(5deg) saturate(0.75)',
}

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  day: 'Day',
  dawn: 'Dawn',
  dusk: 'Dusk',
  night: 'Night',
}

/** Clean unicode glyphs (no emoji) for time-of-day badges — survive markdown copy-paste. */
export const TIME_OF_DAY_GLYPH: Record<TimeOfDay, string> = {
  day: '☼',
  dawn: '◔',
  dusk: '◑',
  night: '☾',
}

const STORAGE_KEY = 'veydria.timeOfDay.v1'

export function cycleTimeOfDay(current: TimeOfDay): TimeOfDay {
  const idx = TIME_OF_DAY_ORDER.indexOf(current)
  return TIME_OF_DAY_ORDER[(idx + 1) % TIME_OF_DAY_ORDER.length]
}

export function loadTimeOfDay(): TimeOfDay {
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
  if (stored && TIME_OF_DAY_ORDER.includes(stored as TimeOfDay)) {
    return stored as TimeOfDay
  }
  return 'day'
}

export function saveTimeOfDay(value: TimeOfDay): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // quota / private mode
  }
}
