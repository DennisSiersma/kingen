/**
 * src/render/cards.ts
 * CardRenderer-implementatie: high-res canvas-textures (pips, hofkaarten,
 * sierlijke rug, afgeronde hoeken via alpha) en kaart-meshes met
 * MeshPhysicalMaterial (lichte glans/clearcoat). GEEN externe assets.
 *
 * Texture-generatie zelf staat in ./cardTextures.ts (+ ./cardArt/*);
 * dit bestand verzorgt caching, Three.js-materialen en meshes.
 */

import * as THREE from 'three';
import type { Card, CardId } from '../core/types.ts';
import type { CardRenderer, CardTextureOptions } from './types.ts';
import { CARD_ASPECT, drawCardBack as drawBack, drawCardFace as drawFace } from './cardTextures.ts';

// Tekenfuncties los testbaar her-exporteren (publieke API van deze module).
export { drawCardFace, drawCardBack, selfTestCardTextures, roundedRectPath, CARD_ASPECT } from './cardTextures.ts';
export type { CardTextureSelfTestResult, BackTheme } from './cardTextures.ts';

/**
 * Kaartafmetingen in wereldeenheden. Poker-verhouding (63 x 88 mm),
 * geschaald naar een tafel met straal ~3 wereldeenheden.
 */
export const CARD_WIDTH = 0.63;
export const CARD_HEIGHT = 0.882;
export const CARD_THICKNESS = 0.006;

/** Aanbevolen lift (wereldeenheden) voor een gehoverde handkaart. */
export const HOVER_LIFT = 0.05;

/** Visuele status van een kaartmesh in de hand. */
export type CardHighlight = 'none' | 'hover' | 'selected' | 'dimmed';

/**
 * Zet de hover/selecteerbaar-status van een kaartmesh: subtiele warme gloed
 * bij hover/selectie, gedimd voor niet-speelbare kaarten. De fysieke "lift"
 * hoort bij de animator (gebruik HOVER_LIFT als afstand).
 */
export function setCardHighlight(mesh: THREE.Mesh, state: CardHighlight): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
    switch (state) {
      case 'hover':
        material.color.setScalar(1);
        material.emissive.set('#ffdf91');
        material.emissiveIntensity = 0.16;
        break;
      case 'selected':
        material.color.setScalar(1);
        material.emissive.set('#ffd066');
        material.emissiveIntensity = 0.3;
        break;
      case 'dimmed':
        material.color.setScalar(0.62);
        material.emissive.set('#000000');
        material.emissiveIntensity = 0;
        break;
      default:
        material.color.setScalar(1);
        material.emissive.set('#000000');
        material.emissiveIntensity = 0;
        break;
    }
  }
  mesh.userData.highlight = state;
}

/** Maak de (cachende) CardRenderer. Elke texture wordt exact één keer gegenereerd. */
export function createCardRenderer(options?: CardTextureOptions): CardRenderer {
  const resolution = Math.max(256, Math.round(options?.resolution ?? 1024));
  const texHeight = Math.round(resolution * CARD_ASPECT);
  const backTheme = options?.backTheme ?? 'blauw';

  const cardSize = { width: CARD_WIDTH, height: CARD_HEIGHT, thickness: CARD_THICKNESS } as const;

  // Gedeelde geometrie voor alle kaarten (dunne box: dikte-illusie + zijrand).
  const geometry = new THREE.BoxGeometry(cardSize.width, cardSize.height, cardSize.thickness);

  const faceTextures = new Map<CardId, THREE.CanvasTexture>();
  let backTexture: THREE.CanvasTexture | null = null;
  let disposed = false;

  function makeTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = texHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D-canvascontext niet beschikbaar voor kaarttextures');
    draw(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  function getFrontTexture(card: Card): THREE.Texture {
    let texture = faceTextures.get(card.id);
    if (!texture) {
      texture = makeTexture((ctx) => drawFace(ctx, card, resolution, texHeight));
      faceTextures.set(card.id, texture);
    }
    return texture;
  }

  function getBackTexture(): THREE.Texture {
    if (!backTexture) {
      // De rug is puntsymmetrisch ontworpen, dus de gespiegelde weergave op
      // de -z-zijde van de box ziet er identiek uit.
      backTexture = makeTexture((ctx) => drawBack(ctx, resolution, texHeight, backTheme));
    }
    return backTexture;
  }

  /** Fysisch materiaal met lichte clearcoat/sheen voor realistische kaartglans. */
  function makeCardMaterial(map: THREE.Texture): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      map,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.32,
      clearcoatRoughness: 0.3,
      sheen: 0.25,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color('#fff6e0'),
      // Afgeronde hoeken: transparante texture-hoeken via alphaTest wegsnijden
      // (geen sorteer-artefacten zoals bij transparent=true).
      alphaTest: 0.5,
      side: THREE.FrontSide,
    });
  }

  function makeEdgeMaterial(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: '#e9e3d3',
      roughness: 0.85,
      metalness: 0,
    });
  }

  function createCardMesh(card: Card): THREE.Mesh {
    if (disposed) throw new Error('CardRenderer is al opgeruimd (dispose aangeroepen)');
    // Eigen materialen per mesh zodat highlight-status per kaart kan
    // verschillen; de (dure) textures worden gedeeld via de cache.
    // EIGENAARSCHAP: de materialen horen bij de mesh — wie de mesh uit de
    // scene verwijdert, dispose't ze (zie verwijderMesh in animations.ts);
    // anders lekken er per ronde tientallen materialen.
    const edge = makeEdgeMaterial();
    const front = makeCardMaterial(getFrontTexture(card));
    const back = makeCardMaterial(getBackTexture());
    // BoxGeometry-materiaalvolgorde: +x, -x, +y, -y, +z (voorkant), -z (rug).
    const mesh = new THREE.Mesh(geometry, [edge, edge, edge, edge, front, back]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cardId = card.id;
    mesh.userData.highlight = 'none';
    return mesh;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // Per-mesh materialen zijn eigendom van de meshes en worden bij het
    // verwijderen uit de scene opgeruimd; hier alleen de gedeelde cache.
    for (const texture of faceTextures.values()) texture.dispose();
    faceTextures.clear();
    backTexture?.dispose();
    backTexture = null;
    geometry.dispose();
  }

  return {
    createCardMesh,
    getFrontTexture,
    getBackTexture,
    cardSize,
    dispose,
  };
}
