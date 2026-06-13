/**
 * src/render/environments.ts
 * De drie omgevingen: bruin café (warm lamplicht, houten tafel), keukentafel
 * (daglicht, eikenblad), casino (groen vilt, spots, donkere sfeer).
 * Alles procedureel: hout-/viltstructuren via canvas-noise, geen assets.
 */

import * as THREE from 'three';
import type { Environment, EnvironmentId } from './types.ts';
import { createTable } from './table.ts';

// ---------------------------------------------------------------------------
// Canvas-helpers (procedurele textures)
// ---------------------------------------------------------------------------

function maakCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D-canvascontext niet beschikbaar');
  return { canvas, ctx };
}

/** Fijne pixelruis over het hele canvas (sterkte = max afwijking per kanaal). */
function voegRuisToe(ctx: CanvasRenderingContext2D, w: number, h: number, sterkte: number): void {
  const beeld = ctx.getImageData(0, 0, w, h);
  const d = beeld.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * sterkte;
    d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n));
  }
  ctx.putImageData(beeld, 0, 0);
}

interface TextureOpties {
  herhaal?: [number, number];
}

function naarTexture(canvas: HTMLCanvasElement, opties?: TextureOpties): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (opties?.herhaal) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opties.herhaal[0], opties.herhaal[1]);
  }
  return tex;
}

interface HoutOpties {
  licht: string;
  donker: string;
  /** rgba-prefix van de nerfkleur, bijv. 'rgba(20,10,5,'. */
  nerf: string;
  knoesten?: number;
  formaat?: number;
}

/** Procedurele houtnerf: gradient + golvende nerflijnen + knoesten + ruis. */
function maakHoutTexture(opties: HoutOpties): THREE.CanvasTexture {
  const s = opties.formaat ?? 1024;
  const { canvas, ctx } = maakCanvas(s, s);

  const grad = ctx.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, opties.licht);
  grad.addColorStop(0.5, opties.donker);
  grad.addColorStop(1, opties.licht);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);

  // Nerflijnen (horizontaal, licht golvend).
  for (let i = 0; i < 150; i++) {
    const y0 = Math.random() * s;
    const amp = 2 + Math.random() * 7;
    const freq = 1.5 + Math.random() * 5;
    const fase = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    for (let x = 0; x <= s; x += 16) {
      ctx.lineTo(x, y0 + Math.sin((x / s) * Math.PI * freq + fase) * amp);
    }
    ctx.strokeStyle = `${opties.nerf}${(0.04 + Math.random() * 0.1).toFixed(3)})`;
    ctx.lineWidth = 0.5 + Math.random() * 2.5;
    ctx.stroke();
  }

  // Knoesten.
  const knoesten = opties.knoesten ?? 4;
  for (let i = 0; i < knoesten; i++) {
    const kx = Math.random() * s;
    const ky = Math.random() * s;
    const r = 14 + Math.random() * 30;
    const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, r);
    kg.addColorStop(0, `${opties.nerf}0.5)`);
    kg.addColorStop(0.4, `${opties.nerf}0.22)`);
    kg.addColorStop(1, `${opties.nerf}0)`);
    ctx.fillStyle = kg;
    ctx.save();
    ctx.translate(kx, ky);
    ctx.scale(1, 0.45 + Math.random() * 0.3);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  voegRuisToe(ctx, s, s, 10);
  return naarTexture(canvas);
}

/** Plankenvloer (donker of licht), herhaalbaar. */
function maakPlankenVloer(licht: string, donker: string, voeg: string): THREE.CanvasTexture {
  const s = 1024;
  const { canvas, ctx } = maakCanvas(s, s);
  const planken = 8;
  const ph = s / planken;
  for (let p = 0; p < planken; p++) {
    const t = Math.random();
    const grad = ctx.createLinearGradient(0, p * ph, 0, (p + 1) * ph);
    grad.addColorStop(0, t < 0.5 ? licht : donker);
    grad.addColorStop(1, t < 0.5 ? donker : licht);
    ctx.fillStyle = grad;
    ctx.fillRect(0, p * ph, s, ph);
    // Nerf per plank.
    for (let i = 0; i < 26; i++) {
      const y0 = p * ph + Math.random() * ph;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      const amp = 1 + Math.random() * 3;
      const fase = Math.random() * Math.PI * 2;
      for (let x = 0; x <= s; x += 32) {
        ctx.lineTo(x, y0 + Math.sin((x / s) * Math.PI * 4 + fase) * amp);
      }
      ctx.strokeStyle = `rgba(0,0,0,${(0.05 + Math.random() * 0.1).toFixed(3)})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.5;
      ctx.stroke();
    }
    // Voegen + kopse naden.
    ctx.fillStyle = voeg;
    ctx.fillRect(0, p * ph - 1.5, s, 3);
    const naad = Math.random() * s;
    ctx.fillRect(naad, p * ph, 3, ph);
  }
  voegRuisToe(ctx, s, s, 12);
  return naarTexture(canvas, { herhaal: [3, 3] });
}

/** Groen casinovilt: vlakke kleur met fijne stofruis en donkere vignettering. */
function maakViltTexture(basis: string): THREE.CanvasTexture {
  const s = 1024;
  const { canvas, ctx } = maakCanvas(s, s);
  ctx.fillStyle = basis;
  ctx.fillRect(0, 0, s, s);
  voegRuisToe(ctx, s, s, 22);
  // Tweede, grovere stofstructuur: korte streepjes.
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.025)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1);
  }
  // Vignet zodat de tafelrand donkerder oogt.
  const vg = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, s, s);
  return naarTexture(canvas);
}

/** Lichte keukentegels, herhaalbaar. */
function maakTegelVloer(): THREE.CanvasTexture {
  const s = 1024;
  const { canvas, ctx } = maakCanvas(s, s);
  const n = 4;
  const ts = s / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const tint = 226 + Math.floor(Math.random() * 16);
      ctx.fillStyle = `rgb(${tint},${tint - 4},${tint - 14})`;
      ctx.fillRect(i * ts, j * ts, ts, ts);
      // Subtiele marmering.
      for (let k = 0; k < 7; k++) {
        ctx.strokeStyle = 'rgba(150,140,120,0.08)';
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.moveTo(i * ts + Math.random() * ts, j * ts + Math.random() * ts);
        ctx.quadraticCurveTo(
          i * ts + Math.random() * ts, j * ts + Math.random() * ts,
          i * ts + Math.random() * ts, j * ts + Math.random() * ts,
        );
        ctx.stroke();
      }
    }
  }
  // Voegen.
  ctx.strokeStyle = 'rgba(120,112,98,0.9)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * ts, 0); ctx.lineTo(i * ts, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * ts); ctx.lineTo(s, i * ts); ctx.stroke();
  }
  voegRuisToe(ctx, s, s, 8);
  return naarTexture(canvas, { herhaal: [5, 5] });
}

/** Donkerrood casinotapijt met goudkleurig ruitpatroon, herhaalbaar. */
function maakTapijtTexture(): THREE.CanvasTexture {
  const s = 512;
  const { canvas, ctx } = maakCanvas(s, s);
  ctx.fillStyle = '#34090f';
  ctx.fillRect(0, 0, s, s);
  voegRuisToe(ctx, s, s, 26);
  ctx.strokeStyle = 'rgba(212,175,55,0.10)';
  ctx.lineWidth = 2;
  const stap = s / 4;
  for (let i = -4; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * stap, 0); ctx.lineTo(i * stap + s, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * stap, 0); ctx.lineTo(i * stap - s, s); ctx.stroke();
  }
  // Gouden stipjes op de kruispunten.
  ctx.fillStyle = 'rgba(212,175,55,0.20)';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.arc(i * stap + stap / 2, j * stap + stap / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return naarTexture(canvas, { herhaal: [6, 6] });
}

/** Café-achtergrond: schemerige wand met flessenplanken en barcontour als silhouet. */
function maakCafeAchtergrond(): THREE.CanvasTexture {
  const w = 2048;
  const h = 512;
  const { canvas, ctx } = maakCanvas(w, h);

  // Donkere, warm-bruine waas met lichtere zweem in het midden.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0c0703');
  grad.addColorStop(0.45, '#1d120a');
  grad.addColorStop(1, '#0a0502');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Vage warme lichtplekken (alsof er ergens lampjes branden).
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) * (w / 6) + (Math.random() - 0.5) * 120;
    const y = h * (0.25 + Math.random() * 0.2);
    const g = ctx.createRadialGradient(x, y, 4, x, y, 150);
    g.addColorStop(0, 'rgba(255,170,90,0.10)');
    g.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 160, y - 160, 320, 320);
  }

  // Flessenplanken (twee rijen silhouetten).
  for (const plankY of [h * 0.32, h * 0.52]) {
    ctx.fillStyle = 'rgba(60,38,20,0.55)';
    ctx.fillRect(0, plankY + 50, w, 7); // de plank zelf
    let x = 20 + Math.random() * 30;
    while (x < w - 40) {
      const bw = 13 + Math.random() * 12;
      const bh = 38 + Math.random() * 26;
      const tint = Math.random();
      ctx.fillStyle = tint < 0.3
        ? 'rgba(120,70,30,0.30)'
        : tint < 0.6
          ? 'rgba(70,90,50,0.26)'
          : 'rgba(40,28,18,0.4)';
      // Fleslichaam + hals.
      ctx.beginPath();
      ctx.moveTo(x, plankY + 50);
      ctx.lineTo(x, plankY + 50 - bh * 0.62);
      ctx.quadraticCurveTo(x, plankY + 50 - bh * 0.78, x + bw * 0.36, plankY + 50 - bh * 0.82);
      ctx.lineTo(x + bw * 0.36, plankY + 50 - bh);
      ctx.lineTo(x + bw * 0.64, plankY + 50 - bh);
      ctx.lineTo(x + bw * 0.64, plankY + 50 - bh * 0.82);
      ctx.quadraticCurveTo(x + bw, plankY + 50 - bh * 0.78, x + bw, plankY + 50 - bh * 0.62);
      ctx.lineTo(x + bw, plankY + 50);
      ctx.closePath();
      ctx.fill();
      // Heel af en toe een glimlichtje op een fles.
      if (Math.random() < 0.25) {
        ctx.fillStyle = 'rgba(255,200,120,0.12)';
        ctx.fillRect(x + bw * 0.25, plankY + 50 - bh * 0.55, 2, bh * 0.3);
      }
      x += bw + 6 + Math.random() * 20;
    }
  }

  // Barcontour onderaan: toog met lichte bovenrand.
  ctx.fillStyle = 'rgba(30,18,9,0.92)';
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.fillStyle = 'rgba(160,110,55,0.30)';
  ctx.fillRect(0, h * 0.72, w, 5);
  // Barkrukken-silhouetten.
  for (let i = 0; i < 9; i++) {
    const x = (i + 0.5) * (w / 9) + (Math.random() - 0.5) * 60;
    ctx.fillStyle = 'rgba(8,4,2,0.85)';
    ctx.fillRect(x - 18, h * 0.78, 36, 8);
    ctx.fillRect(x - 3, h * 0.78, 6, h * 0.2);
  }

  // Donkere staanders die de wand ritmeren.
  ctx.fillStyle = 'rgba(5,3,2,0.55)';
  for (let x = 0; x < w; x += 512) ctx.fillRect(x, 0, 14, h);

  voegRuisToe(ctx, w, h, 9);
  return naarTexture(canvas);
}

/** Helder keukenraam met kozijn en zachte lucht erachter. */
function maakRaamTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 640;
  const { canvas, ctx } = maakCanvas(w, h);
  // Kozijn.
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(0, 0, w, h);
  // Lucht per ruit.
  const rand = 30;
  const midden = 14;
  const rw = (w - rand * 2 - midden) / 2;
  const rh = (h - rand * 2 - midden) / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = rand + i * (rw + midden);
      const y = rand + j * (rh + midden);
      const g = ctx.createLinearGradient(0, y, 0, y + rh);
      g.addColorStop(0, '#fdfdf5');
      g.addColorStop(0.6, '#dceaf2');
      g.addColorStop(1, '#c3d9e8');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, rw, rh);
      // Zonnewaas linksboven.
      const zon = ctx.createRadialGradient(x + rw * 0.3, y + rh * 0.25, 4, x + rw * 0.3, y + rh * 0.25, rw * 0.6);
      zon.addColorStop(0, 'rgba(255,250,225,0.85)');
      zon.addColorStop(1, 'rgba(255,250,225,0)');
      ctx.fillStyle = zon;
      ctx.fillRect(x, y, rw, rh);
    }
  }
  return naarTexture(canvas);
}

// ---------------------------------------------------------------------------
// Gedeelde opbouw-hulpjes
// ---------------------------------------------------------------------------

/** Geef alle geometrieën, materialen en textures binnen een groep vrij. */
function ruimGroepOp(groep: THREE.Group): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  groep.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      geos.add(mesh.geometry);
      const lijst = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of lijst) mats.add(m);
    }
    const licht = obj as THREE.Light & { shadow?: THREE.LightShadow };
    if (licht.isLight && licht.shadow) licht.shadow.dispose();
  });
  for (const g of geos) g.dispose();
  for (const m of mats) {
    const rec = m as unknown as Record<string, { dispose?: () => void } | null | undefined>;
    for (const sleutel of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'emissiveMap', 'aoMap']) {
      rec[sleutel]?.dispose?.();
    }
    m.dispose();
  }
}

/** Voeg lichten toe aan de groep, inclusief eventuele targets van spots. */
function voegLichtenToe(groep: THREE.Group, lichten: THREE.Light[]): void {
  for (const licht of lichten) {
    groep.add(licht);
    const spot = licht as THREE.SpotLight;
    if ((spot as Partial<THREE.SpotLight>).isSpotLight && spot.target) groep.add(spot.target);
    const dir = licht as THREE.DirectionalLight;
    if ((dir as Partial<THREE.DirectionalLight>).isDirectionalLight && dir.target) groep.add(dir.target);
  }
}

function maakVloer(texture: THREE.Texture, roughness: number): THREE.Mesh {
  const vloer = new THREE.Mesh(
    new THREE.CircleGeometry(8, 48),
    new THREE.MeshStandardMaterial({ map: texture, roughness, metalness: 0 }),
  );
  vloer.rotation.x = -Math.PI / 2;
  vloer.receiveShadow = true;
  vloer.name = 'vloer';
  return vloer;
}

/** Hanglamp-armatuur: snoer + kap + gloeiende peer. Het licht zelf komt apart. */
function maakHanglamp(x: number, y: number, z: number, kapKleur: number, kapStraal: number): THREE.Group {
  const lamp = new THREE.Group();
  lamp.name = 'hanglamp';

  const snoer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 3.4 - y, 8),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
  );
  snoer.position.set(x, y + (3.4 - y) / 2, z);
  lamp.add(snoer);

  const kap = new THREE.Mesh(
    new THREE.ConeGeometry(kapStraal, kapStraal * 0.85, 28, 1, true),
    new THREE.MeshStandardMaterial({
      color: kapKleur,
      roughness: 0.45,
      metalness: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  kap.position.set(x, y + kapStraal * 0.3, z);
  lamp.add(kap);

  const peer = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  );
  peer.position.set(x, y, z);
  lamp.add(peer);

  return lamp;
}

/**
 * Zachte, schaduwloze spot op de eigen-hand-zone (stoel 0, aan de +Z-kant van
 * de tafel). Elke omgeving voegt deze toe zodat de eigen kaarten ook in
 * donkere sferen (café, casino) altijd goed leesbaar blijven, zonder harde
 * schaduwen of een aangetaste sfeer.
 */
function maakHandLicht(
  tableSurfaceY: number,
  tableRadius: number,
  kleur: number,
  intensiteit: number,
): THREE.SpotLight {
  const licht = new THREE.SpotLight(kleur, intensiteit, 4.5, 0.62, 0.9, 1.7);
  licht.position.set(0, tableSurfaceY + 1.05, tableRadius + 0.7);
  licht.target.position.set(0, tableSurfaceY + 0.18, tableRadius * 1.03);
  licht.castShadow = false;
  licht.name = 'handlicht';
  licht.userData['omgevingslicht'] = true;
  return licht;
}

function stelSchaduwIn(licht: THREE.SpotLight | THREE.DirectionalLight, formaat = 1024): void {
  licht.castShadow = true;
  licht.shadow.mapSize.set(formaat, formaat);
  licht.shadow.bias = -0.0004;
  // normalBias voorkomt "peter-panning": de lichte spleet tussen een kaart en
  // zijn eigen slagschaduw waar de gebruiker over klaagde.
  licht.shadow.normalBias = 0.02;
  licht.shadow.radius = 5;
  if ((licht as THREE.SpotLight).isSpotLight) {
    licht.shadow.camera.near = 0.4;
    licht.shadow.camera.far = 6;
  }
}

// ---------------------------------------------------------------------------
// Café
// ---------------------------------------------------------------------------

export function createCafeEnvironment(): Environment {
  const tableSurfaceY = 0.92;
  const tableRadius = 1.15;

  const maakTafelMateriaal = (): THREE.Material =>
    new THREE.MeshStandardMaterial({
      map: maakHoutTexture({ licht: '#4a2f1c', donker: '#2c1a0e', nerf: 'rgba(16,8,4,', knoesten: 5 }),
      roughness: 0.5,
      metalness: 0.06,
    });

  const maakLichten = (): THREE.Light[] => {
    const lichten: THREE.Light[] = [];

    const hemel = new THREE.HemisphereLight(0x6a4c30, 0x1c0f08, 0.95);
    hemel.userData['omgevingslicht'] = true;
    lichten.push(hemel);

    // Warme basisvulling zodat de hele kroeg uit het pikkedonker komt.
    const omgeving = new THREE.AmbientLight(0xffd9a8, 0.32);
    omgeving.userData['omgevingslicht'] = true;
    lichten.push(omgeving);

    for (const dx of [-0.55, 0.55]) {
      const spot = new THREE.SpotLight(0xffb56b, 34, 7, 0.62, 0.55, 1.8);
      spot.position.set(dx, tableSurfaceY + 1.02, 0);
      spot.target.position.set(dx * 0.35, tableSurfaceY, 0);
      stelSchaduwIn(spot);
      lichten.push(spot);
    }

    // Warm strooilicht vanaf de bar achterin.
    const bar = new THREE.PointLight(0xff9a4d, 4, 7, 2);
    bar.position.set(0, 1.7, -3.6);
    bar.userData['omgevingslicht'] = true;
    lichten.push(bar);

    // Subtiel warm leeslicht op de eigen hand.
    lichten.push(maakHandLicht(tableSurfaceY, tableRadius, 0xffcf9a, 14));

    return lichten;
  };

  return {
    id: 'cafe',
    naam: 'Bruin café',
    omschrijving: 'Schemerig kroegje: donker hout, warme hanglampen en vage flessenplanken.',
    tableSurfaceY,
    tableRadius,
    createLights: maakLichten,
    createTableMaterial: maakTafelMateriaal,

    async setup(scene: THREE.Scene): Promise<() => void> {
      scene.background = new THREE.Color(0x0d0805);
      scene.fog = new THREE.FogExp2(0x0d0805, 0.15);

      const groep = new THREE.Group();
      groep.name = 'omgeving-cafe';

      // Tafel: donker hout op centrale voet.
      const tafel = createTable({
        radius: tableRadius,
        surfaceY: tableSurfaceY,
        topMaterial: maakTafelMateriaal(),
        rimMaterial: new THREE.MeshStandardMaterial({ color: 0x241408, roughness: 0.45, metalness: 0.08 }),
        legMaterial: new THREE.MeshStandardMaterial({ color: 0x1b0f06, roughness: 0.6 }),
        legStyle: 'centraleVoet',
        rimStyle: 'hout',
      });
      groep.add(tafel.group);

      // Donkere plankenvloer.
      groep.add(maakVloer(maakPlankenVloer('#3a2415', '#2a1809', 'rgba(8,4,2,0.9)'), 0.85));

      // Mistige achtergrond met barcontouren als silhouet.
      const wand = new THREE.Mesh(
        new THREE.CylinderGeometry(5.6, 5.6, 4.2, 48, 1, true),
        new THREE.MeshBasicMaterial({ map: maakCafeAchtergrond(), side: THREE.BackSide }),
      );
      wand.position.y = 2.1;
      groep.add(wand);

      // Hanglampen (armaturen) boven de spots.
      for (const dx of [-0.55, 0.55]) {
        groep.add(maakHanglamp(dx, tableSurfaceY + 1.02, 0, 0x2c1d10, 0.16));
      }

      voegLichtenToe(groep, maakLichten());
      scene.add(groep);

      return () => {
        scene.remove(groep);
        scene.fog = null;
        scene.background = null;
        ruimGroepOp(groep);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Keukentafel
// ---------------------------------------------------------------------------

export function createKeukentafelEnvironment(): Environment {
  const tableSurfaceY = 0.92;
  const tableRadius = 1.15;

  const maakTafelMateriaal = (): THREE.Material =>
    new THREE.MeshStandardMaterial({
      map: maakHoutTexture({ licht: '#dcbd8e', donker: '#c4a06a', nerf: 'rgba(120,88,48,', knoesten: 3 }),
      roughness: 0.6,
      metalness: 0.02,
    });

  const maakLichten = (): THREE.Light[] => {
    const lichten: THREE.Light[] = [];

    // Daglicht vanuit de raamrichting (koel-warm gemengd).
    const dag = new THREE.DirectionalLight(0xfff1dc, 2.6);
    dag.position.set(3.2, 2.8, -1.1);
    dag.target.position.set(0, tableSurfaceY, 0);
    stelSchaduwIn(dag, 2048);
    dag.shadow.camera.left = -2.4;
    dag.shadow.camera.right = 2.4;
    dag.shadow.camera.top = 2.4;
    dag.shadow.camera.bottom = -2.4;
    dag.shadow.camera.near = 0.5;
    dag.shadow.camera.far = 9;
    lichten.push(dag);

    const hemel = new THREE.HemisphereLight(0xcfe0ee, 0x9a8b74, 0.85);
    hemel.userData['omgevingslicht'] = true;
    lichten.push(hemel);

    // Zachte warme invulling vanaf de andere kant van de keuken.
    const vul = new THREE.PointLight(0xffe6c0, 2.2, 9, 2);
    vul.position.set(-2.2, 2.3, 2.0);
    vul.userData['omgevingslicht'] = true;
    lichten.push(vul);

    // Licht leeslicht op de eigen hand (de keuken is al helder; mild houden).
    lichten.push(maakHandLicht(tableSurfaceY, tableRadius, 0xfff4e0, 6));

    return lichten;
  };

  return {
    id: 'keukentafel',
    naam: 'Keukentafel',
    omschrijving: 'Huiselijk en helder: licht eiken blad en daglicht door het raam.',
    tableSurfaceY,
    tableRadius,
    createLights: maakLichten,
    createTableMaterial: maakTafelMateriaal,

    async setup(scene: THREE.Scene): Promise<() => void> {
      scene.background = new THREE.Color(0xe7e0d0);
      scene.fog = new THREE.Fog(0xe7e0d0, 7, 14);

      const groep = new THREE.Group();
      groep.name = 'omgeving-keukentafel';

      // Tafel: licht eiken met vier poten.
      const tafel = createTable({
        radius: tableRadius,
        surfaceY: tableSurfaceY,
        topMaterial: maakTafelMateriaal(),
        rimMaterial: new THREE.MeshStandardMaterial({ color: 0xb98f5c, roughness: 0.55 }),
        legMaterial: new THREE.MeshStandardMaterial({ color: 0xa8824f, roughness: 0.6 }),
        legStyle: 'vierPoten',
        rimStyle: 'hout',
      });
      groep.add(tafel.group);

      // Lichte tegelvloer.
      groep.add(maakVloer(maakTegelVloer(), 0.7));

      // Raam aan de daglichtkant (zelfde richting als de DirectionalLight).
      const raam = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.9),
        new THREE.MeshBasicMaterial({ map: maakRaamTexture() }),
      );
      raam.position.set(3.6, 1.9, -1.2);
      raam.lookAt(0, 1.3, 0.4);
      groep.add(raam);

      // Vensterbank eronder.
      const bank = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.05, 0.16),
        new THREE.MeshStandardMaterial({ color: 0xefe9dc, roughness: 0.8 }),
      );
      bank.position.copy(raam.position);
      bank.position.y -= 1.0;
      bank.rotation.y = raam.rotation.y;
      groep.add(bank);

      voegLichtenToe(groep, maakLichten());
      scene.add(groep);

      return () => {
        scene.remove(groep);
        scene.fog = null;
        scene.background = null;
        ruimGroepOp(groep);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Casino
// ---------------------------------------------------------------------------

export function createCasinoEnvironment(): Environment {
  const tableSurfaceY = 0.92;
  const tableRadius = 1.15;

  const maakTafelMateriaal = (): THREE.Material =>
    new THREE.MeshStandardMaterial({
      map: maakViltTexture('#155433'),
      roughness: 0.95,
      metalness: 0,
    });

  const maakLichten = (): THREE.Light[] => {
    const lichten: THREE.Light[] = [];

    // Laaghangende, felle tafellamp recht boven het midden.
    const spot = new THREE.SpotLight(0xffe2b0, 72, 7.5, 0.82, 0.45, 1.9);
    spot.position.set(0, tableSurfaceY + 0.98, 0);
    spot.target.position.set(0, tableSurfaceY, 0);
    stelSchaduwIn(spot, 2048);
    lichten.push(spot);

    // Gedempt omgevingslicht: het donker hoort erbij, maar de tafel en
    // de eigen kaarten moeten leesbaar blijven (en met de slider verder oplichten).
    const hemel = new THREE.HemisphereLight(0x33485e, 0x0a0f16, 0.55);
    hemel.userData['omgevingslicht'] = true;
    lichten.push(hemel);

    const omgeving = new THREE.AmbientLight(0x3a4a60, 0.3);
    omgeving.userData['omgevingslicht'] = true;
    lichten.push(omgeving);

    // Gouden accentlichtjes in de verte.
    const goud1 = new THREE.PointLight(0xd4af37, 3, 6, 2);
    goud1.position.set(2.4, 1.2, -1.8);
    goud1.userData['omgevingslicht'] = true;
    lichten.push(goud1);
    const goud2 = new THREE.PointLight(0xd4af37, 2.2, 6, 2);
    goud2.position.set(-2.6, 1.0, 1.6);
    goud2.userData['omgevingslicht'] = true;
    lichten.push(goud2);

    // Subtiel warm leeslicht op de eigen hand (de centrale spot reikt daar niet).
    lichten.push(maakHandLicht(tableSurfaceY, tableRadius, 0xffe7c0, 16));

    return lichten;
  };

  return {
    id: 'casino',
    naam: 'Casino',
    omschrijving: 'Groen vilt onder één felle lamp, gouden accenten in het donker.',
    tableSurfaceY,
    tableRadius,
    createLights: maakLichten,
    createTableMaterial: maakTafelMateriaal,

    async setup(scene: THREE.Scene): Promise<() => void> {
      scene.background = new THREE.Color(0x04060a);
      scene.fog = new THREE.FogExp2(0x04060a, 0.19);

      const groep = new THREE.Group();
      groep.name = 'omgeving-casino';

      // Pokertafel: vilt, gestoffeerde lederen rand, donkere voet.
      const tafel = createTable({
        radius: tableRadius,
        surfaceY: tableSurfaceY,
        topMaterial: maakTafelMateriaal(),
        rimMaterial: new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.55, metalness: 0.05 }),
        legMaterial: new THREE.MeshStandardMaterial({ color: 0x120a06, roughness: 0.5 }),
        legStyle: 'centraleVoet',
        rimStyle: 'gestoffeerd',
      });
      groep.add(tafel.group);

      // Gouden sierring tussen vilt en rand.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(tableRadius - 0.02, 0.011, 12, 96),
        new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.25 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = tableSurfaceY + 0.004;
      groep.add(ring);

      // Donkerrood tapijt.
      groep.add(maakVloer(maakTapijtTexture(), 0.95));

      // Lamp-armatuur (brede groene kap) boven de tafel.
      groep.add(maakHanglamp(0, tableSurfaceY + 0.98, 0, 0x0c3320, 0.42));

      // Gouden afzetpaaltjes met koord-suggestie rond de tafel.
      const paalMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.95, roughness: 0.3 });
      const paalGeo = new THREE.CylinderGeometry(0.025, 0.035, 1.0, 12);
      const bolGeo = new THREE.SphereGeometry(0.045, 16, 12);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const paal = new THREE.Mesh(paalGeo, paalMat);
        paal.position.set(Math.cos(a) * 3.1, 0.5, Math.sin(a) * 3.1);
        paal.castShadow = true;
        groep.add(paal);
        const bol = new THREE.Mesh(bolGeo, paalMat);
        bol.position.set(Math.cos(a) * 3.1, 1.02, Math.sin(a) * 3.1);
        groep.add(bol);
      }

      voegLichtenToe(groep, maakLichten());
      scene.add(groep);

      return () => {
        scene.remove(groep);
        scene.fog = null;
        scene.background = null;
        ruimGroepOp(groep);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

const FABRIEKEN: Record<EnvironmentId, () => Environment> = {
  cafe: createCafeEnvironment,
  keukentafel: createKeukentafelEnvironment,
  casino: createCasinoEnvironment,
};

/** Register: id -> verse omgeving-instantie. */
export function getEnvironment(id: EnvironmentId): Environment {
  const fabriek = FABRIEKEN[id];
  if (!fabriek) throw new Error(`Onbekende omgeving: ${id}`);
  return fabriek();
}
