import { useState, useEffect, useRef } from 'react'
import type { HexCell } from '../utils/hex-grid'
import { hexNeighbors, labelHex } from '../utils/hex-grid'
import type { MapAnnotation } from '../utils/annotations'
import { ANNOTATION_COLORS, DEFAULT_ANNOTATION_COLOR } from '../utils/annotations'

interface Props {
  hex: HexCell
  descriptors: string[]
  onClose: () => void
  onCentre?: () => void
  annotations?: MapAnnotation[]
  onAddAnnotation?: (hexLabel: string, x: number, y: number, label: string, body: string, color: string) => void
  onSelectAnnotation?: (annotation: MapAnnotation) => void
  highlightNotes?: boolean
}

export default function HexInfoPanel({ hex, descriptors, onClose, onCentre, annotations, onAddAnnotation, onSelectAnnotation, highlightNotes }: Props) {
  const neighbours = hexNeighbors(hex.coord).map(labelHex)
  const hexNotes = (annotations || []).filter((a) => a.hexLabel === hex.label)
  const [adding, setAdding] = useState(false)
  const [noteLabel, setNoteLabel] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [noteColor, setNoteColor] = useState(DEFAULT_ANNOTATION_COLOR)

  const handleAdd = () => {
    if (!onAddAnnotation) return
    if (!noteLabel.trim()) return
    onAddAnnotation(hex.label, hex.centroid[0], hex.centroid[1], noteLabel.trim(), noteBody, noteColor)
    // Reset form
    setAdding(false)
    setNoteLabel('')
    setNoteBody('')
    setNoteColor(DEFAULT_ANNOTATION_COLOR)
  }

  const notesRef = useRef<HTMLDivElement>(null)
  const [didHighlight, setDidHighlight] = useState(false)

  useEffect(() => {
    if (highlightNotes && !didHighlight && notesRef.current) {
      notesRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      notesRef.current.classList.add('hex-notes-flash')
      const t = window.setTimeout(() => {
        notesRef.current?.classList.remove('hex-notes-flash')
        setDidHighlight(true)
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [highlightNotes, didHighlight])

  const handleStartAdd = () => {
    setAdding(true)
    setNoteLabel('Hex Note')
    setNoteBody('')
    setNoteColor(DEFAULT_ANNOTATION_COLOR)
  }

  return (
    <aside className="hex-info-panel" role="dialog" aria-label={`Hex ${hex.label}`}>
      <header className="hex-info-panel-header">
        <span className="hex-info-panel-coord">{hex.label}</span>
        <div className="hex-info-panel-actions">
          {onCentre && (
            <button
              type="button"
              className="hex-info-panel-action"
              onClick={onCentre}
              aria-label={`Centre map on hex ${hex.label}`}
              title="Centre on hex"
            >
              ⊙
            </button>
          )}
          <button type="button" className="hex-info-panel-close" onClick={onClose} aria-label="Close hex panel">×</button>
        </div>
      </header>
      <div className="hex-info-panel-body">
        <div className="hex-info-panel-row">
          <span className="hex-info-panel-key">Terrain</span>
          <span className="hex-info-panel-val">
            {descriptors.length > 0 ? descriptors.join(', ') : 'Open Sea'}
          </span>
        </div>
        <div className="hex-info-panel-row">
          <span className="hex-info-panel-key">Neighbours</span>
          <span className="hex-info-panel-val hex-info-panel-neighbours">
            {neighbours.join(' · ')}
          </span>
        </div>

        {/* Hex Notes */}
        <div className="hex-info-panel-row" ref={notesRef}>
          <div className="hex-info-panel-key" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Notes</span>
            {onAddAnnotation && !adding && (
              <button
                type="button"
                className="hex-note-add-btn"
                onClick={handleStartAdd}
                title="Add note to this hex"
              >
                + Add
              </button>
            )}
          </div>
          {hexNotes.length > 0 && (
            <div className="hex-notes-list">
              {hexNotes.map((ann) => {
                const snippet = ann.body
                  ? ann.body.slice(0, 60) + (ann.body.length > 60 ? '…' : '')
                  : ''
                return (
                  <button
                    key={ann.id}
                    type="button"
                    className="hex-note-item"
                    onClick={() => onSelectAnnotation?.(ann)}
                    title={ann.label}
                  >
                    <span
                      className="hex-note-dot"
                      style={{ background: ann.color }}
                      aria-hidden="true"
                    />
                    <span className="hex-note-label">{ann.label}</span>
                    {snippet && (
                      <span className="hex-note-snippet">{snippet}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {adding && (
            <div className="hex-note-form">
              <input
                type="text"
                className="hex-note-input"
                value={noteLabel}
                onChange={(e) => setNoteLabel(e.target.value)}
                placeholder="Label..."
                autoFocus
              />
              <textarea
                className="hex-note-textarea"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Notes..."
                rows={2}
              />
              <div className="hex-note-colors">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`hex-note-color-btn ${c.value === noteColor ? 'active' : ''}`}
                    style={{ background: c.value }}
                    title={c.label}
                    onClick={() => setNoteColor(c.value)}
                    aria-label={c.label}
                  />
                ))}
              </div>
              <div className="hex-note-actions">
                <button type="button" className="hex-note-save" onClick={handleAdd}>Save</button>
                <button
                  type="button"
                  className="hex-note-cancel"
                  onClick={() => {
                    setAdding(false)
                    setNoteLabel('')
                    setNoteBody('')
                    setNoteColor(DEFAULT_ANNOTATION_COLOR)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {hexNotes.length === 0 && !adding && (
            <span className="hex-info-panel-val" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
              No notes for this hex
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}
