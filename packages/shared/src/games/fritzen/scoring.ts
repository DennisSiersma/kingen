/**
 * src/games/fritzen/scoring.ts
 * Vertaalt een beurt-totaal (som van 6 stenen, 6..36) naar punten. De veilige
 * zones zijn ≥30 (hoog) en ≤10 (laag); daar "deel je slokken uit" → pluspunten.
 * Tussen 11 en 29 "drink je" → minpunten naar rato van hoe diep in de foutzone.
 */

/** Punten voor een beurt-totaal `t`. */
export function fritzenPoints(t: number): number {
  if (t >= 30) return t - 30; // surplus boven 30 (0..6)
  if (t <= 10) return 10 - t; // tekort onder 10 (0..4)
  return -Math.min(t - 10, 30 - t); // afstand tot de dichtstbijzijnde veilige grens
}

/** Is dit totaal een "geslaagde" worp (in een veilige zone)? */
export function isSafe(t: number): boolean {
  return t >= 30 || t <= 10;
}
