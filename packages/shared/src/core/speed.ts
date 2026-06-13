/**
 * Globale speelsnelheid: één factor die zowel de AI-denktijd (src/core/player.ts)
 * als de animatieduur (src/render/animations.ts) schaalt, zodat een potje als
 * geheel sneller of langzamer loopt. 1 = normaal tempo.
 *
 * Spel-onafhankelijk en UI-loos; de UI zet het niveau via setSnelheidNiveau.
 */
export type SnelheidNiveau = 'langzaam' | 'normaal' | 'snel' | 'direct';

const FACTOREN: Record<SnelheidNiveau, number> = {
  langzaam: 1.7,
  normaal: 1,
  snel: 0.5,
  direct: 0.18,
};

let factor = 1;

export function setSnelheidNiveau(niveau: SnelheidNiveau): void {
  factor = FACTOREN[niveau] ?? 1;
}

/** Huidige snelheidsfactor (vermenigvuldig denktijd/animatieduur hiermee). */
export function snelheidsFactor(): number {
  return factor;
}
