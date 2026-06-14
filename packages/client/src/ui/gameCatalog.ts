/**
 * src/ui/gameCatalog.ts
 * Catalogus van speelbare kaartspellen voor de landingsgalerij en de spelpagina's.
 * Een "familie" is één spel op een tegel; sommige families hebben meerdere
 * varianten (elk een eigen registry-gameId) die op de spelpagina te kiezen zijn.
 * De namen/omschrijvingen lopen via i18n-sleutels (NL/EN).
 */

import type { TranslationKey } from './i18n.ts';

export interface GameVariant {
  /** Registry-id (server + lokale host gebruiken dit), bijv. 'klaverjassen'. */
  gameId: string;
  /** i18n-sleutel voor de variantnaam (bijv. 'Rotterdams'). */
  labelKey: TranslationKey;
  /** i18n-sleutel met een korte uitleg van deze variant (tooltip + uitlegregel). */
  descKey: TranslationKey;
}

export interface GameFamily {
  /** Sleutel van de familie (voor routing + i18n), bijv. 'klaverjassen'. */
  key: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  /** Korte spelersaanduiding, bijv. '4' of '3–5'. */
  players: string;
  /** Accentkleur van de tegel (CSS-kleur). */
  accent: string;
  /** Embleemletter/teken op de tegel. */
  embleem: string;
  /** 'kingen' = rijk lokaal setupscherm; 'generic' = lokale host met AI-fill. */
  localKind: 'kingen' | 'generic';
  /** Eén of meer varianten; >1 toont een variantkiezer op de spelpagina. */
  variants: GameVariant[];
}

/** De spelfamilies in galerij-volgorde. */
export const GAME_FAMILIES: GameFamily[] = [
  {
    key: 'kingen',
    titleKey: 'game.kingen',
    descKey: 'catalog.kingen.desc',
    players: '3–5',
    accent: '#c9a227',
    embleem: '♛',
    localKind: 'kingen',
    variants: [{ gameId: 'kingen', labelKey: 'game.kingen', descKey: 'catalog.kingen.desc' }],
  },
  {
    key: 'hartenjagen',
    titleKey: 'catalog.hartenjagen.title',
    descKey: 'catalog.hartenjagen.desc',
    players: '4',
    accent: '#c0392b',
    embleem: '♥',
    localKind: 'generic',
    variants: [
      { gameId: 'hartenjagen', labelKey: 'catalog.variant.nederlands', descKey: 'variant.hartenjagen.nederlands' },
      { gameId: 'hearts', labelKey: 'catalog.variant.internationaal', descKey: 'variant.hartenjagen.internationaal' },
    ],
  },
  {
    key: 'klaverjassen',
    titleKey: 'catalog.klaverjassen.title',
    descKey: 'catalog.klaverjassen.desc',
    players: '4',
    accent: '#2e8b57',
    embleem: '♣',
    localKind: 'generic',
    // Amsterdams is de standaard (eerste = voorgekozen op de spelpagina).
    variants: [
      { gameId: 'klaverjas-amsterdams', labelKey: 'catalog.variant.amsterdams', descKey: 'variant.klaverjas.amsterdams' },
      { gameId: 'klaverjassen', labelKey: 'catalog.variant.rotterdams', descKey: 'variant.klaverjas.rotterdams' },
    ],
  },
];

/** Zoek een familie op key. */
export function familyByKey(key: string): GameFamily | undefined {
  return GAME_FAMILIES.find((f) => f.key === key);
}
