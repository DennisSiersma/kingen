/**
 * src/games/mexen/types.ts
 * Typen voor Mexen (de Nederlandse blufvariant met doorgeven; intl. Mäxchen/Mia/
 * Meiern). 2 stenen + beker, verdekt gooien, aankondigen-of-liegen, de volgende
 * speler gelooft-of-twijfelt. Zie docs/MEXEN_PLAN.md en DICEGAME_RULES_RESEARCH.md.
 */

import type { GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';
import type { Roll } from '../dice/dice.ts';

/**
 * Variant-/spelconfiguratie. De defaults volgen de vastgelegde canonieke NL-variant;
 * afwijkingen zijn flags zodat regionale varianten later aanklikbaar zijn.
 */
export interface MexenVariantConfig {
  playerCount: number;
  /** Beginlevens per speler (default 6; variant 3). */
  startLives: number;
  /** Aankondigen: 'strict' = strikt hoger (default); 'tie' = gelijk mag ("mit"). */
  announceMode: 'strict' | 'tie';
  /** Levensverlies bij een Mäxchen(21)-resolutie (default 2). */
  mexPenalty: number;
  /** NL-drankvariant: 21 onder de beker kost de gooier sowieso mexPenalty extra (default false). */
  flatMexOnRoll: boolean;
  /** "Beker ongezien doorgeven" als zet toestaan (default true). */
  allowPassUnseen: boolean;
  /** Max. aantal worpen per beurt vóór je iets moet roepen en doorgeven (default 3). */
  maxRolls: number;
  /** v1: alleen eliminatie (strepen-variant kan later). */
  scoreMode: 'elimination';
}

/** Canonieke NL-default (zie docs/MEXEN_PLAN.md §10/§13). */
export const MEXEN_DEFAULT: MexenVariantConfig = {
  playerCount: 4,
  startLives: 6,
  announceMode: 'strict',
  mexPenalty: 2,
  flatMexOnRoll: false,
  allowPassUnseen: true,
  maxRolls: 3,
  scoreMode: 'elimination',
};

export type MexenPhase = 'rolling' | 'announcing' | 'responding' | 'finished';

/**
 * Zetten in Mexen. `value` is altijd een ranking-code (zie ranking.ts).
 *  - roll        : de houder gooit verdekt (alleen in 'rolling').
 *  - announce    : de houder kondigt een waarde aan na te hebben gegooid ('announcing').
 *  - believe     : de ontvanger gelooft de vorige aankondiging en gaat zelf gooien ('responding').
 *  - doubt        : de ontvanger tilt de beker, onthult en rekent af ('responding').
 *  - passUnseen  : de ontvanger geeft de beker ongezien door met een hogere aankondiging
 *                  (de stenen eronder blijven die van de oorspronkelijke gooier) ('responding').
 */
export type MexenMove =
  | { type: 'roll' }
  | { type: 'announce'; value: number }
  | { type: 'believe' }
  | { type: 'doubt' }
  | { type: 'passUnseen'; value: number };

/** Onthulde worp na een twijfel (publiek). */
export interface MexenReveal {
  announcer: Seat;
  doubter: Seat;
  roll: Roll;
  code: number;
  announced: number;
  truthful: boolean;
  loser: Seat;
  amount: number;
}

/** Volledige (geheime) spelstate. Alleen de engine/host ziet deze. */
export interface MexenState {
  config: MexenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: MexenPhase;
  roundIndex: number;
  /** Doorlopende worp-teller voor deterministische, onafhankelijke worpen. */
  rollSeq: number;
  /** Aantal worpen dat de huidige houder deze beurt al deed (max config.maxRolls). */
  rollsThisTurn: number;
  /** Resterende levens per stoel; 0 = af. */
  lives: number[];
  /** Afgeleid gemak: heeft deze stoel nog levens? */
  alive: boolean[];
  /** Wie de beker heeft / aan zet is. */
  cupHolder: Seat;
  /** Draairichting: 1 = met de klok mee. */
  direction: 1 | -1;
  /** GEHEIM: de huidige worp onder de beker. Alleen in de viewExtras van de eigenaar. */
  actualRoll: Roll | null;
  /** Ranking-code van de laatste aankondiging deze ronde, of null (nog niets aangekondigd). */
  currentAnnouncement: number | null;
  /** Wie de huidige aankondiging deed (de stenen onder de beker "horen" bij hem). */
  announcer: Seat | null;
  /** Laatste onthulling (voor UI/log), of null. */
  lastReveal: MexenReveal | null;
  turn: Seat | null;
  /** "Score" voor de scoreboard-UI = resterende levens. */
  totals: number[];
  /** Per ronde de levens-delta per stoel (negatief voor de verliezer). */
  scoresPerRound: number[][];
}

export type MexenDefinition = GameDefinition<MexenState, MexenMove, MexenVariantConfig>;
