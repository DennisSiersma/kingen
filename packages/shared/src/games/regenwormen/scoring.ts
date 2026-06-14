/**
 * src/games/regenwormen/scoring.ts
 * Pure helpers voor Regenwormen: ogen-/wormwaarden, tegel-wormen, totaaltelling
 * en de pakbare-tegel-bepaling (centrum ≤ som, of exacte steal van een top).
 */

/** Het worm-vlak van de steen (intern oog 6). */
export const WORM = 6;

/** Alle tegels die bij de start in het midden liggen. */
export const ALL_TILES: readonly number[] = Array.from({ length: 16 }, (_, i) => 21 + i);

/** Ogenwaarde van een steen voor het optellen (worm telt als 5). */
export function pips(v: number): number {
  return v === WORM ? 5 : v;
}

export function isWorm(v: number): boolean {
  return v === WORM;
}

/** Som van een verzameling stenen (worm = 5). */
export function sumPips(dice: readonly number[]): number {
  return dice.reduce((a, v) => a + pips(v), 0);
}

/** Ligt er minstens één worm bij? (vereist om te mogen pakken) */
export function hasWorm(dice: readonly number[]): boolean {
  return dice.some(isWorm);
}

/** Aantal wormen op een tegel: 21–24→1, 25–28→2, 29–32→3, 33–36→4. */
export function wormsOfTile(tile: number): number {
  return Math.floor((tile - 21) / 4) + 1;
}

/** Wormen-totaal van een tegelstapel. */
export function wormTotal(stack: readonly number[]): number {
  return stack.reduce((a, t) => a + wormsOfTile(t), 0);
}

export interface TakeOption {
  tile: number;
  from: 'center' | number;
}

/**
 * Pakbare tegels bij som `sum`: de hoogste centrumtegel ≤ som, plus elke
 * tegenstander-toptegel die exact `sum` is (steal). Lege lijst = niets pakbaar.
 */
export function takeOptions(
  sum: number,
  center: readonly number[],
  stacks: readonly (readonly number[])[],
  active: number,
): TakeOption[] {
  const opts: TakeOption[] = [];
  const onder = center.filter((t) => t <= sum);
  if (onder.length > 0) opts.push({ tile: Math.max(...onder), from: 'center' });
  stacks.forEach((st, s) => {
    if (s !== active && st.length > 0 && st[st.length - 1] === sum) opts.push({ tile: sum, from: s });
  });
  return opts;
}
