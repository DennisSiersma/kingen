/**
 * src/render/scene.ts
 * SceneManager-implementatie: Three.js-scene, camera (schuin op het tafelblad
 * met lichte muis-parallax), ACESFilmicToneMapping, schaduwen, resize-handling,
 * raycasting voor kaartkliks, render-loop en koppeling aan de GameEventBus.
 */

import * as THREE from 'three';
import type { Card, GameEvent, PublicGameView, Seat } from '@shared/core/types.ts';
import { createDeck, sortHand } from '@shared/core/deck.ts';
import type { GameEventBus } from '@shared/core/events.ts';
import { createCardRenderer } from './cards.ts';
import { getEnvironment } from './environments.ts';
import { createCardAnimator, createTableLayout } from './animations.ts';
import type { EnvironmentId, SceneManager, SceneRenderPlugin } from './types.ts';

/** Uitgebreid contract: main.ts kan de animatie-gate (afterEvent) hierop wachten. */
export interface KingenSceneManager extends SceneManager {
  /** Resolved zodra alle door GameEvents getriggerde animaties klaar zijn. */
  waitForIdle(): Promise<void>;
  /** Helderheid in procenten (50-160); schaalt de tone-mapping-exposure. */
  setBrightness(percent: number): void;
  /** Muis-parallax van de camera aan/uit (staat altijd stil tijdens kaartkeuze). */
  setCameraMotion(enabled: boolean): void;
  /** Zet de kijker-stoel (eigen hand onderaan); default 0. Voor online spelen. */
  setViewerSeat(seat: Seat): void;
  /** Herbouw de tafel direct uit een momentopname (reconnect). */
  toonSnapshot(view: PublicGameView): void;
  /** Spelersnamen voor de zwevende naamlabels boven de tegenstanders. */
  setSeatNames(names: string[]): void;
}

const wacht = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** Basis-exposure; de helderheidsinstelling is een factor hier bovenop. */
const BASIS_EXPOSURE = 1.15;
const HELDERHEID_KEY = 'kingen.brightness';
const CAMERA_KEY = 'kingen.cameraMotion';

const klemHelderheid = (pct: number): number => Math.min(160, Math.max(50, pct));

function leesHelderheid(): number {
  try {
    const v = Number(window.localStorage.getItem(HELDERHEID_KEY));
    if (Number.isFinite(v) && v > 0) return klemHelderheid(v);
  } catch {
    // localStorage kan geblokkeerd zijn; val terug op default.
  }
  return 100;
}

function leesCameraBeweging(): boolean {
  try {
    // Standaard UIT: een meebewegende camera maakt richten op kaarten lastig.
    return window.localStorage.getItem(CAMERA_KEY) === '1';
  } catch {
    return false;
  }
}

type DealEvent = Extract<GameEvent, { type: 'deal' }>;

/**
 * Maak de SceneManager. Bouwt renderer in `container` (#app), abonneert zich
 * op de bus voor deal/playCard/trickWon/... en stuurt de CardAnimator aan.
 */
export async function createSceneManager(
  container: HTMLElement,
  bus: GameEventBus,
  environment: EnvironmentId,
  /** Optionele per-spel render-plugin (afleg-trek/rummy); Kingen geeft er geen. */
  renderPlugin?: SceneRenderPlugin,
): Promise<KingenSceneManager> {
  // --- renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Neutral (Khronos PBR Neutral) i.p.v. ACES: ACES desatureert/wast felle
  // highlights uit, waardoor de kaarten onder de tafelspot kleurloos werden.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = BASIS_EXPOSURE * (leesHelderheid() / 100);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  // --- scene + omgeving ---
  const scene = new THREE.Scene();
  let env = getEnvironment(environment);
  let envDispose = await env.setup(scene);

  // --- kaarten, layout, animator ---
  const cardRenderer = createCardRenderer();
  const layout = createTableLayout(env.tableSurfaceY, env.tableRadius);
  const animator = createCardAnimator(scene, cardRenderer, layout, 4);
  // Welke stoel is "ik" (komt onderaan). Offline = 0; online = de eigen stoel.
  let viewerSeat: Seat = 0;

  // Helderheid (50-160%) regelt zowel de tonemapping-exposure als de
  // intensiteit van de omgevingslichten (gemarkeerd met userData.omgevingslicht).
  // Zo lichten donkere sferen als café en casino echt op i.p.v. alleen de
  // centrale spot. De basisintensiteit wordt per licht eenmalig onthouden.
  let huidigeHelderheid = leesHelderheid();
  const pasHelderheidToe = (): void => {
    const factor = klemHelderheid(huidigeHelderheid) / 100;
    renderer.toneMappingExposure = BASIS_EXPOSURE * factor;
    // Omgevingslichten extra meeschalen zodat de darks zichtbaar oplichten.
    const omgevingFactor = Math.pow(factor, 1.4);
    scene.traverse((obj) => {
      const licht = obj as THREE.Light;
      if (!(licht as Partial<THREE.Light>).isLight) return;
      if (!licht.userData['omgevingslicht']) return;
      if (licht.userData['basisIntensiteit'] === undefined) {
        licht.userData['basisIntensiteit'] = licht.intensity;
      }
      licht.intensity = (licht.userData['basisIntensiteit'] as number) * omgevingFactor;
    });
  };
  pasHelderheidToe();

  // --- camera: schuin op het tafelblad, achter stoel 0 ---
  const kijkDoel = new THREE.Vector3(0, env.tableSurfaceY + 0.02, -0.12);
  const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 60);
  const basisAfstand = 2.55;
  const basisElevatie = 0.58; // rad boven de horizon
  const basisAzimut = Math.PI / 2; // boven stoel 0 (+Z)

  // Lichte orbit/parallax met de muis, beperkt in bereik. Standaard UIT
  // (instelbaar via het HUD-menu) en altijd bevroren tijdens kaartkeuze.
  let cameraBeweging = leesCameraBeweging();
  let doelYaw = 0;
  let doelPitch = 0;
  let huidigeYaw = 0;
  let huidigePitch = 0;
  const MAX_YAW = 0.16;
  const MAX_PITCH = 0.07;

  const plaatsCamera = (): void => {
    const az = basisAzimut + huidigeYaw;
    const el = Math.min(0.85, Math.max(0.35, basisElevatie + huidigePitch));
    camera.position.set(
      kijkDoel.x + basisAfstand * Math.cos(el) * Math.cos(az),
      kijkDoel.y + basisAfstand * Math.sin(el),
      kijkDoel.z + basisAfstand * Math.cos(el) * Math.sin(az),
    );
    camera.lookAt(kijkDoel);
  };
  plaatsCamera();

  // --- naamlabels boven de tegenstanders (zien wie links/rechts zit) ---
  const labelLaag = document.createElement('div');
  labelLaag.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
  container.appendChild(labelLaag);
  const naamLabels = new Map<number, HTMLElement>();
  let spelerNamen: string[] = [];
  const labelVec = new THREE.Vector3();

  const herbouwLabels = (): void => {
    for (const elLabel of naamLabels.values()) elLabel.remove();
    naamLabels.clear();
    for (let seat = 0; seat < stoelen; seat++) {
      if (seat === viewerSeat) continue; // jezelf zit onderin, geen label nodig
      const tag = document.createElement('div');
      tag.className = 'kg-naamtag';
      tag.textContent = spelerNamen[seat] ?? '';
      labelLaag.appendChild(tag);
      naamLabels.set(seat, tag);
    }
  };

  const plaatsLabels = (): void => {
    if (naamLabels.size === 0) return;
    const b = labelLaag.clientWidth;
    const h = labelLaag.clientHeight;
    for (const [seat, tag] of naamLabels) {
      const a = layout.seatAngle(seat as Seat, stoelen);
      labelVec.set(Math.cos(a) * env.tableRadius * 1.04, env.tableSurfaceY + 0.42, Math.sin(a) * env.tableRadius * 1.04);
      labelVec.project(camera);
      if (labelVec.z > 1) {
        tag.style.opacity = '0';
        continue;
      }
      const x = (labelVec.x * 0.5 + 0.5) * b;
      const y = (-labelVec.y * 0.5 + 0.5) * h;
      tag.style.opacity = '1';
      tag.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  };

  // --- resize ---
  const herschaal = (): void => {
    const b = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(b, h);
    camera.aspect = b / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  herschaal();
  window.addEventListener('resize', herschaal);

  // --- raycasting: klikken & hoveren op de eigen hand ---
  const raycaster = new THREE.Raycaster();
  const muisNdc = new THREE.Vector2();
  const klikHandlers = new Set<(cardId: string) => void>();
  let speelbaar = new Set<string>();
  let hoverId: string | null = null;
  let drukX = 0;
  let drukY = 0;

  const vindKaartMesh = (obj: THREE.Object3D | null): THREE.Mesh | null => {
    let huidig = obj;
    while (huidig) {
      if (typeof huidig.userData['cardId'] === 'string') return huidig as THREE.Mesh;
      huidig = huidig.parent;
    }
    return null;
  };

  const raycastHand = (clientX: number, clientY: number): string | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    muisNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(muisNdc, camera);
    const treffers = raycaster.intersectObjects(animator.getHandMeshes(viewerSeat), true);
    for (const treffer of treffers) {
      const mesh = vindKaartMesh(treffer.object);
      if (mesh) return String(mesh.userData['cardId']);
    }
    return null;
  };

  const opPointerMove = (e: PointerEvent): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      doelYaw = Math.max(-1, Math.min(1, nx)) * MAX_YAW;
      doelPitch = Math.max(-1, Math.min(1, -ny)) * MAX_PITCH;
    }
    hoverId = raycastHand(e.clientX, e.clientY);
    renderer.domElement.style.cursor =
      hoverId !== null && speelbaar.has(hoverId) ? 'pointer' : 'default';
  };

  const opPointerDown = (e: PointerEvent): void => {
    drukX = e.clientX;
    drukY = e.clientY;
  };

  const opPointerUp = (e: PointerEvent): void => {
    // Alleen een echte klik (geen sleep) telt.
    if (Math.hypot(e.clientX - drukX, e.clientY - drukY) > 7) return;
    const id = raycastHand(e.clientX, e.clientY);
    if (id !== null && speelbaar.has(id)) {
      for (const handler of [...klikHandlers]) handler(id);
    }
  };

  renderer.domElement.addEventListener('pointermove', opPointerMove);
  renderer.domElement.addEventListener('pointerdown', opPointerDown);
  renderer.domElement.addEventListener('pointerup', opPointerUp);

  // --- dimmen van niet-speelbare kaarten (klonen, nooit gedeelde mats muteren) ---
  const dimOrigineel = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  const zetDim = (mesh: THREE.Mesh, dim: boolean): void => {
    const isGedimd = dimOrigineel.has(mesh);
    if (dim === isGedimd) return;
    if (dim) {
      dimOrigineel.set(mesh, mesh.material);
      const kloon = (m: THREE.Material): THREE.Material => {
        const k = m.clone();
        const kleur = (k as THREE.MeshStandardMaterial).color;
        if (kleur && (kleur as Partial<THREE.Color>).isColor) kleur.multiplyScalar(0.55);
        return k;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(kloon) : kloon(mesh.material);
    } else {
      const origineel = dimOrigineel.get(mesh);
      if (!origineel) return;
      const klonen = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = origineel;
      dimOrigineel.delete(mesh);
      for (const k of klonen) k.dispose();
    }
  };

  const herstelAlleDim = (): void => {
    for (const mesh of [...dimOrigineel.keys()]) zetDim(mesh, false);
  };

  // --- GameEvents: serieel verwerken zodat animaties elkaar netjes opvolgen ---
  let staart: Promise<void> = Promise.resolve();
  let stoelen = 4;
  let deler: Seat = 0;
  /** roundIndex waarvoor al gedeeld is (dubbelkingen: deal komt vóór roundStart). */
  let gedeeldVoorRonde = -1;

  /** Bouw per stoel een kaartenlijst voor de deal-animatie. Onbekende handen
   *  (tegenstanders) krijgen unieke placeholder-kaarten — ze liggen toch verdekt. */
  const bouwHanden = (ev: { hands: Partial<Record<Seat, Card[]>>; handSizes: Record<number, number> }): Card[][] => {
    const bekend = new Set<string>();
    for (let seat = 0; seat < stoelen; seat++) {
      const hand = ev.hands[seat as Seat];
      if (hand) for (const c of hand) bekend.add(c.id);
    }
    const voorraad = createDeck().filter((c) => !bekend.has(c.id));
    let p = 0;
    const resultaat: Card[][] = [];
    for (let seat = 0; seat < stoelen; seat++) {
      const echte = ev.hands[seat as Seat];
      if (echte) {
        resultaat.push(seat === viewerSeat ? sortHand(echte) : [...echte]);
        continue;
      }
      const grootte = ev.handSizes[seat] ?? 0;
      const placeholders: Card[] = [];
      for (let i = 0; i < grootte && voorraad.length > 0; i++) {
        const kaart = voorraad[p % voorraad.length];
        p++;
        if (kaart) placeholders.push(kaart);
      }
      resultaat.push(placeholders);
    }
    return resultaat;
  };

  const verwerkEvent = async (ev: GameEvent): Promise<void> => {
    // Per-spel render-plugin krijgt eerst de kans (afleg-trek/rummy-events);
    // geeft true terug = afgehandeld, dan slaat de default slag-render over.
    if (renderPlugin && (await renderPlugin.handleEvent(ev, animator))) return;
    switch (ev.type) {
      case 'gameStart':
        stoelen = ev.seatCount;
        animator.setSeatCount(stoelen);
        herstelAlleDim();
        animator.clearTable();
        gedeeldVoorRonde = -1;
        break;
      case 'roundStart':
        deler = ev.dealer;
        herstelAlleDim();
        // In dubbelkingen komt roundStart ná de deal (deler kiest eerst het
        // spel); de zojuist gedeelde handen dan niet van tafel vegen.
        if (ev.roundIndex !== gedeeldVoorRonde) animator.clearTable();
        break;
      case 'deal':
        deler = ev.dealer;
        gedeeldVoorRonde = ev.roundIndex;
        await animator.animateDeal(bouwHanden(ev), deler);
        break;
      case 'playCard':
        await animator.animatePlay(ev.card, ev.seat);
        await animator.animateArrangeHand(ev.seat);
        break;
      case 'trickWon':
        await wacht(550); // de complete slag even laten zien
        await animator.animateCollectTrick(ev.winner);
        break;
      default:
        break;
    }
  };

  const offBus = bus.onAny((ev) => {
    staart = staart
      .then(() => verwerkEvent(ev))
      .catch((fout) => {
        console.error('[render] animatiefout bij event', ev.type, fout);
      });
  });

  // --- render-loop ---
  const tik = (): void => {
    // Camera volgt de muis alleen als de toggle aanstaat én er geen kaartkeuze
    // loopt (speelbaar leeg): richten op een kaart moet altijd stabiel zijn.
    const volgMuis = cameraBeweging && speelbaar.size === 0;
    huidigeYaw += ((volgMuis ? doelYaw : 0) - huidigeYaw) * 0.06;
    huidigePitch += ((volgMuis ? doelPitch : 0) - huidigePitch) * 0.06;
    plaatsCamera();

    // Hover-lift van speelbare kaarten in de eigen hand.
    for (const mesh of animator.getHandMeshes(viewerSeat)) {
      if (mesh.userData['animating'] === true) continue;
      const basis = mesh.userData['basePosition'] as THREE.Vector3 | undefined;
      if (!basis) continue;
      const id = String(mesh.userData['cardId'] ?? '');
      const doel = hoverId === id && speelbaar.has(id) ? 1 : 0;
      const huidig = typeof mesh.userData['lift'] === 'number' ? (mesh.userData['lift'] as number) : 0;
      const lift = huidig + (doel - huidig) * 0.22;
      mesh.userData['lift'] = lift;
      mesh.position.set(basis.x, basis.y + 0.05 * lift, basis.z + 0.04 * lift);
    }

    plaatsLabels();
    renderer.render(scene, camera);
  };

  return {
    scene,
    camera,
    renderer,
    cardRenderer,
    animator,

    async setEnvironment(id: EnvironmentId): Promise<void> {
      if (id === env.id) return;
      envDispose();
      env = getEnvironment(id);
      envDispose = await env.setup(scene);
      layout.setDimensions(env.tableSurfaceY, env.tableRadius);
      kijkDoel.y = env.tableSurfaceY + 0.02;
      animator.relayout();
      // Nieuwe omgeving heeft eigen lichten: helderheid opnieuw toepassen.
      pasHelderheidToe();
    },

    onCardClicked(handler: (cardId: string) => void): () => void {
      klikHandlers.add(handler);
      return () => klikHandlers.delete(handler);
    },

    setPlayableCards(cardIds: string[]): void {
      speelbaar = new Set(cardIds);
      const handMeshes = animator.getHandMeshes(viewerSeat);
      const inHand = new Set<THREE.Mesh>(handMeshes);
      // Verlopen dim-administratie opruimen (kaarten die de hand verlieten).
      for (const mesh of [...dimOrigineel.keys()]) {
        if (!inHand.has(mesh)) zetDim(mesh, false);
      }
      for (const mesh of handMeshes) {
        const id = String(mesh.userData['cardId'] ?? '');
        zetDim(mesh, speelbaar.size > 0 && !speelbaar.has(id));
      }
    },

    waitForIdle(): Promise<void> {
      return staart;
    },

    setBrightness(percent: number): void {
      huidigeHelderheid = klemHelderheid(percent);
      pasHelderheidToe();
    },

    setCameraMotion(enabled: boolean): void {
      cameraBeweging = enabled;
    },

    setViewerSeat(seat: Seat): void {
      viewerSeat = seat;
      animator.setViewerSeat(seat);
      herbouwLabels();
    },

    setSeatNames(names: string[]): void {
      spelerNamen = names.slice();
      herbouwLabels();
    },

    toonSnapshot(view: PublicGameView): void {
      stoelen = view.seatCount;
      animator.setSeatCount(view.seatCount);
      const handen = bouwHanden({ hands: { [view.seat]: view.hand }, handSizes: view.handSizes });
      const trick = (view.currentTrick?.plays ?? []).map((p) => ({ seat: p.seat, card: p.card }));
      staart = staart.then(() => animator.toonSnapshot(handen, trick)).catch(() => {});
    },

    start(): void {
      renderer.setAnimationLoop(tik);
    },

    dispose(): void {
      renderer.setAnimationLoop(null);
      offBus();
      window.removeEventListener('resize', herschaal);
      renderer.domElement.removeEventListener('pointermove', opPointerMove);
      renderer.domElement.removeEventListener('pointerdown', opPointerDown);
      renderer.domElement.removeEventListener('pointerup', opPointerUp);
      herstelAlleDim();
      animator.cancelAll();
      animator.clearTable();
      envDispose();
      cardRenderer.dispose();
      labelLaag.remove();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
