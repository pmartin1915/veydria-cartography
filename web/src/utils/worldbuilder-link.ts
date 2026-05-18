/**
 * Deep-link helpers for the canonical worldbuilder compendium.
 *
 * This panel is a subordinate Phase 1 copy (see CompendiumPanel.tsx). For depth
 * we link out to the canonical compendium hosted by the worldbuilder map-viewer.
 * Base URL is configurable via VITE_WORLDBUILDER_COMPENDIUM_URL (see .env.example).
 */

export const WORLDBUILDER_DEFAULT_BASE = 'http://localhost:5173';

function resolveBaseFromEnv(): string {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const fromEnv = env.VITE_WORLDBUILDER_COMPENDIUM_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : WORLDBUILDER_DEFAULT_BASE;
}

export const WORLDBUILDER_BASE: string = resolveBaseFromEnv();

function normalize(base: string): string {
  return base.replace(/\/+$/, '');
}

export function buildWorldbuilderCompendiumUrl(
  id: string,
  base: string = WORLDBUILDER_BASE,
): string {
  return `${normalize(base)}/#compendium?id=${encodeURIComponent(id)}`;
}

export function buildWorldbuilderHomeUrl(base: string = WORLDBUILDER_BASE): string {
  return `${normalize(base)}/#compendium`;
}
