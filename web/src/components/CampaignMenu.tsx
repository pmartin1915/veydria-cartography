import { useState, useRef, useEffect, useCallback } from 'react'
import { exportCampaign } from '../persistence/campaign-export'
import { importCampaign } from '../persistence/campaign-import'

interface CampaignMenuProps {
  onToast?: (msg: string) => void
}

type PendingMode = 'open' | 'import'

interface ConfirmState {
  mode: PendingMode
  filename: string
  parsed?: unknown
  error?: string
}

export function CampaignMenu({ onToast }: CampaignMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingModeRef = useRef<PendingMode>('open')
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const modalWasOpenRef = useRef(false)

  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  const toggleOpen = useCallback(() => {
    setOpen(prev => {
      if (!prev && menuRef.current) {
        const r = menuRef.current.getBoundingClientRect()
        setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
      }
      return !prev
    })
  }, [])

  // Close dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSave = useCallback(() => {
    const data = JSON.stringify(exportCampaign(), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().slice(0, 10)
    a.download = `veydria-campaign-${date}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    onToast?.('Campaign saved')
    setOpen(false)
    // Phase 6: reroute through Tauri save dialog.
  }, [onToast])

  const triggerFilePick = useCallback((mode: PendingMode) => {
    pendingModeRef.current = mode
    setOpen(false)
    // Defer click so the dropdown has rendered its close before the OS dialog opens.
    queueMicrotask(() => {
      fileInputRef.current?.click()
    })
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const mode = pendingModeRef.current
    const filename = file.name
    let parsed: unknown
    try {
      const text = await file.text()
      parsed = JSON.parse(text)
    } catch (err) {
      setConfirm({ mode, filename, error: err instanceof Error ? err.message : String(err) })
      return
    }
    setConfirm({ mode, filename, parsed })
  }, [])

  // Modal focus management + Escape close. On open: focus the safe default (Cancel).
  // On close: return focus to the trigger — but only if a modal was actually open, so we
  // never steal focus to the Campaign button on initial mount.
  useEffect(() => {
    if (confirm) {
      modalWasOpenRef.current = true
      cancelButtonRef.current?.focus()
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setConfirm(null)
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
    if (modalWasOpenRef.current) {
      modalWasOpenRef.current = false
      triggerRef.current?.focus()
    }
  }, [confirm])

  const handleConfirm = useCallback(() => {
    if (!confirm || confirm.error) return
    try {
      importCampaign(confirm.parsed, confirm.mode === 'open' ? 'replace' : 'merge')
      window.location.reload()
    } catch (e) {
      setConfirm(prev => (prev ? { ...prev, error: e instanceof Error ? e.message : String(e) } : prev))
    }
  }, [confirm])

  const warningId = 'campaign-import-warning'

  return (
    <>
      <div className="share-menu" ref={menuRef}>
        <button
          ref={triggerRef}
          className={`search-trigger ${open ? 'active' : ''}`}
          onClick={toggleOpen}
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Campaign save / open / import"
          id="campaign-menu-trigger"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span>Campaign&nbsp;▾</span>
        </button>
        {open && (
          <div
            className="share-popover"
            role="dialog"
            aria-label="Campaign menu"
            style={pos ? { top: pos.top, right: pos.right } : undefined}
          >
            <h3 className="share-popover-title">Campaign</h3>
            <button className="share-popover-action" onClick={handleSave}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="share-popover-action-text">
                <span className="share-popover-action-label">Save campaign</span>
                <span className="share-popover-action-hint">Download a backup JSON file</span>
              </span>
            </button>
            <button className="share-popover-action" onClick={() => triggerFilePick('open')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="share-popover-action-text">
                <span className="share-popover-action-label">Open campaign</span>
                <span className="share-popover-action-hint">Replace current data from a file</span>
              </span>
            </button>
            <button className="share-popover-action" onClick={() => triggerFilePick('import')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
              <span className="share-popover-action-text">
                <span className="share-popover-action-label">Import &amp; merge</span>
                <span className="share-popover-action-hint">Add/update items without losing data</span>
              </span>
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        multiple={false}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {confirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1700,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirm(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={confirm.mode === 'open' ? 'Open campaign?' : 'Import & merge?'}
            aria-describedby={warningId}
            style={{
              width: 'min(360px, calc(100vw - 32px))',
              padding: '18px',
              border: '1px solid var(--border-accent)',
              borderRadius: '10px',
              background: 'var(--bg-elevated)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              color: 'var(--text-primary)',
            }}
          >
            <h3
              style={{
                margin: '0 0 10px',
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--color-port)',
                letterSpacing: '0.3px',
              }}
            >
              {confirm.mode === 'open' ? 'Open campaign?' : 'Import & merge?'}
            </h3>
            <p
              id={warningId}
              style={{
                margin: '0 0 16px',
                fontSize: '12px',
                lineHeight: 1.55,
                color: 'var(--text-secondary)',
              }}
            >
              {confirm.mode === 'open'
                ? `This replaces your current annotations, journeys, notes, stars, prep, hooks, and layer presets with the contents of ${confirm.filename}.`
                : `This merges ${confirm.filename} into your current campaign (existing items are kept; matching items are updated).`}
            </p>
            {confirm.error && (
              <div
                style={{
                  margin: '0 0 16px',
                  padding: '10px 12px',
                  border: '1px solid var(--color-ruin, #c06040)',
                  borderRadius: '6px',
                  background: 'rgba(192,96,64,0.12)',
                  color: 'var(--text-primary)',
                  fontSize: '11.5px',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {confirm.error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                ref={cancelButtonRef}
                className="search-trigger"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="search-trigger"
                style={{
                  borderColor: 'var(--color-port)',
                  color: 'var(--bg-deep)',
                  background: 'var(--color-port)',
                }}
                onClick={handleConfirm}
                disabled={!!confirm.error}
              >
                {confirm.mode === 'open' ? 'Open' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
