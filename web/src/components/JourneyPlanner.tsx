import { useState, useMemo, useRef, useEffect } from 'react'
import type { GeoJSONCollection } from '../App'
import { buildGraph, findRoute, getJourneyNodes, type JourneyNode, type JourneyRoute } from '../utils/journey-graph'
import { formatDistance } from '../utils/measure'

interface JourneyPlannerProps {
  geojson: GeoJSONCollection
  active: boolean
  onClose: () => void
  onRouteComputed: (route: JourneyRoute | null) => void
}

function formatDays(days: number): string {
  if (days < 0.5) {
    const hours = Math.round(days * 24)
    return `~${hours} hour${hours !== 1 ? 's' : ''}`
  }
  if (days < 2) {
    return `~${Math.round(days * 10) / 10} day`
  }
  return `~${Math.round(days)} days`
}

function NodeIcon({ category }: { category: string }) {
  const icons: Record<string, string> = {
    civilization: '🏛',
    port: '⚓',
    oasis: '🌿',
    landmark: '◆',
    chokepoint: '⛨',
    contested_site: '✧',
  }
  return <span className="journey-node-icon">{icons[category] || '📍'}</span>
}

export default function JourneyPlanner({ geojson, active, onClose, onRouteComputed }: JourneyPlannerProps) {
  const [startId, setStartId] = useState('')
  const [endId, setEndId] = useState('')
  const [route, setRoute] = useState<JourneyRoute | null>(null)
  const [startSearch, setStartSearch] = useState('')
  const [endSearch, setEndSearch] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const startRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const nodes = useMemo(() => getJourneyNodes(geojson), [geojson])

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (startRef.current && !startRef.current.contains(e.target as Node)) setStartOpen(false)
      if (endRef.current && !endRef.current.contains(e.target as Node)) setEndOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset route when closed
  useEffect(() => {
    if (!active) {
      setRoute(null)
      onRouteComputed(null)
      setStartId('')
      setEndId('')
      setStartSearch('')
      setEndSearch('')
    }
  }, [active, onRouteComputed])

  const filteredStart = useMemo(() => {
    const q = startSearch.toLowerCase()
    return nodes.filter(n => n.name.toLowerCase().includes(q) || n.category.includes(q))
  }, [nodes, startSearch])

  const filteredEnd = useMemo(() => {
    const q = endSearch.toLowerCase()
    return nodes.filter(n => n.name.toLowerCase().includes(q) || n.category.includes(q))
  }, [nodes, endSearch])

  const startNode = nodes.find(n => n.id === startId)
  const endNode = nodes.find(n => n.id === endId)

  function handleFindRoute() {
    if (!startId || !endId) return
    const graph = buildGraph(geojson)
    const result = findRoute(graph, startId, endId)
    setRoute(result)
    onRouteComputed(result)
  }

  function handleClear() {
    setRoute(null)
    onRouteComputed(null)
    setStartId('')
    setEndId('')
    setStartSearch('')
    setEndSearch('')
  }

  function handleSwap() {
    const tmp = startId
    setStartId(endId)
    setEndId(tmp)
    setStartSearch(endNode?.name || '')
    setEndSearch(startNode?.name || '')
    setRoute(null)
    onRouteComputed(null)
  }

  if (!active) return null

  return (
    <div className="journey-planner">
      <div className="journey-planner-header">
        <h3 className="journey-planner-title">
          <span className="journey-planner-icon">🧭</span>
          Journey Planner
        </h3>
        <button className="journey-planner-close" onClick={onClose} title="Close (Esc)">×</button>
      </div>

      <div className="journey-planner-body">
        {/* Start selector */}
        <div className="journey-field" ref={startRef}>
          <label className="journey-field-label">From</label>
          <div className="journey-dropdown">
            <button
              className="journey-dropdown-trigger"
              onClick={() => setStartOpen(!startOpen)}
            >
              {startNode ? (
                <>
                  <NodeIcon category={startNode.category} />
                  <span>{startNode.name}</span>
                  <span className="journey-dropdown-cat">{startNode.category.replace('_', ' ')}</span>
                </>
              ) : (
                <span className="journey-dropdown-placeholder">Select starting point...</span>
              )}
              <span className={`journey-dropdown-arrow ${startOpen ? 'open' : ''}`}>▾</span>
            </button>
            {startOpen && (
              <div className="journey-dropdown-menu">
                <input
                  type="text"
                  className="journey-dropdown-search"
                  placeholder="Search..."
                  value={startSearch}
                  onChange={(e) => setStartSearch(e.target.value)}
                  autoFocus
                />
                <div className="journey-dropdown-list">
                  {filteredStart.map(n => (
                    <button
                      key={n.id}
                      className={`journey-dropdown-item ${n.id === startId ? 'selected' : ''}`}
                      onClick={() => {
                        setStartId(n.id)
                        setStartSearch('')
                        setStartOpen(false)
                        setRoute(null)
                        onRouteComputed(null)
                      }}
                    >
                      <NodeIcon category={n.category} />
                      <span className="journey-dropdown-item-name">{n.name}</span>
                      <span className="journey-dropdown-item-cat">{n.category.replace('_', ' ')}</span>
                    </button>
                  ))}
                  {filteredStart.length === 0 && (
                    <div className="journey-dropdown-empty">No matches</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Swap button */}
        <div className="journey-swap-row">
          <button
            className="journey-swap-btn"
            onClick={handleSwap}
            disabled={!startId && !endId}
            title="Swap start and end"
          >
            ⇅
          </button>
        </div>

        {/* End selector */}
        <div className="journey-field" ref={endRef}>
          <label className="journey-field-label">To</label>
          <div className="journey-dropdown">
            <button
              className="journey-dropdown-trigger"
              onClick={() => setEndOpen(!endOpen)}
            >
              {endNode ? (
                <>
                  <NodeIcon category={endNode.category} />
                  <span>{endNode.name}</span>
                  <span className="journey-dropdown-cat">{endNode.category.replace('_', ' ')}</span>
                </>
              ) : (
                <span className="journey-dropdown-placeholder">Select destination...</span>
              )}
              <span className={`journey-dropdown-arrow ${endOpen ? 'open' : ''}`}>▾</span>
            </button>
            {endOpen && (
              <div className="journey-dropdown-menu">
                <input
                  type="text"
                  className="journey-dropdown-search"
                  placeholder="Search..."
                  value={endSearch}
                  onChange={(e) => setEndSearch(e.target.value)}
                  autoFocus
                />
                <div className="journey-dropdown-list">
                  {filteredEnd.map(n => (
                    <button
                      key={n.id}
                      className={`journey-dropdown-item ${n.id === endId ? 'selected' : ''}`}
                      onClick={() => {
                        setEndId(n.id)
                        setEndSearch('')
                        setEndOpen(false)
                        setRoute(null)
                        onRouteComputed(null)
                      }}
                    >
                      <NodeIcon category={n.category} />
                      <span className="journey-dropdown-item-name">{n.name}</span>
                      <span className="journey-dropdown-item-cat">{n.category.replace('_', ' ')}</span>
                    </button>
                  ))}
                  {filteredEnd.length === 0 && (
                    <div className="journey-dropdown-empty">No matches</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="journey-actions">
          <button
            className="journey-btn journey-btn--primary"
            onClick={handleFindRoute}
            disabled={!startId || !endId}
          >
            Find Route
          </button>
          <button
            className="journey-btn"
            onClick={handleClear}
            disabled={!startId && !endId && !route}
          >
            Clear
          </button>
        </div>

        {/* Route results */}
        {route && (
          <div className="journey-route">
            <div className="journey-route-stats">
              <div className="journey-stat">
                <span className="journey-stat-label">Distance</span>
                <span className="journey-stat-value">{formatDistance(route.totalDistanceSvg)}</span>
              </div>
              <div className="journey-stat">
                <span className="journey-stat-label">Est. Travel</span>
                <span className="journey-stat-value">{formatDays(route.estimatedDays)}</span>
              </div>
              <div className="journey-stat">
                <span className="journey-stat-label">Segments</span>
                <span className="journey-stat-value">{route.edges.length}</span>
              </div>
            </div>

            {/* Path timeline */}
            <div className="journey-route-path">
              <div className="journey-path-line" />
              {route.nodes.map((node, i) => (
                <div key={node.id} className="journey-path-node">
                  <div className={`journey-path-dot ${i === 0 ? 'start' : i === route.nodes.length - 1 ? 'end' : 'waypoint'}`} />
                  <div className="journey-path-info">
                    <span className="journey-path-name">
                      <NodeIcon category={node.category} />
                      {node.name}
                    </span>
                    {i < route.edges.length && (
                      <span className="journey-path-edge">
                        {route.edges[i].type === 'trade_route' && '📜'}
                        {route.edges[i].type === 'chokepoint' && '⛰'}
                        {route.edges[i].type === 'intra_civ' && '→'}
                        {route.edges[i].type === 'civ_link' && '→'}
                        {' '}{route.edges[i].name}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Bottlenecks */}
            {route.bottlenecks.length > 0 && (
              <div className="journey-bottlenecks">
                <div className="journey-bottlenecks-title">⚠️ Bottlenecks & Risks</div>
                {route.bottlenecks.map((b, i) => (
                  <div key={i} className="journey-bottleneck">{b}</div>
                ))}
              </div>
            )}

            {route.bottlenecks.length === 0 && (
              <div className="journey-no-bottlenecks">✓ No major bottlenecks on this route</div>
            )}

            {/* Seasonal warnings */}
            {route.seasonalWarnings.length > 0 && (
              <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
                <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}>🌦️ Seasonal Restrictions</div>
                {route.seasonalWarnings.map((w, i) => (
                  <div key={i} className="journey-bottleneck">{w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {route === null && startId && endId && (
          <div className="journey-no-route">
            No route found between these locations.
          </div>
        )}
      </div>
    </div>
  )
}
