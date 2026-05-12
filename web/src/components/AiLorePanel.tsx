import { useState, useCallback, useEffect, useRef } from 'react'
import type { GeoJSONFeature } from '../App'
import {
  type AiLoreType,
  type AiLoreResult,
  loadAiLoreSettings,
  fetchAiLore,
  generateMockLore,
  getCachedLore,
  setCachedLore,
} from '../utils/ai-lore'

type LoreTab = 'rumors' | 'npcs' | 'tensions'

interface AiLorePanelProps {
  feature: GeoJSONFeature | null
  onOpenSettings?: () => void
}

const TAB_LABELS: Record<LoreTab, string> = {
  rumors: 'Rumours',
  npcs: 'NPCs',
  tensions: 'Tensions',
}

const TAB_ICONS: Record<LoreTab, string> = {
  rumors: '💬',
  npcs: '👤',
  tensions: '⚡',
}

interface TabState {
  content: string
  loading: boolean
  error: string | null
}

function getFeatureId(feature: GeoJSONFeature): string {
  return (feature.properties.id as string) || (feature as unknown as Record<string, unknown>).id as string || ''
}

export default function AiLorePanel({ feature, onOpenSettings }: AiLorePanelProps) {
  const [activeTab, setActiveTab] = useState<LoreTab>('rumors')
  const [tabStates, setTabStates] = useState<Record<LoreTab, TabState>>({
    rumors: { content: '', loading: false, error: null },
    npcs: { content: '', loading: false, error: null },
    tensions: { content: '', loading: false, error: null },
  })
  const abortRef = useRef<AbortController | null>(null)

  // Reset state when feature changes
  useEffect(() => {
    if (!feature) {
      setTabStates({
        rumors: { content: '', loading: false, error: null },
        npcs: { content: '', loading: false, error: null },
        tensions: { content: '', loading: false, error: null },
      })
      return
    }

    const id = getFeatureId(feature)
    if (!id) return

    const settings = loadAiLoreSettings()
    const hasKey = !!settings.apiKey

    setTabStates((prev) => {
      const next: Record<LoreTab, TabState> = { ...prev }
      ;(['rumors', 'npcs', 'tensions'] as LoreTab[]).forEach((type) => {
        const cached = getCachedLore(id, type)
        if (cached) {
          next[type] = { content: cached, loading: false, error: null }
        } else if (!hasKey) {
          // Auto-generate mock content when no API key
          const mock = generateMockLore(feature, type)
          setCachedLore(id, type, mock)
          next[type] = { content: mock, loading: false, error: null }
        } else {
          next[type] = { content: '', loading: false, error: null }
        }
      })
      return next
    })

    return () => {
      abortRef.current?.abort()
    }
  }, [feature])

  const handleGenerate = useCallback(async (type: LoreTab) => {
    if (!feature) return
    const id = getFeatureId(feature)
    if (!id) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setTabStates((prev) => ({ ...prev, [type]: { ...prev[type], loading: true, error: null } }))

    try {
      const settings = loadAiLoreSettings()
      let result: AiLoreResult

      if (!settings.apiKey) {
        // Mock mode: regenerate with a time-based seed variation
        const mock = generateMockLore(feature, type)
        setCachedLore(id, type, mock)
        result = { content: mock, cached: false }
      } else {
        result = await fetchAiLore(feature, type, settings)
      }

      if (controller.signal.aborted) return
      setTabStates((prev) => ({ ...prev, [type]: { content: result.content, loading: false, error: null } }))
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'Unknown error'
      setTabStates((prev) => ({ ...prev, [type]: { ...prev[type], loading: false, error: message } }))
    }
  }, [feature])

  if (!feature) return null

  const currentState = tabStates[activeTab]
  const settings = loadAiLoreSettings()
  const hasApiKey = !!settings.apiKey
  const id = getFeatureId(feature)
  const hasContent = !!currentState.content

  return (
    <div className="info-field info-field--ai-lore" key="ai-lore">
      <div className="info-field-header">
        <div className="info-field-label">AI Lore</div>
        <button
          className="info-hooks-roll-btn"
          onClick={() => handleGenerate(activeTab)}
          title={hasContent ? 'Regenerate' : 'Generate'}
          aria-label={hasContent ? 'Regenerate' : 'Generate'}
          disabled={currentState.loading}
        >
          {currentState.loading ? '⋯' : `⟳ ${hasContent ? 'Regenerate' : 'Generate'}`}
        </button>
      </div>

      {/* Tab bar */}
      <div className="ai-lore-tabs">
        {(['rumors', 'npcs', 'tensions'] as LoreTab[]).map((tab) => (
          <button
            key={tab}
            className={`ai-lore-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
          >
            <span className="ai-lore-tab-icon">{TAB_ICONS[tab]}</span>
            <span className="ai-lore-tab-label">{TAB_LABELS[tab]}</span>
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="ai-lore-content">
        {currentState.loading && (
          <div className="ai-lore-skeleton">
            <div className="ai-lore-skeleton-line" />
            <div className="ai-lore-skeleton-line short" />
            <div className="ai-lore-skeleton-line" />
            <div className="ai-lore-skeleton-line short" />
            <div className="ai-lore-skeleton-line" />
            <div className="ai-lore-skeleton-line short" />
          </div>
        )}

        {currentState.error && (
          <div className="ai-lore-error">
            <p className="ai-lore-error-text">{currentState.error}</p>
            {!hasApiKey && (
              <button className="ai-lore-settings-link" onClick={onOpenSettings}>
                Open settings to add an API key
              </button>
            )}
          </div>
        )}

        {!currentState.loading && !currentState.error && hasContent && (
          <div className="ai-lore-text">
            {currentState.content.split('\n\n').map((paragraph, i) => (
              <p key={i} className="ai-lore-paragraph">{paragraph}</p>
            ))}
          </div>
        )}

        {!currentState.loading && !currentState.error && !hasContent && (
          <div className="ai-lore-placeholder">
            <p>
              {hasApiKey
                ? `Click Generate to create ${TAB_LABELS[activeTab].toLowerCase()} for this location.`
                : `Mock-mode content is generated automatically. Add an API key in settings for richer, AI-generated content.`}
            </p>
            {!hasApiKey && (
              <button className="ai-lore-settings-link" onClick={onOpenSettings}>
                Open settings
              </button>
            )}
          </div>
        )}
      </div>

      {!hasApiKey && hasContent && (
        <div className="ai-lore-mock-badge">
          <span className="ai-lore-mock-dot" />
          Mock mode — add an API key for AI-generated content
        </div>
      )}
    </div>
  )
}
