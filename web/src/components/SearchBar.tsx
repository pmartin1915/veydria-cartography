import { useState, useEffect, useRef, useMemo } from 'react'

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
  onSelect: (feature: GeoJSONFeature) => void
  onClose: () => void
}

// Category icons
const CATEGORY_ICONS: Record<string, string> = {
  civilization: '🏛',
  port: '⚓',
  chokepoint: '⛨',
  oasis: '🌿',
  contested_site: '✧',
  trade_route: '⤳',
  landmark: '◆',
  river: '〜',
  water: '🌊',
}

export default function SearchBar({ features, onSelect, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Filter features by query
  const results = useMemo(() => {
    if (!query.trim()) {
      // Show all named features, grouped by category
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

    const q = query.toLowerCase()
    return features
      .filter((f) => {
        const name = ((f.properties.name as string) || '').toLowerCase()
        const category = ((f.properties.category as string) || '').toLowerCase()
        const desc = ((f.properties.description as string) || '').toLowerCase()
        const etymology = ((f.properties.etymology as string) || '').toLowerCase()
        return name.includes(q) || category.includes(q) || desc.includes(q) || etymology.includes(q)
      })
      .sort((a, b) => {
        const aName = ((a.properties.name as string) || '').toLowerCase()
        const bName = ((b.properties.name as string) || '').toLowerCase()
        // Prioritize name matches at start
        const aStarts = aName.startsWith(q) ? -1 : 0
        const bStarts = bName.startsWith(q) ? -1 : 0
        if (aStarts !== bStarts) return aStarts - bStarts
        return aName.localeCompare(bName)
      })
  }, [features, query])

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
          onSelect(results[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div className="search-overlay" onClick={onClose} id="search-overlay">
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search features by name, type, or description..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            id="search-input"
          />
          <span className="search-count">{results.length}</span>
        </div>

        <div className="search-results" ref={listRef}>
          {results.slice(0, 30).map((feature, i) => {
            const category = (feature.properties.category as string) || 'unknown'
            const icon = CATEGORY_ICONS[category] || '•'
            const name = (feature.properties.name as string) || 'Unknown'
            const type = (feature.properties.type as string) || ''

            return (
              <button
                key={`${feature.properties.id}-${i}`}
                className={`search-result-item ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(feature)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="search-result-icon">{icon}</span>
                <div className="search-result-text">
                  <span className="search-result-name">{name}</span>
                  <span className="search-result-meta">
                    {category.replace('_', ' ')}
                    {type ? ` · ${type}` : ''}
                  </span>
                </div>
              </button>
            )
          })}
          {results.length === 0 && (
            <div className="search-empty">No features match "{query}"</div>
          )}
        </div>

        <div className="search-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}
