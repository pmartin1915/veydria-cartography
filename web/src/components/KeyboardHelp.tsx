interface Shortcut {
  keys: string
  description: string
}

const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + K', description: 'Open search' },
  { keys: '/', description: 'Open search (when not typing)' },
  { keys: 'J', description: 'Toggle journey planner' },
  { keys: 'M', description: 'Toggle measure mode' },
  { keys: 'P', description: 'Toggle pin mode' },
  { keys: 'Esc', description: 'Close panel / search / measure mode' },
  { keys: 'Backspace', description: 'Undo last measure point' },
  { keys: 'Shift + click Snapshot', description: 'Capture without annotation pins (player view)' },
  { keys: 'Shift + ?', description: 'Show this help' },
]

interface KeyboardHelpProps {
  open: boolean
  onClose: () => void
}

export default function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  if (!open) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal keyboard-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M6 12h.01M6 16h.01" />
          </svg>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>Keyboard Shortcuts</span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, border: '1px solid var(--border-subtle)',
              borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        <div className="keyboard-help-body">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="keyboard-help-row">
              <kbd className="keyboard-help-key">{s.keys}</kbd>
              <span className="keyboard-help-desc">{s.description}</span>
            </div>
          ))}
        </div>

        <div className="search-footer">
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}
