/**
 * src/games/toepen/types.ts
 * Typen voor Toepen — het Nederlandse slagen-/bluf-/gokspel (geen aparte Engelse
 * naam; EN Wikipedia/Pagat gebruiken ook "Toepen"). 32 kaarten (7..A), 4 p.p.,
 * 4 slagen per ronde, GEEN troef, eigen kaartvolgorde 10>9>8>7>A>H>V>B.
 *
 * Bovenop de slagen ligt een gok-/bluf-laag: elke nog-meedoende speler mag op
 * zijn beurt "toep(en)" (kloppen) → inzet +1; de overige spelers gaan om de beurt
 * mee of passen (vouwen). De verliezers van de 4e slag krijgen de inzet als
 * strafpunten; passers betalen de inzet zoals die gold vóór de toep waarop ze
 * passten. Wie het maximum (canoniek 15) bereikt is af; de laatste speler over
 * wint de hele partij (eliminatie over meerdere rondes).
 *
 * Canonieke variant + bronverantwoording: zie docs/MULTIGAME_PLAN.md (Toepen).
 */

import type { Card, GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

/** Status van een stoel binnen de partij/ronde. */
export type SeatStatus = 'active' | 'folded' | 'eliminated';

/** Variant-/spelconfiguratie voor Toepen. */
export interface ToepenVariantConfig {
  /** Strafpuntenmaximum: 15 (canoniek) of 10 (alternatief). Wie dit bereikt is af. */
  maxStrafpunten: number;
  /** Vuile was (waardeloze hand omruilen, met controle/bluf). Default aan. */
  vuileWasRegel: boolean;
  /** Vier gelijke = directe winst + 3 voor de rest. Default aan. */
  vierGelijkeRegel: boolean;
  /** Pelt/armoede (1 onder max → mag niet meer toepen). Default uit (regionaal). */
  peltRegel: boolean;
  /** Aantal spelers (2..8, ideaal 4). */
  playerCount: number;
}

/** Canonieke standaardvariant (NL): max 15, vuile was + vier gelijke aan, pelt uit. */
export const TOEPEN_STANDAARD: ToepenVariantConfig = {
  maxStrafpunten: 15,
  vuileWasRegel: true,
  vierGelijkeRegel: true,
  peltRegel: false,
  playerCount: 4,
};

export const TOEPEN_DEFAULT = TOEPEN_STANDAARD;

/**
 * Fasen per ronde:
 *  - 'specialClaims' : vóór de eerste slag — vier gelijke declareren / vuile was
 *    claimen (of voorbijgaan), één keuze per stoel met de klok mee.
 *  - 'vuileWasChallenge' : na een vuile-was-claim mag de volgende tegenstander
 *    controleren (uitdagen) of laten gaan.
 *  - 'playing' : de 4 slagen (en, op je eigen beurt, eventueel toepen).
 *  - 'toepResponse' : na een toep reageren de overige actieve spelers één voor
 *    één (meegaan/passen) met de klok mee.
 *  - 'finished' : de partij is afgelopen.
 */
export type ToepenPhase =
  | 'specialClaims'
  | 'vuileWasChallenge'
  | 'playing'
  | 'toepResponse'
  | 'finished';

/** Zetten in Toepen (via het generieke chooseMove-pad). */
export type ToepenMove =
  // Slagfase
  | { type: 'playCard'; card: Card }
  | { type: 'callToep' }
  // Toep-respons
  | { type: 'respondMeegaan' }
  | { type: 'respondPas' }
  // Speciale handen (vóór de eerste slag)
  | { type: 'declareVierGelijke' }
  | { type: 'claimVuileWas' }
  | { type: 'passClaim' }
  // Vuile-was-controle
  | { type: 'challengeVuileWas' }
  | { type: 'passChallenge' };

/** Eén geregistreerde toep: wie toepte en de inzet ná die toep. */
export interface ToepEntry {
  seat: Seat;
  stakeAfter: number;
}

/** Lopende vuile-was-claim die op controle wacht. */
export interface VuileWasClaim {
  /** Wie claimde. */
  claimer: Seat;
  /** Wie nu mag controleren/uitdagen (volgende actieve stoel). */
  challenger: Seat;
}

type Trick = { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat };

/** Volledige (geheime) spelstate. Alleen de engine/host ziet deze. */
export interface ToepenState {
  config: ToepenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: ToepenPhase;
  roundIndex: number;
  /** Deler van de huidige ronde (winnaar 4e slag vorige ronde). */
  dealer: Seat;
  /** Handen per stoel; lege array voor afgevallen spelers. Index = Seat. */
  hands: Card[][];
  /** Resterende (gedekte, dode) kaarten — voorraad voor vuile-was-omruil. */
  stock: Card[];
  /** Status per stoel. Index = Seat. */
  status: SeatStatus[];
  /** Open op tafel (vuile-was-bluf betrapt): hand zichtbaar voor iedereen. Index = Seat. */
  openHand: boolean[];

  // Slagfase
  currentTrick: Trick;
  completedTricks: Trick[];
  /** Aantal gewonnen slagen per stoel deze ronde. Index = Seat. */
  trickCounts: number[];
  turn: Seat | null;

  // Gok-/toep-laag
  /** Huidige inzet (start 1, +1 per toep). */
  stake: number;
  /** Geschiedenis van toeps deze ronde. */
  toepHistory: ToepEntry[];
  /** Laatste toeper (mag niet zelf opnieuw toepen tot een ander toepte). */
  lastToeper: Seat | null;
  /** Tijdens 'toepResponse': nog te beantwoorden stoelen, in klokvolgorde. */
  pendingResponders: Seat[];
  /** Inzet vlak vóór de huidige toep (= wat een passer nu betaalt). */
  stakeBeforeToep: number;
  /** Naar welke fase keren we terug na de toep-respons ('playing'). */
  resumePhase: ToepenPhase | null;
  /** Wiens beurt het was vóór de toep-respons (de toeper speelt daarna zijn kaart). */
  resumeTurn: Seat | null;

  // Speciale handen
  /** Tijdens 'specialClaims': stoelen die nog een claim-keuze moeten maken (klokvolgorde). */
  pendingClaimers: Seat[];
  /** Lopende vuile-was-claim (alleen tijdens 'vuileWasChallenge'). */
  vuileWasClaim: VuileWasClaim | null;

  // Eliminatie / match
  /** Cumulatieve strafpunten per stoel (laag = goed). Index = Seat. */
  totals: number[];
  /** Per-ronde delta's: scoresPerRound[ronde][stoel]. */
  scoresPerRound: number[][];
  /** Strafpunten die deze ronde al zijn toegekend (voor het roundEnd-delta). */
  roundDeltas: number[];
}

/** Wat de view-extras van Toepen aan client/AI doorgeven. */
export interface ToepenViewExtras {
  phase: ToepenPhase;
  stake: number;
  status: SeatStatus[];
  openHand: boolean[];
  /** Handen die open op tafel liggen (vuile-was-bluf), zichtbaar voor iedereen. */
  openHands: Record<number, Card[]>;
  toepHistory: ToepEntry[];
  lastToeper: Seat | null;
  /** Mag de kijker nu toepen (eigen beurt, niet lastToeper, niet op pelt, inzet < max)? */
  canCallToep: boolean;
  /** Tijdens 'toepResponse': nog te reageren stoelen. */
  pendingResponders: Seat[];
  /** Kosten als de kijker nu past (inzet vóór de toep). */
  penaltyIfIFoldNow: number;
  /** Tijdens 'specialClaims'/'vuileWasChallenge'. */
  pendingClaimers: Seat[];
  vuileWasClaim: VuileWasClaim | null;
  maxStrafpunten: number;
}

export type ToepenDefinition = GameDefinition<ToepenState, ToepenMove, ToepenVariantConfig>;
