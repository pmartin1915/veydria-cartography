import React, { useMemo, useRef, useEffect, useState } from 'react';
import type { CanonEntity } from './types';
import { displayName } from './types';

interface EgoNetworkProps {
  entity: CanonEntity;
  allEntities: CanonEntity[];
  onSelectEntity: (id: string) => void;
}

export default function EgoNetwork({ entity, allEntities, onSelectEntity }: EgoNetworkProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 300, height: 300 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, links } = useMemo(() => {
    const centerId = entity.id;
    const centerNode = { id: centerId, label: displayName(entity), x: 0, y: 0, color: '#c4a862' };

    const outIds = new Set(entity.cross_refs || []);
    const inIds = new Set(allEntities.filter((e) => e.cross_refs?.includes(centerId)).map((e) => e.id));

    // Remove center from sets
    outIds.delete(centerId);
    inIds.delete(centerId);

    const nodes: Array<{ id: string; label: string; x: number; y: number; color: string }> = [centerNode];
    const links: Array<{ source: string; target: string }> = [];

    const allNeighbors = Array.from(new Set([...outIds, ...inIds]));
    const radius = Math.min(size.width, size.height) * 0.35;
    const angleStep = allNeighbors.length > 0 ? (2 * Math.PI) / allNeighbors.length : 0;

    allNeighbors.forEach((id, i) => {
      const neighbor = allEntities.find((e) => e.id === id);
      if (!neighbor) return;
      const angle = i * angleStep - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const isOutgoing = outIds.has(id);
      const color = isOutgoing ? '#4a9a3a' : '#88ccff';
      nodes.push({ id, label: displayName(neighbor), x, y, color });
      links.push({ source: isOutgoing ? centerId : id, target: isOutgoing ? id : centerId });
    });

    return { nodes, links };
  }, [entity, allEntities, size.width, size.height]);

  const cx = size.width / 2;
  const cy = size.height / 2;

  return (
    <div className="compendium-ego-network">
      <h4>Network</h4>
      <div className="compendium-ego-legend">
        <span><span className="compendium-legend-dot" style={{ background: '#c4a862' }} /> Root</span>
        <span><span className="compendium-legend-dot" style={{ background: '#4a9a3a' }} /> Outgoing</span>
        <span><span className="compendium-legend-dot" style={{ background: '#88ccff' }} /> Incoming</span>
      </div>
      <svg ref={svgRef} width={size.width} height={size.height}>
        <g transform={`translate(${cx}, ${cy})`}>
          {links.map((link, i) => {
            const source = nodes.find((n) => n.id === link.source);
            const target = nodes.find((n) => n.id === link.target);
            if (!source || !target) return null;
            return (
              <line
                key={i}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="rgba(196, 168, 98, 0.25)"
                strokeWidth={1}
              />
            );
          })}
          {nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="compendium-ego-node"
              onClick={() => node.id !== entity.id && onSelectEntity(node.id)}
              style={{ cursor: node.id !== entity.id ? 'pointer' : 'default' }}
            >
              <circle r={node.id === entity.id ? 10 : 6} fill={node.color} opacity={0.9} />
              <text
                y={node.id === entity.id ? -14 : -10}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize={node.id === entity.id ? 11 : 9}
                fontFamily="var(--font-body)"
              >
                {node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
