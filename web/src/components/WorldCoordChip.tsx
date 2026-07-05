interface Props {
  eastKm: number
  northKm: number
}

export default function WorldCoordChip({ eastKm, northKm }: Props) {
  const east = Math.round(eastKm)
  const north = Math.round(northKm)
  return (
    <div className="world-coord-chip" role="status" aria-live="polite">
      <span className="world-coord-chip-label">{east} km E</span>
      <span className="world-coord-chip-sep">·</span>
      <span className="world-coord-chip-value">{north} km N</span>
    </div>
  )
}
