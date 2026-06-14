/**
 * src/games/hartenjagen/types.ts
 * Typen voor Hartenjagen (Engels: Hearts). Slagvermijdingsspel: harten geven
 * strafpunten (1 elk), ♠V geeft er 13. Wie alle 26 pakt "schiet de maan"
 * (0 voor zichzelf, 26 voor de rest). Laagste totaal wint; de partij eindigt
 * zodra iemand `endScore` bereikt.
 */

import type { Card, GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

/**
 * Variant-/spelconfiguratie voor Hartenjagen. Twee profielen:
 *  - B = Nederlands Hartenjagen (32 piketkaarten, ♣7 opent, geen doorgeven/breken,
 *        harten 1 / ♠V 5 / ♣B 2, twee-fasen-einde: stijgen tot drempel, dan dalen
 *        naar 0). DEFAULT voor de NL-app.
 *  - A = internationaal Hearts/Black Lady (52 kaarten, ♣2 opent, doorgeven +
 *        harten-breken + schiet-de-maan, harten 1 / ♠V 13, tot 100, laagste wint).
 */
export interface HartenjagenVariantConfig {
  profile: 'A' | 'B';
  playerCount: number;
  /** 32-kaarts piketdek (ranks 7-14) i.p.v. 52. */
  deck32: boolean;
  /** Id van de openingskaart die verplicht de eerste slag opent ('clubs-2' / 'clubs-7'). */
  openingCardId: string;
  /** Strafpunten voor ♠V (schoppenvrouw). */
  queenPenalty: number;
  /** Strafpunten voor ♣B (klaverenboer). 0 als niet van toepassing (profiel A). */
  jackClubsPenalty: number;
  /** Strafpunten per hart. */
  heartPenalty: number;
  /** 3 kaarten doorgeven vóór het spelen (profiel A). */
  passing: boolean;
  /** Harten mogen pas geleid worden na "breken" (profiel A). */
  heartsBreakRule: boolean;
  /** Geen strafkaarten dumpen in de eerste slag (profiel A). */
  firstTrickNoPenalty: boolean;
  /** "Schiet de maan" (profiel A). */
  shootMoon: boolean;
  /** 'highScore' (A: tot endScore, laagste wint) of 'twoPhase' (B: stijgen tot drempel, dan dalen naar 0). */
  endMode: 'highScore' | 'twoPhase';
  /** A: verliesdrempel (100). B: omslagdrempel waarna het dalen begint (50). */
  endScore: number;
}

/** Profiel B — Nederlands Hartenjagen (default). */
export const HARTENJAGEN_B: HartenjagenVariantConfig = {
  profile: 'B',
  playerCount: 4,
  deck32: true,
  openingCardId: 'clubs-7',
  queenPenalty: 5,
  jackClubsPenalty: 2,
  heartPenalty: 1,
  passing: false,
  heartsBreakRule: false,
  firstTrickNoPenalty: false,
  shootMoon: false,
  endMode: 'twoPhase',
  endScore: 50,
};

/** Profiel A — internationaal Hearts. */
export const HARTENJAGEN_A: HartenjagenVariantConfig = {
  profile: 'A',
  playerCount: 4,
  deck32: false,
  openingCardId: 'clubs-2',
  queenPenalty: 13,
  jackClubsPenalty: 0,
  heartPenalty: 1,
  passing: true,
  heartsBreakRule: true,
  firstTrickNoPenalty: true,
  shootMoon: true,
  endMode: 'highScore',
  endScore: 100,
};

/** Default = profiel B (Nederlands). */
export const HARTENJAGEN_DEFAULT = HARTENJAGEN_B;

/** Doorgeefrichting per ronde (roteert); 'none' = ronde zonder doorgeven. */
export type PassDirection = 'left' | 'right' | 'across' | 'none';

export type HartenjagenPhase = 'passing' | 'playing' | 'finished';

/** Zetten in Hartenjagen: 3 kaarten doorgeven, of een kaart spelen. */
export type HartenjagenMove =
  | { type: 'passCards'; cards: Card[] }
  | { type: 'playCard'; card: Card };

/** Volledige (geheime) spelstate. Alleen de engine/host ziet deze. */
export interface HartenjagenState {
  config: HartenjagenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: HartenjagenPhase;
  roundIndex: number;
  /** Doorgeefrichting deze ronde. */
  passDir: PassDirection;
  hands: Card[][];
  /** Per stoel de (geheim) doorgegeven kaarten tijdens de doorgeeffase, of null. */
  passed: (Card[] | null)[];
  currentTrick: { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat };
  completedTricks: { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat }[];
  trickCounts: number[];
  /** Gepakte strafpunten deze ronde, per stoel. */
  pointsTaken: number[];
  heartsBroken: boolean;
  /** Is dit de eerste slag van de ronde (openingskaart komt uit)? */
  firstTrick: boolean;
  /** Profiel B twee-fasen-einde: false = stijgen, true = dalen naar 0. */
  descending: boolean;
  turn: Seat | null;
  totals: number[];
  scoresPerRound: number[][];
}

export type HartenjagenDefinition = GameDefinition<
  HartenjagenState,
  HartenjagenMove,
  HartenjagenVariantConfig
>;
