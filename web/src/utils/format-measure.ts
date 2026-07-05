/**
 * Shared formatting helpers for the freehand ruler and measure panel.
 */

export function formatDays(days: number): string {
  const rounded = Math.round(days)
  if (rounded >= 1) return `~${rounded}d`
  return '<1d'
}
