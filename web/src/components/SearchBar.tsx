import { useState, useEffect, useRef, useMemo, useDeferredValue } from 'react'
import { NodeIcon } from './icons'
import { loadRecentItems, pushRecentItem, type RecentItem } from '../utils/search-recent'
import type { MapAnnotation } from '../utils/annotations'

interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

interface SearchBarProps {
  features: GeoJSONFeature[]
  annotations?: MapAnnotation[]
  starredIds?: string[]
  onSelect: (feature: GeoJSONFeature) => void
  onClose: () => void
  exiting?: boolean
}

export default function SearchBar({ features, annotations = [], starredIds = [], onSelect, onClose, exiting = false }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query)
  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => loadRecentItems())

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Pre-built search index for fast filtering
  const searchIndex = useMemo(() => {
    return features.map((f) => ({
      feature: f,
      name: ((f.properties.name as string) || '').toLowerCase(),
      category: ((f.properties.category as string) || '').toLowerCase(),
      description: ((f.properties.description as string) || '').toLowerCase(),
      etymology: ((f.properties.etymology as string) || '').toLowerCase(),
    }))
  }, [features])

  // Civilization names for quick chips
  const civNames = useMemo(() => {
    const names = features
      .filter((f) => f.properties.category === 'civilization' && f.properties.name)
      .map((f) => (f.properties.name as string))
    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }, [features])

  // Linked pins: annotations with a resolved feature
  const linkedPins = useMemo(() => {
    const featureMap = new Map<string, GeoJSONFeature>()
    for (const f of features) {
      const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
      if (id) featureMap.set(id, f)
    }
    const pins: { annotation: MapAnnotation; feature: GeoJSONFeature }[] = []
    for (const a of annotations) {
      if (a.featureId && a.featureName && featureMap.has(a.featureId)) {
        pins.push({ annotation: a, feature: featureMap.get(a.featureId)! })
      }
    }
    // Most recent first
    return pins.sort((a, b) => b.annotation.createdAt - a.annotation.createdAt).slice(0, 5)
  }, [annotations, features])

  // Resolve starred IDs to actual features
  const starredFeatures = useMemo(() => {
    if (starredIds.length === 0) return []
    const featureMap = new Map<string, GeoJSONFeature>()
    for (const f of features) {
      const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
      if (id) featureMap.set(id, f)
    }
    const out: GeoJSONFeature[] = []
    for (const id of starredIds) {
      const f = featureMap.get(id)
      if (f) out.push(f)
    }
    return out
  }, [starredIds, features])

  // Resolve recent items to actual features (defensive against stale IDs)
  const recentFeatures = useMemo(() => {
    const featureMap = new Map<string, GeoJSONFeature>()
    for (const f of features) {
      const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
      if (id) featureMap.set(id, f)
    }
    const out: GeoJSONFeature[] = []
    for (const item of recentItems) {
      const f = featureMap.get(item.id)
      if (f) out.push(f)
    }
    return out
  }, [recentItems, features])

  // Filter features by deferred query
  const results = useMemo(() => {
    const trimmed = deferredQuery.trim()
    if (!trimmed) {
      // When empty, we show sections (Recent, Linked pins, All features).
      // Return the full browsable list as the "all features" section.
      return features
        .filter((f) => f.properties.name)
        .sort((a, b) => {
          const catOrder: Record<string, number> = {
            port: 0, chokepoint: 1, landmark: 2, oasis: 3,
            contested_site: 4, civilization: 5, trade_route: 6, river: 7, water: 8,
          }
          const ca = catOrder[(a.properties.category as string) || ''] ?? 99
          const cb = catOrder[(b.properties.category as string) || ''] ?? 99
          if (ca !== cb) return ca - cb
          return ((a.properties.name as string) || '').localeCompare((b.properties.name as string) || '')
        })
    }

    const lower = trimmed.toLowerCase()

    // civ: prefix → filter to civilization features
    if (lower.startsWith('civ:')) {
      const rest = lower.slice(4).trim()
      return searchIndex
        .filter((entry) => entry.category === 'civilization' && (!rest || entry.name.includes(rest)))
        .map((entry) => entry.feature)
        .sort((a, b) => {
          const aName = ((a.properties.name as string) || '').toLowerCase()
          const bName = ((b.properties.name as string) || '').toLowerCase()
          if (!rest) return aName.localeCompare(bName)
          const aStarts = aName.startsWith(rest) ? -1 : 0
          const bStarts = bName.startsWith(rest) ? -1 : 0
          if (aStarts !== bStarts) return aStarts - bStarts
          return aName.localeCompare(bName)
        })
    }

    // pin: prefix → filter to linked pins by label/body/featureName
    if (lower.startsWith('pin:')) {
      const rest = lower.slice(4).trim()
      return linkedPins
        .filter(({ annotation }) => {
          if (!rest) return true
          const q = rest
          return (
            annotation.label.toLowerCase().includes(q) ||
            annotation.body.toLowerCase().includes(q) ||
            (annotation.featureName || '').toLowerCase().includes(q)
          )
        })
        .map(({ feature }) => feature)
    }

    // Default fuzzy search
    return searchIndex
      .filter((entry) => {
        return (
          entry.name.includes(lower) ||
          entry.category.includes(lower) ||
          entry.description.includes(lower) ||
          entry.etymology.includes(lower)
        )
      })
      .map((entry) => entry.feature)
      .sort((a, b) => {
        const aName = ((a.properties.name as string) || '').toLowerCase()
        const bName = ((b.properties.name as string) || '').toLowerCase()
        const aStarts = aName.startsWith(lower) ? -1 : 0
        const bStarts = bName.startsWith(lower) ? -1 : 0
        if (aStarts !== bStarts) return aStarts - bStarts
        return aName.localeCompare(bName)
      })
  }, [searchIndex, deferredQuery, features, linkedPins])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  const handleSelect = (feature: GeoJSONFeature) => {
    const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
    const name = (feature.properties.name as string) || 'Unknown'
    const category = (feature.properties.category as string) || 'unknown'
    if (id) {
      pushRecentItem(id, name, category)
      setRecentItems(loadRecentItems())
    }
    onSelect(feature)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  const isEmptyQuery = !deferredQuery.trim()
  const showStarred = isEmptyQuery && starredFeatures.length > 0
  const showRecent = isEmptyQuery && recentFeatures.length > 0
  const showLinkedPins = isEmptyQuery && linkedPins.length > 0
  const showCivChips = isEmptyQuery && civNames.length > 0
  const showAllHeader = isEmptyQuery && (showStarred || showRecent || showLinkedPins)

  const renderFeatureRow = (feature: GeoJSONFeature, i: number, opts?: { icon?: React.ReactNode; metaOverride?: string }) => {
    const category = (feature.properties.category as string) || 'unknown'
    const name = (feature.properties.name as string) || 'Unknown'
    const type = (feature.properties.type as string) || ''
    return (
      <button
        key={`${feature.properties.id}-${i}`}
        className={`search-result-item ${i === selectedIndex ? 'selected' : ''}`}
        onClick={() => handleSelect(feature)}
        onMouseEnter={() => setSelectedIndex(i)}
      >
        <span className="search-result-icon">{opts?.icon ?? <NodeIcon category={category} size={14} />}</span>
        <div className="search-result-text">
          <span className="search-result-name">{name}</span>
          <span className="search-result-meta">
            {opts?.metaOverride ?? category.replace('_', ' ')}
            {type ? ` · ${type}` : ''}
          </span>
        </div>
      </button>
    )
  }

  // Build flat list with section headers for display
  let displayIndex = 0
  const displayItems: React.ReactNode[] = []

  if (showStarred) {
    displayItems.push(
      <div key="starred-header" className="search-section-header">Starred</div>
    )
    for (const f of starredFeatures) {
      displayItems.push(renderFeatureRow(f, displayIndex++, {
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12,2 14.5,9 22,9 16,13.5 18.5,21 12,16.5 5.5,21 8,13.5 2,9 9.5,9"/></svg>,
      }))
    }
  }

  if (showRecent) {
    displayItems.push(
      <div key="recent-header" className="search-section-header">Recent</div>
    )
    for (const f of recentFeatures) {
      displayItems.push(renderFeatureRow(f, displayIndex++))
    }
  }

  if (showLinkedPins) {
    displayItems.push(
      <div key="pins-header" className="search-section-header">Linked pins</div>
    )
    for (const { annotation, feature } of linkedPins) {
      displayItems.push(
        renderFeatureRow(feature, displayIndex++, {
          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 14 6 14s6-9.5 6-14c0-3.3-2.7-6-6-6z"/><circle cx="12" cy="8" r="2.5"/></svg>,
          metaOverride: `Pin · ${annotation.label}`,
        })
      )
    }
  }

  if (showAllHeader) {
    displayItems.push(
      <div key="all-header" className="search-section-header">All features</div>
    )
  }

  for (let i = 0; i < results.slice(0, 30).length; i++) {
    displayItems.push(renderFeatureRow(results[i], displayIndex++))
  }

  if (results.length === 0 && !isEmptyQuery) {
    displayItems.push(
      <div key="empty" className="search-empty">No features match "{query}"</div>
    )
  }

  return (
    <div className={`search-overlay ${exiting ? 'exiting' : ''}`} onClick={onClose} id="search-overlay">
      <div className={`search-modal ${exiting ? 'exiting' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            data-tour="search-input"
            placeholder="Search features by name, type, or description..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            id="search-input"
          />
          <span className="search-count">{results.length}</span>
        </div>

        {showCivChips && (
          <div className="search-civ-chips">
            {civNames.map((name) => (
              <button
                key={name}
                className="search-civ-chip"
                onClick={() => setQuery(`civ:${name.toLowerCase()}`)}
                tabIndex={-1}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="search-results" ref={listRef}>
          {displayItems}
        </div>

        <div className="search-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
          {query.toLowerCase().startsWith('civ:') && <span className="search-footer-hint">civ filter</span>}
          {query.toLowerCase().startsWith('pin:') && <span className="search-footer-hint">pin filter</span>}
        </div>
      </div>
    </div>
  )
}
