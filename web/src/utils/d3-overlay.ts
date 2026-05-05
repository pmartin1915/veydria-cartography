/**
 * d3-overlay.ts — D3 GeoJSON bridge for Leaflet
 *
 * Renders trade routes and other vector features as D3 SVG paths
 * overlaid on the Leaflet map. This provides more flexible styling
 * than Leaflet's built-in polyline rendering.
 */

import * as d3 from 'd3'
import L from 'leaflet'
import { GeoJSONFeature } from '../App'

// Convert SVG coordinate to Leaflet LatLng
const SVG_HEIGHT = 800
function svgToLatLng(x: number, y: number): L.LatLng {
  return L.latLng(SVG_HEIGHT - y, x)
}

interface Particle {
  progress: number
  speed: number
  element: d3.Selection<SVGCircleElement, unknown, null, undefined>
}

export function initD3Overlay(
  map: L.Map,
  features: GeoJSONFeature[],
  onFeatureClick: (feature: GeoJSONFeature) => void
) {
  L.svg().addTo(map)

  const svg = d3.select(map.getPanes().overlayPane).select<SVGSVGElement>('svg')
  const g = svg.select<SVGGElement>('g.leaflet-zoom-hide')

  g.selectAll('.d3-route-group').remove()
  const routeGroup = g.append('g').attr('class', 'd3-route-group')

  let defs = svg.select<SVGDefsElement>('defs')
  if (defs.empty()) {
    defs = svg.append('defs')
  }

  // Gold gradient for trade routes
  defs.selectAll('#route-gradient').data([1]).join('linearGradient')
    .attr('id', 'route-gradient')
    .attr('gradientUnits', 'userSpaceOnUse')
    .call((g) => {
      g.selectAll('stop').data([
        { offset: '0%', color: 'rgba(212, 168, 84, 0.9)' },
        { offset: '50%', color: 'rgba(212, 168, 84, 0.5)' },
        { offset: '100%', color: 'rgba(212, 168, 84, 0.1)' },
      ]).join('stop')
        .attr('offset', d => d.offset)
        .attr('stop-color', d => d.color)
    })

  // Add arrowhead marker
  defs.selectAll('#route-arrow').data([1]).join('marker')
    .attr('id', 'route-arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 8)
    .attr('refY', 0)
    .attr('markerWidth', 5)
    .attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L10,0L0,4')
    .attr('fill', '#d4a854')
    .attr('opacity', 0.8)

  // Glow filter for particles
  defs.selectAll('#particle-glow').data([1]).join('filter')
    .attr('id', 'particle-glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%')
    .call((f) => {
      f.append('feGaussianBlur')
        .attr('stdDeviation', '2')
        .attr('result', 'coloredBlur')
      f.append('feMerge')
        .call((m) => {
          m.append('feMergeNode').attr('in', 'coloredBlur')
          m.append('feMergeNode').attr('in', 'SourceGraphic')
        })
    })

  // Map features to D3 path elements
  const paths = routeGroup
    .selectAll('path.d3-route-path')
    .data(features)
    .join('path')
    .attr('class', 'd3-route-path')
    .attr('stroke', 'url(#route-gradient)')
    .attr('stroke-width', d => {
      const importance = (d.properties.importance as number) || 1
      return ((d.properties['stroke-width'] as number) || 2.5) * (0.8 + importance * 0.4)
    })
    .attr('stroke-dasharray', d => (d.properties['stroke-dasharray'] as string) || '6,4')
    .attr('fill', 'none')
    .attr('opacity', 0.75)
    .style('cursor', 'pointer')
    .on('click', (event, d) => onFeatureClick(d))
    .on('mouseover', function (_event, d) {
      d3.select(this)
        .interrupt()
        .attr('stroke-width', ((d.properties['stroke-width'] as number) || 2.5) * 1.8)
        .attr('opacity', 1)
        .attr('filter', 'drop-shadow(0 0 6px rgba(212, 168, 84, 0.6))')
    })
    .on('mouseout', function (_event, d) {
      const importance = (d.properties.importance as number) || 1
      d3.select(this)
        .interrupt()
        .attr('stroke-width', ((d.properties['stroke-width'] as number) || 2.5) * (0.8 + importance * 0.4))
        .attr('opacity', currentOpacity)
        .attr('filter', null)
    })

  // Particle group (separate from paths so they sit on top)
  const particleGroup = routeGroup.append('g').attr('class', 'd3-particle-group')

  // Track particles per path
  const pathParticles = new Map<string, { particles: Particle[]; pathElement: SVGPathElement }>()

  // Function to project coordinates using Leaflet's current transform
  function projectPoint(x: number, y: number) {
    const latlng = svgToLatLng(x, y)
    const point = map.latLngToLayerPoint(latlng)
    return [point.x, point.y]
  }

  // D3 line generator — use Catmull-Rom for smooth curves, fallback to linear for short routes
  function makeLine(coords: number[][]) {
    const generator = d3.line<number[]>()
      .x(d => projectPoint(d[0], d[1])[0])
      .y(d => projectPoint(d[0], d[1])[1])
    // CatmullRom needs at least 3 points; fallback to linear for 2-point routes
    if (coords.length <= 2) {
      return generator.curve(d3.curveLinear)
    }
    return generator.curve(d3.curveCatmullRom.alpha(0.5))
  }

  let currentOpacity = 0.75
  let isVisible = true
  let animFrameId: number | null = null
  let particleRafId: number | null = null
  let lastTime = 0

  // Create particles for each route
  function createParticles() {
    pathParticles.clear()
    particleGroup.selectAll('*').remove()

    paths.each(function (d, i) {
      const pathEl = this as SVGPathElement
      const totalLength = pathEl.getTotalLength()
      if (!totalLength || !isVisible) return

      const importance = (d.properties.importance as number) || 1
      const particleCount = importance >= 2 ? 3 : 2
      const particles: Particle[] = []

      for (let p = 0; p < particleCount; p++) {
        const circle = particleGroup.append('circle')
          .attr('r', 2.5 + importance * 0.5)
          .attr('fill', '#e8c840')
          .attr('opacity', 0)
          .attr('filter', 'url(#particle-glow)')

        particles.push({
          progress: p / particleCount,
          speed: 0.00015 + Math.random() * 0.00005,
          element: circle,
        })
      }

      pathParticles.set(String(i), { particles, pathElement: pathEl })
    })
  }

  // Animate particles
  function animate(time: number) {
    if (!isVisible) {
      animFrameId = null
      return
    }

    const dt = lastTime ? (time - lastTime) / 16.67 : 1
    lastTime = time

    for (const [, { particles, pathElement }] of pathParticles) {
      const totalLength = pathElement.getTotalLength()
      if (!totalLength) continue

      for (const particle of particles) {
        particle.progress += particle.speed * dt
        if (particle.progress > 1) particle.progress -= 1

        const point = pathElement.getPointAtLength(particle.progress * totalLength)
        particle.element
          .attr('cx', point.x)
          .attr('cy', point.y)

        // Fade in at start, fade out at end
        const fadeRange = 0.08
        let alpha = 1
        if (particle.progress < fadeRange) {
          alpha = particle.progress / fadeRange
        } else if (particle.progress > 1 - fadeRange) {
          alpha = (1 - particle.progress) / fadeRange
        }
        particle.element.attr('opacity', alpha * currentOpacity)
      }
    }

    animFrameId = requestAnimationFrame(animate)
  }

  function startAnimation() {
    if (animFrameId) return
    lastTime = 0
    animFrameId = requestAnimationFrame(animate)
  }

  function stopAnimation() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  // Update function called on zoom/pan
  function update() {
    paths.attr('d', d => {
      if (d.geometry.type === 'LineString') {
        const coords = d.geometry.coordinates as number[][]
        return makeLine(coords)(coords)
      }
      return null
    })

    // Defer particle creation until browser has laid out the new path data
    if (particleRafId) cancelAnimationFrame(particleRafId)
    particleRafId = requestAnimationFrame(() => {
      particleRafId = null
      createParticles()
    })
  }

  // Initial draw
  update()
  if (isVisible) startAnimation()

  // Bind to Leaflet events
  map.on('zoom', update)
  map.on('viewreset', update)
  map.on('moveend', update)

  return {
    update,
    destroy: () => {
      stopAnimation()
      if (particleRafId) {
        cancelAnimationFrame(particleRafId)
        particleRafId = null
      }
      map.off('zoom', update)
      map.off('viewreset', update)
      map.off('moveend', update)
      routeGroup.remove()
    },
    setVisibility: (visible: boolean) => {
      isVisible = visible
      routeGroup.style('display', visible ? 'block' : 'none')
      if (visible) {
        stopAnimation()
        if (particleRafId) {
          cancelAnimationFrame(particleRafId)
          particleRafId = null
        }
        createParticles()
        startAnimation()
      } else {
        stopAnimation()
      }
    },
    setOpacity: (opacity: number) => {
      currentOpacity = opacity
      paths.attr('opacity', opacity)
      particleGroup.selectAll('circle').attr('opacity', opacity)
    }
  }
}
