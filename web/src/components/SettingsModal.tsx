import { useState, useEffect, useRef, useCallback } from 'react'
import { loadAiLoreSettings, saveAiLoreSettings, clearAiLoreCache } from '../utils/ai-lore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [showKey, setShowKey] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      const settings = loadAiLoreSettings()
      setApiKey(settings.apiKey ?? '')
      setEndpoint(settings.endpoint)
      setModel(settings.model)
      setTemperature(settings.temperature)
      setSavedFlash(false)
      // Focus the first input after mount
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleSave = useCallback(() => {
    saveAiLoreSettings({
      apiKey: apiKey.trim() || null,
      endpoint: endpoint.trim() || 'https://api.openai.com/v1/chat/completions',
      model: model.trim() || 'gpt-4o-mini',
      temperature,
    })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1200)
  }, [apiKey, endpoint, model])

  const handleClearCache = useCallback(() => {
    clearAiLoreCache()
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1200)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  if (!open) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div
        className="search-modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="search-input-row">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>Settings</span>
          <button
            onClick={onClose}
            aria-label="Close settings"
            title="Close (Esc)"
            style={{
              width: 28, height: 28, border: '1px solid var(--border-subtle)',
              borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-section">
            <h3 className="settings-section-title">AI Lore</h3>
            <p className="settings-section-desc">
              Configure an OpenAI-compatible API to generate richer rumours, NPCs, and tensions per feature.
              Without a key, mock content is generated automatically.
            </p>

            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-api-key">API Key</label>
              <div className="settings-input-row">
                <input
                  id="settings-api-key"
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  className="settings-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                />
                <button
                  className="settings-toggle-btn"
                  onClick={() => setShowKey((v) => !v)}
                  type="button"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-endpoint">Endpoint</label>
              <input
                id="settings-endpoint"
                type="url"
                className="settings-input"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.openai.com/v1/chat/completions"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-model">Model</label>
              <input
                id="settings-model"
                type="text"
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-temperature">
                Temperature
                <span className="settings-slider-value">{temperature.toFixed(1)}</span>
              </label>
              <div className="settings-slider-row">
                <span className="settings-slider-label">Grounded</span>
                <input
                  id="settings-temperature"
                  type="range"
                  className="settings-slider"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
                <span className="settings-slider-label">Creative</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <div className="settings-footer-left">
            <button className="settings-btn settings-btn--secondary" onClick={handleClearCache} type="button">
              Clear AI cache
            </button>
            {savedFlash && <span className="settings-saved-flash">Saved ✓</span>}
          </div>
          <div className="settings-footer-right">
            <button className="settings-btn settings-btn--primary" onClick={handleSave} type="button">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
