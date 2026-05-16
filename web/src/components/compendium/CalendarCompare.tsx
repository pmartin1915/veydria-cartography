import React from 'react';
import type { CanonEntity } from './types';
import { CIVS, CIV_LABELS } from './types';

const SECTIONS = [
  'Master Rhythm',
  'Year Structure',
  'Gating Mechanism',
  'Political Function',
  'Annual Cycle',
  'Internal Fracture',
  'Cross-Calendar Interaction',
  'Design Notes',
] as const;

interface CalendarCompareProps {
  entities: CanonEntity[];
}

export default function CalendarCompare({ entities }: CalendarCompareProps) {
  const calendarEntities = entities.filter((e) => e.family === 'calendar_institution');

  const byCiv = React.useMemo(() => {
    const map: Record<string, CanonEntity[]> = {};
    for (const civ of CIVS) {
      map[civ] = calendarEntities.filter((e) => {
        if (!e.civ_scope) return false;
        if (Array.isArray(e.civ_scope)) return e.civ_scope.includes(civ);
        return e.civ_scope === civ;
      });
    }
    return map;
  }, [calendarEntities]);

  const findSection = (entity: CanonEntity, sectionTitle: string): { title: string; snippet: string } | null => {
    if (!entity.body) return null;
    const lines = entity.body.split('\n');
    let inSection = false;
    let sectionLines: string[] = [];
    let foundTitle = '';

    for (const line of lines) {
      const match = line.match(/^##+\s+(.+)$/);
      if (match) {
        if (inSection) break;
        if (match[1].toLowerCase().includes(sectionTitle.toLowerCase()) ||
            sectionTitle.toLowerCase().includes(match[1].toLowerCase())) {
          inSection = true;
          foundTitle = match[1];
        }
      } else if (inSection) {
        sectionLines.push(line);
      }
    }

    if (!inSection) return null;
    const snippet = sectionLines.join(' ').trim().slice(0, 180);
    return { title: foundTitle, snippet };
  };

  return (
    <div className="calendar-compare">
      <div className="calendar-compare-grid">
        {/* Header row */}
        <div className="calendar-compare-cell calendar-compare-header" />
        {CIVS.map((civ) => (
          <div key={civ} className="calendar-compare-cell calendar-compare-header">
            {CIV_LABELS[civ]}
          </div>
        ))}

        {/* Data rows */}
        {SECTIONS.map((section) => (
          <React.Fragment key={section}>
            <div className="calendar-compare-cell calendar-compare-row-header">
              {section}
            </div>
            {CIVS.map((civ) => {
              const civEntities = byCiv[civ] || [];
              let match: ReturnType<typeof findSection> = null;
              for (const e of civEntities) {
                match = findSection(e, section);
                if (match) break;
              }
              return (
                <div
                  key={`${section}-${civ}`}
                  className={`calendar-compare-cell ${match ? '' : 'calendar-compare-stub'}`}
                >
                  {match ? (
                    <>
                      <div className="calendar-compare-section-title">{match.title}</div>
                      <div className="calendar-compare-snippet">{match.snippet}…</div>
                    </>
                  ) : (
                    <span className="calendar-compare-stub-label">—</span>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
