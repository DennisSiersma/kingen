/**
 * src/games/kingen/rules.ts
 * Pure regelfuncties: legale zetten, rondescore, ronde-einde.
 * Zie KingenRules in types.ts voor het contract.
 */

import type { Card, Seat, Suit } from '../../core/types.ts';
import { JACK, KING, QUEEN, SUITS } from '../../core/types.ts';
import type { KingenRoundKind, KingenRules, KingenState } from './types.ts';
import { NEGATIVE_ROUND_KINDS } from './types.ts';
import { scoreRound } from './scoring.ts';

const HEART_KING_ID = 'hearts-13';

/** Stoel links van (na) een stoel, met de klok mee. */
export function leftOf(seat: Seat, seatCount: number): Seat {
  return ((seat + 1) % seatCount) as Seat;
}

/** Wie kiest de troefkleur in de fase 'choosingTrump'? */
export function trumpChooser(state: KingenState): Seat {
  return state.config.trumpSelection === 'uitkomerKiest'
    ? leftOf(state.dealer, state.params.playerCount)
    : state.dealer;
}

export const kingenRules: KingenRules = {
  legalCards(state: KingenState, seat: Seat): Card[] {
    if (state.phase !== 'playing' || state.turn !== seat) return [];
    const hand = state.hands[seat] ?? [];
    if (hand.length === 0) return [];
    const cfg = state.config;
    const kind = state.roundKind;
    const plays = state.currentTrick.plays;

    // --- Uitkomen ---
    if (plays.length === 0) {
      const banHearts =
        (kind === 'geenHarten' && cfg.heartLeadBan.geenHarten) ||
        (kind === 'hartenheer' && cfg.heartLeadBan.hartenheer);
      if (banHearts) {
        const nonHearts = hand.filter((c) => c.suit !== 'hearts');
        if (nonHearts.length > 0) return nonHearts;
      }
      return hand.slice();
    }

    // --- Bekennen ---
    const ledSuit = plays[0]!.card.suit;
    const follow = hand.filter((c) => c.suit === ledSuit);
    if (follow.length > 0) {
      // Hartenheer-speelplicht (strikt): kan de ♥H de slag toch niet meer
      // winnen (de ♥A ligt al), dan MOET hij gespeeld worden.
      if (kind === 'hartenheer' && cfg.discardRules.hartenheer && ledSuit === 'hearts') {
        const heartKing = follow.find((c) => c.id === HEART_KING_ID);
        if (heartKing) {
          const highest = Math.max(...plays.map((p) => (p.card.suit === 'hearts' ? p.card.rank : 0)));
          if (highest > KING) return [heartKing];
        }
      }
      return follow;
    }

    // --- Niet kunnen bekennen ---
    if (kind === 'troef' && state.trump !== null) {
      const trumps = hand.filter((c) => c.suit === state.trump);
      if (cfg.mustTrump && trumps.length > 0 && ledSuit !== state.trump) {
        if (cfg.mustOvertrump) {
          const trumpPlays = plays.filter((p) => p.card.suit === state.trump);
          if (trumpPlays.length > 0) {
            const highest = Math.max(...trumpPlays.map((p) => p.card.rank));
            const higher = trumps.filter((c) => c.rank > highest);
            if (higher.length > 0) return higher; // overtroeven verplicht indien mogelijk
          }
        }
        return trumps; // troeven (kopen) verplicht
      }
      return hand.slice();
    }

    // Hartenheer: de ♥H moet ALTIJD afgegooid worden bij niet kunnen bekennen
    // (ook in 'vrije' regelsets — WK-uitzondering).
    if (kind === 'hartenheer') {
      const heartKing = hand.find((c) => c.id === HEART_KING_ID);
      if (heartKing) return [heartKing];
    }

    // Strikte afgooiverplichtingen per negatief onderdeel.
    if (kind === 'geenHarten' && cfg.discardRules.geenHarten) {
      const hearts = hand.filter((c) => c.suit === 'hearts');
      if (hearts.length > 0) return hearts;
    }
    if (kind === 'geenHerenBoeren' && cfg.discardRules.geenHerenBoeren) {
      const penaltyCards = hand.filter((c) => c.rank === KING || c.rank === JACK);
      if (penaltyCards.length > 0) return penaltyCards;
    }
    if (kind === 'geenDames' && cfg.discardRules.geenDames) {
      const queens = hand.filter((c) => c.rank === QUEEN);
      if (queens.length > 0) return queens;
    }

    return hand.slice();
  },

  legalTrumps(state: KingenState, seat: Seat): Suit[] {
    if (state.phase !== 'choosingTrump') return [];
    if (trumpChooser(state) !== seat) return [];
    // 'laatsteKaart' bereikt deze fase nooit (troef wordt automatisch bepaald);
    // bij vrije keuze zijn alle vier de kleuren toegestaan.
    return [...SUITS];
  },

  legalRoundKinds(state: KingenState, seat: Seat): KingenRoundKind[] {
    if (state.config.mode !== 'dubbel') return [];
    if (state.phase !== 'choosingRoundKind' || state.dealer !== seat) return [];
    const ledger = state.choiceLedger;
    if (!ledger) return [];

    const n = state.params.playerCount;
    // Resterende keuzebeurten van deze stoel (inclusief de huidige).
    let turnsLeft = 0;
    for (let r = state.roundIndex; r < state.params.totalRounds; r++) {
      if (r % n === seat) turnsLeft++;
    }
    const trumpLeft = 2 - (ledger.trumpChoicesPerSeat[seat] ?? 0);
    const forced = ledger.forcedTrumpSeats.includes(seat) && trumpLeft > 0;

    const out: KingenRoundKind[] = [];
    // Negatieve spellen: max 2x per partij; alleen als er nog een keuzebeurt
    // over blijft voor de verplichte troefkeuzes (en geen troefdwang actief is).
    if (!forced && turnsLeft > trumpLeft) {
      for (const kind of NEGATIVE_ROUND_KINDS) {
        if ((ledger.negativeCounts[kind] ?? 0) < 2) out.push(kind);
      }
    }
    if (trumpLeft > 0) out.push('troef');
    return out;
  },

  scoreRound(state: KingenState): number[] {
    return scoreRound(state);
  },

  isRoundFinished(state: KingenState): boolean {
    if (state.completedTricks.length >= state.params.tricksPerRound) return true;
    return (
      state.roundKind === 'hartenheer' &&
      state.config.stopWhenKingFalls &&
      state.heartKingFallen &&
      state.currentTrick.plays.length === 0 // slag waarin ♥H viel is afgemaakt
    );
  },
};
