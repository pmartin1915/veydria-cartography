import { useState, useRef, useEffect, useCallback } from 'react'
import { exportCampaign } from '../persistence/campaign-export'
import { importCampaign } from '../persistence/campaign-import'
import { getCampaignIO } from '../persistence/campaign-io'
import { reportSaveFailure } from '../persistence/save-status'
import { kvStore } from '../persistence/kv-store'

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

  const handleSave = useCallback(async () => {
    setOpen(false)
    const data = JSON.stringify(exportCampaign(), null, 2)
    const date = new Date().toISOString().slice(0, 10)
    const io = await getCampaignIO()
    const result = await io.save(`veydria-campaign-${date}.json`, data)
    if (result.error) {
      // A write that the user asked for failed — surface it where WebView2 can't
      // swallow it (the success toast is silent on desktop, the failure must not be).
      reportSaveFailure(result.error)
    } else if (result.saved) {
      onToast?.('Campaign saved')
    }
  }, [onToast])

  const handleOpenOrImport = useCallback(async (mode: PendingMode) => {
    setOpen(false)
    const io = await getCampaignIO()
    const picked = await io.open()
    if (!picked) return // user cancelled
    let parsed: unknown
    try {
      parsed = JSON.parse(picked.json)
    } catch (err) {
      setConfirm({ mode, filename: picked.name, error: err instanceof Error ? err.message : String(err) })
      return
    }
    setConfirm({ mode, filename: picked.name, parsed })
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

  const handleConfirm = useCallback(async () => {
    if (!confirm || confirm.error) return
    try {
      importCampaign(confirm.parsed, confirm.mode === 'open' ? 'replace' : 'merge')
      // Desktop: importCampaign wrote into the debounced disk cache. Drain it to disk
      // BEFORE reload tears down the JS realm — otherwise boot re-hydrates the stale
      // store file and the import silently vanishes. No-op on web (sync localStorage).
      await kvStore.flush()
      window.location.reload()
    } catch (e) {
      // flush rejected (disk full / USB ejected): reloading now would re-hydrate stale
      // disk and lose the in-memory import. Keep the session and surface the error.
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
            <button className="share-popover-action" onClick={() => handleOpenOrImport('open')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="share-popover-action-text">
                <span className="share-popover-action-label">Open campaign</span>
                <span className="share-popover-action-hint">Replace current data from a file</span>
              </span>
            </button>
            <button className="share-popover-action" onClick={() => handleOpenOrImport('import')}>
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
