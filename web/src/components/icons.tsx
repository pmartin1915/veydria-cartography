import type { ReactNode } from 'react'

const SVG_BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function svgFor(size: number) {
  return { width: size, height: size, viewBox: '0 0 24 24', ...SVG_BASE } as const
}

export const IconMountain = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M3 20l5-8 4 5 3-4 5 7H3Z"/></svg>

export const IconWaves = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M2 14c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3-2 4.5 0"/><path d="M2 10c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3-2 4.5 0"/></svg>

export const IconRiver = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M3 6c3 0 3 4 6 4s3-4 6-4 3 4 6 4"/><path d="M3 14c3 0 3 4 6 4s3-4 6-4 3 4 6 4"/></svg>

export const IconFlag = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>

export const IconFootsteps = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M8 4v4m0 0c0 4-3 5-3 8h6c0-3-3-4-3-8zm8 4v4m0 0c0 4-3 5-3 8h6c0-3-3-4-3-8z"/></svg>

export const IconPillars = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><rect x="2" y="20" width="20" height="2"/><rect x="6" y="4" width="3" height="16"/><rect x="15" y="4" width="3" height="16"/><rect x="2" y="4" width="20" height="3"/></svg>

export const IconLandmark = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><polygon points="12,2 22,12 12,22 2,12"/></svg>

export const IconLeaf = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M12 22V12M12 12C12 7 17 3 22 2c0 5-3 10-10 10zm0 0C12 7 7 3 2 2c0 5 3 10 10 10"/></svg>

export const IconStar = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><polygon points="12,2 14.5,9 22,9 16,13.5 18.5,21 12,16.5 5.5,21 8,13.5 2,9 9.5,9"/></svg>

export const IconAnchor = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0020 0h-3"/></svg>

export const IconShield = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>

export const IconRoute = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 004-4V8"/></svg>

export const IconPencil = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>

export const IconHex = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><polygon points="12,3 21,8 21,16 12,21 3,16 3,8"/></svg>

export const IconCompass = ({ size = 15 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="12" cy="12" r="10"/><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/></svg>

export const IconCalendar = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>

export const IconFlower = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="12" cy="12" r="3"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="7.05" cy="7.05" r="2"/><circle cx="16.95" cy="16.95" r="2"/></svg>

export const IconSun = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/></svg>

export const IconLeafFall = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M2 22c4-2 8-8 8-14 0 4 2 9 7 12"/><path d="M12 22c-2-4-2-8 2-12"/></svg>

export const IconSnowflake = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/></svg>

export const IconWarning = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>

export const IconCloudRain = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><line x1="16" y1="13" x2="16" y2="21"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0018 7h-1.26A8 8 0 104 15.25"/></svg>

export const IconPin = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 14 6 14s6-9.5 6-14c0-3.3-2.7-6-6-6z"/><circle cx="12" cy="8" r="2.5"/></svg>

export const IconClipboard = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>

export const IconScroll = ({ size = 12 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>

export const IconArrow = ({ size = 12 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14,6 20,12 14,18"/></svg>

export const IconClock = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>

export const IconBox = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27,6.96 12,12.01 20.73,6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>

export const IconBolt = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>

export const IconCircleDot = ({ size = 13 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>

export const IconLink = ({ size = 14 }: { size?: number } = {}) =>
  <svg {...svgFor(size)}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>

export function NodeIcon({ category, size = 13 }: { category: string; size?: number }) {
  const p = svgFor(size)
  let body: ReactNode
  switch (category) {
    case 'civilization':
      body = <><rect x="2" y="20" width="20" height="2"/><rect x="6" y="4" width="3" height="16"/><rect x="15" y="4" width="3" height="16"/><rect x="2" y="4" width="20" height="3"/></>
      break
    case 'port':
      body = <><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0020 0h-3"/></>
      break
    case 'oasis':
      body = <path d="M12 22V12M12 12C12 7 17 3 22 2c0 5-3 10-10 10zm0 0C12 7 7 3 2 2c0 5 3 10 10 10"/>
      break
    case 'landmark':
      body = <polygon points="12,2 22,12 12,22 2,12"/>
      break
    case 'chokepoint':
      body = <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      break
    case 'contested_site':
      body = <polygon points="12,2 14.5,9 22,9 16,13.5 18.5,21 12,16.5 5.5,21 8,13.5 2,9 9.5,9"/>
      break
    case 'trade_route':
      body = <><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 004-4V8"/></>
      break
    case 'water':
      body = <><path d="M2 14c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3-2 4.5 0"/><path d="M2 10c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3-2 4.5 0"/></>
      break
    case 'river':
      body = <><path d="M3 6c3 0 3 4 6 4s3-4 6-4 3 4 6 4"/><path d="M3 14c3 0 3 4 6 4s3-4 6-4 3 4 6 4"/></>
      break
    default:
      body = <><path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 14 6 14s6-9.5 6-14c0-3.3-2.7-6-6-6z"/><circle cx="12" cy="8" r="2.5"/></>
  }
  return <svg {...p}>{body}</svg>
}

// Inline SVG strings — for use inside template-literal HTML (e.g. Leaflet popups).
// These return raw SVG markup, not React elements.
function svgString(size: number, body: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

export const iconWarningHtml = (size = 12) =>
  svgString(size, '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>')

export const iconBoxHtml = (size = 12) =>
  svgString(size, '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27,6.96 12,12.01 20.73,6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>')

export const iconBoltHtml = (size = 12) =>
  svgString(size, '<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>')
