#!/usr/bin/env node
/**
 * gen-icons.mjs — rasterize the Veydria compass mark (web/public/favicon.svg)
 * to the PNGs the app/installer need.
 *
 * Uses the already-installed Playwright (devDep in web/) as the rasterizer, so
 * no new dependency is added (Money-Rule safe). Mirrors build-asterisms.mjs's
 * createRequire-anchored-at-web pattern for module resolution.
 *
 * Outputs:
 *   web/src-tauri/icons/source.png   1024x1024  -> feed to `npm run tauri icon`
 *   web/public/favicon-32.png          32x32    -> <link rel="icon" png fallback>
 *   web/public/apple-touch-icon.png   180x180   -> <link rel="apple-touch-icon">
 *
 * Usage: node scripts/gen-icons.mjs   (run from anywhere; paths are repo-anchored)
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const requireFromWeb = createRequire(resolve(ROOT, 'web', 'package.json'));
const { chromium } = requireFromWeb('@playwright/test');

const svg = readFileSync(resolve(ROOT, 'web', 'public', 'favicon.svg'), 'utf8');

const TARGETS = [
  { out: 'web/src-tauri/icons/source.png', size: 1024 },
  { out: 'web/public/favicon-32.png', size: 32 },
  { out: 'web/public/apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { out, size } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><head><style>
      *{margin:0;padding:0}
      html,body{background:transparent}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const el = await page.$('svg');
    if (!el) throw new Error('svg element not found in rendered page');
    // omitBackground keeps the rounded-rect corners transparent (the mark's own
    // dark rect supplies the icon fill).
    await el.screenshot({ path: resolve(ROOT, out), omitBackground: true });
    await page.close();
    console.log(`wrote ${out} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
