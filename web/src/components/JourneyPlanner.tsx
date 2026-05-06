import { useState, useMemo, useRef, useEffect } from 'react'
import type { GeoJSONCollection } from '../App'
import { buildGraph, findRoute, findMultiStopRoute, getJourneyNodes, type JourneyNode, type JourneyRoute, type Season, type RouteMode } from '../utils/journey-graph'
import { loadHistory, addHistoryEntry, deleteHistoryEntry, clearHistory, type HistoryEntry } from '../utils/journey-history'
import { formatDistance } from '../utils/measure'
import { buildHash } from '../utils/url-hash'

interface JourneyPlannerProps {
  geojson: GeoJSONCollection
  active: boolean
  defaultStartId?: string
  defaultEndId?: string
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

export default function JourneyPlanner({ geojson, active, defaultStartId, defaultEndId, onClose, onRouteComputed }: JourneyPlannerProps) {
  const [startId, setStartId] = useState('')
  const [endId, setEndId] = useState('')
  const [route, setRoute] = useState<JourneyRoute | null>(null)
  const [startSearch, setStartSearch] = useState('')
  const [endSearch, setEndSearch] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [exportToast, setExportToast] = useState<string | null>(null)
  const [season, setSeason] = useState<Season | undefined>(undefined)
  const [mode, setMode] = useState<RouteMode>('direct')
  const [waypoints, setWaypoints] = useState<string[]>([])
  const [wpSearch, setWpSearch] = useState('')
  const [wpOpenIdx, setWpOpenIdx] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const startRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const wpRefs = useRef<(HTMLDivElement | null)[]>([])
  const exportToastTimeoutRef = useRef<number | null>(null)
  const didAutoComputeRef = useRef(false)

  const nodes = useMemo(() => getJourneyNodes(geojson), [geojson])
  const graph = useMemo(() => buildGraph(geojson), [geojson])

  const SEASONS: { key: Season; label: string; icon: string }[] = [
    { key: 'spring', label: 'Spring', icon: '🌸' },
    { key: 'summer', label: 'Summer', icon: '☀️' },
    { key: 'autumn', label: 'Autumn', icon: '🍂' },
    { key: 'winter', label: 'Winter', icon: '❄️' },
  ]

  const MODES: { key: RouteMode; label: string; desc: string }[] = [
    { key: 'direct', label: 'Direct', desc: 'Shortest distance' },
    { key: 'fastest', label: 'Fastest', desc: 'Favour trade routes' },
    { key: 'safest', label: 'Safest', desc: 'Avoid chokepoints' },
    { key: 'cheapest', label: 'Cheapest', desc: 'Minimise tolls' },
  ]

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (startRef.current && !startRef.current.contains(e.target as Node)) setStartOpen(false)
      if (endRef.current && !endRef.current.contains(e.target as Node)) setEndOpen(false)
      for (let i = 0; i < wpRefs.current.length; i++) {
        const ref = wpRefs.current[i]
        if (ref && !ref.contains(e.target as Node)) {
          setWpOpenIdx(prev => prev === i ? null : prev)
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Cleanup export toast timeout
  useEffect(() => {
    return () => {
      if (exportToastTimeoutRef.current) clearTimeout(exportToastTimeoutRef.current)
    }
  }, [])

  // Auto-compute route from URL defaults on first mount
  useEffect(() => {
    if (!active || didAutoComputeRef.current) return
    if (defaultStartId && defaultEndId && nodes.some(n => n.id === defaultStartId) && nodes.some(n => n.id === defaultEndId)) {
      didAutoComputeRef.current = true
      setStartId(defaultStartId)
      setEndId(defaultEndId)
      const result = findRoute(graph, defaultStartId, defaultEndId)
      setRoute(result)
      onRouteComputed(result)
    }
  }, [active, defaultStartId, defaultEndId, nodes, graph, onRouteComputed])

  // Reset route when closed
  useEffect(() => {
    if (!active) {
      didAutoComputeRef.current = false
      setRoute(null)
      onRouteComputed(null)
      setStartId('')
      setEndId('')
      setStartSearch('')
      setEndSearch('')
      setWaypoints([])
      setWpSearch('')
      setWpOpenIdx(null)
      setSeason(undefined)
      setMode('direct')
      setExportToast(null)
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

  function computeRoute(s?: Season, m?: RouteMode) {
    if (!startId || !endId) return
    const stops = [startId, ...waypoints, endId]
    const result = stops.length > 2
      ? findMultiStopRoute(graph, stops, s, m)
      : findRoute(graph, startId, endId, s, m)
    setRoute(result)
    onRouteComputed(result)
  }

  function handleFindRoute() {
    computeRoute(season, mode)
  }

  function handleClear() {
    setRoute(null)
    onRouteComputed(null)
    setStartId('')
    setEndId('')
    setStartSearch('')
    setEndSearch('')
    setWaypoints([])
    setWpSearch('')
    setWpOpenIdx(null)
  }

  function handleAddWaypoint() {
    setWaypoints(prev => [...prev, ''])
    setWpOpenIdx(waypoints.length)
    setWpSearch('')
  }

  function handleRemoveWaypoint(idx: number) {
    setWaypoints(prev => prev.filter((_, i) => i !== idx))
    setRoute(null)
    onRouteComputed(null)
  }

  function handleSetWaypoint(idx: number, nodeId: string) {
    setWaypoints(prev => {
      const next = [...prev]
      next[idx] = nodeId
      return next
    })
    setWpOpenIdx(null)
    setWpSearch('')
    setRoute(null)
    onRouteComputed(null)
  }

  function showExportToast(msg: string) {
    setExportToast(msg)
    if (exportToastTimeoutRef.current) clearTimeout(exportToastTimeoutRef.current)
    exportToastTimeoutRef.current = window.setTimeout(() => setExportToast(null), 2000)
  }

  async function handleCopyLink() {
    if (!route) return
    const url = new URL(window.location.href)
    url.hash = buildHash({
      journeyFrom: route.nodes[0]?.id,
      journeyTo: route.nodes[route.nodes.length - 1]?.id,
    })
    try {
      await navigator.clipboard.writeText(url.toString())
      showExportToast('Journey link copied')
    } catch {
      showExportToast('Failed to copy link')
    }
  }

  async function handleCopyJSON() {
    if (!route) return
    const payload = {
      journey: {
        from: route.nodes[0]?.name,
        to: route.nodes[route.nodes.length - 1]?.name,
        distanceKm: Math.round(route.totalKm),
        estimatedDays: Math.round(route.estimatedDays),
        path: route.nodes.map(n => n.name),
        segments: route.edges.map(e => ({
          name: e.name,
          type: e.type,
          bottleneck: e.bottleneck,
          seasonal: e.seasonal,
        })),
        warnings: [...route.bottlenecks, ...route.seasonalWarnings],
      },
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      showExportToast('Journey JSON copied')
    } catch {
      showExportToast('Failed to copy JSON')
    }
  }

  async function handleCopyMarkdown() {
    if (!route) return
    const fromName = route.nodes[0]?.name || 'Unknown'
    const toName = route.nodes[route.nodes.length - 1]?.name || 'Unknown'
    const wpNames = route.nodes.slice(1, -1).map(n => n.name)
    const routeTitle = wpNames.length > 0
      ? `${fromName} → ${wpNames.join(' → ')} → ${toName}`
      : `${fromName} → ${toName}`

    let md = `## Journey: ${routeTitle}\n\n`
    md += `**Distance:** ${Math.round(route.totalKm)} km  \n`
    md += `**Estimated Travel:** ${formatDays(route.estimatedDays)}  \n`
    md += `**Mode:** ${mode}  \n`
    if (season) md += `**Season:** ${season}  \n`
    md += `\n### Route\n\n`

    for (let i = 0; i < route.nodes.length; i++) {
      const node = route.nodes[i]
      md += `${i + 1}. **${node.name}** (${node.category.replace('_', ' ')})\n`
      if (i < route.edges.length) {
        const edge = route.edges[i]
        const edgeKm = route.totalDistanceSvg > 0
          ? Math.round(route.totalKm * (edge.distanceSvg / route.totalDistanceSvg))
          : 0
        const edgeDays = edge.segmentDays ? ` · ~${edge.segmentDays.toFixed(1)} days` : ''
        const icon = edge.type === 'trade_route' ? '📜' :
                     edge.type === 'chokepoint' ? '⛰' : '→'
        md += `   ${icon} ${edge.name} (${edge.type.replace('_', '-')}) · ${edgeKm} km${edgeDays}\n`
      }
    }

    const allWarnings = [...route.bottlenecks, ...route.seasonalWarnings]
    if (allWarnings.length > 0) {
      md += `\n### Warnings\n\n`
      for (const w of allWarnings) {
        md += `⚠️ ${w}\n`
      }
    }

    md += `\n---\n*Exported from [Veydria Cartography](${window.location.href.split('#')[0]})*`

    try {
      await navigator.clipboard.writeText(md)
      showExportToast('Markdown copied to clipboard')
    } catch {
      showExportToast('Failed to copy markdown')
    }
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

  function handleSeasonChange(newSeason: Season | undefined) {
    setSeason(newSeason)
    if (startId && endId) {
      computeRoute(newSeason, mode)
    }
  }

  function handleModeChange(newMode: RouteMode) {
    setMode(newMode)
    if (startId && endId) {
      computeRoute(season, newMode)
    }
  }

  function handleSaveRoute() {
    if (!route) return
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
      fromName: route.nodes[0]?.name || '',
      toName: route.nodes[route.nodes.length - 1]?.name || '',
      waypoints: route.nodes.slice(1, -1).map(n => n.name),
      season,
      mode,
      totalKm: route.totalKm,
      estimatedDays: route.estimatedDays,
      nodeIds: route.nodes.map(n => n.id),
      edgeCount: route.edges.length,
      bottlenecks: route.bottlenecks,
      seasonalWarnings: route.seasonalWarnings,
    }
    const updated = addHistoryEntry(entry)
    setHistory(updated)
    showExportToast('Route saved to history')
  }

  function handleLoadHistory(entry: HistoryEntry) {
    if (entry.nodeIds.length < 2) return
    const [start, ...rest] = entry.nodeIds
    const end = rest[rest.length - 1]
    const wps = rest.slice(0, -1)
    setStartId(start)
    setEndId(end)
    setWaypoints(wps)
    setSeason(entry.season)
    setMode(entry.mode)
    setStartSearch('')
    setEndSearch('')
    setWpSearch('')
    setWpOpenIdx(null)
    const result = wps.length > 0
      ? findMultiStopRoute(graph, entry.nodeIds, entry.season, entry.mode)
      : findRoute(graph, start, end, entry.season, entry.mode)
    setRoute(result)
    onRouteComputed(result)
    showExportToast('Route restored')
  }

  function handleDeleteHistory(id: string) {
    const updated = deleteHistoryEntry(id)
    setHistory(updated)
  }

  function handleClearHistory() {
    const updated = clearHistory()
    setHistory(updated)
    showExportToast('History cleared')
  }

  if (!active) return null

  return (
    <div className="journey-planner">
      <div className="journey-planner-header">
        <h3 className="journey-planner-title">
          <span className="journey-planner-icon">🧭</span>
          Journey Planner
        </h3>
        <div className="journey-header-actions">
          <button
            className={`journey-history-toggle ${historyOpen ? 'active' : ''}`}
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Saved routes"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span>{history.length}</span>
          </button>
          <button className="journey-planner-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>
      </div>

      {/* History panel */}
      {historyOpen && (
        <div className="journey-history-panel">
          <div className="journey-history-header">
            <span className="journey-history-title">Saved Routes</span>
            {history.length > 0 && (
              <button className="journey-history-clear" onClick={handleClearHistory}>Clear all</button>
            )}
          </div>
          {history.length === 0 && (
            <div className="journey-history-empty">No saved routes yet. Compute a route and click Save.</div>
          )}
          <div className="journey-history-list">
            {history.map(entry => (
              <div key={entry.id} className="journey-history-item">
                <div className="journey-history-info">
                  <div className="journey-history-route">
                    <span className="journey-history-from">{entry.fromName}</span>
                    {entry.waypoints.length > 0 && (
                      <span className="journey-history-via"> → {entry.waypoints.join(' → ')}</span>
                    )}
                    <span className="journey-history-arrow"> → </span>
                    <span className="journey-history-to">{entry.toName}</span>
                  </div>
                  <div className="journey-history-meta">
                    {entry.season && <span className="journey-history-season">{entry.season}</span>}
                    <span className="journey-history-mode">{entry.mode}</span>
                    <span>{Math.round(entry.totalKm)} km</span>
                    <span>~{formatDays(entry.estimatedDays)}</span>
                  </div>
                </div>
                <div className="journey-history-actions">
                  <button className="journey-history-load" onClick={() => handleLoadHistory(entry)} title="Load route">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M12 3l9 9-9 9"/></svg>
                  </button>
                  <button className="journey-history-delete" onClick={() => handleDeleteHistory(entry.id)} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="journey-planner-body">
        {/* Season selector */}
        <div className="journey-seasons">
          <span className="journey-seasons-label">Season</span>
          <div className="journey-seasons-row">
            <button
              className={`journey-season-btn ${season === undefined ? 'active' : ''}`}
              onClick={() => handleSeasonChange(undefined)}
              title="All seasons"
            >
              🗓️ Any
            </button>
            {SEASONS.map(s => (
              <button
                key={s.key}
                className={`journey-season-btn ${season === s.key ? 'active' : ''}`}
                onClick={() => handleSeasonChange(s.key)}
                title={s.label}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Route mode selector */}
        <div className="journey-modes">
          <span className="journey-modes-label">Route priority</span>
          <div className="journey-modes-row">
            {MODES.map(m => (
              <button
                key={m.key}
                className={`journey-mode-btn ${mode === m.key ? 'active' : ''}`}
                onClick={() => handleModeChange(m.key)}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

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

        {/* Waypoints */}
        {waypoints.map((wpId, idx) => {
          const wpNode = nodes.find(n => n.id === wpId)
          const isOpen = wpOpenIdx === idx
          const filteredWp = wpSearch.toLowerCase()
            ? nodes.filter(n => (n.name.toLowerCase().includes(wpSearch.toLowerCase()) || n.category.includes(wpSearch.toLowerCase())) && n.id !== startId && n.id !== endId && !waypoints.slice(0, idx).includes(n.id))
            : nodes.filter(n => n.id !== startId && n.id !== endId && !waypoints.slice(0, idx).includes(n.id))
          return (
            <div className="journey-field" key={idx} ref={el => { wpRefs.current[idx] = el }}>
              <div className="journey-field-header">
                <label className="journey-field-label">Via {idx + 1}</label>
                <button className="journey-wp-remove" onClick={() => handleRemoveWaypoint(idx)} title="Remove waypoint">×</button>
              </div>
              <div className="journey-dropdown">
                <button className="journey-dropdown-trigger" onClick={() => setWpOpenIdx(isOpen ? null : idx)}>
                  {wpNode ? (
                    <>
                      <NodeIcon category={wpNode.category} />
                      <span>{wpNode.name}</span>
                      <span className="journey-dropdown-cat">{wpNode.category.replace('_', ' ')}</span>
                    </>
                  ) : (
                    <span className="journey-dropdown-placeholder">Select waypoint...</span>
                  )}
                  <span className={`journey-dropdown-arrow ${isOpen ? 'open' : ''}`}>▾</span>
                </button>
                {isOpen && (
                  <div className="journey-dropdown-menu">
                    <input
                      type="text"
                      className="journey-dropdown-search"
                      placeholder="Search..."
                      value={wpSearch}
                      onChange={(e) => setWpSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="journey-dropdown-list">
                      {filteredWp.map(n => (
                        <button
                          key={n.id}
                          className={`journey-dropdown-item ${n.id === wpId ? 'selected' : ''}`}
                          onClick={() => handleSetWaypoint(idx, n.id)}
                        >
                          <NodeIcon category={n.category} />
                          <span className="journey-dropdown-item-name">{n.name}</span>
                          <span className="journey-dropdown-item-cat">{n.category.replace('_', ' ')}</span>
                        </button>
                      ))}
                      {filteredWp.length === 0 && <div className="journey-dropdown-empty">No matches</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <button
          className="journey-add-wp"
          onClick={handleAddWaypoint}
          disabled={!startId || !endId || waypoints.length >= 4}
        >
          + Add waypoint
        </button>

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
            <div className="journey-route-actions">
              <button className="journey-export-btn" onClick={handleSaveRoute} title="Save to history">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Save
              </button>
              <button className="journey-export-btn" onClick={handleCopyLink} title="Copy shareable link">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Link
              </button>
              <button className="journey-export-btn" onClick={handleCopyMarkdown} title="Copy as markdown">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Markdown
              </button>
              <button className="journey-export-btn" onClick={handleCopyJSON} title="Copy route JSON">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                JSON
              </button>
            </div>
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

        {/* Export toast */}
        {exportToast && (
          <div className="journey-export-toast">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span>{exportToast}</span>
          </div>
        )}
      </div>
    </div>
  )
}
