/**
 * src/games/kingen/types.ts
 * Domeintypes en publieke API van de Kingen-regelimplementatie.
 * Gebaseerd op het regelonderzoek (NL Wikipedia, Whisthub, pagat, wikibooks,
 * CardgamesHub) en de variantenlijst (dubbelkingen, WK-regels, etc.).
 */

import type {
  Card,
  CardId,
  GameDefinition,
  PlayerConfig,
  PublicGameView,
  Seat,
  Suit,
  Trick,
} from '../../core/types.ts';

// ---------------------------------------------------------------------------
// Rondesoorten
// ---------------------------------------------------------------------------

/**
 * De zeven speltypes van Kingen.
 * Zes negatieve rondes + één positieve troefronde (meermaals gespeeld).
 */
export type KingenRoundKind =
  /** 1. Geen slagen: 1 strafpunt per gewonnen slag (13 totaal). */
  | 'geenSlagen'
  /** 2. Geen harten: 1 strafpunt per hartenkaart (13 totaal). */
  | 'geenHarten'
  /** 3. Geen heren en boeren: 1 strafpunt per heer/boer (8 totaal). */
  | 'geenHerenBoeren'
  /** 4. Geen dames: 2 strafpunten per dame (8 totaal). */
  | 'geenDames'
  /** 5. De King: 5 (variant: 4) strafpunten voor de hartenheer; ronde stopt zodra ♥H valt. */
  | 'hartenheer'
  /** 6. Geen 7e en laatste slag: 2 strafpunten voor de 7e, 3 voor de laatste. */
  | 'zevenLaatste'
  /** 7-10. Troef: 1 pluspunt per slag; iedere speler kiest één keer troef. */
  | 'troef';

export const ALL_ROUND_KINDS: readonly KingenRoundKind[] = [
  'geenSlagen', 'geenHarten', 'geenHerenBoeren', 'geenDames', 'hartenheer', 'zevenLaatste', 'troef',
];

export const NEGATIVE_ROUND_KINDS: readonly KingenRoundKind[] = [
  'geenSlagen', 'geenHarten', 'geenHerenBoeren', 'geenDames', 'hartenheer', 'zevenLaatste',
];

/** Nederlandse labels voor de UI/het scorebord. */
export const ROUND_LABELS_NL: Readonly<Record<KingenRoundKind, string>> = {
  geenSlagen: 'Geen slagen',
  geenHarten: 'Geen harten',
  geenHerenBoeren: 'Geen heren en boeren',
  geenDames: 'Geen dames',
  hartenheer: 'De King (geen hartenheer)',
  zevenLaatste: 'Geen 7e en laatste slag',
  troef: 'Troef',
};

// ---------------------------------------------------------------------------
// Variantconfiguratie
// ---------------------------------------------------------------------------

/** Hoe wordt de troefkleur bepaald in troefrondes? */
export type TrumpSelectionMode =
  /** Deler kiest vrij na het inzien van zijn hand (gangbare NL huisregel, default). */
  | 'delerKiest'
  /** De laatst aan de deler gedeelde kaart bepaalt troef (klassiek pagat/Vlaams). */
  | 'laatsteKaart'
  /** De speler die uitkomt kiest troef. */
  | 'uitkomerKiest';

/** Spelmodus. */
export type KingenMode =
  /** 10 gevingen in vaste volgorde (6 negatief, daarna 4x troef). */
  | 'standaard'
  /** Dubbel/vrij kingen: 20 gevingen, deler kiest het spel; elk negatief spel max 2x, troef precies 2x per speler. */
  | 'dubbel';

/** Strikte-afgooi-regels per negatief onderdeel (huisregels). */
export interface DiscardRules {
  /**
   * Strikt: wie niet kan bekennen MOET een strafkaart van het lopende onderdeel
   * afgooien (harten / heer-boer / dame / ♥H). Vrij: elke kaart mag.
   */
  geenHarten: boolean;
  geenHerenBoeren: boolean;
  geenDames: boolean;
  /** NB: in het hartenheer-onderdeel is het afgooien van ♥H bij niet kunnen bekennen vrijwel altijd verplicht. */
  hartenheer: boolean;
}

/** Verbod om met harten uit te komen (tenzij alleen nog harten), per onderdeel. */
export interface HeartLeadBan {
  geenHarten: boolean;
  hartenheer: boolean;
}

/**
 * Alle selecteerbare varianten/parameters van een partij Kingen.
 * `DEFAULT_VARIANT` levert het gangbare Nederlandse standaardspel.
 */
export interface KingenVariantConfig {
  /** Aantal spelers: 3, 4 (standaard) of 5. Bepaalt deck-stripping en telling. */
  playerCount: 3 | 4 | 5;
  mode: KingenMode;

  /** Volgorde van de negatieve rondes in standaardmodus (instelbaar per bron/huisregel). */
  roundOrder: KingenRoundKind[];

  trumpSelection: TrumpSelectionMode;
  /** Verplicht troeven (kopen) bij niet kunnen bekennen in troefrondes. */
  mustTrump: boolean;
  /** Verplicht overtroeven als er al een troef ligt. */
  mustOvertrump: boolean;

  /** Strafpunten voor de hartenheer: 5 (gangbaar NL, totaal 52) of 4 (pagat/CardgamesHub). */
  hartenheerPoints: 4 | 5;
  /** Ronde 'hartenheer' stopt zodra ♥H gevallen is (gangbaar). */
  stopWhenKingFalls: boolean;

  discardRules: DiscardRules;
  heartLeadBan: HeartLeadBan;

  /**
   * Dubbelkingen WK-regel: wie zijn 3e keuzebeurt ingaat zonder ooit troef te
   * hebben gekozen krijgt een waarschuwing en wordt daarna verplicht.
   */
  derdeGiftTroefdwang: boolean;

  /** WK-regel 'hand afleggen': speler mag claimen en neemt resterende strafpunten. */
  claimingAllowed: boolean;

  /**
   * Alles als strafpunten noteren / laagste wint (CardgamesHub-stijl).
   * Default false: straf negatief, troef positief, hoogste saldo wint, som = 0.
   */
  lowestWins: boolean;
}

/** Het gangbare Nederlandse standaardspel voor 4 spelers. */
export const DEFAULT_VARIANT: KingenVariantConfig = {
  playerCount: 4,
  mode: 'standaard',
  roundOrder: ['geenSlagen', 'geenHarten', 'geenHerenBoeren', 'geenDames', 'hartenheer', 'zevenLaatste'],
  trumpSelection: 'delerKiest',
  mustTrump: true,
  mustOvertrump: true,
  hartenheerPoints: 5,
  stopWhenKingFalls: true,
  discardRules: { geenHarten: true, geenHerenBoeren: true, geenDames: true, hartenheer: true },
  heartLeadBan: { geenHarten: true, hartenheer: true },
  derdeGiftTroefdwang: false,
  claimingAllowed: false,
  lowestWins: false,
};

/**
 * Afgeleide partijparameters per spelersaantal (deck-stripping, telling, aantal gevingen).
 * 4 sp: 52 krt, 13 p.p., 10 gevingen. 3 sp: 51 krt (zonder ♠2), 17 p.p., 9 gevingen.
 * 5 sp: 50 krt (zonder ♠2+♣2), 10 p.p., 11 gevingen.
 */
export interface KingenTableParams {
  playerCount: 3 | 4 | 5;
  /** CardIds die uit het deck verwijderd worden. */
  removedCards: CardId[];
  cardsPerPlayer: number;
  tricksPerRound: number;
  /** Aantal troefrondes (= playerCount). */
  trumpRounds: number;
  /** Totaal aantal gevingen in standaardmodus. */
  totalRounds: number;
  /** Strafpunt-parameters, aangepast per spelersaantal (zie variants-onderzoek). */
  penalties: {
    perTrick: number;        // geenSlagen
    perHeart: number;        // geenHarten
    perKingOrJack: number;   // geenHerenBoeren
    perQueen: number;        // geenDames
    heartKing: number;       // hartenheer
    seventhTrick: number;    // zevenLaatste: de "7e" slag
    lastTrick: number;       // zevenLaatste: de laatste slag
    /** Index (0-based) van de "7e" slag; bij 5 spelers blijft dit slag 7 maar is de laatste slag 10. */
    seventhTrickIndex: number;
  };
}

// NB: de pure functie `getTableParams(config): KingenTableParams` staat in params.ts.

// ---------------------------------------------------------------------------
// Zetten (moves)
// ---------------------------------------------------------------------------

/** Alle zet-typen in Kingen; gebruikt als TMove in GameDefinition. */
export type KingenMove =
  | { type: 'playCard'; card: Card }
  | { type: 'chooseTrump'; suit: Suit }
  /** Alleen in dubbelkingen: deler kiest het speltype voor deze geving. */
  | { type: 'chooseRoundKind'; kind: KingenRoundKind }
  /** Alleen als claimingAllowed: hand afleggen, resterende strafpunten accepteren. */
  | { type: 'claimHand' };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Fase binnen een geving. */
export type KingenPhase =
  | 'choosingRoundKind'   // dubbelkingen: deler kiest spel
  | 'dealing'
  | 'choosingTrump'
  | 'playing'
  | 'roundFinished'
  | 'gameFinished';

/** Administratie voor dubbelkingen: hoe vaak is elk spel gekozen, en door wie. */
export interface ChoiceLedger {
  /** Totaal aantal keren dat elk negatief spel gekozen is (max 2). */
  negativeCounts: Record<KingenRoundKind, number>;
  /** Aantal troefkeuzes per stoel (precies 2 vereist). Index = Seat. */
  trumpChoicesPerSeat: number[];
  /** Aantal verbruikte keuzebeurten per stoel. Index = Seat. */
  choicesMadePerSeat: number[];
  /** Stoelen die onder de derde-gift-troefdwang vallen. */
  forcedTrumpSeats: Seat[];
}

/** Volledige (geheime) spelstate. Alleen de engine/host ziet dit object. */
export interface KingenState {
  config: KingenVariantConfig;
  params: KingenTableParams;
  players: PlayerConfig[];
  seed: number;

  phase: KingenPhase;
  roundIndex: number;       // 0-based geving-teller
  roundKind: KingenRoundKind | null;
  dealer: Seat;
  trump: Suit | null;

  hands: Card[][];          // index = Seat
  currentTrick: Trick;
  completedTricks: Trick[];
  trickCounts: number[];    // index = Seat
  /** In het hartenheer-onderdeel: is ♥H al gevallen? */
  heartKingFallen: boolean;

  turn: Seat | null;

  /** Per-ronde scores: scoresPerRound[geving][stoel]. */
  scoresPerRound: number[][];
  totals: number[];         // index = Seat

  /** Alleen gebruikt in dubbelkingen-modus. */
  choiceLedger: ChoiceLedger | null;
}

// ---------------------------------------------------------------------------
// Publieke engine-API
// ---------------------------------------------------------------------------

/**
 * De Kingen-GameDefinition: implementatie van het generieke core-contract.
 * Geconstrueerd in engine.ts en geregistreerd in het spellenregister.
 */
export type KingenDefinition = GameDefinition<KingenState, KingenMove, KingenVariantConfig>;

/**
 * Kingen-specifieke hulp-API bovenop de GameDefinition. Dit zijn pure functies
 * (state in, antwoord uit) die ook door AI en UI gebruikt worden.
 */
export interface KingenRules {
  /**
   * Legale kaarten voor een stoel, met inachtneming van: kleur bekennen,
   * hartenverbod bij uitkomen, strikte afgooiverplichtingen, verplicht
   * (over)troeven en de ♥H-speelplicht.
   */
  legalCards(state: KingenState, seat: Seat): Card[];

  /** Legale troefkleuren (alle 4, of de afgedwongen kleur bij 'laatsteKaart'). */
  legalTrumps(state: KingenState, seat: Seat): Suit[];

  /** Dubbelkingen: welke speltypes mag deze deler nu nog kiezen (schrijver-administratie + troefdwang)? */
  legalRoundKinds(state: KingenState, seat: Seat): KingenRoundKind[];

  /** Score-delta's van een afgeronde ronde, per stoel (negatief = straf). */
  scoreRound(state: KingenState): number[];

  /** Is de ronde voorbij (alle slagen gespeeld, of ♥H gevallen bij stopWhenKingFalls)? */
  isRoundFinished(state: KingenState): boolean;
}

/**
 * AI-hook: dit is de ENIGE manier waarop een computerspeler een kaart kiest.
 * De functie krijgt uitsluitend de publieke view (met view.legalCards gevuld)
 * en retourneert één daarvan. Zie src/ai/types.ts voor het strategie-interface.
 */
export type ChooseCardFn = (view: PublicGameView) => Card | Promise<Card>;

// NB: `createKingenDefinition(): KingenDefinition` staat in engine.ts;
//     `kingenRules: KingenRules` staat in rules.ts;
//     `scoreRound`-implementatiedetails in scoring.ts.
