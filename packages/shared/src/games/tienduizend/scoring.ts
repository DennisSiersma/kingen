/**
 * src/games/tienduizend/scoring.ts
 * Pure scoring voor Tienduizend. `scoreDice` geeft de beste score voor een
 * verzameling stenen die VOLLEDIG scoort (elke steen draagt bij), anders null.
 * Default-conventie (zie research §3.1): losse 1 = 100, losse 5 = 50, drie
 * gelijk = oog×100 (drie 1-en = 1000); vier/vijf/zes gelijk verdubbelt het trio
 * (×2/×4/×8); straat 1-2-3-4-5-6 = 1500; drie paren = 1500.
 */

/** Tellingen per oog (index 1..6); index 0 ongebruikt. */
export function counts(dice: readonly number[]): number[] {
  const c = new Array<number>(7).fill(0);
  for (const d of dice) if (d >= 1 && d <= 6) c[d]! += 1;
  return c;
}

/** Basiswaarde van een trio van oog `f` (drie 1-en = 1000, anders oog×100). */
function trioValue(f: number): number {
  return f === 1 ? 1000 : f * 100;
}

/**
 * Beste score als ALLE stenen scoren (volledig "consumeerbaar"), anders null.
 * Gebruikt voor het waarderen van een apart-leg-keuze: elke steen in `dice`
 * moet bijdragen (geen losse niet-scorende steen toegestaan).
 */
export function scoreDice(dice: readonly number[]): number | null {
  if (dice.length === 0) return null;
  const c = counts(dice);
  const len = dice.length;

  // Specials gelden alleen voor een volledige worp van zes.
  let special = 0;
  if (len === 6) {
    if ([1, 2, 3, 4, 5, 6].every((f) => c[f] === 1)) special = Math.max(special, 1500); // straat
    if ([1, 2, 3, 4, 5, 6].filter((f) => c[f] === 2).length === 3) special = Math.max(special, 1500); // drie paren
  }

  // Algemene decompositie per oog.
  let general = 0;
  let consumable = true;
  for (let f = 1; f <= 6; f++) {
    const k = c[f]!;
    if (k === 0) continue;
    if (k >= 3) general += trioValue(f) * Math.pow(2, k - 3);
    else if (f === 1) general += k * 100;
    else if (f === 5) general += k * 50;
    else { consumable = false; break; }
  }

  const candidates: number[] = [];
  if (special > 0) candidates.push(special);
  if (consumable && general > 0) candidates.push(general);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/** Levert deze worp ook maar íéts op? Zo niet → bust. */
export function hasAnyScore(dice: readonly number[]): boolean {
  const c = counts(dice);
  if (c[1]! > 0 || c[5]! > 0) return true;
  for (let f = 1; f <= 6; f++) if (c[f]! >= 3) return true;
  // Drie paren zonder 1/5 (bijv. 2-2-3-3-4-4) scoort tóch.
  if (dice.length === 6 && [1, 2, 3, 4, 5, 6].filter((f) => c[f] === 2).length === 3) return true;
  return false;
}

/** Hoogste score die uit een (deel)worp te halen is door alles scorende apart te leggen. */
export function bestScore(dice: readonly number[]): number {
  let best = 0;
  for (const sel of scoringSelections(dice)) if (sel.score > best) best = sel.score;
  return best;
}

/** Niet-lege deel-multisets van `dice` (oplopend gesorteerd, distinct op waarde). */
function subMultisets(dice: readonly number[]): number[][] {
  const c = counts(dice);
  const waarden = [1, 2, 3, 4, 5, 6].filter((f) => c[f]! > 0);
  let subsets: number[][] = [[]];
  for (const v of waarden) {
    const max = c[v]!;
    const next: number[][] = [];
    for (const s of subsets) {
      for (let k = 0; k <= max; k++) next.push([...s, ...Array<number>(k).fill(v)]);
    }
    subsets = next;
  }
  return subsets.filter((s) => s.length > 0);
}

/** Alle geldige apart-leg-keuzes met hun score (volledig scorende deel-multisets). */
export function scoringSelections(dice: readonly number[]): { keep: number[]; score: number }[] {
  const out: { keep: number[]; score: number }[] = [];
  for (const sub of subMultisets(dice)) {
    const score = scoreDice(sub);
    if (score !== null) out.push({ keep: sub, score });
  }
  return out;
}
