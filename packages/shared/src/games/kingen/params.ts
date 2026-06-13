/**
 * src/games/kingen/params.ts
 * Tafel-parameters per spelersaantal: deck-stripping, telling, aantal rondes.
 */

import type { CardId } from '../../core/types.ts';
import type { KingenTableParams, KingenVariantConfig } from './types.ts';
import { NEGATIVE_ROUND_KINDS } from './types.ts';

/**
 * Bereken de afgeleide partijparameters (pure functie).
 *
 * 4 sp: 52 krt, 13 p.p., 10 rondes; straffen 13/13/8/8/5/5, troef 4x13 (som 0).
 * 3 sp: 51 krt (zonder ♠2), 17 p.p., 9 rondes; straffen 17/13/8/4 (1 per dame)/4/5, troef 3x17 (som 0).
 * 5 sp: 50 krt (zonder ♠2 en ♣2), 10 p.p., 11 rondes; straffen 10/13/8/8/5/6 (7e+10e elk 3), troef 5x10 (som 0).
 *
 * Bij dubbelkingen verdubbelt alles: elk negatief spel 2x + per speler 2x troef.
 * NB: hartenheerPoints (4|5) is alleen bij 4 spelers configureerbaar; bij 3/5
 * spelers liggen de punten vast (4 resp. 5) om de nulsom te behouden.
 */
export function getTableParams(config: KingenVariantConfig): KingenTableParams {
  const n = config.playerCount;

  let removedCards: CardId[];
  let cardsPerPlayer: number;
  let penalties: KingenTableParams['penalties'];

  switch (n) {
    case 3:
      removedCards = ['spades-2'];
      cardsPerPlayer = 17;
      penalties = {
        perTrick: 1,
        perHeart: 1,
        perKingOrJack: 1,
        perQueen: 1, // 1 per dame: 4 totaal (telling op 51)
        heartKing: 4,
        seventhTrick: 2,
        lastTrick: 3,
        seventhTrickIndex: 6,
      };
      break;
    case 5:
      removedCards = ['spades-2', 'clubs-2'];
      cardsPerPlayer = 10;
      penalties = {
        perTrick: 1,
        perHeart: 1,
        perKingOrJack: 1,
        perQueen: 2,
        heartKing: 5,
        seventhTrick: 3, // 7e en laatste (10e) slag elk 3 (telling op 50)
        lastTrick: 3,
        seventhTrickIndex: 6,
      };
      break;
    default:
      removedCards = [];
      cardsPerPlayer = 13;
      penalties = {
        perTrick: 1,
        perHeart: 1,
        perKingOrJack: 1,
        perQueen: 2,
        heartKing: config.hartenheerPoints,
        seventhTrick: 2,
        lastTrick: 3,
        seventhTrickIndex: 6,
      };
      break;
  }

  const negativeRounds =
    config.mode === 'dubbel' ? NEGATIVE_ROUND_KINDS.length * 2 : config.roundOrder.length;
  const trumpRounds = config.mode === 'dubbel' ? n * 2 : n;

  return {
    playerCount: n,
    removedCards,
    cardsPerPlayer,
    tricksPerRound: cardsPerPlayer,
    trumpRounds,
    totalRounds: negativeRounds + trumpRounds,
    penalties,
  };
}
