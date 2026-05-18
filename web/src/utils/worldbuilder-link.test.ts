import { describe, it, expect } from 'vitest';
import {
  buildWorldbuilderCompendiumUrl,
  buildWorldbuilderHomeUrl,
  WORLDBUILDER_DEFAULT_BASE,
} from './worldbuilder-link';

describe('worldbuilder-link', () => {
  it('builds an entity deep-link against the default base', () => {
    expect(buildWorldbuilderCompendiumUrl('religion:soken-rivulet', WORLDBUILDER_DEFAULT_BASE))
      .toBe('http://localhost:5173/#compendium?id=religion%3Asoken-rivulet');
  });

  it('builds the compendium home link against the default base', () => {
    expect(buildWorldbuilderHomeUrl(WORLDBUILDER_DEFAULT_BASE))
      .toBe('http://localhost:5173/#compendium');
  });

  it('honors a caller-supplied base (deployed worldbuilder)', () => {
    expect(buildWorldbuilderCompendiumUrl('faction:bint', 'https://worldbuilder.example.org'))
      .toBe('https://worldbuilder.example.org/#compendium?id=faction%3Abint');
  });

  it('trims trailing slashes from the base', () => {
    expect(buildWorldbuilderCompendiumUrl('x', 'https://example.org///'))
      .toBe('https://example.org/#compendium?id=x');
  });

  it('percent-encodes ids containing colons, spaces, and reserved chars', () => {
    expect(buildWorldbuilderCompendiumUrl('named-figure:Wa Kande', WORLDBUILDER_DEFAULT_BASE))
      .toBe('http://localhost:5173/#compendium?id=named-figure%3AWa%20Kande');
  });
});
