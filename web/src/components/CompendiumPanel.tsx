/**
 * Subordinate Phase 1 compendium for the play surface (at-the-table reference).
 *
 * Canonical compendium lives in the worldbuilder repo at
 * `tools/map-viewer/src/components/compendium/` (11+ lenses, full-body search,
 * crisis dashboard, sacred registers, pilgrimage routes, reform movements).
 *
 * Rule: new compendium lenses go in worldbuilder. Bug fixes and per-table
 * usability tweaks are fine here. For depth, this panel deep-links out via
 * VITE_WORLDBUILDER_COMPENDIUM_URL (see web/.env.example).
 *
 * See RECONCILIATION-PLAN-MAP-COMPENDIUM-2026-05-18.md (worldbuilder repo root)
 * for the audience-split rationale.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { marked } from 'marked';
import type { CanonData, CanonEntity, CompendiumTab } from './compendium/types';
import { CIVS, CIV_LABELS, LENSES, displayName } from './compendium/types';
import EgoNetwork from './compendium/EgoNetwork';
import CalendarCompare from './compendium/CalendarCompare';
import MatrixCardGrid from './compendium/MatrixCardGrid';
import { loadCanon, loadSearchIndex, getEntitiesArray, lookupEntity, getMapAnchor } from '../utils/compendium-data';
import { generateEntityOrientation } from '../utils/entity-orientation';
import {
  buildWorldbuilderCompendiumUrl,
  buildWorldbuilderHomeUrl,
} from '../utils/worldbuilder-link';

function getHashParam(key: string, defaultValue: string): string {
  const hash = window.location.hash;
  const qs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(qs);
  const val = params.get(key);
  return val !== null ? val : defaultValue;
}

function setHashParam(key: string, value: string | null) {
  const hash = window.location.hash;
  const base = hash.split('?')[0] || '';
  const qs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(qs);
  if (value === null || value === '' || value === 'browse') {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const newQs = params.toString();
  window.history.replaceState(null, '', base + (newQs ? '?' + newQs : ''));
}

interface CompendiumPanelProps {
  onSelectMapAnchor?: (kind: string, slug: string) => void;
  onClose?: () => void;
}

export default function CompendiumPanel({ onSelectMapAnchor, onClose }: CompendiumPanelProps) {
  const [canon, setCanon] = useState<CanonData['entities'] | null>(null);
  const [searchText, setSearchText] = useState(() => getHashParam('q', ''));
  const [selectedId, setSelectedId] = useState<string | null>(() => getHashParam('id', '') || null);
  const [tab, setTab] = useState<CompendiumTab>(() => {
    const t = getHashParam('tab', 'browse');
    return ['browse', 'civs', 'lenses'].includes(t) ? (t as CompendiumTab) : 'browse';
  });
  const [civPage, setCivPage] = useState<string | null>(() => getHashParam('civPage', '') || null);
  const [lens, setLens] = useState<string | null>(() => getHashParam('lens', '') || null);
  const [searchIndex, setSearchIndex] = useState<{ id: string; name: string; tokens: string[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCanon(), loadSearchIndex()]).then(([canonData, idx]) => {
      if (cancelled) return;
      setCanon(canonData.entities);
      setSearchIndex(idx.entries || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Sync state → URL
  useEffect(() => { setHashParam('q', searchText || null); }, [searchText]);
  useEffect(() => { setHashParam('id', selectedId); }, [selectedId]);
  useEffect(() => { setHashParam('tab', tab); }, [tab]);
  useEffect(() => { setHashParam('civPage', civPage); }, [civPage]);
  useEffect(() => { setHashParam('lens', lens); }, [lens]);

  // Sync URL → state on hashchange
  useEffect(() => {
    const onHashChange = () => {
      setSearchText(getHashParam('q', ''));
      setSelectedId(getHashParam('id', '') || null);
      const t = getHashParam('tab', 'browse');
      setTab(['browse', 'civs', 'lenses'].includes(t) ? (t as CompendiumTab) : 'browse');
      setCivPage(getHashParam('civPage', '') || null);
      setLens(getHashParam('lens', '') || null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const entities = useMemo(() => canon ? getEntitiesArray({ entities: canon, meta: {} }) : [], [canon]);

  const filtered = useMemo(() => {
    if (!searchText.trim()) return entities;
    const q = searchText.toLowerCase();
    const idSet = new Set<string>();

    // Name match
    for (const e of entities) {
      if (e.name?.toLowerCase().includes(q)) idSet.add(e.id);
    }

    // Search index token match
    for (const entry of searchIndex) {
      if (entry.tokens?.some((t) => t.toLowerCase().includes(q))) {
        idSet.add(entry.id);
      }
    }

    return entities.filter((e) => idSet.has(e.id));
  }, [entities, searchText, searchIndex]);

  const selectedEntity = useMemo(() => {
    if (!selectedId || !canon) return null;
    return lookupEntity({ entities: canon, meta: {} }, selectedId);
  }, [selectedId, canon]);

  const handleMapClick = useCallback(async (entity: CanonEntity) => {
    if (!onSelectMapAnchor) return;
    const anchor = await getMapAnchor(entity.id);
    if (anchor) {
      onSelectMapAnchor(anchor.kind, anchor.slug);
    }
  }, [onSelectMapAnchor]);

  if (loading) {
    return (
      <div className="compendium-panel">
        <div className="compendium-loading">Loading compendium…</div>
      </div>
    );
  }

  return (
    <div className="compendium-panel">
      <div className="compendium-header">
        <h2>Compendium</h2>
        <a
          className="compendium-worldbuilder-link"
          href={buildWorldbuilderHomeUrl()}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the canonical compendium in worldbuilder (new tab)"
        >
          Open full compendium ↗
        </a>
        {onClose && (
          <button className="compendium-close" onClick={onClose} aria-label="Close compendium">
            ✕
          </button>
        )}
      </div>

      <div className="compendium-toolbar">
        <input
          type="text"
          className="compendium-search"
          placeholder="Search entities…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <div className="compendium-tabs">
          {(['browse', 'civs', 'lenses'] as CompendiumTab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => { setTab(t); setSelectedId(null); setCivPage(null); setLens(null); }}
            >
              {t === 'browse' ? 'Browse' : t === 'civs' ? 'Civilizations' : 'Lenses'}
            </button>
          ))}
        </div>
      </div>

      <div className="compendium-body">
        {selectedEntity ? (
          <EntityDetailView
            entity={selectedEntity}
            onBack={() => setSelectedId(null)}
            onMapClick={() => handleMapClick(selectedEntity)}
            hasMapAnchor={!!selectedEntity.map_anchor}
            allEntities={entities}
            onSelectEntity={(id) => { setSelectedId(id); }}
          />
        ) : tab === 'browse' ? (
          <BrowseView entities={filtered} onSelect={setSelectedId} total={entities.length} />
        ) : tab === 'civs' ? (
          <CivsView
            entities={entities}
            civPage={civPage}
            onSelectCiv={setCivPage}
            onSelectEntity={setSelectedId}
          />
        ) : (
          <LensesView
            entities={entities}
            lens={lens}
            onSelectLens={setLens}
            onSelectEntity={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}

function BrowseView({ entities, onSelect, total }: { entities: CanonEntity[]; onSelect: (id: string) => void; total: number }) {
  return (
    <div className="compendium-browse">
      <div className="compendium-meta">{entities.length} / {total} entities</div>
      <div className="compendium-grid">
        {entities.map((e) => (
          <button key={e.id} className="compendium-card" onClick={() => onSelect(e.id)}>
            <div className="compendium-card-name">{displayName(e)}</div>
            <div className="compendium-card-meta">
              {e.family} {e.civ_scope ? `· ${Array.isArray(e.civ_scope) ? e.civ_scope.join(', ') : e.civ_scope}` : ''}
            </div>
            {e.summary && <div className="compendium-card-summary">{e.summary}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function CivsView({ entities, civPage, onSelectCiv, onSelectEntity }: {
  entities: CanonEntity[];
  civPage: string | null;
  onSelectCiv: (civ: string | null) => void;
  onSelectEntity: (id: string) => void;
}) {
  if (civPage) {
    const civEntities = entities.filter((e) => {
      if (!e.civ_scope) return false;
      if (Array.isArray(e.civ_scope)) return e.civ_scope.includes(civPage);
      return e.civ_scope === civPage;
    });
    return (
      <div className="compendium-civ-page">
        <button className="compendium-back" onClick={() => onSelectCiv(null)}>← Back</button>
        <h3>{CIV_LABELS[civPage as keyof typeof CIV_LABELS] || civPage}</h3>
        <div className="compendium-civ-list">
          {civEntities.map((e) => (
            <button key={e.id} className="compendium-card" onClick={() => onSelectEntity(e.id)}>
              <div className="compendium-card-name">{displayName(e)}</div>
              <div className="compendium-card-meta">{e.family}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="compendium-civs">
      {CIVS.map((civ) => {
        const count = entities.filter((e) => {
          if (!e.civ_scope) return false;
          if (Array.isArray(e.civ_scope)) return e.civ_scope.includes(civ);
          return e.civ_scope === civ;
        }).length;
        return (
          <button key={civ} className="compendium-civ-card" onClick={() => onSelectCiv(civ)}>
            <div className="compendium-civ-name">{CIV_LABELS[civ]}</div>
            <div className="compendium-civ-count">{count} entities</div>
          </button>
        );
      })}
    </div>
  );
}

function LensesView({ entities, lens, onSelectLens, onSelectEntity }: {
  entities: CanonEntity[];
  lens: string | null;
  onSelectLens: (lens: string | null) => void;
  onSelectEntity: (id: string) => void;
}) {
  if (lens === 'calendars') {
    return (
      <div className="compendium-lens-page">
        <button className="compendium-back" onClick={() => onSelectLens(null)}>← Back</button>
        <h3>{LENSES.find((l) => l.key === lens)?.label}</h3>
        <CalendarCompare entities={entities} />
      </div>
    );
  }

  if (lens === 'cross-civ') {
    return (
      <div className="compendium-lens-page">
        <button className="compendium-back" onClick={() => onSelectLens(null)}>← Back</button>
        <h3>{LENSES.find((l) => l.key === lens)?.label}</h3>
        <MatrixCardGrid entities={entities} onSelectEntity={onSelectEntity} />
      </div>
    );
  }

  if (lens) {
    let filtered: CanonEntity[] = [];
    switch (lens) {
      case 'cross-civ':
        filtered = entities.filter((e) => e.family === 'cross_civ_relationship');
        break;
      case 'crises':
        filtered = entities.filter((e) => e.family === 'crisis' || e.family === 'cold_war');
        break;
      case 'magic':
        filtered = entities.filter((e) => e.family === 'magic');
        break;
      case 'traditions':
        filtered = entities.filter((e) => e.entity_type === 'tradition');
        break;
      case 'resources':
        filtered = entities.filter((e) => e.family === 'resource_governance');
        break;
      case 'institutions':
        filtered = entities.filter((e) => e.entity_type === 'institution');
        break;
      case 'figures':
        filtered = entities.filter((e) => e.entity_type === 'deity_figure');
        break;
      case 'characters':
        filtered = entities.filter((e) => e.entity_type === 'character');
        break;
      case 'record-keeping':
        filtered = entities.filter((e) => e.entity_type === 'record_medium');
        break;
      case 'underclass':
        filtered = entities.filter((e) => e.entity_type === 'underclass_life');
        break;
      case 'funerary':
        filtered = entities.filter((e) => e.entity_type === 'funerary_practice');
        break;
    }
    return (
      <div className="compendium-lens-page">
        <button className="compendium-back" onClick={() => onSelectLens(null)}>← Back</button>
        <h3>{LENSES.find((l) => l.key === lens)?.label}</h3>
        <div className="compendium-grid">
          {filtered.map((e) => (
            <button key={e.id} className="compendium-card" onClick={() => onSelectEntity(e.id)}>
              <div className="compendium-card-name">{displayName(e)}</div>
              <div className="compendium-card-meta">{e.civ_scope ? `${Array.isArray(e.civ_scope) ? e.civ_scope.join(', ') : e.civ_scope}` : ''}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="compendium-lenses">
      {LENSES.map((l) => (
        <button key={l.key} className="compendium-lens-card" onClick={() => onSelectLens(l.key)}>
          <div className="compendium-lens-name">{l.label}</div>
          <div className="compendium-lens-desc">{l.description}</div>
        </button>
      ))}
    </div>
  );
}

function EntityDetailView({ entity, onBack, onMapClick, hasMapAnchor, allEntities, onSelectEntity }: {
  entity: CanonEntity;
  onBack: () => void;
  onMapClick: () => void;
  hasMapAnchor: boolean;
  allEntities: CanonEntity[];
  onSelectEntity: (id: string) => void;
}) {
  const [bodyHtml, setBodyHtml] = useState('');
  const [showNetwork, setShowNetwork] = useState(false);

  useEffect(() => {
    if (entity.body) {
      const result = marked.parse(entity.body);
      if (typeof result === 'string') {
        setBodyHtml(result);
      } else {
        result.then((html) => setBodyHtml(html));
      }
    } else {
      setBodyHtml('');
    }
  }, [entity.body]);

  const hasNetwork = (entity.cross_refs && entity.cross_refs.length > 0) ||
    allEntities.some((e) => e.cross_refs?.includes(entity.id));

  return (
    <div className="compendium-detail">
      <button className="compendium-back" onClick={onBack}>← Back</button>
      <h3>{displayName(entity)}</h3>
      <div className="compendium-detail-meta">
        {entity.family && <span className="compendium-tag">{entity.family}</span>}
        {entity.civ_scope && (
          <span className="compendium-tag">
            {Array.isArray(entity.civ_scope) ? entity.civ_scope.join(', ') : entity.civ_scope}
          </span>
        )}
        {entity.epoch && <span className="compendium-tag">{entity.epoch}</span>}
        {entity.status && <span className="compendium-tag">{entity.status}</span>}
      </div>
      <div className="compendium-detail-actions">
        {hasMapAnchor && (
          <button className="compendium-map-btn" onClick={onMapClick}>
            🗺 Show on Map
          </button>
        )}
        {hasNetwork && (
          <button className="compendium-map-btn" onClick={() => setShowNetwork((p) => !p)}>
            {showNetwork ? '✕ Hide Network' : '⟡ Network'}
          </button>
        )}
        <a
          className="compendium-map-btn compendium-worldbuilder-btn"
          href={buildWorldbuilderCompendiumUrl(entity.id)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this entity in the worldbuilder compendium (new tab)"
        >
          Open in worldbuilder ↗
        </a>
      </div>
      {entity.family === 'factions' && (
        <div className="compendium-detail-orientation">
          <h4>🧭 What is this?</h4>
          {generateEntityOrientation(entity, allEntities)
            .split('\n\n')
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
      )}
      {entity.summary && (
        <div className="compendium-detail-summary">{entity.summary}</div>
      )}
      {entity.cross_refs && entity.cross_refs.length > 0 && (
        <div className="compendium-detail-refs">
          <h4>Related</h4>
          <ul>
            {entity.cross_refs.map((ref) => {
              const related = allEntities.find((e) => e.id === ref);
              return (
                <li key={ref}>
                  {related ? (
                    <button className="compendium-ref-link" onClick={() => onSelectEntity(ref)}>
                      {displayName(related)}
                    </button>
                  ) : (
                    <span className="compendium-ref-missing">{ref}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {showNetwork && hasNetwork && (
        <EgoNetwork entity={entity} allEntities={allEntities} onSelectEntity={onSelectEntity} />
      )}
      {bodyHtml && (
        <div className="compendium-detail-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      )}
    </div>
  );
}
