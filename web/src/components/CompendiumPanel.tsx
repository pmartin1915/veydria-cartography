import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { marked } from 'marked';
import type { CanonEntity, CanonEntityRaw, CompendiumTab } from './compendium/types';
import { CIVS, CIV_LABELS, LENSES, displayName } from './compendium/types';
import { loadCanon, loadSearchIndex, getEntitiesArray, getMapAnchor } from '../utils/compendium-data';

interface CompendiumPanelProps {
  onSelectMapAnchor?: (kind: string, slug: string) => void;
  onClose?: () => void;
}

export default function CompendiumPanel({ onSelectMapAnchor, onClose }: CompendiumPanelProps) {
  const [canon, setCanon] = useState<Record<string, CanonEntityRaw> | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<CompendiumTab>('browse');
  const [civPage, setCivPage] = useState<string | null>(null);
  const [lens, setLens] = useState<string | null>(null);
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
    const raw = canon[selectedId];
    if (!raw) return null;
    return { ...raw, id: selectedId } as CanonEntity;
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
  if (lens) {
    let filtered: CanonEntity[] = [];
    switch (lens) {
      case 'calendars':
        filtered = entities.filter((e) => e.family === 'calendar_institution');
        break;
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

function EntityDetailView({ entity, onBack, onMapClick, hasMapAnchor }: {
  entity: CanonEntity;
  onBack: () => void;
  onMapClick: () => void;
  hasMapAnchor: boolean;
}) {
  const [bodyHtml, setBodyHtml] = useState('');

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
      {hasMapAnchor && (
        <button className="compendium-map-btn" onClick={onMapClick}>
          🗺 Show on Map
        </button>
      )}
      {entity.summary && (
        <div className="compendium-detail-summary">{entity.summary}</div>
      )}
      {entity.cross_refs && entity.cross_refs.length > 0 && (
        <div className="compendium-detail-refs">
          <h4>Related</h4>
          <ul>
            {entity.cross_refs.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        </div>
      )}
      {bodyHtml && (
        <div className="compendium-detail-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      )}
    </div>
  );
}
