export interface CoordinatePatch {
  id: string
  category: string
  coords: [number, number]
}

export function parsePatchYaml(yaml: string): CoordinatePatch[] {
  const patches: CoordinatePatch[] = []
  const lines = yaml.split('\n')
  let current: Partial<CoordinatePatch> | null = null
  let inPatches = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'patches:') {
      inPatches = true
      continue
    }
    if (trimmed.startsWith('metadata:')) {
      inPatches = false
      continue
    }
    if (!inPatches) continue

    // Match "- id: some_id"
    const idMatch = trimmed.match(/^-\s*id:\s*(.+)$/)
    if (idMatch) {
      if (current?.id && current?.coords) {
        patches.push(current as CoordinatePatch)
      }
      current = { id: idMatch[1].trim() }
      continue
    }

    // Match "category: some_category"
    const catMatch = trimmed.match(/^category:\s*(.+)$/)
    if (catMatch && current) {
      current.category = catMatch[1].trim()
      continue
    }

    // Match "coords: [x, y]"
    const coordsMatch = trimmed.match(/^coords:\s*\[\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\]$/)
    if (coordsMatch && current) {
      current.coords = [parseFloat(coordsMatch[1]), parseFloat(coordsMatch[2])]
      continue
    }
  }

  if (current?.id && current?.coords) {
    patches.push(current as CoordinatePatch)
  }

  return patches
}

export function applyPatches(
  geojson: { features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }> },
  patches: CoordinatePatch[]
): { applied: number; skipped: number; details: string[] } {
  let applied = 0
  let skipped = 0
  const details: string[] = []

  for (const patch of patches) {
    const feature = geojson.features.find((f) => {
      const fid = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
      return fid === patch.id
    })

    if (!feature) {
      skipped++
      details.push(`Skipped: ${patch.id} — feature not found`)
      continue
    }

    if (feature.geometry.type === 'Point') {
      feature.geometry.coordinates = patch.coords
      applied++
      details.push(`Applied: ${patch.id} → [${patch.coords[0].toFixed(1)}, ${patch.coords[1].toFixed(1)}]`)
    } else {
      skipped++
      details.push(`Skipped: ${patch.id} — not a Point geometry`)
    }
  }

  return { applied, skipped, details }
}
