// Local data gate (CI was retired 2026-06-29, a072da8, to stop Actions drain).
// Runs the worldbuilder sync check, then `pipeline.py validate` on the topology,
// preferring generator/.venv (system Python usually lacks jsonschema/shapely).
// Run from web/ as `npm run check:data`, or directly: node scripts/check-data.mjs

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GEN = join(ROOT, 'generator')
const venvPy = join(GEN, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(venvPy) ? venvPy : 'python'

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (r.error) console.error(`check:data: could not run ${cmd}: ${r.error.message}`)
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(process.execPath, [join(ROOT, 'scripts', 'sync-world-data.mjs'), '--check'], ROOT)
run(python, ['pipeline.py', 'validate'], GEN)
