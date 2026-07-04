import { useEffect, useRef } from 'react'
import type { Season } from '../../utils/journey-graph'
import { djb2Hash, mulberry32 } from '../../utils/encounters'

interface TrailVistaProps {
  biome: string | undefined
  season?: Season
  dayNum: number
  paused: boolean
  seed: number
}

const VISTA_PALETTE: Record<
  string,
  { sky: string; far: string; mid: string; ground: string; accent: string }
> = {
  Desert: { sky: '#f2dfae', far: '#c8966a', mid: '#d9a85c', ground: '#e0b978', accent: '#7a5a36' },
  Sabkha: { sky: '#e8e4d0', far: '#6b5e46', mid: '#b8a64e', ground: '#d8cf72', accent: '#bdb45f' },
  Steppe: { sky: '#dfe3c8', far: '#8a7a44', mid: '#9a8a54', ground: '#b8a64e', accent: '#4a3f2a' },
  Escarpment: { sky: '#d8d4c8', far: '#6e5a48', mid: '#8a7a5e', ground: '#a5906a', accent: '#4a3f30' },
  'Highland savanna': {
    sky: '#e2e6c6',
    far: '#3f7d5a',
    mid: '#6f8a4e',
    ground: '#8fa05e',
    accent: '#2c4a30',
  },
  'Cloud forest': {
    sky: '#ccd8d4',
    far: '#2c5a40',
    mid: '#3f7d5a',
    ground: '#356a4a',
    accent: '#24483a',
  },
  'Miombo woodland': {
    sky: '#e6dcc0',
    far: '#5a6a3e',
    mid: '#7a8a4e',
    ground: '#93a05a',
    accent: '#3a4a28',
  },
  'Monsoon delta': {
    sky: '#d2e2de',
    far: '#2f7d6e',
    mid: '#3f7d6a',
    ground: '#4a8a9a',
    accent: '#2f6d5e',
  },
  Oasis: { sky: '#eadfb2', far: '#c8966a', mid: '#3f8a5a', ground: '#d9b878', accent: '#2c5a40' },
  default: { sky: '#e0dcc8', far: '#6f7a5a', mid: '#8a946f', ground: '#a8a37e', accent: '#4a4a38' },
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')}`
}

function mixHex(base: string, tint: string, ratio: number): string {
  const a = hexToRgb(base)
  const b = hexToRgb(tint)
  return rgbToHex({
    r: a.r * (1 - ratio) + b.r * ratio,
    g: a.g * (1 - ratio) + b.g * ratio,
    b: a.b * (1 - ratio) + b.b * ratio,
  })
}

function applySeason(
  palette: (typeof VISTA_PALETTE)[string],
  season: Season | undefined,
): (typeof VISTA_PALETTE)[string] {
  if (season === 'winter') {
    return {
      ...palette,
      sky: mixHex(palette.sky, '#d8e0e8', 0.15),
      ground: mixHex(palette.ground, '#d8e0e8', 0.15),
    }
  }
  if (season === 'summer') {
    return {
      ...palette,
      sky: mixHex(palette.sky, '#f0d8a0', 0.1),
      ground: mixHex(palette.ground, '#f0d8a0', 0.1),
    }
  }
  return palette
}

interface RidgeBump {
  x: number
  width: number
  height: number
}

interface ScatterFeature {
  x: number
  y: number
  kind: ScatterKind
}

interface GroundSpeck {
  x: number
  y: number
}

type ScatterKind = 'dune' | 'scrub' | 'tree'

function generateRidge(rng: () => number): RidgeBump[] {
  const bumps: RidgeBump[] = []
  let x = 0
  while (x < 160) {
    const width = 8 + Math.floor(rng() * 5)
    const height = 3 + Math.floor(rng() * 4)
    bumps.push({ x, width, height })
    x += width
  }
  return bumps
}

function scatterKindForBiome(biome: string | undefined): ScatterKind {
  const b = biome ?? 'default'
  if (b === 'Desert' || b === 'Sabkha') return 'dune'
  if (b === 'Steppe' || b === 'Escarpment') return 'scrub'
  if (b === 'Cloud forest' || b === 'Miombo woodland' || b === 'Monsoon delta') return 'tree'
  return 'scrub'
}

function generateScatter(rng: () => number, kind: ScatterKind): ScatterFeature[] {
  const count = 8 + Math.floor(rng() * 5)
  const features: ScatterFeature[] = []
  for (let i = 0; i < count; i++) {
    features.push({
      x: Math.floor(rng() * 160),
      y: 20 + Math.floor(rng() * 11),
      kind,
    })
  }
  return features
}

function generateGroundSpecks(rng: () => number): GroundSpeck[] {
  const specks: GroundSpeck[] = []
  for (let i = 0; i < 10; i++) {
    specks.push({
      x: Math.floor(rng() * 160),
      y: 31 + Math.floor(rng() * 13),
    })
  }
  return specks
}

function drawScatterFeature(ctx: CanvasRenderingContext2D, x: number, y: number, kind: ScatterKind) {
  if (kind === 'dune') {
    ctx.fillRect(Math.floor(x - 1), Math.floor(y - 1), 3, 2)
  } else if (kind === 'scrub') {
    ctx.fillRect(Math.floor(x), Math.floor(y - 1), 1, 2)
  } else {
    // tree: 2x3 canopy on 1x1 trunk
    ctx.fillRect(Math.floor(x), Math.floor(y), 1, 2)
    ctx.fillRect(Math.floor(x), Math.floor(y - 3), 2, 3)
  }
}

function wrapOffset(offset: number): number {
  let o = offset
  while (o <= -160) o += 160
  while (o > 0) o -= 160
  return o
}

export default function TrailVista({ biome, season, dayNum, paused, seed }: TrailVistaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufferRef = useRef<HTMLCanvasElement | null>(null)

  if (!bufferRef.current) {
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 44
    bufferRef.current = c
  }

  const paletteKey = biome ?? 'default'
  const palette = VISTA_PALETTE[paletteKey] ?? VISTA_PALETTE.default
  const colors = applySeason(palette, season)

  const ridgeRef = useRef<RidgeBump[]>([])
  const scatterRef = useRef<ScatterFeature[]>([])
  const specksRef = useRef<GroundSpeck[]>([])

  const farOffsetRef = useRef(0)
  const midOffsetRef = useRef(0)
  const groundOffsetRef = useRef(0)
  const velocityRef = useRef(0)
  const distanceRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const prevTimestampRef = useRef<number | null>(null)
  const prevDayNumRef = useRef(dayNum)
  const reducedMotionRef = useRef(false)
  const drawRef = useRef<() => void>(() => {})
  const stopRafRef = useRef<() => void>(() => {})

  function regenerateLayouts() {
    const rng = mulberry32(seed ^ djb2Hash(biome ?? 'default'))
    ridgeRef.current = generateRidge(rng)
    scatterRef.current = generateScatter(rng, scatterKindForBiome(biome))
    specksRef.current = generateGroundSpecks(rng)
  }

  function stopRaf() {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    prevTimestampRef.current = null
  }

  function startBurst() {
    velocityRef.current = 48
    distanceRef.current = 0
    prevTimestampRef.current = null
    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(tick)
    }
  }

  function tick(timestamp: number) {
    if (prevTimestampRef.current == null) {
      prevTimestampRef.current = timestamp
      rafIdRef.current = requestAnimationFrame(tick)
      draw()
      return
    }

    const dt = (timestamp - prevTimestampRef.current) / 1000
    prevTimestampRef.current = timestamp

    const v = velocityRef.current
    if (v > 0 && dt > 0) {
      farOffsetRef.current = wrapOffset(farOffsetRef.current + v * 0.25 * dt)
      midOffsetRef.current = wrapOffset(midOffsetRef.current + v * 0.5 * dt)
      groundOffsetRef.current = wrapOffset(groundOffsetRef.current + v * 1.0 * dt)
      distanceRef.current += v * dt
      velocityRef.current = Math.max(0, v - 60 * dt)
    }

    draw()

    if (velocityRef.current > 0) {
      rafIdRef.current = requestAnimationFrame(tick)
    } else {
      rafIdRef.current = null
      prevTimestampRef.current = null
    }
  }

  function drawCaravan(ctx: CanvasRenderingContext2D, x: number, groundY: number) {
    ctx.fillStyle = '#10141c'
    const bx = Math.floor(x)
    const by = Math.floor(groundY)
    // wagon body 14x6
    ctx.fillRect(bx, by - 6, 14, 6)
    // 3x3 canopy hump
    ctx.fillRect(bx + 5, by - 9, 3, 3)
    // two 2x2 wheels
    ctx.fillRect(bx + 2, by, 2, 2)
    ctx.fillRect(bx + 10, by, 2, 2)
    // draft-beast 8x5 ahead
    ctx.fillRect(bx + 14, by - 5, 8, 5)
  }

  function draw() {
    const visible = canvasRef.current
    const buffer = bufferRef.current
    if (!visible || !buffer) return

    const bctx = buffer.getContext('2d')
    const vctx = visible.getContext('2d')
    if (!bctx || !vctx) return

    bctx.imageSmoothingEnabled = false
    bctx.clearRect(0, 0, 160, 44)

    // Sky band
    bctx.fillStyle = colors.sky
    bctx.fillRect(0, 0, 160, 18)

    // Sun (accent-tinted white, fixed at x=128 y=4)
    bctx.fillStyle = mixHex('#ffffff', colors.accent, 0.2)
    bctx.fillRect(128, 4, 5, 5)

    // Far ridge
    bctx.fillStyle = colors.far
    const farOffset = farOffsetRef.current
    for (const bump of ridgeRef.current) {
      for (const tile of [0, 160]) {
        const x = Math.floor(farOffset + bump.x + tile)
        const y = Math.floor(22 - bump.height)
        bctx.fillRect(x, y, bump.width, bump.height)
      }
    }

    // Mid scatter
    bctx.fillStyle = colors.mid
    const midOffset = midOffsetRef.current
    for (const f of scatterRef.current) {
      for (const tile of [0, 160]) {
        const x = Math.floor(midOffset + f.x + tile)
        const y = Math.floor(f.y)
        drawScatterFeature(bctx, x, y, f.kind)
      }
    }

    // Ground band
    bctx.fillStyle = colors.ground
    bctx.fillRect(0, 30, 160, 14)

    // Horizon line
    bctx.fillStyle = colors.accent
    bctx.fillRect(0, 30, 160, 1)

    // Ground specks
    bctx.fillStyle = colors.accent
    const groundOffset = groundOffsetRef.current
    for (const speck of specksRef.current) {
      for (const tile of [0, 160]) {
        const x = Math.floor(groundOffset + speck.x + tile)
        const y = Math.floor(speck.y)
        bctx.fillRect(x, y, 1, 1)
      }
    }

    // Caravan (fixed x ~104, on ground line)
    const scrolling = velocityRef.current > 0
    const yOffset = scrolling ? Math.floor(distanceRef.current / 6) % 2 : 0
    drawCaravan(bctx, 104, 30 - yOffset)

    // Blit offscreen buffer to visible canvas 2x with smoothing disabled
    vctx.imageSmoothingEnabled = false
    vctx.clearRect(0, 0, 320, 88)
    vctx.drawImage(buffer, 0, 0, 320, 88)
  }

  // Regenerate layouts and paint when biome or seed changes.
  useEffect(() => {
    regenerateLayouts()
    farOffsetRef.current = 0
    midOffsetRef.current = 0
    groundOffsetRef.current = 0
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biome, seed])

  // Repaint when season changes.
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season])

  // Scroll burst on dayNum change; no burst on mount.
  useEffect(() => {
    if (dayNum !== prevDayNumRef.current) {
      prevDayNumRef.current = dayNum
      if (!paused && !reducedMotionRef.current) {
        startBurst()
      } else {
        draw()
      }
    }
  }, [dayNum, paused])

  // Pause cancels an in-flight burst and freezes the frame.
  useEffect(() => {
    if (paused && rafIdRef.current != null) {
      stopRaf()
      draw()
    }
  }, [paused])

  // Keep the latest imperative callbacks available to event listeners.
  drawRef.current = draw
  stopRafRef.current = stopRaf

  // Reduced-motion listener.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mql.matches
    const listener = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches
      if (e.matches) stopRafRef.current()
      drawRef.current()
    }
    mql.addEventListener('change', listener)
    return () => {
      mql.removeEventListener('change', listener)
    }
  }, [])

  // Cleanup rAF on unmount.
  useEffect(() => {
    return () => {
      stopRaf()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-testid="trail-vista"
      className="trail-vista"
      width={320}
      height={88}
      aria-hidden="true"
    />
  )
}
