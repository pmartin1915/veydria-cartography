import { useState, useEffect, useRef, useMemo } from 'react'
import {
  initTrail,
  trailAct,
  trailChoose,
  currentTrailNodeIndex,
  scoreTrail,
  type TrailState,
  type TrailMember,
  type TrailPending,
} from '../../utils/trail'
import type { JourneyStateOpts } from '../../utils/journey-days'
import type { EncounterChoice } from '../../utils/passage'
import type { JourneyRoute, JourneyEdge, Season, RouteMode, PartyConfig } from '../../utils/journey-graph'
import type { SupplyConfig } from '../../utils/journey-supply'
import { PassageLedger } from './PassageMode'
import TravelVignette from './TravelVignette'

interface TrailModeProps {
  route: JourneyRoute
  season?: Season
  mode: RouteMode
  party: PartyConfig
  supply: SupplyConfig
  edgeBiomes?: (string | undefined)[]
  departureDayOfYear?: number
  onExit: () => void
  onPositionChange?: (nodeIndex: number | null) => void
  initialSeed?: number
}

type ActionKind = 'continue' | 'rest' | 'force-march' | 'ration' | 'turn-back'

type JournalEntry =
  | { kind: 'log'; text: string }
  | { kind: 'grave'; member: TrailMember }

interface RosterEntry {
  id: string
  name: string
  civ: string
  role?: string
}

const DEFAULT_TRAIL_ROSTER: RosterEntry[] = [
  { id: 'r0', name: 'Dorje Tsering', civ: 'ngaru_bon', role: 'smith-guide' },
  { id: 'r1', name: 'Sera Qalbin', civ: 'irrah', role: 'path-finder' },
  { id: 'r2', name: 'Altan Khesh', civ: 'kheshkai', role: 'horse-scout' },
  { id: 'r3', name: 'Mirembe Ki-Mbuhari', civ: 'ndjadi', role: 'river-merchant' },
  { id: 'r4', name: 'Pacha-Urco Yuraq', civ: 'qollari', role: 'cliff-porter' },
  { id: 'r5', name: 'Halkar Vela', civ: 'oravan', role: 'ship-factor' },
  { id: 'r6', name: 'Tamir Halani', civ: 'aethelian_basin', role: 'caravan-guard' },
  { id: 'r7', name: 'Khen-Po Yeshi', civ: 'ngaru_bon', role: 'stone-tithe clerk' },
  { id: 'r8', name: 'Noor al-Qalat', civ: 'irrah', role: 'salt-trader' },
  { id: 'r9', name: 'Batz Qollari', civ: 'qollari', role: 'calendar-keeper' },
]

function defaultMemberCount(size: PartyConfig['size']): number {
  switch (size) {
    case 'small': return 3
    case 'large': return 5
    default: return 4
  }
}

function outcomeHeadline(outcome: TrailState['outcome']): string {
  switch (outcome) {
    case 'arrived': return 'You have arrived.'
    case 'aborted': return 'The party turned back.'
    case 'perished': return "The party's supplies gave out."
    case 'party-wiped': return 'The party has perished to the last.'
    default: return 'In progress'
  }
}

function healthBadgeClass(health: TrailMember['health']): string {
  switch (health) {
    case 'well': return 'well'
    case 'ill': return 'ill'
    case 'very ill': return 'very-ill'
    case 'dead': return 'dead'
  }
}

function healthLabel(health: TrailMember['health']): string {
  switch (health) {
    case 'well': return 'well'
    case 'ill': return 'ill'
    case 'very ill': return 'very ill'
    case 'dead': return 'dead'
  }
}

export default function TrailMode({
  route,
  season,
  mode,
  party,
  supply,
  edgeBiomes,
  departureDayOfYear,
  onExit,
  onPositionChange,
  initialSeed,
}: TrailModeProps) {
  const [runSeed, setRunSeed] = useState<number>(() => initialSeed ?? (Date.now() >>> 0))
  const [state, setState] = useState<TrailState | null>(null)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const headingRef = useRef<HTMLHeadingElement>(null)
  const prevStateRef = useRef<TrailState | null>(null)

  const defaultCount = useMemo(() => {
    const n = defaultMemberCount(party.size)
    return Math.max(2, Math.min(5, n))
  }, [party.size])

  const [roster, setRoster] = useState<RosterEntry[]>(() =>
    DEFAULT_TRAIL_ROSTER.slice(0, defaultCount).map((entry, i) => ({ ...entry, id: `m${i}` }))
  )

  // Report position on mount and after every state change.
  useEffect(() => {
    onPositionChange?.(state ? currentTrailNodeIndex(state) : null)
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

  // Sync journal with log and newly dead members after each state transition.
  useEffect(() => {
    if (!state) {
      prevStateRef.current = null
      return
    }
    const prev = prevStateRef.current
    if (prev) {
      const deltas = computeJournalDeltas(prev, state)
      if (deltas.length > 0) {
        setJournal(j => [...j, ...deltas])
      }
    }
    prevStateRef.current = state
  }, [state])

  // Hunts only surface when journey.biomeForEdge is set (trail.ts) — the engine
  // never derives it from edgeBiomes, so the UI must wire it here. Reference-
  // identity lookup, same as scripts/sim/trail-run.ts buildEdgeBiomes.
  const biomeForEdge = useMemo(() => {
    if (!edgeBiomes) return undefined
    return (edge: JourneyEdge) => edgeBiomes[route.edges.indexOf(edge)]
  }, [route.edges, edgeBiomes])

  const journeyOpts = useMemo<JourneyStateOpts>(() => ({
    route,
    season,
    mode,
    party,
    supply,
    edgeBiomes,
    departureDayOfYear,
    biomeForEdge,
  }), [route, season, mode, party, supply, edgeBiomes, departureDayOfYear, biomeForEdge])

  function computeJournalDeltas(prev: TrailState, next: TrailState): JournalEntry[] {
    const entries: JournalEntry[] = []
    for (let i = prev.log.length; i < next.log.length; i++) {
      entries.push({ kind: 'log', text: next.log[i] })
    }
    const deaths: TrailMember[] = []
    for (let i = 0; i < next.members.length; i++) {
      const before = prev.members[i]
      const after = next.members[i]
      if (before.diedDay == null && after.diedDay != null) {
        deaths.push(after)
      }
    }
    for (const member of deaths) {
      entries.push({ kind: 'grave', member })
    }
    return entries
  }

  function advance(fn: (prev: TrailState) => TrailState) {
    setState(prev => {
      if (!prev) return prev
      return fn(prev)
    })
  }

  function handleBegin() {
    const seed = initialSeed ?? (Date.now() >>> 0)
    setRunSeed(seed)
    const members = roster.map(entry => ({
      id: entry.id,
      name: entry.name.trim() || DEFAULT_TRAIL_ROSTER[parseInt(entry.id.slice(1), 10) % DEFAULT_TRAIL_ROSTER.length].name,
      civ: entry.civ,
      role: entry.role,
    }))
    const next = initTrail({ journeyOpts, members, runSeed: seed })
    prevStateRef.current = null
    setState(next)
    setJournal([])
  }

  function handleAction(kind: ActionKind) {
    advance(prev => {
      const afterAct = trailAct(prev, { kind })
      if (kind === 'continue' && afterAct.pending?.kind === 'hunt') {
        return trailChoose(afterAct, 1)
      }
      return afterAct
    })
  }

  function handleHunt() {
    advance(prev => {
      const afterAct = trailAct(prev, { kind: 'continue' })
      if (afterAct.pending?.kind === 'hunt') {
        return trailChoose(afterAct, 0)
      }
      return afterAct
    })
  }

  function handleChoice(choiceIndex: number) {
    advance(prev => {
      if (!prev.pending || prev.outcome !== 'in-progress') return prev
      return trailChoose(prev, choiceIndex)
    })
  }

  function addRow() {
    setRoster(prev => {
      if (prev.length >= 5) return prev
      const nextIndex = prev.length
      const poolEntry = DEFAULT_TRAIL_ROSTER[nextIndex % DEFAULT_TRAIL_ROSTER.length]
      return [...prev, { ...poolEntry, id: `m${nextIndex}` }]
    })
  }

  function removeRow(index: number) {
    setRoster(prev => {
      if (prev.length <= 2) return prev
      return prev.filter((_, i) => i !== index).map((entry, i) => ({ ...entry, id: `m${i}` }))
    })
  }

  function updateName(index: number, name: string) {
    setRoster(prev => {
      const next = [...prev]
      next[index] = { ...next[index], name }
      return next
    })
  }

  // ── Setup card (before initTrail) ───────────────────────────────────────
  if (!state) {
    return (
      <div className="trail-mode">
        <h3 className="trail-heading" ref={headingRef} tabIndex={-1}>
          Trail
        </h3>
        <div className="trail-setup">
          <div className="trail-setup-instructions">
            Name your party. Each row keeps the listed homeland and role.
          </div>
          <div className="trail-roster-inputs">
            {roster.map((entry, i) => (
              <div key={entry.id} className="trail-roster-row">
                <input
                  type="text"
                  className="trail-roster-name-input"
                  value={entry.name}
                  onChange={(e) => updateName(i, e.target.value)}
                  aria-label={`Member ${i + 1} name`}
                  data-testid={`trail-roster-name-${i}`}
                />
                <span className="trail-roster-tag" title={entry.civ}>
                  {entry.civ.replace(/_/g, ' ')}
                  {entry.role && <span className="trail-roster-role"> · {entry.role}</span>}
                </span>
                <button
                  className="trail-roster-remove"
                  onClick={() => removeRow(i)}
                  disabled={roster.length <= 2}
                  aria-label={`Remove member ${i + 1}`}
                  data-testid={`trail-roster-remove-${i}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="trail-setup-actions">
            <button
              className="trail-roster-add"
              onClick={addRow}
              disabled={roster.length >= 5}
              data-testid="trail-roster-add"
            >
              + Add member
            </button>
            <button
              className="trail-btn trail-btn--primary"
              onClick={handleBegin}
              data-testid="trail-begin-btn"
            >
              Begin the trail
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Active run ──────────────────────────────────────────────────────────
  const selectedSegmentIdx = Math.min(
    Math.max(0, currentTrailNodeIndex(state)),
    Math.max(0, route.edges.length - 1),
  )

  return (
    <div className="trail-mode">
      <h3 className="trail-heading" ref={headingRef} tabIndex={-1}>
        Trail
      </h3>

      <TravelVignette
        route={route}
        edgeBiomes={edgeBiomes}
        selectedSegmentIdx={selectedSegmentIdx}
        season={season}
      />

      <div className="trail-ledger passage-ledger" data-tour="trail-ledger">
        <PassageLedger
          rationsLeft={state.journey.rationsLeft}
          waterLeft={state.journey.waterLeft}
          scarRations={state.journey.scarRations ?? 0}
          scarWater={state.journey.scarWater ?? 0}
          startingRations={state.journey.supplyConstants.startingRations}
          startingWater={state.journey.supplyConstants.startingWater}
        />
        <div className="trail-ledger-members">
          {state.members.map(m => (
            <div
              key={m.id}
              className={`trail-member ${m.health === 'dead' ? 'dead' : ''}`}
              data-testid={`trail-member-${m.id}`}
            >
              <span className="trail-member-name" data-testid={`trail-member-name-${m.id}`}>
                {m.health === 'dead' ? <s>{m.name}</s> : m.name}
              </span>
              {m.role && <span className="trail-member-role">{m.role}</span>}
              <span className={`trail-member-health ${healthBadgeClass(m.health)}`} data-testid={`trail-member-health-${m.id}`}>
                {healthLabel(m.health)}
              </span>
              {m.health !== 'well' && m.health !== 'dead' && m.ailment && (
                <span className="trail-member-ailment">{m.ailment}</span>
              )}
              {m.diedDay != null && (
                <span className="trail-member-died">Day {m.diedDay}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="trail-journal" data-tour="trail-journal" data-testid="trail-journal">
        {journal.length === 0 && (
          <div className="trail-empty">The trail has not yet been walked. Choose an action below.</div>
        )}
        {journal.map((entry, idx) =>
          entry.kind === 'log' ? (
            <div key={idx} className="trail-log-line journey-day" data-testid={`trail-log-line-${idx}`}>
              <div className="trail-log-text">{entry.text}</div>
            </div>
          ) : (
            <div key={idx} className="trail-grave journey-day" data-testid="trail-grave">
              <div className="trail-grave-name">{entry.member.name}</div>
              <div className="trail-grave-epitaph">{entry.member.epitaph}</div>
              {entry.member.diedDay != null && (
                <div className="trail-grave-day">Day {entry.member.diedDay}</div>
              )}
            </div>
          ),
        )}
      </div>

      <div className="trail-controls">
        {state.outcome !== 'in-progress' ? (
          <TrailScoreScreen state={state} runSeed={runSeed} onExit={onExit} />
        ) : state.pending ? (
          <TrailPendingCard pending={state.pending} onChoose={handleChoice} />
        ) : (
          <div className="trail-action-bar" data-tour="trail-actions">
            <button
              className="trail-btn trail-btn--primary"
              title="March one day toward the destination."
              onClick={() => handleAction('continue')}
              data-testid="trail-action-continue"
            >
              Continue
            </button>
            <button
              className="trail-btn"
              title="Travel on and hunt if game appears"
              onClick={handleHunt}
              data-testid="trail-action-hunt"
            >
              Hunt
            </button>
            <button
              className="trail-btn"
              title="Halt and recover. Burns water but no rations."
              onClick={() => handleAction('rest')}
              data-testid="trail-action-rest"
            >
              Rest
            </button>
            <button
              className="trail-btn"
              title="Push hard. Burns extra rations and water."
              onClick={() => handleAction('force-march')}
              data-testid="trail-action-force-march"
            >
              Force-march
            </button>
            <button
              className="trail-btn"
              title="Half rations today. Slower but stretches food."
              onClick={() => handleAction('ration')}
              data-testid="trail-action-ration"
            >
              Ration
            </button>
            <button
              className="trail-btn"
              title="Abandon the crossing and return."
              onClick={() => handleAction('turn-back')}
              data-testid="trail-action-turn-back"
            >
              Turn back
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TrailPendingCard({ pending, onChoose }: { pending: TrailPending; onChoose: (i: number) => void }) {
  if (pending.kind === 'signature') {
    return (
      <div className="trail-choice-cards passage-choice-cards" data-testid="trail-choice-cards">
        <div className="passage-choice-prompt">{signaturePrompt(pending.key)}</div>
        {pending.choices.map((choice: EncounterChoice, i: number) => (
          <button
            key={i}
            className={`passage-choice-card risk-${choice.outcome.risk ?? 'none'}`}
            onClick={() => onChoose(i)}
            data-testid={`trail-choice-${i}`}
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
    )
  }

  if (pending.kind === 'fort') {
    return (
      <div className="trail-choice-cards passage-choice-cards" data-testid="trail-choice-cards">
        <div className="passage-choice-prompt">A waypoint offers resupply.</div>
        <button
          className="passage-choice-card"
          onClick={() => onChoose(0)}
          data-testid="trail-fort-choice"
        >
          <div className="passage-choice-label">Resupply at the waypoint</div>
        </button>
      </div>
    )
  }

  // ford (reserved) — fall back to a single-button ford card.
  return (
    <div className="trail-choice-cards passage-choice-cards" data-testid="trail-choice-cards">
      <div className="passage-choice-prompt">A river bars the road.</div>
      <button
        className="passage-choice-card"
        onClick={() => onChoose(0)}
        data-testid="trail-ford-choice"
      >
        <div className="passage-choice-label">Ford the river</div>
      </button>
    </div>
  )
}

function signaturePrompt(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function TrailScoreScreen({ state, runSeed, onExit }: { state: TrailState; runSeed: number; onExit: () => void }) {
  const score = scoreTrail(state)
  const dead = state.members.filter(m => m.health === 'dead')
  return (
    <div className="trail-score-screen passage-ending-panel">
      <div className="passage-ending-title" data-testid="trail-outcome-headline">{outcomeHeadline(state.outcome)}</div>
      <div className="trail-score-grid">
        <div className="trail-score-item">
          <span className="trail-score-label">Survivors</span>
          <span className="trail-score-value" data-testid="trail-score-survivors">{score.survivors}/{state.members.length}</span>
        </div>
        <div className="trail-score-item">
          <span className="trail-score-label">Days elapsed</span>
          <span className="trail-score-value" data-testid="trail-score-days">{score.daysElapsed}</span>
        </div>
        <div className="trail-score-item">
          <span className="trail-score-label">Supply margin</span>
          <span className="trail-score-value" data-testid="trail-score-supply">{score.supplyMargin.toFixed(1)}d</span>
        </div>
        <div className="trail-score-item">
          <span className="trail-score-label">Rank</span>
          <span className="trail-score-value" data-testid="trail-score-rank">{score.rank}</span>
        </div>
      </div>
      {dead.length > 0 && (
        <div className="trail-score-graves">
          <div className="trail-score-graves-title">The fallen</div>
          {dead.map(m => (
            <div key={m.id} className="trail-grave journey-day" data-testid="trail-score-grave">
              <div className="trail-grave-name">{m.name}</div>
              <div className="trail-grave-epitaph">{m.epitaph}</div>
              <div className="trail-grave-day">Day {m.diedDay}</div>
            </div>
          ))}
        </div>
      )}
      <div className="trail-score-seed">Run seed: {runSeed}</div>
      <button className="trail-btn trail-btn--primary" onClick={onExit} data-testid="trail-return-btn">
        Return to Atlas
      </button>
    </div>
  )
}
