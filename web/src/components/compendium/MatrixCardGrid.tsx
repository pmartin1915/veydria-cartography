import React from 'react';
import type { CanonEntity } from './types';
import { CIVS, CIV_LABELS } from './types';

interface MatrixCardGridProps {
  entities: CanonEntity[];
  onSelectEntity: (id: string) => void;
}

export default function MatrixCardGrid({ entities, onSelectEntity }: MatrixCardGridProps) {
  const matrixEntities = entities.filter((e) => e.family === 'cross_civ_relationship');

  const getDyad = (a: string, b: string): CanonEntity | undefined => {
    const key1 = `${a}-${b}`;
    const key2 = `${b}-${a}`;
    return matrixEntities.find((e) => {
      const id = e.id.toLowerCase().replace(/\./g, '-');
      return id.includes(key1) || id.includes(key2);
    });
  };

  const getDensityLabel = (density?: number): string => {
    if (!density) return '—';
    if (density >= 4) return 'Dense';
    if (density >= 2) return 'Moderate';
    return 'Sparse';
  };

  const getDensityClass = (density?: number): string => {
    if (!density) return '';
    if (density >= 4) return 'density-dense';
    if (density >= 2) return 'density-moderate';
    return 'density-sparse';
  };

  return (
    <div className="matrix-card-grid">
      <div className="matrix-grid">
        {/* Header row */}
        <div className="matrix-cell matrix-header" />
        {CIVS.map((civ) => (
          <div key={civ} className="matrix-cell matrix-header">
            {CIV_LABELS[civ]}
          </div>
        ))}

        {/* Data rows */}
        {CIVS.map((rowCiv) => (
          <React.Fragment key={rowCiv}>
            <div className="matrix-cell matrix-row-header">
              {CIV_LABELS[rowCiv]}
            </div>
            {CIVS.map((colCiv) => {
              if (rowCiv === colCiv) {
                return (
                  <div key={colCiv} className="matrix-cell matrix-diagonal">
                    {CIV_LABELS[rowCiv]}
                  </div>
                );
              }
              const dyad = getDyad(rowCiv, colCiv);
              if (!dyad) {
                return (
                  <div key={colCiv} className="matrix-cell matrix-stub">
                    <span className="matrix-stub-label">Generate</span>
                  </div>
                );
              }
              return (
                <button
                  key={colCiv}
                  className="matrix-cell matrix-card"
                  onClick={() => onSelectEntity(dyad.id)}
                >
                  <div className="matrix-card-title">{dyad.name}</div>
                  <div className="matrix-card-meta">
                    <span className={`matrix-density ${getDensityClass(dyad.density)}`}>
                      {getDensityLabel(dyad.density)}
                    </span>
                    {dyad.status && (
                      <span className={`matrix-status status-${dyad.status}`}>
                        {dyad.status}
                      </span>
                    )}
                  </div>
                  {dyad.summary && (
                    <div className="matrix-card-summary">{dyad.summary}</div>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
