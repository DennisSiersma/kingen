/**
 * src/games/kingen/scoring.ts
 * Score-berekening per rondesoort. Negatieve rondes leveren strafpunten
 * (negatief), troefrondes pluspunten. Over de hele partij is de som 0
 * (tenzij lowestWins: dan alles met omgekeerd teken genoteerd; laagste wint).
 */

import type { Card, Seat } from '../../core/types.ts';
import { JACK, KING, QUEEN } from '../../core/types.ts';
import { createDeck } from '../../core/deck.ts';
import type { KingenState } from './types.ts';

const HEART_KING_ID = 'hearts-13';

/** Alle kaarten die een stoel tot nu toe in zijn gewonnen slagen heeft geraapt. */
function capturedCards(state: KingenState, seat: Seat): Card[] {
  const out: Card[] = [];
  for (const trick of state.completedTricks) {
    if (trick.winner === seat) {
      for (const play of trick.plays) out.push(play.card);
    }
  }
  return out;
}

/** "Natuurlijke" scores: straf negatief, troefslagen positief (vóór lowestWins-flip). */
function naturalScores(state: KingenState): number[] {
  const n = state.params.playerCount;
  const p = state.params.penalties;
  const scores: number[] = new Array<number>(n).fill(0);

  for (let seat = 0; seat < n; seat++) {
    const won = capturedCards(state, seat as Seat);
    const tricks = state.trickCounts[seat] ?? 0;

    switch (state.roundKind) {
      case 'geenSlagen':
        scores[seat] = -p.perTrick * tricks;
        break;
      case 'geenHarten':
        scores[seat] = -p.perHeart * won.filter((c) => c.suit === 'hearts').length;
        break;
      case 'geenHerenBoeren':
        scores[seat] =
          -p.perKingOrJack * won.filter((c) => c.rank === KING || c.rank === JACK).length;
        break;
      case 'geenDames':
        scores[seat] = -p.perQueen * won.filter((c) => c.rank === QUEEN).length;
        break;
      case 'hartenheer':
        scores[seat] = won.some((c) => c.id === HEART_KING_ID) ? -p.heartKing : 0;
        break;
      case 'zevenLaatste': {
        let s = 0;
        const seventh = state.completedTricks[p.seventhTrickIndex];
        if (seventh?.winner === seat) s -= p.seventhTrick;
        const last = state.completedTricks[state.params.tricksPerRound - 1];
        if (last?.winner === seat) s -= p.lastTrick;
        scores[seat] = s;
        break;
      }
      case 'troef':
        scores[seat] = tricks; // 1 pluspunt per gewonnen slag
        break;
      default:
        scores[seat] = 0;
    }
  }
  return scores;
}

/** Delta-scores van de zojuist afgeronde ronde, per stoel (index = Seat). */
export function scoreRound(state: KingenState): number[] {
  const scores = naturalScores(state);
  return state.config.lowestWins ? scores.map((s) => -s) : scores;
}

/**
 * Scores wanneer een speler claimt (variant 'hand afleggen'): de tot dan toe
 * gevallen straf blijft staan en de claimende stoel neemt ALLE resterende
 * strafpunten van het onderdeel op zich (nulsom blijft intact).
 */
export function scoreRoundWithClaim(
  state: KingenState,
  claimer: Seat,
  acceptedPenalty: number,
): number[] {
  const scores = naturalScores(state);
  scores[claimer] = (scores[claimer] ?? 0) - acceptedPenalty;
  return state.config.lowestWins ? scores.map((s) => -s) : scores;
}

/** Strafpunten die een claimende speler op zich neemt (variant 'hand afleggen'). */
export function remainingPenaltyForClaim(state: KingenState, _seat: Seat): number {
  const p = state.params.penalties;
  const n = state.params.playerCount;
  const done = state.completedTricks.length;

  // Nog niet geraapte strafkaarten = totaal in het (gestripte) deck minus geraapt.
  const deck = createDeck(state.params.removedCards);
  const captured: Card[] = [];
  for (let seat = 0; seat < n; seat++) captured.push(...capturedCards(state, seat as Seat));

  switch (state.roundKind) {
    case 'geenSlagen':
      return p.perTrick * (state.params.tricksPerRound - done);
    case 'geenHarten': {
      const total = deck.filter((c) => c.suit === 'hearts').length;
      const taken = captured.filter((c) => c.suit === 'hearts').length;
      return p.perHeart * (total - taken);
    }
    case 'geenHerenBoeren': {
      const isKJ = (c: Card) => c.rank === KING || c.rank === JACK;
      return p.perKingOrJack * (deck.filter(isKJ).length - captured.filter(isKJ).length);
    }
    case 'geenDames': {
      const isQ = (c: Card) => c.rank === QUEEN;
      return p.perQueen * (deck.filter(isQ).length - captured.filter(isQ).length);
    }
    case 'hartenheer':
      return captured.some((c) => c.id === HEART_KING_ID) ? 0 : p.heartKing;
    case 'zevenLaatste': {
      let remaining = 0;
      if (done <= p.seventhTrickIndex) remaining += p.seventhTrick;
      if (done < state.params.tricksPerRound) remaining += p.lastTrick;
      return remaining;
    }
    default:
      return 0; // troefrondes zijn niet claimbaar
  }
}
