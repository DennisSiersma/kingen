/**
 * src/render/types.ts
 * Contracten voor de Three.js-renderlaag: omgevingen, kaart-rendering en
 * animaties. ALLE textures worden programmatisch gegenereerd (canvas) —
 * geen externe assets.
 */

import type * as THREE from 'three';
import type { Card, Seat, Suit } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Omgevingen
// ---------------------------------------------------------------------------

export type EnvironmentId = 'cafe' | 'keukentafel' | 'casino';

export const ENVIRONMENT_IDS: readonly EnvironmentId[] = ['cafe', 'keukentafel', 'casino'];

/**
 * Een speelomgeving: tafel, belichting en sfeer. Elke omgeving bouwt zijn
 * eigen meshes/lichten procedureel op (canvas-textures, geometrie, fog).
 */
export interface Environment {
  readonly id: EnvironmentId;
  /** Nederlandse naam voor het setup-scherm, bijv. 'Bruin café'. */
  readonly naam: string;
  /** Korte Nederlandse omschrijving voor de omgevingskeuze. */
  readonly omschrijving: string;

  /**
   * Bouw de omgeving op in de scene: tafel(blad), decor, fog, achtergrond.
   * Mag async zijn (procedurele texture-generatie). Retourneert een dispose-functie.
   */
  setup(scene: THREE.Scene): Promise<() => void>;

  /** Maak en retourneer de lichten van deze omgeving (al aan de scene toegevoegd door setup). */
  createLights(): THREE.Light[];

  /** Materiaal van het tafelblad (vilt, hout, ...), procedureel gegenereerd. */
  createTableMaterial(): THREE.Material;

  /** Y-hoogte van het tafeloppervlak (waar kaarten op liggen). */
  readonly tableSurfaceY: number;
  /** Straal/halve breedte van het speelvlak, voor het positioneren van stoelen/handen. */
  readonly tableRadius: number;
}

// ---------------------------------------------------------------------------
// Kaart-rendering
// ---------------------------------------------------------------------------

/** Opties voor de texture-generator. */
export interface CardTextureOptions {
  /** Texture-resolutie van de voorkant in px (breedte; hoogte = breedte * 1.4). Default 1024. */
  resolution?: number;
  /** Rugkleur-thema. */
  backTheme?: 'blauw' | 'rood' | 'groen';
}

/**
 * Genereert en cachet high-res canvas-textures en meshes voor alle kaarten.
 * Eisen (kwaliteitslat): correcte pip-layouts per rang, sierlijke hofkaarten
 * (B/V/H, procedureel getekend), mooie geornamenteerde kaartrug, afgeronde
 * hoeken via alpha, MeshPhysicalMaterial met lichte glans/clearcoat.
 */
export interface CardRenderer {
  /**
   * Maak een mesh voor een kaart. userData.cardId wordt gezet. Textures en
   * geometrie komen uit de gedeelde cache; de materialen zijn per mesh en
   * eigendom van de aanvrager (bij verwijderen uit de scene zelf disposen).
   */
  createCardMesh(card: Card): THREE.Mesh;

  /** Voorkant-texture van een kaart (gecachet). */
  getFrontTexture(card: Card): THREE.Texture;

  /** Rug-texture (één voor alle kaarten). */
  getBackTexture(): THREE.Texture;

  /** Kaartafmetingen in wereld-eenheden { width, height, thickness }. */
  readonly cardSize: { width: number; height: number; thickness: number };

  /** Geef GPU-resources vrij. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Animaties
// ---------------------------------------------------------------------------

/** Posities aan tafel per stoel (hand-waaier, speel-/slagposities). */
export interface TableLayout {
  /** Wereldpositie + rotatie van het hand-anker van een stoel. */
  handAnchor(seat: Seat, seatCount: number): { position: THREE.Vector3; rotationY: number };
  /** Plek op tafel waar de kaart van deze stoel in de slag komt te liggen. */
  trickSlot(seat: Seat, seatCount: number): THREE.Vector3;
  /** Plek waar gewonnen slagen van deze stoel worden verzameld. */
  wonPile(seat: Seat, seatCount: number): THREE.Vector3;
}

/**
 * Animatie-API. Elke animatie retourneert een Promise die resolved als de
 * beweging klaar is — de TurnManager-gate (afterEvent) await deze promises
 * zodat het spel vloeiend op de visuals wacht.
 */
export interface CardAnimator {
  /** Deel alle handen rond vanaf de deler (kaarten vliegen één voor één). */
  animateDeal(handsBySeat: Card[][], dealer: Seat): Promise<void>;

  /** Speel een kaart van hand naar de slagpositie (boogje + flip indien AI/verdekt). */
  animatePlay(card: Card, from: Seat): Promise<void>;

  /** Veeg de complete slag naar de winnaar en stapel hem daar om. */
  animateCollectTrick(winner: Seat): Promise<void>;

  /** Herschik/waaier de hand van een stoel (na spelen/sorteren). */
  animateArrangeHand(seat: Seat): Promise<void>;

  /** Onderbreek alles (nieuwe partij / venster weg). */
  cancelAll(): void;
}

// ---------------------------------------------------------------------------
// Scene-beheer
// ---------------------------------------------------------------------------

/** Hoofdingang van de renderlaag; luistert op de GameEventBus en animeert. */
export interface SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cardRenderer: CardRenderer;
  readonly animator: CardAnimator;

  /** Wissel van omgeving (ruimt de oude netjes op). */
  setEnvironment(id: EnvironmentId): Promise<void>;

  /** Raycast-hover/klik op handkaarten van de mens; callback met CardId. */
  onCardClicked(handler: (cardId: string) => void): () => void;
  /** Markeer welke kaarten klikbaar (legaal) zijn — andere worden gedimd. */
  setPlayableCards(cardIds: string[]): void;

  start(): void;
  dispose(): void;
}
