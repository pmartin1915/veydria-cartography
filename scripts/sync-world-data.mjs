#!/usr/bin/env node
/**
 * sync-world-data.mjs — Sync canonical worldbuilder data into cartography
 *
 * The worldbuilder repo is the source of truth. This script copies the
 * geography files that the cartography pipeline depends on.
 *
 * Usage: node scripts/sync-world-data.mjs [--check]
 *   --check  Verify files are in sync without copying
 */
import { cpSync, existsSync, statSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARTOGRAPHY_PATH = process.env.CARTOGRAPHY_PATH || resolve(__dirname, '..');
const WORLDBUILDER_PATH = process.env.WORLDBUILDER_PATH || resolve(CARTOGRAPHY_PATH, '..', 'worldbuilder');

// Map of source paths in worldbuilder to destination paths in cartography
// These are the canonical files per README.md
const SYNC_MAP = [
  {
    src: 'geography/continents/veydria-topology.yaml',
    dest: 'data/veydria-topology.yaml',
    description: 'Spatial source of truth — civilization positions, chokepoints, trade routes'
  },
  {
    src: 'geography/MAP-PROMPT.md',
    dest: 'data/MAP-PROMPT.md',
    description: 'Definitive visual specification for all map outputs'
  },
  {
    src: 'geography/veydria-schematic.svg',
    dest: 'data/veydria-schematic.svg',
    description: 'Base SVG schematic from which coordinates are derived'
  },
  {
    src: 'timeline/calendar/calendar-events.yaml',
    dest: 'data/calendar-events.yaml',
    description: 'Structured calendar events (optional — falls back to hardcoded if missing in worldbuilder)',
    optional: true,
  },
  {
    src: 'design/narrative-schema/canon.json',
    dest: 'web/public/canon.json',
    description: 'Compendium entity corpus (340 entities) for narrative browsing',
    optional: true,
  },
  {
    src: 'design/narrative-schema/search-index.json',
    dest: 'web/public/search-index.json',
    description: 'Full-text search index for compendium search',
    optional: true,
  },
  {
    src: 'design/narrative-schema/map-anchors.json',
    dest: 'web/public/map-anchors.json',
    description: 'Compendium→map anchor mappings (30 entries)',
    optional: true,
  },
  {
    src: 'ecology/encounters/encounters.yaml',
    dest: 'web/public/encounters.json',
    description: 'Machine-readable encounter canon (ADR-0022); yaml→json for the journey-sim',
    optional: true,
    transform: 'yaml2json',
  },
  {
    src: 'geography/continents/veydria-travel-graph.yaml',
    dest: 'web/src/generated/veydria-travel-graph.json',
    description: 'Authored inter-place travel durations (ADR-0018); yaml→json for the journey graph',
    optional: true,
    transform: 'yaml2json',
  },
];

// yaml→json conversion keeps the web app on its familiar fetch-JSON path (no
// in-bundle YAML parser). `yaml` is resolved from web/node_modules.
function yamlToJson(srcPath, destPath) {
  const requireFromWeb = createRequire(resolve(CARTOGRAPHY_PATH, 'web', 'package.json'));
  const YAML = requireFromWeb('yaml');
  const data = YAML.parse(readFileSync(srcPath, 'utf8'));
  writeFileSync(destPath, JSON.stringify(data, null, 2) + '\n');
}

const CHECK_MODE = process.argv.includes('--check');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getMtime(path) {
  try {
    return statSync(path).mtime;
  } catch {
    return null;
  }
}

console.log(CHECK_MODE
  ? '🔍 Checking worldbuilder → cartography sync status...'
  : '🔄 Syncing worldbuilder data to cartography engine...');
console.log();

let synced = 0;
let stale = 0;
let missing = 0;

for (const { src, dest, description, optional, transform } of SYNC_MAP) {
  const srcPath = join(WORLDBUILDER_PATH, src);
  const destPath = join(CARTOGRAPHY_PATH, dest);
  const relDest = relative(CARTOGRAPHY_PATH, destPath);

  if (!existsSync(srcPath)) {
    if (optional) {
      console.log(`⏭️  Skipped (optional, not in worldbuilder): ${src}`);
      continue;
    }
    console.error(`❌ Source not found: ${srcPath}`);
    missing++;
    continue;
  }

  const srcMtime = getMtime(srcPath);
  const destMtime = getMtime(destPath);
  const srcSize = statSync(srcPath).size;

  if (CHECK_MODE) {
    if (!destMtime) {
      console.log(`❌ ${relDest} — missing`);
      missing++;
    } else if (srcMtime > destMtime) {
      const age = Math.round((srcMtime - destMtime) / 1000 / 60);
      console.log(`⚠️  ${relDest} — stale by ${age} min (${formatBytes(srcSize)})`);
      stale++;
    } else {
      console.log(`✅ ${relDest} — up to date (${formatBytes(srcSize)})`);
      synced++;
    }
    continue;
  }

  // Copy mode
  if (!destMtime || srcMtime > destMtime) {
    if (transform === 'yaml2json') {
      yamlToJson(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
    console.log(`✅ Synced: ${src} → ${relDest}`);
    console.log(`   ${description}`);
    synced++;
  } else {
    console.log(`⏭️  Skipped (up to date): ${relDest}`);
  }
}

console.log();
if (CHECK_MODE) {
  const total = SYNC_MAP.length;
  console.log(`📊 Status: ${synced}/${total} up to date, ${stale} stale, ${missing} missing`);
  if (stale > 0 || missing > 0) {
    console.log('   Run without --check to sync.');
    process.exit(1);
  }
} else {
  console.log('✨ Sync complete.');
  console.log(`   Tip: Run with --check in CI to verify sync before builds.`);
}
