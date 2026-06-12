/**
 * src/ui/types.ts
 * Contracten voor de DOM-overlay: setup-scherm, HUD, scorebord, meldingen.
 * Alle zichtbare teksten lopen via src/ui/i18n.ts (NL/EN).
 */

import type { PlayerConfig, Seat, Suit } from '../core/types.ts';
import type { KingenRoundKind, KingenVariantConfig } from '../games/kingen/types.ts';
import type { EnvironmentId } from '../render/types.ts';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Resultaat van het setup-scherm; hiermee wordt de partij gestart. */
export interface SetupConfig {
  /** 3-5 spelers; spelers[0] is de stoel van de lokale gebruiker. */
  spelers: PlayerConfig[];
  variant: KingenVariantConfig;
  omgeving: EnvironmentId;
}

// ---------------------------------------------------------------------------
// UI-events (van DOM-overlay naar app/spel-loop)
// ---------------------------------------------------------------------------

export type UiEvent =
  /** Setup-scherm bevestigd: start de partij. */
  | { type: 'setupComplete'; config: SetupConfig }
  /** Mens klikte een kaart in zijn hand aan. */
  | { type: 'cardChosen'; seat: Seat; cardId: string }
  /** Mens koos een troefkleur in de troefkeuze-dialoog. */
  | { type: 'trumpChosen'; seat: Seat; suit: Suit }
  /** Mens (als deler, dubbelkingen) koos een speltype. */
  | { type: 'roundKindChosen'; seat: Seat; kind: KingenRoundKind }
  /** Mens claimt zijn hand (variant 'hand afleggen'). */
  | { type: 'claimRequested'; seat: Seat }
  /** Scorebord open/dicht. */
  | { type: 'toggleScoreboard' }
  /** Terug naar het setup-scherm (partij afbreken). */
  | { type: 'quitToSetup' }
  /** Nieuwe partij met dezelfde instellingen. */
  | { type: 'playAgain' };

export type UiEventType = UiEvent['type'];

// ---------------------------------------------------------------------------
// UI-componenten
// ---------------------------------------------------------------------------

/** Setup-scherm: aantal spelers, mens/computer per stoel, variant- en omgevingskeuze. */
export interface SetupScreen {
  /** Toon het scherm; resolves met de gekozen configuratie. */
  show(defaults?: Partial<SetupConfig>): Promise<SetupConfig>;
  hide(): void;
}

/** HUD tijdens het spel: rondenaam, troef, beurtindicator, slagentellers, namen. */
export interface Hud {
  /**
   * Toon de huidige ronde. `kind` is de taalneutrale rondesoort
   * (KingenRoundKind); de UI leidt daar zelf de zichtbare naam uit af (i18n).
   * Een lege string toont de placeholder.
   */
  setRound(kind: string, index: number, total: number): void;
  setTrump(trump: Suit | null): void;
  setTurn(seat: Seat | null): void;
  setTrickCounts(counts: number[]): void;
  setPlayers(names: string[], kinds: ('human' | 'ai')[]): void;
  /**
   * Toon/verberg de knop 'Hand afleggen' (variant claimen). Een klik emit het
   * UiEvent 'claimRequested' voor stoel 0.
   */
  setClaimAvailable(beschikbaar: boolean): void;
  show(): void;
  hide(): void;
}

/** Scorebord-overlay met per-ronde rijen en totalen (ScoreSheet-data). */
export interface Scoreboard {
  update(rows: import('../core/scoresheet.ts').ScoreRow[], names: string[]): void;
  show(): void;
  hide(): void;
  toggle(): void;
}

/** Meldingen/toasts, bijv. "Dennis wint de slag", "De King is gevallen!". */
export interface Notifications {
  /** Toon een melding (al vertaalde tekst); resolves wanneer hij weer verdwenen is. */
  toon(tekst: string, opts?: { duurMs?: number; soort?: 'info' | 'succes' | 'waarschuwing' }): Promise<void>;
  /** Grote ronde-aankondiging in beeld ("Ronde 5 — De King"). */
  kondigRondeAan(label: string): Promise<void>;
}

/** Dialogen die een keuze van de mens vragen. */
export interface ChoiceDialogs {
  /** Troefkeuze (toont 4 of minder kleuren). */
  vraagTroef(legal: Suit[]): Promise<Suit>;
  /** Spelkeuze voor dubbelkingen (uitgeputte keuzes uitgeschakeld weergeven). */
  vraagRondeKeuze(available: KingenRoundKind[]): Promise<KingenRoundKind>;
  /** Einde partij: uitslag + "Nog een keer?" */
  toonEindstand(names: string[], totals: number[], winners: Seat[]): Promise<'opnieuw' | 'setup'>;
}
