import { useSyncExternalStore } from 'react'
import { getSaveStatus, subscribeSaveStatus } from '../persistence/save-status'

/**
 * Renders ONLY when the last persist failed — a quiet, always-truthful "your work
 * may not be saved" badge. This is the desktop substitute for the success toast
 * (which WebView2 swallows); failure is the case that actually matters for the
 * "never lose your work" guarantee.
 */
export function SaveStatusIndicator() {
  const status = useSyncExternalStore(subscribeSaveStatus, getSaveStatus, getSaveStatus)
  if (!status.failed) return null
  return (
    <div className="save-status-failed" role="alert" id="save-status-failed">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>Last save failed{status.message ? ` — ${status.message}` : ''}</span>
    </div>
  )
}
