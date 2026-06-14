/**
 * src/render/types.ts
 * Contracten voor de Three.js-renderlaag: omgevingen, kaart-rendering en
 * animaties. ALLE textures worden programmatisch gegenereerd (canvas) —
 * geen externe assets.
 */

import type * as THREE from 'three';
import type { Card, GameEvent, Rank, Seat, Suit } from '@shared/core/types.ts';

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
  /** Anisotrope filtering (1-16). Lager = goedkoper op mobiele GPU's. Default 8. */
  anisotropy?: number;
  /** Rugkleur-thema. */
  backTheme?: 'blauw' | 'rood' | 'groen';
  /** Korte rang-labels (taalafhankelijk: NL B/V/H, EN J/Q/K). Default NL. */
  rankLabels?: Readonly<Record<Rank, string>>;
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

  /**
   * Wissel de rang-labels (taalwissel NL↔EN). Hertekent de gecachete
   * voorkant-textures in-place, zodat bestaande kaart-meshes meteen de nieuwe
   * letters (B/V/H ↔ J/Q/K) tonen zonder opnieuw te worden aangemaakt.
   */
  setRankLabels(labels: Readonly<Record<Rank, string>>): void;

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
  /** Wereldhoek van een stoel rond de tafel (kijker-stoel = bij de camera, +Z). */
  seatAngle(seat: Seat, seatCount: number): number;
  /** Y-hoogte van het tafeloppervlak. */
  getSurfaceY(): number;
  /** Straal/halve breedte van het speelvlak. */
  getRadius(): number;
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

  // --- Optionele uitbreidingen per spel-familie (afleg-trek, rummy) ---
  // Slagenspellen (Kingen) implementeren deze niet; een render-plugin voor
  // Pesten/Jokeren voegt ze toe wanneer dat spel gebouwd wordt.

  /** Afleg-trek: speler trekt `count` kaarten van de koopstapel. */
  animateDraw?(seat: Seat, count: number): Promise<void>;
  /** Afleg-trek: kaart naar de aflegstapel. */
  animateDiscard?(card: Card, from: Seat): Promise<void>;
  /** Afleg-trek: aflegstapel teruggeschud tot nieuwe koopstapel. */
  animateReshuffle?(): Promise<void>;
  /** Rummy: een combinatie (meld) open op tafel leggen. */
  animateLayMeld?(seat: Seat, cards: Card[]): Promise<void>;
}

/**
 * Context die de SceneManager bij creatie aan een render-plugin geeft, zodat
 * plugins die eigen 3D-objecten beheren (bijv. Mexen's dobbelstenen/beker)
 * toegang hebben tot de scene, camera en tafel-layout.
 */
export interface RenderPluginContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  layout: TableLayout;
}

/**
 * Per-spel render-plugin: mag een GameEvent zelf afhandelen (bijv. drawCard/
 * layCard voor afleg-trek-spellen, of dobbelworpen voor Mexen) vóór de standaard
 * slag-render. Geeft `true` terug als het event volledig is afgehandeld (de scene
 * slaat zijn default over). Kingen levert geen plugin → de standaard slag-render
 * draait ongewijzigd.
 */
export interface SceneRenderPlugin {
  /** Eenmalig aangeroepen bij scene-creatie; geeft scene/camera/layout-toegang. */
  attach?(ctx: RenderPluginContext): void;
  handleEvent(ev: GameEvent, animator: CardAnimator): Promise<boolean>;
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
