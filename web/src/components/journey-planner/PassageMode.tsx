import { useState, useEffect, useRef, useMemo } from 'react'
import {
  initPassage,
  passageAct,
  passageChoose,
  passageReroute,
  currentNodeIndex,
  type PassageState,
  type PassageEntry,
} from '../../utils/passage'
import type { JourneyStateOpts } from '../../utils/journey-days'
import { encounterTypeIcon, encounterSeverityLabel } from '../../utils/encounters'
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_GLYPH } from '../../utils/time-of-day'
import { IconCloudRain, IconPin } from '../icons'
import NodeIcon from './NodeIcon'
import type { JourneyRoute, Season, RouteMode, PartyConfig, JourneyNode, Graph } from '../../utils/journey-graph'
import type { SupplyConfig } from '../../utils/journey-supply'

interface PassageModeProps {
  route: JourneyRoute
  season?: Season
  mode: RouteMode
  party: PartyConfig
  supply: SupplyConfig
  edgeBiomes?: (string | undefined)[]
  departureDayOfYear?: number
  /** All map nodes — the reroute picker's destination list. */
  nodes: JourneyNode[]
  /** The journey graph — required for the engine to recompute a reroute path. */
  graph: Graph
  /** The original destination id, seeded into the engine for reroute snapping. */
  endId: string
  onExit: () => void
  onPositionChange?: (nodeIndex: number | null) => void
}

/** Mirror of JourneyPlanner's category formatter for the reroute picker rows. */
function formatNodeCategory(n: JourneyNode): string {
  const cat = n.category.replace('_', ' ')
  if (!n.civ) return cat
  const civLabel = n.civ.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `${civLabel} · ${cat}`
}

const ACTION_KINDS: { kind: 'continue' | 'rest' | 'force-march' | 'ration' | 'turn-back'; label: string; title: string }[] = [
  { kind: 'continue', label: 'Continue', title: 'March one day toward the destination.' },
  { kind: 'rest', label: 'Rest', title: 'Halt and recover. Burns water but no rations.' },
  { kind: 'force-march', label: 'Force-march', title: 'Push hard. Burns extra rations and water.' },
  { kind: 'ration', label: 'Ration', title: 'Half rations today. Slower but stretches food.' },
  { kind: 'turn-back', label: 'Turn back', title: 'Abandon the crossing and return.' },
]

function formatSupply(value: number): string {
  return value.toFixed(1)
}

function outcomeTitle(outcome: PassageState['outcome']): string {
  switch (outcome) {
    case 'arrived': return 'Arrived'
    case 'aborted': return 'Turned back'
    case 'perished': return 'Perished'
    default: return 'In progress'
  }
}

export default function PassageMode({
  route,
  season,
  mode,
  party,
  supply,
  edgeBiomes,
  departureDayOfYear,
  nodes,
  graph,
  endId,
  onExit,
  onPositionChange,
}: PassageModeProps) {
  const [state, setState] = useState<PassageState>(() =>
    initPassage({ route, season, mode, party, supply, edgeBiomes, departureDayOfYear, graph, endId } as JourneyStateOpts)
  )
  const [rerouteOpen, setRerouteOpen] = useState(false)
  const [rerouteSearch, setRerouteSearch] = useState('')
  const [rerouteError, setRerouteError] = useState<string | null>(null)
  const [rerouteMode, setRerouteMode] = useState<RouteMode>(
    mode === 'safest' ? 'safest' : 'fastest'
  )
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The node the party is currently standing on — exclude it from reroute targets.
  // Indexes the CURRENT journey route (which the engine swaps on each reroute).
  const currentId = state.journey.route.nodes[currentNodeIndex(state)]?.id
  const filteredReroute = useMemo(() => {
    const q = rerouteSearch.toLowerCase()
    return nodes.filter(n =>
      n.id !== currentId &&
      (n.name.toLowerCase().includes(q) || n.category.includes(q))
    )
  }, [nodes, rerouteSearch, currentId])

  // Report position on mount and after every state change.
  useEffect(() => {
    onPositionChange?.(currentNodeIndex(state))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Clear position only on unmount.
  useEffect(() => {
    return () => {
      onPositionChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Move focus to the journal heading on entry for keyboard users.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Reset the local reroute mode whenever the picker opens.
  useEffect(() => {
    if (rerouteOpen) {
      setRerouteMode(mode === 'safest' ? 'safest' : 'fastest')
    }
  }, [rerouteOpen, mode])

  const handleAction = (kind: 'continue' | 'rest' | 'force-march' | 'ration' | 'turn-back') => {
    setState(prev => passageAct(prev, { kind }))
  }

  const handleChoice = (choiceIndex: number) => {
    setState(prev => passageChoose(prev, choiceIndex))
  }

  const handleReroute = (newEndId: string) => {
    const next = passageReroute(state, newEndId, rerouteMode)
    if (next === state) {
      setRerouteError('No road that way.')
      return
    }
    setState(next)
    setRerouteError(null)
    setRerouteSearch('')
    setRerouteOpen(false)
  }

  return (
    <div className="passage-mode">
      <h3 className="passage-heading" ref={headingRef} tabIndex={-1}>
        Passage
      </h3>

      <PassageLedger
        rationsLeft={state.journey.rationsLeft}
        waterLeft={state.journey.waterLeft}
        scarRations={state.journey.scarRations ?? 0}
        scarWater={state.journey.scarWater ?? 0}
        startingRations={state.journey.supplyConstants.startingRations}
        startingWater={state.journey.supplyConstants.startingWater}
      />

      <div className="passage-journal" data-tour="passage-journal">
        {state.log.length === 0 && (
          <div className="passage-empty">The journey has not yet begun. Choose an action below.</div>
        )}
        {state.log.map((entry, idx) => (
          <PassageEntryBlock key={idx} entry={entry} />
        ))}
      </div>

      <div className="passage-controls">
        {state.outcome !== 'in-progress' ? (
          <div className="passage-ending-panel">
            <div className="passage-ending-title">{outcomeTitle(state.outcome)}</div>
            <div className="passage-ending-body">
              {(() => {
                const last = state.log[state.log.length - 1]
                return last && last.kind === 'ending' ? last.narrative : ''
              })()}
            </div>
            <button className="passage-btn passage-btn--primary" onClick={onExit}>
              Return to Atlas
            </button>
          </div>
        ) : state.pending ? (
          <div className="passage-choice-cards">
            <div className="passage-choice-prompt">
              {state.pending.encounter.beat}
            </div>
            {state.pending.choices.map((choice, i) => (
              <button
                key={i}
                className={`passage-choice-card risk-${choice.outcome.risk ?? 'none'}`}
                onClick={() => handleChoice(i)}
              >
                <div className="passage-choice-header">
                  <span className="passage-choice-label">{choice.label}</span>
                  <span className={`passage-choice-risk ${choice.outcome.risk ?? 'none'}`}>
                    {choice.outcome.risk ?? 'none'}
                  </span>
                </div>
                <div className="passage-choice-outcome">{choice.outcome.narrative}</div>
              </button>
            ))}
          </div>
        ) : rerouteOpen ? (
          <div className="passage-reroute-picker" data-testid="passage-reroute-picker">
            <div className="passage-reroute-prompt">Turn the column toward a new destination.</div>
            <div className="passage-reroute-mode-toggle">
              {(['fastest', 'safest'] as RouteMode[]).map(m => (
                <button
                  key={m}
                  className={`passage-reroute-mode-btn${rerouteMode === m ? ' active' : ''}`}
                  onClick={() => { setRerouteMode(m); setRerouteError(null) }}
                >
                  {m === 'fastest' ? 'Fastest' : 'Safest'}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="journey-dropdown-search"
              placeholder="Search destinations..."
              value={rerouteSearch}
              onChange={(e) => { setRerouteSearch(e.target.value); setRerouteError(null) }}
              autoFocus
            />
            <div className="journey-dropdown-list passage-reroute-list">
              {filteredReroute.map(n => (
                <button
                  key={n.id}
                  className="journey-dropdown-item"
                  onClick={() => handleReroute(n.id)}
                >
                  <NodeIcon category={n.category} />
                  <span className="journey-dropdown-item-name">{n.name}</span>
                  <span className="journey-dropdown-item-cat">{formatNodeCategory(n)}</span>
                </button>
              ))}
              {filteredReroute.length === 0 && (
                <div className="journey-dropdown-empty">No matches</div>
              )}
            </div>
            {rerouteError && <p className="passage-reroute-error">{rerouteError}</p>}
            <button
              className="passage-btn"
              onClick={() => { setRerouteSearch(''); setRerouteError(null); setRerouteOpen(false) }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="passage-action-bar" data-tour="passage-actions">
            {ACTION_KINDS.map(({ kind, label, title }) => (
              <button
                key={kind}
                className={`passage-btn ${kind === 'continue' ? 'passage-btn--primary' : ''}`}
                title={title}
                onClick={() => handleAction(kind)}
              >
                {label}
              </button>
            ))}
            <button
              className="passage-btn"
              data-testid="passage-reroute-btn"
              title="Change the party's destination. Recomputes the road from where you stand."
              onClick={() => setRerouteOpen(true)}
            >
              Reroute
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface PassageLedgerProps {
  rationsLeft: number
  waterLeft: number
  scarRations: number
  scarWater: number
  startingRations: number
  startingWater: number
}

/**
 * Supply ledger pinned above the journal. Shows current days-of-supply for each
 * reserve, and — only when a choice has permanently scarred capacity — the
 * lowered resupply CAP plus the scar delta. Without this the scar is invisible
 * bookkeeping: a later resupply quietly refills to a smaller number with nothing
 * on screen explaining why. Exported for unit testing the scar-legibility path.
 */
export function PassageLedger({
  rationsLeft,
  waterLeft,
  scarRations,
  scarWater,
  startingRations,
  startingWater,
}: PassageLedgerProps) {
  const capRations = Math.max(0, startingRations - scarRations)
  const capWater = Math.max(0, startingWater - scarWater)
  const scarTitle =
    'A choice this crossing permanently cut your carrying capacity. Resupply now refills only to this lower cap.'
  return (
    <div className="passage-ledger" data-tour="passage-ledger">
      <div className="passage-ledger-item">
        <span className="passage-ledger-label">Rations</span>
        <span className={`passage-ledger-value ${rationsLeft < 0 ? 'passage-debt' : ''}`}>
          {formatSupply(rationsLeft)}d
          {rationsLeft < 0 && <span className="passage-debt-tag">debt</span>}
        </span>
        {scarRations > 0 && (
          <span className="passage-ledger-cap" title={scarTitle}>
            cap {formatSupply(capRations)}d
            <span className="passage-scar-delta">&minus;{scarRations}</span>
          </span>
        )}
      </div>
      <div className="passage-ledger-item">
        <span className="passage-ledger-label">Water</span>
        <span className={`passage-ledger-value ${waterLeft < 0 ? 'passage-debt' : ''}`}>
          {formatSupply(waterLeft)}d
          {waterLeft < 0 && <span className="passage-debt-tag">debt</span>}
        </span>
        {scarWater > 0 && (
          <span className="passage-ledger-cap" title={scarTitle}>
            cap {formatSupply(capWater)}d
            <span className="passage-scar-delta">&minus;{scarWater}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function PassageEntryBlock({ entry }: { entry: PassageEntry }) {
  switch (entry.kind) {
    case 'day':
      return (
        <div className="passage-day journey-day">
          <div className="journey-day-header">
            <span className="journey-day-num">Day {entry.dayLabel}</span>
            <span className="journey-day-km">{Math.round(entry.day.kmCovered)} km</span>
          </div>
          <div className="journey-day-line"><span className="journey-day-label">Start:</span> {entry.day.startLabel}</div>
          <div className="journey-day-line journey-day-weather"><IconCloudRain /> {entry.day.weather}</div>
          {entry.day.notable.length > 0 && (
            <ul className="journey-day-notable">
              {entry.day.notable.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          {entry.day.encounters.length > 0 && (
            <div className="journey-day-encounters">
              {entry.day.encounters.map((enc, i) => (
                <div key={i} className={`journey-encounter ${enc.severity}`}>
                  <div className="journey-encounter-meta">
                    <span className="journey-encounter-icon">{encounterTypeIcon(enc.type)}</span>
                    <span className="journey-encounter-type">{enc.type}</span>
                    <span className={`journey-encounter-severity ${enc.severity}`}>{encounterSeverityLabel(enc.severity)}</span>
                    {enc.timeOfDay !== 'day' && (
                      <span className={`journey-encounter-time ${enc.timeOfDay}`}>
                        {TIME_OF_DAY_GLYPH[enc.timeOfDay]} {TIME_OF_DAY_LABELS[enc.timeOfDay]}
                      </span>
                    )}
                    {enc.biome && <span className="journey-encounter-biome">{enc.biome}</span>}
                  </div>
                  <div className="journey-encounter-beat">{enc.beat}</div>
                </div>
              ))}
            </div>
          )}
          <div className={`journey-day-line journey-day-supply ${entry.supply.warning ?? ''}`}>
            <span className="journey-day-label">Supply:</span>{' '}
            Rations {entry.supply.rationsLeft.toFixed(1)}d
            {' · '}
            Water {entry.supply.waterLeft.toFixed(1)}d
            {entry.supply.warning && (
              <span className="journey-day-supply-warn">
                {' '}
                {entry.supply.warning === 'water-out' ? 'water exhausted'
                  : entry.supply.warning === 'rations-out' ? 'rations exhausted'
                  : entry.supply.warning === 'water-low' ? 'water critical'
                  : 'rations critical'}
              </span>
            )}
          </div>
          <div className="journey-day-line journey-day-camp"><IconPin /> {entry.day.campLabel}</div>
        </div>
      )
    case 'wait':
      return (
        <div className="passage-wait journey-day">
          <div className="journey-day-header">
            <span className="journey-day-num">Day {entry.dayLabel}</span>
            <span className="journey-day-km">Held</span>
          </div>
          <div className="passage-wait-narrative">{entry.narrative}</div>
          <div className={`journey-day-line journey-day-supply ${entry.supply.warning ?? ''}`}>
            <span className="journey-day-label">Supply:</span>{' '}
            Rations {entry.supply.rationsLeft.toFixed(1)}d
            {' · '}
            Water {entry.supply.waterLeft.toFixed(1)}d
            {entry.supply.warning && (
              <span className="journey-day-supply-warn">
                {' '}
                {entry.supply.warning === 'water-out' ? 'water exhausted'
                  : entry.supply.warning === 'rations-out' ? 'rations exhausted'
                  : entry.supply.warning === 'water-low' ? 'water critical'
                  : 'rations critical'}
              </span>
            )}
          </div>
        </div>
      )
    case 'choice':
      return (
        <div className={`passage-choice journey-day risk-${entry.risk}`}>
          <div className="journey-day-header">
            <span className="journey-day-num">Day {entry.dayLabel}</span>
            <span className={`passage-choice-risk ${entry.risk}`}>{entry.risk}</span>
          </div>
          <div className="passage-choice-taken">{entry.label}</div>
          <div className="passage-wait-narrative">{entry.narrative}</div>
        </div>
      )
    case 'reroute':
      return (
        <div className="passage-reroute journey-day">
          <div className="journey-day-header">
            <span className="journey-day-num">Day {entry.dayLabel}</span>
            <span className="passage-reroute-badge">Reroute</span>
          </div>
          <div className="passage-wait-narrative">{entry.narrative}</div>
        </div>
      )
    case 'ending':
      return (
        <div className={`passage-ending journey-day outcome-${entry.outcome}`}>
          <div className="journey-day-header">
            <span className="journey-day-num">Day {entry.dayLabel}</span>
            <span className="passage-ending-badge">{outcomeTitle(entry.outcome)}</span>
          </div>
          <div className="passage-wait-narrative">{entry.narrative}</div>
        </div>
      )
  }
}
