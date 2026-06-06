#!/usr/bin/env node
/**
 * build-asterisms.mjs — generate web/public/asterisms.json from data/asterisms.yaml
 *
 * The cartography-side machine extract of the Oravan nakhoda star-register
 * (ADR-0023 Q6). data/asterisms.yaml is the human-readable source of truth;
 * the app fetches the generated JSON at runtime (no in-bundle YAML parser).
 * The generated JSON is committed, exactly like web/public/encounters.json.
 *
 * Mirrors the yaml2json transform in sync-world-data.mjs (`yaml` from web/node_modules).
 *
 * Usage: node scripts/build-asterisms.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'data', 'asterisms.yaml');
const DEST = resolve(ROOT, 'web', 'public', 'asterisms.json');

const requireFromWeb = createRequire(resolve(ROOT, 'web', 'package.json'));
const YAML = requireFromWeb('yaml');

const data = YAML.parse(readFileSync(SRC, 'utf8'));
writeFileSync(DEST, JSON.stringify(data, null, 2) + '\n');

const count = Array.isArray(data?.asterisms) ? data.asterisms.length : 0;
console.log(`✅ Generated web/public/asterisms.json (${count} asterisms)`);
