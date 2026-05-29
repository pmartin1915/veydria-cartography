/**
 * Plain-language "What is this?" for canon entities — the faction/house
 * counterpart to the place-orientation in ai-lore.ts. Deterministic, offline,
 * and faithful: it restates an entity's own canon fields under plain framing
 * rather than inventing flavour, so it works with no API key and stays true to
 * the data. Built for faction entities, whose `summary` is a short truncated
 * fragment; the `lede` field (added by worldbuilder's extract-canon.mjs) gives
 * us real opening prose to surface.
 *
 * Kept standalone (a local `asSentence`, no import from ai-lore) because that
 * module is GeoJSON/place-shaped; this one works on CanonEntity.
 */
import type { CanonEntity } from '../components/compendium/types';
import { CIV_LABELS, displayName } from '../components/compendium/types';

/** Trim and ensure terminal punctuation; canon text is shown verbatim. */
function asSentence(value: string): string {
  const t = value.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** Title-case a civ slug, preferring the canonical label. */
function civLabel(slug: string): string {
  const label = (CIV_LABELS as Record<string, string>)[slug];
  if (label) return label;
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeTag(tag: string): string {
  return tag.replace(/[-_]/g, ' ');
}

/**
 * A plain clause describing what kind of thing the entity is, derived from its
 * scope / entity_type / civ fields. Mirrors the spirit of CATEGORY_NOUNS in
 * ai-lore.ts but keyed off canon structure rather than a map category.
 */
function framingClause(entity: CanonEntity): string {
  const et = (entity.entity_type ?? '').toLowerCase();
  const scope = entity.scope;
  const pair = Array.isArray(entity.civ_pair) && entity.civ_pair.length >= 2 ? entity.civ_pair : null;

  if (et.includes('relationship') || pair) {
    return pair
      ? `the relationship between the ${civLabel(pair[0])} and ${civLabel(pair[1])} civilizations`
      : 'a relationship between two civilizations';
  }
  if (et.includes('crisis')) return 'a basin-wide crisis that cuts across the civilizations';
  if (et.includes('overview') || et.includes('catalog')) return 'an overview of the faction landscape';
  if (et.includes('worked_example') || et.includes('document') || et.includes('primary_source')) {
    return 'a worked example drawn from the faction material';
  }
  if (scope === 'civ' && entity.civilization) {
    return `one of the faction groupings within the ${civLabel(entity.civilization)} civilization`;
  }
  if (scope === 'trans-civ') return 'a cross-civilization institution or guild';
  if (scope === 'basin') return 'a basin-wide faction grouping';
  return 'a faction grouping';
}

/**
 * Build a deterministic, plain-language overview of a canon entity. Returns a
 * paragraph-separated string (split on "\n\n" to render).
 */
export function generateEntityOrientation(entity: CanonEntity, allEntities: CanonEntity[]): string {
  const name = displayName(entity);
  const paras: string[] = [];

  // Lead: what it is, in plain words.
  paras.push(`${name} is ${framingClause(entity)}.`);

  // Recorded prose: the lede, verbatim (already markdown-flattened upstream).
  if (entity.lede) paras.push(asSentence(entity.lede));

  // Labelled facts.
  const facts: string[] = [];
  if (Array.isArray(entity.tags) && entity.tags.length) {
    facts.push(`Themes: ${entity.tags.map(humanizeTag).join(', ')}.`);
  }
  if (Array.isArray(entity.cross_refs) && entity.cross_refs.length) {
    const byId = new Map(allEntities.map((e) => [e.id, e]));
    const names = entity.cross_refs.map((ref) => {
      const found = byId.get(ref);
      return found ? displayName(found) : displayName({ id: ref } as CanonEntity);
    });
    facts.push(`Connected to: ${names.join(', ')}.`);
  }
  if (facts.length) paras.push(facts.join(' '));

  // Almost-empty fallback: name + type only.
  if (!entity.lede && !(entity.tags?.length) && !(entity.cross_refs?.length)) {
    paras.push(
      `Beyond its name and type, little plain-language detail is recorded about ${name} yet — a good spot to flesh out.`,
    );
  }

  return paras.join('\n\n');
}
