/**
 * src/render/table.ts
 * Parametrische speeltafel: rond blad met rand en poten. Elke omgeving levert
 * zijn eigen materialen (procedureel hout/vilt) en kiest een rand-/pootstijl.
 * Geen externe assets; alleen geometrie + door de omgeving gegeven materialen.
 */

import * as THREE from 'three';

export type TafelPootStijl = 'centraleVoet' | 'vierPoten';
export type TafelRandStijl = 'hout' | 'gestoffeerd' | 'geen';

export interface TableOptions {
  /** Straal van het speelvlak. */
  radius: number;
  /** Y-hoogte van het tafeloppervlak. */
  surfaceY: number;
  /** Materiaal van het blad (vilt, hout, ...). */
  topMaterial: THREE.Material;
  /** Materiaal van de rand; default donker hout. */
  rimMaterial?: THREE.Material;
  /** Materiaal van de poten; default zeer donker hout. */
  legMaterial?: THREE.Material;
  legStyle?: TafelPootStijl;
  rimStyle?: TafelRandStijl;
}

export interface TableBuild {
  group: THREE.Group;
  /** Ruimt geometrieën en intern aangemaakte default-materialen op. */
  dispose(): void;
}

const BLAD_DIKTE = 0.06;

/** Bouw een tafel (blad + rand + poten) als THREE.Group rond de oorsprong. */
export function createTable(options: TableOptions): TableBuild {
  const { radius, surfaceY, topMaterial } = options;
  const legStyle = options.legStyle ?? 'centraleVoet';
  const rimStyle = options.rimStyle ?? 'hout';

  const eigenMaterialen: THREE.Material[] = [];
  const eigenMateriaal = (kleur: number, roughness: number): THREE.Material => {
    const m = new THREE.MeshStandardMaterial({ color: kleur, roughness, metalness: 0.05 });
    eigenMaterialen.push(m);
    return m;
  };

  const rimMaterial = options.rimMaterial ?? eigenMateriaal(0x3a2616, 0.5);
  const legMaterial = options.legMaterial ?? eigenMateriaal(0x241708, 0.6);

  const group = new THREE.Group();
  group.name = 'tafel';

  // --- blad ---
  const blad = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.985, BLAD_DIKTE, 64),
    topMaterial,
  );
  blad.position.y = surfaceY - BLAD_DIKTE / 2;
  blad.castShadow = true;
  blad.receiveShadow = true;
  blad.name = 'tafelblad';
  group.add(blad);

  // --- rand ---
  if (rimStyle !== 'geen') {
    const gestoffeerd = rimStyle === 'gestoffeerd';
    const buis = gestoffeerd ? 0.065 : 0.04;
    const rand = new THREE.Mesh(
      new THREE.TorusGeometry(radius + (gestoffeerd ? 0.03 : 0.012), buis, 20, 96),
      rimMaterial,
    );
    rand.rotation.x = Math.PI / 2;
    // Gestoffeerde rand komt iets bóven het vlak uit (zoals een pokertafel).
    rand.position.y = gestoffeerd ? surfaceY + 0.004 : surfaceY - 0.024;
    rand.castShadow = true;
    rand.receiveShadow = true;
    rand.name = 'tafelrand';
    group.add(rand);
  }

  // --- poten ---
  const pootHoogte = surfaceY - BLAD_DIKTE;
  if (legStyle === 'centraleVoet') {
    const kolom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, pootHoogte, 24),
      legMaterial,
    );
    kolom.position.y = pootHoogte / 2;
    kolom.castShadow = true;
    group.add(kolom);

    const voet = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.4, radius * 0.46, 0.05, 40),
      legMaterial,
    );
    voet.position.y = 0.025;
    voet.castShadow = true;
    voet.receiveShadow = true;
    group.add(voet);
  } else {
    const pootGeo = new THREE.BoxGeometry(0.07, pootHoogte, 0.07);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const poot = new THREE.Mesh(pootGeo, legMaterial);
      poot.position.set(Math.cos(a) * radius * 0.74, pootHoogte / 2, Math.sin(a) * radius * 0.74);
      poot.castShadow = true;
      group.add(poot);
    }
    // Dwarsregels voor een huiselijke keukentafel-look.
    const regelGeo = new THREE.BoxGeometry(radius * 1.04, 0.05, 0.05);
    for (const hoek of [0, Math.PI / 2]) {
      const regel = new THREE.Mesh(regelGeo, legMaterial);
      regel.rotation.y = hoek + Math.PI / 4;
      regel.position.y = pootHoogte * 0.22;
      regel.castShadow = true;
      group.add(regel);
    }
  }

  const dispose = (): void => {
    const geos = new Set<THREE.BufferGeometry>();
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) geos.add((obj as THREE.Mesh).geometry);
    });
    for (const g of geos) g.dispose();
    for (const m of eigenMaterialen) m.dispose();
  };

  return { group, dispose };
}
