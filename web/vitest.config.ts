import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  // Mirror vite.config.ts so __APP_VERSION__ is defined when a test imports a
  // component that uses it (this config does not extend vite.config).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '../scripts/**/*.test.ts'],
    reporters: ['default'],
  },
})
