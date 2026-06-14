/**
 * src/render/dice/diceRenderer.ts
 * Procedurele Three.js-geometrie/materialen voor Mexen: twee dobbelstenen en een
 * 3D-dobbelbeker. Net als de kaarten worden alle textures programmatisch
 * (canvas) gemaakt — geen externe assets.
 *
 * Kern is de DETERMINISTISCHE oriëntatie: faceQuaternion(value) draait een steen
 * zo dat het gevraagde aantal ogen recht omhoog (+Y) wijst. Daarmee landt een
 * geanimeerde worp altijd op de waarde die de (seedbare) engine heeft bepaald.
 */

import * as THREE from 'three';
import type { DieValue } from '@shared/games/dice/dice.ts';

/** Ribbe van één dobbelsteen in wereld-eenheden (past samen onder de beker). */
export const DIE_SIZE = 0.07;
/** Buitenstraal van de beker aan de monding. */
export const CUP_RADIUS = 0.1;
/** Hoogte van de beker. */
export const CUP_HEIGHT = 0.17;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Vlaknormaal (lokaal) van het vlak dat `value` ogen toont. Gekozen zodat
 * tegenoverliggende vlakken samen 7 zijn (standaard dobbelsteen) en de
 * materiaal-volgorde van BoxGeometry [+X,-X,+Y,-Y,+Z,-Z] klopt:
 *   +X=1  -X=6   +Y=2  -Y=5   +Z=3  -Z=4
 */
export const DIE_FACE_NORMALS: Record<DieValue, THREE.Vector3> = {
  1: new THREE.Vector3(1, 0, 0),
  6: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 1, 0),
  5: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
};

/** Het vlak tegenover `value` (samen 7). */
export function oppositeFace(value: DieValue): DieValue {
  return (7 - value) as DieValue;
}

/**
 * Quaternion die de steen zo oriënteert dat `value` recht omhoog wijst.
 * `spinY` draait de steen daarna nog om de verticale as (cosmetische variatie)
 * zonder de bovenkant te veranderen.
 */
export function faceQuaternion(value: DieValue, spinY = 0): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(DIE_FACE_NORMALS[value], UP);
  if (spinY !== 0) {
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, spinY));
  }
  return q;
}

// ---------------------------------------------------------------------------
// Pip-textures (ogen) per vlak
// ---------------------------------------------------------------------------

/** Genormaliseerde pip-posities (0..1) per ogental, klassieke dobbelsteen-layout. */
const PIP_LAYOUT: Record<DieValue, ReadonlyArray<readonly [number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

/** Teken een vlak met `value` ogen op een canvas en maak er een texture van. */
export function createDiePipTexture(value: DieValue): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Ivoorwit vlak met een zachte vignette voor diepte.
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.7);
  grad.addColorStop(0, '#fbf7ef');
  grad.addColorStop(1, '#ece3d2');
  ctx.fillStyle = '#f7f1e4';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Ogen: donkere ingegraveerde stippen met lichte rand (groot + contrastrijk
  // zodat ze ook op tafelafstand goed leesbaar zijn).
  const pipR = size * 0.11;
  for (const [px, py] of PIP_LAYOUT[value]) {
    const x = px * size;
    const y = py * size;
    const pg = ctx.createRadialGradient(x - pipR * 0.3, y - pipR * 0.3, pipR * 0.1, x, y, pipR);
    pg.addColorStop(0, '#3a322a');
    pg.addColorStop(1, '#16110c');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(x, y, pipR, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Maak een dobbelsteen-mesh met de zes vlakken correct getextureerd. */
export function createDie(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
  // Materiaal-volgorde volgt BoxGeometry-groepen [+X,-X,+Y,-Y,+Z,-Z].
  const volgorde: DieValue[] = [1, 6, 2, 5, 3, 4];
  const materials = volgorde.map((value) =>
    new THREE.MeshPhysicalMaterial({
      map: createDiePipTexture(value),
      roughness: 0.35,
      clearcoat: 0.6,
      clearcoatRoughness: 0.3,
      color: 0xffffff,
    }),
  );
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData['die'] = true;
  return mesh;
}

/** Geef de materialen + map-textures van een steen vrij. */
export function disposeDie(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    const map = (m as THREE.MeshStandardMaterial).map;
    if (map) map.dispose();
    m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Dobbelbeker (LatheGeometry-tumbler met vilt-interieur)
// ---------------------------------------------------------------------------

/** Profielpunten (x = straal, y = hoogte) van de bekerwand, bodem → monding. */
function cupProfile(): THREE.Vector2[] {
  const r = CUP_RADIUS;
  const h = CUP_HEIGHT;
  // Lichte taps toelopende tumbler: iets smaller aan de bodem dan aan de monding.
  return [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(r * 0.72, 0.0),
    new THREE.Vector2(r * 0.78, h * 0.08),
    new THREE.Vector2(r * 0.9, h * 0.55),
    new THREE.Vector2(r, h),
  ];
}

/**
 * Maak een dobbelbeker als Group: lederen buitenwand + bodem en een iets kleinere
 * vilt-binnenwand (sheen) zodat de binnenkant bij het optillen mooi oplicht.
 * Het lokale nulpunt ligt op de bodem; de monding wijst naar +Y.
 */
export function createCup(): THREE.Group {
  const group = new THREE.Group();
  const profiel = cupProfile();

  const buitenGeo = new THREE.LatheGeometry(profiel, 48);
  const buitenMat = new THREE.MeshPhysicalMaterial({
    color: 0x6b3f2a,
    roughness: 0.55,
    clearcoat: 0.4,
    clearcoatRoughness: 0.4,
    side: THREE.FrontSide,
  });
  const buiten = new THREE.Mesh(buitenGeo, buitenMat);
  buiten.castShadow = true;

  // Binnenwand: zelfde profiel iets naar binnen, normalen naar binnen (BackSide),
  // groen vilt met sheen.
  const binnenProfiel = profiel.map((p) => new THREE.Vector2(Math.max(0, p.x - 0.004), p.y + 0.002));
  const binnenGeo = new THREE.LatheGeometry(binnenProfiel, 48);
  const binnenMat = new THREE.MeshPhysicalMaterial({
    color: 0x14532d,
    roughness: 0.95,
    sheen: 1.0,
    sheenColor: new THREE.Color(0x2f8f54),
    sheenRoughness: 0.6,
    side: THREE.BackSide,
  });
  const binnen = new THREE.Mesh(binnenGeo, binnenMat);

  group.add(buiten, binnen);
  group.userData['cup'] = true;
  return group;
}

/** Geef de resources van een beker-group vrij. */
export function disposeCup(group: THREE.Group): void {
  disposeGroup(group);
}

// ---------------------------------------------------------------------------
// Bierviltje (waar de beker omgekeerd op geschud wordt)
// ---------------------------------------------------------------------------

/** Straal van het viltje (ruim groter dan de bekermonding). */
export const COASTER_RADIUS = CUP_RADIUS * 1.7;

/**
 * Biervilt-ontwerpen. Bewust ORIGINEEL (verzonnen namen + eigen, generieke
 * emblemen) en NIET de beschermde merklogo's — alleen de kroegsfeer + de
 * kleur/motief-families (pils, bock, ster, leeuw/kroon, stier) zijn nagebootst.
 */
interface CoasterDesign {
  naam: string;
  onder: string;
  bg: string;
  rim: string;
  ink: string;
  accent: string;
  emblem: 'hop' | 'shield' | 'star' | 'crown' | 'sunburst';
}

const COASTER_DESIGNS: readonly CoasterDesign[] = [
  { naam: "'t Groene Hart", onder: 'PILSNER', bg: '#1f7a3d', rim: '#f3ead2', ink: '#f6efdc', accent: '#e7c66a', emblem: 'hop' },
  { naam: 'Havenbock', onder: 'BOCKBIER', bg: '#8f1d1d', rim: '#e7c66a', ink: '#f3ead2', accent: '#e7c66a', emblem: 'shield' },
  { naam: 'Noorderlicht', onder: 'LAGER', bg: '#15314f', rim: '#f3ead2', ink: '#f3ead2', accent: '#cfe3f2', emblem: 'star' },
  { naam: 'Gouden Leeuw', onder: 'ROYAL', bg: '#c89b2c', rim: '#2a2118', ink: '#2a2118', accent: '#8a1f1f', emblem: 'crown' },
  { naam: 'Zwarte Stier', onder: 'STOUT', bg: '#16130f', rim: '#d9442f', ink: '#e9c46a', accent: '#d9442f', emblem: 'sunburst' },
];

/** Aantal beschikbare vilt-ontwerpen (voor willekeurige keuze per partij). */
export const COASTER_COUNT = COASTER_DESIGNS.length;

function tekenEmblem(ctx: CanvasRenderingContext2D, d: CoasterDesign, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.fillStyle = d.ink;
  ctx.strokeStyle = d.ink;
  ctx.lineWidth = r * 0.12;
  ctx.lineJoin = 'round';
  switch (d.emblem) {
    case 'star':
      tekenSter(ctx, cx, cy, r, 5);
      ctx.fill();
      break;
    case 'sunburst': {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = d.accent;
      ctx.fill();
      break;
    }
    case 'crown': {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.5);
      ctx.lineTo(cx - r, cy - r * 0.2);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.15);
      ctx.lineTo(cx, cy - r * 0.6);
      ctx.lineTo(cx + r * 0.5, cy + r * 0.15);
      ctx.lineTo(cx + r, cy - r * 0.2);
      ctx.lineTo(cx + r, cy + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'shield': {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.8, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.8, cy + r * 0.15);
      ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.8, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.8, cx - r * 0.8, cy + r * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = d.accent;
      tekenSter(ctx, cx, cy - r * 0.1, r * 0.42, 5);
      ctx.fill();
      break;
    }
    case 'hop': {
      // Gestileerde hopbel: een ovaal met overlappende "schubben".
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.6, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = d.bg;
      ctx.lineWidth = r * 0.07;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.arc(cx, cy + k * r * 0.28, r * 0.55, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function tekenSter(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, punten: number): void {
  ctx.beginPath();
  for (let i = 0; i < punten * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = (i / (punten * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Teken één vilt-ontwerp op een canvas en maak er een texture van. */
export function createCoasterTexture(variant: number): THREE.CanvasTexture {
  const d = COASTER_DESIGNS[((variant % COASTER_COUNT) + COASTER_COUNT) % COASTER_COUNT]!;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  // Achtergrondvlak + crème/contrast rand.
  ctx.fillStyle = d.bg;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = d.rim;
  ctx.beginPath();
  ctx.arc(c, c, c - ctx.lineWidth, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.7, 0, Math.PI * 2);
  ctx.stroke();

  // Embleem in het midden.
  tekenEmblem(ctx, d, c, c * 0.92, size * 0.17);

  // Naam boven, soort onder.
  ctx.fillStyle = d.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size * 0.1}px Georgia, "Times New Roman", serif`;
  ctx.fillText(d.naam, c, size * 0.26);
  ctx.font = `600 ${size * 0.05}px system-ui, sans-serif`;
  ctx.fillStyle = d.accent;
  ctx.fillText(d.onder, c, size * 0.74);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Maak een rond bierviltje met één van de originele ontwerpen (`variant`, of
 * willekeurig). Lokaal nulpunt in het midden; leg het net boven het tafelblad.
 */
export function createCoaster(variant: number = Math.floor(Math.random() * COASTER_COUNT)): THREE.Group {
  const group = new THREE.Group();
  // Dunne schijf als basis (zijkant in de randkleur).
  const basis = new THREE.Mesh(
    new THREE.CylinderGeometry(COASTER_RADIUS, COASTER_RADIUS, 0.006, 48),
    new THREE.MeshStandardMaterial({ color: 0xece3d2, roughness: 0.92 }),
  );
  basis.receiveShadow = true;
  // Bovenvlak met het bedrukte ontwerp.
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(COASTER_RADIUS, 48),
    new THREE.MeshStandardMaterial({ map: createCoasterTexture(variant), roughness: 0.85 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0032;
  top.receiveShadow = true;
  group.add(basis, top);
  group.userData['coaster'] = true;
  return group;
}

/** Geef de resources van een viltje-group vrij. */
export function disposeCoaster(group: THREE.Group): void {
  disposeGroup(group);
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      m.dispose();
    }
  });
}
