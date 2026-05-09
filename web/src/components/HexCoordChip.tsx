interface Props {
  label: string
  descriptors: string[]
}

export default function HexCoordChip({ label, descriptors }: Props) {
  return (
    <div className="hex-coord-chip" role="status" aria-live="polite">
      <span className="hex-coord-chip-label">{label}</span>
      {descriptors.length > 0 && (
        <>
          <span className="hex-coord-chip-sep">·</span>
          <span className="hex-coord-chip-descriptors">{descriptors.join(', ')}</span>
        </>
      )}
    </div>
  )
}
