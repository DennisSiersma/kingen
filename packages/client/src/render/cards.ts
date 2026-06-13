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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Card, CardId, Rank } from '@shared/core/types.ts';
import { RANK_LABELS_NL } from '@shared/core/types.ts';
import type { CardRenderer, CardTextureOptions } from './types.ts';
import {
  CARD_ASPECT,
  CORNER_RADIUS_FRAC,
  drawCardBack as drawBack,
  drawCardFace as drawFace,
} from './cardTextures.ts';

// Tekenfuncties los testbaar her-exporteren (publieke API van deze module).
export { drawCardFace, drawCardBack, selfTestCardTextures, roundedRectPath, CARD_ASPECT } from './cardTextures.ts';
export type { CardTextureSelfTestResult, BackTheme } from './cardTextures.ts';

/**
 * Kaartafmetingen in wereldeenheden. Poker-verhouding (63 x 88 mm),
 * geschaald naar een tafel met straal ~3 wereldeenheden.
 */
export const CARD_WIDTH = 0.63;
export const CARD_HEIGHT = 0.882;
// Dun gehouden: dikke kaarten lieten de slag onnatuurlijk hoog "zweven" en
// gaven een witte spleet tussen kaart en slagschaduw.
export const CARD_THICKNESS = 0.0035;

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

/** Afgerond-rechthoekig kaartsilhouet als THREE.Shape (gecentreerd op 0,0). */
function roundedCardShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Normaliseer de UV's van een vlak shape-geometrie naar 0..1 over de bounding box. */
function normalizeShapeUV(geo: THREE.BufferGeometry, w: number, h: number): void {
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  const uv = geo.attributes['uv'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  }
  uv.needsUpdate = true;
}

/**
 * Kaartgeometrie met écht afgerond silhouet: twee afgerond-rechthoekige vlakken
 * (voor- en achterkant), gescheiden door de kaartdikte. Geen rechte zijwanden,
 * dus geen witte rand die bij een BoxGeometry buiten de afgeronde hoeken stak.
 * Materiaalgroepen: 0 = voorkant, 1 = achterkant.
 */
function makeRoundedCardGeometry(w: number, h: number, t: number, r: number): THREE.BufferGeometry {
  const shape = roundedCardShape(w, h, r);

  const front = new THREE.ShapeGeometry(shape, 10);
  normalizeShapeUV(front, w, h);
  front.translate(0, 0, t / 2);

  const back = new THREE.ShapeGeometry(shape, 10);
  normalizeShapeUV(back, w, h); // vóór het draaien, zodat de UV-oriëntatie klopt
  back.rotateY(Math.PI); // laat de achterkant naar -z kijken (rug symmetrisch → spiegeling onzichtbaar)
  back.translate(0, 0, -t / 2);

  const merged = mergeGeometries([front, back], true); // useGroups: groep 0 = voor, 1 = achter
  front.dispose();
  back.dispose();
  if (!merged) throw new Error('Kon kaartgeometrie niet samenvoegen');
  return merged;
}

/** Maak de (cachende) CardRenderer. Elke texture wordt exact één keer gegenereerd. */
export function createCardRenderer(options?: CardTextureOptions): CardRenderer {
  const resolution = Math.max(256, Math.round(options?.resolution ?? 1024));
  const texHeight = Math.round(resolution * CARD_ASPECT);
  const backTheme = options?.backTheme ?? 'blauw';

  const cardSize = { width: CARD_WIDTH, height: CARD_HEIGHT, thickness: CARD_THICKNESS } as const;

  // Gedeelde geometrie voor alle kaarten: afgerond silhouet (voor- + achterkant),
  // geen rechte zijwanden → geen uitstekende witte rand bij de hoeken.
  const geometry = makeRoundedCardGeometry(
    cardSize.width,
    cardSize.height,
    cardSize.thickness,
    CARD_WIDTH * CORNER_RADIUS_FRAC,
  );

  // Voorkant-cache: bewaar het canvas + de kaart zodat we bij een taalwissel
  // (B/V/H ↔ J/Q/K) hetzelfde canvas opnieuw kunnen tekenen i.p.v. nieuwe
  // textures te maken — bestaande meshes verwijzen naar dezelfde texture.
  interface FaceEntry {
    card: Card;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
  }
  const faceEntries = new Map<CardId, FaceEntry>();
  let backTexture: THREE.CanvasTexture | null = null;
  let disposed = false;
  let rankLabels = options?.rankLabels ?? RANK_LABELS_NL;

  function configureTexture(texture: THREE.CanvasTexture): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }

  function maakCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = texHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D-canvascontext niet beschikbaar voor kaarttextures');
    return { canvas, ctx };
  }

  function makeTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const { canvas, ctx } = maakCanvas();
    draw(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    configureTexture(texture);
    return texture;
  }

  function getFrontTexture(card: Card): THREE.Texture {
    let entry = faceEntries.get(card.id);
    if (!entry) {
      const { canvas, ctx } = maakCanvas();
      drawFace(ctx, card, resolution, texHeight, rankLabels);
      const texture = new THREE.CanvasTexture(canvas);
      configureTexture(texture);
      entry = { card, canvas, texture };
      faceEntries.set(card.id, entry);
    }
    return entry.texture;
  }

  function setRankLabels(labels: Readonly<Record<Rank, string>>): void {
    if (labels === rankLabels) return;
    rankLabels = labels;
    // Hele cache opnieuw tekenen op dezelfde canvassen; meshes updaten vanzelf.
    for (const entry of faceEntries.values()) {
      const ctx = entry.canvas.getContext('2d');
      if (!ctx) continue;
      drawFace(ctx, entry.card, resolution, texHeight, rankLabels);
      entry.texture.needsUpdate = true;
    }
  }

  function getBackTexture(): THREE.Texture {
    if (!backTexture) {
      // De rug is puntsymmetrisch ontworpen, dus de gespiegelde weergave op
      // de -z-zijde van de box ziet er identiek uit.
      backTexture = makeTexture((ctx) => drawBack(ctx, resolution, texHeight, backTheme));
    }
    return backTexture;
  }

  /** Fysisch materiaal met lichte glans. Bewust mat gehouden: te veel
   *  clearcoat/sheen blaast onder de felle tafelspot de witte kaart uit
   *  ("washed out"), waardoor pip-kleuren verdwijnen. */
  function makeCardMaterial(map: THREE.Texture): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      map,
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.1,
      clearcoatRoughness: 0.55,
      sheen: 0.08,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color('#fff6e0'),
      // Afgeronde hoeken: transparante texture-hoeken via alphaTest wegsnijden
      // (geen sorteer-artefacten zoals bij transparent=true).
      alphaTest: 0.5,
      side: THREE.FrontSide,
    });
  }

  function createCardMesh(card: Card): THREE.Mesh {
    if (disposed) throw new Error('CardRenderer is al opgeruimd (dispose aangeroepen)');
    // Eigen materialen per mesh zodat highlight-status per kaart kan
    // verschillen; de (dure) textures worden gedeeld via de cache.
    // EIGENAARSCHAP: de materialen horen bij de mesh — wie de mesh uit de
    // scene verwijdert, dispose't ze (zie verwijderMesh in animations.ts);
    // anders lekken er per ronde tientallen materialen.
    const front = makeCardMaterial(getFrontTexture(card));
    const back = makeCardMaterial(getBackTexture());
    // Geometrie-materiaalgroepen: 0 = voorkant, 1 = achterkant.
    const mesh = new THREE.Mesh(geometry, [front, back]);
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
    for (const entry of faceEntries.values()) entry.texture.dispose();
    faceEntries.clear();
    backTexture?.dispose();
    backTexture = null;
    geometry.dispose();
  }

  return {
    createCardMesh,
    getFrontTexture,
    getBackTexture,
    setRankLabels,
    cardSize,
    dispose,
  };
}
