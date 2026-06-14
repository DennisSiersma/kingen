/**
 * src/render/animations.ts
 * CardAnimator + TableLayout: vloeiende tween-animaties (delen, spelen,
 * slag innemen, hand herschikken) met easing; elke animatie is een Promise.
 * Bevat een lichte eigen tween-engine (requestAnimationFrame) — geen externe lib.
 */

import * as THREE from 'three';
import type { Card, Seat } from '@shared/core/types.ts';
import { snelheidsFactor } from '@shared/core/speed.ts';
import type { CardAnimator, CardRenderer, TableLayout } from './types.ts';

// ---------------------------------------------------------------------------
// Tween-engine
// ---------------------------------------------------------------------------

export type EaseFn = (t: number) => number;

export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: EaseFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeInQuad: EaseFn = (t) => t * t;

interface ActieveTween {
  start: number;
  vertraging: number;
  duur: number;
  ease: EaseFn;
  onUpdate(t: number): void;
  resolve(): void;
  klaar: boolean;
}

export interface TweenHandle {
  promise: Promise<void>;
  /** Stop direct; de promise resolved (geen reject) zodat awaits doorlopen. */
  cancel(): void;
}

const actieveTweens = new Set<ActieveTween>();
let rafHandle: number | null = null;

function rondAf(tw: ActieveTween): void {
  if (tw.klaar) return;
  tw.klaar = true;
  actieveTweens.delete(tw);
  tw.resolve();
}

function pomp(nu: number): void {
  for (const tw of [...actieveTweens]) {
    const verstreken = nu - tw.start - tw.vertraging;
    if (verstreken < 0) continue;
    const t = tw.duur <= 0 ? 1 : Math.min(1, verstreken / tw.duur);
    tw.onUpdate(tw.ease(t));
    if (t >= 1) rondAf(tw);
  }
  rafHandle = actieveTweens.size > 0 ? requestAnimationFrame(pomp) : null;
}

/** Start een tween; onUpdate krijgt de ge-easde voortgang (0..1). */
export function startTween(opties: {
  duur: number;
  vertraging?: number;
  ease?: EaseFn;
  onUpdate(t: number): void;
}): TweenHandle {
  let resolveFn!: () => void;
  const promise = new Promise<void>((res) => {
    resolveFn = res;
  });
  // Globale speelsnelheid schaalt elke animatieduur (en vertraging) mee.
  const f = snelheidsFactor();
  const tw: ActieveTween = {
    start: performance.now(),
    vertraging: (opties.vertraging ?? 0) * f,
    duur: Math.max(1, opties.duur * f),
    ease: opties.ease ?? easeInOutCubic,
    onUpdate: opties.onUpdate,
    resolve: resolveFn,
    klaar: false,
  };
  actieveTweens.add(tw);
  if (rafHandle === null) rafHandle = requestAnimationFrame(pomp);
  return { promise, cancel: () => rondAf(tw) };
}

// ---------------------------------------------------------------------------
// TableLayout
// ---------------------------------------------------------------------------

/** Uitgebreide layout met runtime-aanpasbare afmetingen (omgevingswissel). */
export interface KingenTableLayout extends TableLayout {
  setDimensions(tableSurfaceY: number, tableRadius: number): void;
  /** Zet de kijker-stoel (komt onderaan, bij de camera); default 0. */
  setViewerSeat(seat: Seat): void;
  /** Wereldhoek van een stoel rond de tafel (kijker-stoel = bij de camera, +Z). */
  seatAngle(seat: Seat, seatCount: number): number;
  /** Plek van de delerstapel waar de kaarten vandaan vliegen. */
  deckPosition(dealer: Seat, seatCount: number): THREE.Vector3;
  getSurfaceY(): number;
}

/** Maak de tafel-layout (hand-ankers, slag-slots, won-stapels) voor 3-6 stoelen. */
export function createTableLayout(tableSurfaceY: number, tableRadius: number): KingenTableLayout {
  let opp = tableSurfaceY;
  let straal = tableRadius;
  // De kijker zit altijd onderaan (+Z, bij de camera). Online kan dat een andere
  // stoel dan 0 zijn; de tafel roteert dan zo dat jouw stoel onderaan komt.
  let viewer = 0;

  const seatAngle = (seat: Seat, seatCount: number): number => {
    const n = Math.max(seatCount, 1);
    const rel = ((seat - viewer) % n + n) % n;
    return Math.PI / 2 + (rel / n) * Math.PI * 2;
  };

  return {
    setDimensions(y: number, r: number): void {
      opp = y;
      straal = r;
    },
    setViewerSeat(seat: Seat): void {
      viewer = seat;
    },
    getSurfaceY: () => opp,
    getRadius: () => straal,
    seatAngle,

    handAnchor(seat: Seat, seatCount: number): { position: THREE.Vector3; rotationY: number } {
      const a = seatAngle(seat, seatCount);
      const lokaal = seat === viewer;
      // Eigen hand net buiten de rand, relatief laag (verder van de camera,
      // zodat tafel en tegenstanders de compositie domineren); tegenstanders
      // net binnen de rand met een compacte gesloten waaier.
      const r = straal * (lokaal ? 1.02 : 0.94);
      const position = new THREE.Vector3(
        Math.cos(a) * r,
        opp + (lokaal ? 0.16 : 0.17),
        Math.sin(a) * r,
      );
      // Lokale +Z van het hand-anker wijst naar het tafelmidden.
      const rotationY = Math.atan2(-Math.cos(a), -Math.sin(a));
      return { position, rotationY };
    },

    trickSlot(seat: Seat, seatCount: number): THREE.Vector3 {
      const a = seatAngle(seat, seatCount);
      return new THREE.Vector3(Math.cos(a) * 0.27, opp + 0.01, Math.sin(a) * 0.27);
    },

    wonPile(seat: Seat, seatCount: number): THREE.Vector3 {
      const a = seatAngle(seat, seatCount) + 0.5;
      // Ver naar de rand toe (0.74) zodat de gewonnen stapels buiten de centrale
      // slag-zone liggen en die niet overlappen/bedekken.
      return new THREE.Vector3(Math.cos(a) * straal * 0.74, opp + 0.004, Math.sin(a) * straal * 0.74);
    },

    deckPosition(dealer: Seat, seatCount: number): THREE.Vector3 {
      const a = seatAngle(dealer, seatCount);
      return new THREE.Vector3(Math.cos(a) * 0.18, opp + 0.012, Math.sin(a) * 0.18);
    },
  };
}

// ---------------------------------------------------------------------------
// Mesh-hulpjes
// ---------------------------------------------------------------------------

/** Quaternion voor een plat op tafel liggende kaart (yaw = richting kaarttop). */
function vlakkeQuat(yaw: number, openLigt: boolean): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(openLigt ? -Math.PI / 2 : Math.PI / 2, yaw, 0, 'YXZ'),
  );
}

/**
 * Fade-hulp: kloont de materialen van een mesh eenmalig (gedeelde, gecachete
 * materialen van de CardRenderer mogen nooit gemuteerd worden) en zet opacity.
 */
function zetOpacity(mesh: THREE.Mesh, opacity: number): void {
  if (!mesh.userData['fadeOrigineel']) {
    mesh.userData['fadeOrigineel'] = mesh.material;
    const kloon = (m: THREE.Material): THREE.Material => {
      const k = m.clone();
      k.transparent = true;
      return k;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(kloon) : kloon(mesh.material);
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) m.opacity = opacity;
}

/** Herstel de originele materialen en ruim de fade-klonen op. */
function herstelOpacity(mesh: THREE.Mesh): void {
  const origineel = mesh.userData['fadeOrigineel'] as THREE.Material | THREE.Material[] | undefined;
  if (!origineel) return;
  const huidig = mesh.material;
  mesh.material = origineel;
  delete mesh.userData['fadeOrigineel'];
  const klonen = Array.isArray(huidig) ? huidig : [huidig];
  for (const m of klonen) m.dispose(); // klonen delen hun textures met het origineel; dispose() raakt die niet aan
}

interface DoelTransform {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Uniforme schaal van de mesh op de bestemming (default 1). */
  schaal?: number;
}

/**
 * Schaal van kaarten in de eigen hand (stoel 0). Kleiner dan 1 zodat de
 * voorgrond-waaier de tafel en tegenstanders niet domineert; bij het spelen
 * groeit de kaart tijdens de vlucht terug naar 1 (tafelformaat).
 */
const EIGEN_HAND_SCHAAL = 0.58;

/**
 * Schaal van kaarten die plat op tafel liggen (slag, gewonnen stapels, deck).
 * Kleiner dan 1 zodat ze in verhouding bij de tafel passen en niet door de
 * rand steken; tegelijk groot genoeg om vanaf elke stoel leesbaar te blijven.
 */
const TAFEL_SCHAAL = 0.78;

/**
 * Schaal van de gewonnen-slag-stapels: kleiner dan de slag, en aan de rand
 * geplaatst (zie layout.wonPile) zodat ze de centrale slag niet overlappen of
 * bedekken.
 */
const WON_SCHAAL = 0.6;

// ---------------------------------------------------------------------------
// CardAnimator
// ---------------------------------------------------------------------------

/** Uitgebreide animator met hulpmethodes voor de SceneManager. */
export interface KingenCardAnimator extends CardAnimator {
  setSeatCount(n: number): void;
  /** Zet de kijker-stoel (eigen hand onderaan, open gewaaierd); default 0. */
  setViewerSeat(seat: Seat): void;
  /** Verwijder alle kaarten (handen, slag, stapels) van tafel. */
  clearTable(): void;
  /** Plaats alle handen direct (zonder animatie) opnieuw — na omgevingswissel. */
  relayout(): void;
  /** Herbouw de tafel direct uit een momentopname (reconnect): handen + lopende slag. */
  toonSnapshot(handsBySeat: Card[][], trick: { seat: Seat; card: Card }[]): void;
  /** Meshes in de hand van een stoel (voor raycast/hover in de scene). */
  getHandMeshes(seat: Seat): THREE.Mesh[];
}

/** Maak de animator; beheert alle kaart-meshes in de scene. */
export function createCardAnimator(
  scene: THREE.Scene,
  cardRenderer: CardRenderer,
  layout: TableLayout,
  seatCount: number,
): KingenCardAnimator {
  let stoelen = Math.max(2, seatCount);
  let kijker: Seat = 0;
  const klayoutView = layout as Partial<KingenTableLayout>;

  const handen = new Map<number, THREE.Mesh[]>();
  const slag: { seat: Seat; card: Card; mesh: THREE.Mesh }[] = [];
  const stapelMeshes: THREE.Mesh[] = [];
  const gewonnenTellers = new Map<number, number>();
  const handles = new Set<TweenHandle>();

  const klayout = layout as Partial<KingenTableLayout> & TableLayout;
  const oppervlak = (): number =>
    klayout.getSurfaceY ? klayout.getSurfaceY() : layout.trickSlot(0, stoelen).y - 0.01;
  const stoelHoek = (seat: Seat): number =>
    klayout.seatAngle
      ? klayout.seatAngle(seat, stoelen)
      : Math.PI / 2 + (seat / stoelen) * Math.PI * 2;
  const delerStapelPos = (dealer: Seat): THREE.Vector3 =>
    klayout.deckPosition
      ? klayout.deckPosition(dealer, stoelen)
      : new THREE.Vector3(0, oppervlak() + 0.012, 0);

  const handVan = (seat: number): THREE.Mesh[] => {
    let arr = handen.get(seat);
    if (!arr) {
      arr = [];
      handen.set(seat, arr);
    }
    return arr;
  };

  const maakMesh = (card: Card): THREE.Mesh => {
    const mesh = cardRenderer.createCardMesh(card);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const volg = (h: TweenHandle): TweenHandle => {
    handles.add(h);
    void h.promise.finally(() => handles.delete(h));
    return h;
  };

  /** Tween een mesh naar een doel-transform; optioneel met boog, schaal en/of fade. */
  const beweegMesh = (
    mesh: THREE.Mesh,
    doel: DoelTransform,
    opties: { duur: number; vertraging?: number; boog?: number; ease?: EaseFn; fade?: boolean },
  ): Promise<void> => {
    const p0 = mesh.position.clone();
    const q0 = mesh.quaternion.clone();
    const s0 = mesh.scale.x;
    const s1 = doel.schaal ?? 1;
    mesh.userData['animating'] = true;
    const h = volg(
      startTween({
        duur: opties.duur,
        vertraging: opties.vertraging ?? 0,
        ease: opties.ease ?? easeInOutCubic,
        onUpdate(t) {
          mesh.position.lerpVectors(p0, doel.pos, t);
          if (opties.boog) mesh.position.y += Math.sin(Math.PI * t) * opties.boog;
          mesh.quaternion.slerpQuaternions(q0, doel.quat, t);
          if (s0 !== s1) mesh.scale.setScalar(s0 + (s1 - s0) * t);
          if (opties.fade) zetOpacity(mesh, 1 - easeInQuad(t));
        },
      }),
    );
    return h.promise.then(() => {
      mesh.userData['animating'] = false;
    });
  };

  /** Bereken de waaier-transforms voor een hand van n kaarten. */
  const handTransforms = (seat: Seat, n: number): DoelTransform[] => {
    const anker = layout.handAnchor(seat, stoelen);
    const ankerQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, anker.rotationY, 0));
    const ch = cardRenderer.cardSize.height;
    const lokaal = seat === kijker;

    // Eigen hand: open waaier (verkleind, zie EIGEN_HAND_SCHAAL);
    // tegenstanders: smalle gesloten waaier.
    const stap = lokaal
      ? Math.min(0.085, 0.5 / Math.max(n, 1))
      : Math.min(0.06, 0.5 / Math.max(n, 1));
    const waaierStraal = ch * (lokaal ? 1.7 : 1.5);

    const uit: DoelTransform[] = [];
    for (let i = 0; i < n; i++) {
      const phi = (i - (n - 1) / 2) * stap;
      const lx = Math.sin(phi) * waaierStraal * (lokaal ? 1 : 0.6);
      const ly = (Math.cos(phi) - 1) * waaierStraal * (lokaal ? 1 : 0.5);
      // Stapelvolgorde: bij de eigen hand ligt de RECHTER kaart bovenop
      // (zoals een echte waaier in de hand); van elke bedekte kaart blijft zo
      // de linkerbovenhoek — mét index — zichtbaar. Tegenstanders andersom
      // (onzichtbaar detail, alleen z-fighting vermijden).
      const lz = lokaal ? -(n - 1 - i) * 0.0028 : -i * 0.0022;
      // ry=π: voorkant naar de eigenaar (rug naar het tafelmidden);
      // rx: kaarten leunen naar de houder; rz: waaierdraaiing per kaart.
      const lokaleQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(lokaal ? -0.62 : -0.5, Math.PI, -phi * (lokaal ? 1 : 0.85), 'YXZ'),
      );
      const pos = new THREE.Vector3(lx, ly, lz).applyQuaternion(ankerQ).add(anker.position);
      const quat = ankerQ.clone().multiply(lokaleQ);
      uit.push({ pos, quat, schaal: lokaal ? EIGEN_HAND_SCHAAL : 1 });
    }
    return uit;
  };

  const onthoudBasis = (mesh: THREE.Mesh, doel: DoelTransform): void => {
    mesh.userData['basePosition'] = doel.pos.clone();
    mesh.userData['baseQuaternion'] = doel.quat.clone();
    mesh.userData['lift'] = 0;
  };

  /** Yaw waarmee een slagkaart "leesbaar vanaf de stoel" op tafel ligt. */
  const slagYaw = (seat: Seat): number => {
    const a = stoelHoek(seat);
    return Math.atan2(Math.cos(a), Math.sin(a));
  };

  const verwijderMesh = (mesh: THREE.Mesh): void => {
    herstelOpacity(mesh);
    scene.remove(mesh);
    // De CardRenderer maakt per mesh eigen materialen (voor highlight-status);
    // die hier opruimen, anders lekken ze per ronde. Geometrie en textures
    // zijn gedeeld via de renderer-cache en blijven bestaan.
    const materialen = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const materiaal of new Set(materialen)) materiaal.dispose();
  };

  /** Leg de hand van een stoel opnieuw in de waaier (animatie optioneel). */
  const legHandNeer = (seat: Seat, animeren: boolean): Promise<void> => {
    const arr = handVan(seat);
    const doelen = handTransforms(seat, arr.length);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < arr.length; i++) {
      const mesh = arr[i];
      const doel = doelen[i];
      if (!mesh || !doel) continue;
      onthoudBasis(mesh, doel);
      if (animeren) {
        promises.push(beweegMesh(mesh, doel, { duur: 260, ease: easeInOutCubic }));
      } else {
        mesh.position.copy(doel.pos);
        mesh.quaternion.copy(doel.quat);
        mesh.scale.setScalar(doel.schaal ?? 1);
      }
    }
    return Promise.all(promises).then(() => undefined);
  };

  const clearTable = (): void => {
    for (const h of [...handles]) h.cancel();
    handles.clear();
    for (const arr of handen.values()) {
      for (const mesh of arr) verwijderMesh(mesh);
    }
    handen.clear();
    for (const t of slag) verwijderMesh(t.mesh);
    slag.length = 0;
    for (const mesh of stapelMeshes) verwijderMesh(mesh);
    stapelMeshes.length = 0;
    gewonnenTellers.clear();
  };

  return {
    setSeatCount(n: number): void {
      stoelen = Math.max(2, n);
    },

    setViewerSeat(seat: Seat): void {
      kijker = seat;
      klayoutView.setViewerSeat?.(seat);
    },

    getHandMeshes(seat: Seat): THREE.Mesh[] {
      return [...handVan(seat)];
    },

    clearTable,

    relayout(): void {
      for (let seat = 0; seat < stoelen; seat++) {
        void legHandNeer(seat as Seat, false);
      }
    },

    toonSnapshot(handsBySeat: Card[][], trick: { seat: Seat; card: Card }[]): void {
      clearTable();
      if (handsBySeat.length > 0) stoelen = handsBySeat.length;
      // Handen direct op hun eindplek zetten (geen deel-animatie).
      for (let seat = 0; seat < stoelen; seat++) {
        const kaarten = handsBySeat[seat] ?? [];
        const doelen = handTransforms(seat as Seat, kaarten.length);
        const arr: THREE.Mesh[] = [];
        kaarten.forEach((card, i) => {
          const doel = doelen[i];
          if (!doel) return;
          const mesh = maakMesh(card);
          mesh.position.copy(doel.pos);
          mesh.quaternion.copy(doel.quat);
          mesh.scale.setScalar(doel.schaal ?? 1);
          scene.add(mesh);
          onthoudBasis(mesh, doel);
          arr[i] = mesh;
        });
        handen.set(seat, arr);
      }
      // Lopende slag terugleggen in het midden.
      trick.forEach((p, i) => {
        const slot = layout.trickSlot(p.seat, stoelen).clone();
        slot.y += 0.0016 + i * 0.004;
        const mesh = maakMesh(p.card);
        mesh.position.copy(slot);
        mesh.quaternion.copy(vlakkeQuat(slagYaw(p.seat), true));
        mesh.scale.setScalar(TAFEL_SCHAAL);
        mesh.renderOrder = 10 + i;
        scene.add(mesh);
        slag.push({ seat: p.seat, card: p.card, mesh });
      });
    },

    async animateDeal(handsBySeat: Card[][], dealer: Seat): Promise<void> {
      clearTable();
      if (handsBySeat.length > 0) stoelen = handsBySeat.length;

      // Deelvolgorde: links van de deler beginnen, klokwijs, één kaart per beurt.
      const volgorde: { seat: number; card: Card; idx: number }[] = [];
      const maxLengte = handsBySeat.reduce((m, h) => Math.max(m, h.length), 0);
      for (let ronde = 0; ronde < maxLengte; ronde++) {
        for (let s = 1; s <= stoelen; s++) {
          const seat = (dealer + s) % stoelen;
          const card = handsBySeat[seat]?.[ronde];
          if (card) volgorde.push({ seat, card, idx: ronde });
        }
      }

      const stapelPos = delerStapelPos(dealer);
      const dikte = cardRenderer.cardSize.thickness;
      const totaal = volgorde.length;

      // Doel-transforms per stoel (op basis van de uiteindelijke handgrootte).
      const doelenPerStoel = new Map<number, DoelTransform[]>();
      for (let seat = 0; seat < stoelen; seat++) {
        const lengte = handsBySeat[seat]?.length ?? 0;
        doelenPerStoel.set(seat, handTransforms(seat as Seat, lengte));
        handen.set(seat, new Array<THREE.Mesh>(lengte));
      }

      const promises: Promise<void>[] = [];
      volgorde.forEach((item, k) => {
        const mesh = maakMesh(item.card);
        // Stapel: eerst gedeelde kaart ligt bovenop.
        mesh.position.set(
          stapelPos.x + (Math.random() - 0.5) * 0.006,
          stapelPos.y + (totaal - 1 - k) * dikte * 1.15,
          stapelPos.z + (Math.random() - 0.5) * 0.006,
        );
        mesh.quaternion.copy(vlakkeQuat((Math.random() - 0.5) * 0.15, false));
        scene.add(mesh);

        const arr = handVan(item.seat);
        arr[item.idx] = mesh;

        const doel = doelenPerStoel.get(item.seat)?.[item.idx];
        if (!doel) return;
        promises.push(
          beweegMesh(mesh, doel, {
            duur: 420,
            vertraging: k * 55,
            boog: 0.16,
            ease: easeOutCubic,
          }).then(() => onthoudBasis(mesh, doel)),
        );
      });

      await Promise.all(promises);
    },

    async animatePlay(card: Card, from: Seat): Promise<void> {
      const arr = handVan(from);
      let mesh = arr.find((m) => m.userData['cardId'] === card.id);
      if (mesh) {
        arr.splice(arr.indexOf(mesh), 1);
      } else {
        // Verdekte hand (tegenstander): vervang de buitenste placeholder door
        // de echte kaart op exact dezelfde plek; de flip gebeurt tijdens de vlucht.
        const placeholder = arr.pop();
        mesh = maakMesh(card);
        if (placeholder) {
          mesh.position.copy(placeholder.position);
          mesh.quaternion.copy(placeholder.quaternion);
          verwijderMesh(placeholder);
        } else {
          const anker = layout.handAnchor(from, stoelen);
          mesh.position.copy(anker.position);
          mesh.quaternion.copy(vlakkeQuat(0, false));
        }
        scene.add(mesh);
      }

      const slot = layout.trickSlot(from, stoelen).clone();
      slot.x += (Math.random() - 0.5) * 0.03;
      slot.z += (Math.random() - 0.5) * 0.03;
      // Laag op tafel houden: net iets meer dan de kaartdikte (3,5 mm) per kaart
      // zodat ze niet in elkaar steken (z-fighting) maar ook niet zweven.
      slot.y += 0.0016 + slag.length * 0.004;
      const yaw = slagYaw(from) + (Math.random() - 0.5) * 0.18;
      // Tekenvolgorde sluit aan op de speelvolgorde: nieuwste kaart bovenop.
      mesh.renderOrder = 10 + slag.length;

      slag.push({ seat: from, card, mesh });
      await beweegMesh(mesh, { pos: slot, quat: vlakkeQuat(yaw, true), schaal: TAFEL_SCHAAL }, {
        duur: 480,
        boog: 0.22,
        ease: easeInOutCubic,
      });
    },

    async animateCollectTrick(winner: Seat): Promise<void> {
      if (slag.length === 0) return;

      const stapelBasis = layout.wonPile(winner, stoelen);
      const teller = gewonnenTellers.get(winner) ?? 0;
      const dikte = cardRenderer.cardSize.thickness;
      const winnaarYaw = slagYaw(winner);

      const promises = slag.map((item, i) =>
        beweegMesh(
          item.mesh,
          {
            pos: stapelBasis
              .clone()
              .add(new THREE.Vector3((Math.random() - 0.5) * 0.02, i * dikte * 1.2, (Math.random() - 0.5) * 0.02)),
            quat: vlakkeQuat(winnaarYaw + (Math.random() - 0.5) * 0.3, false),
            schaal: WON_SCHAAL,
          },
          { duur: 600, vertraging: i * 40, fade: true, ease: easeInOutCubic },
        ),
      );
      await Promise.all(promises);

      // Slagkaarten weghalen (incl. materiaal-opruiming); één nette gedekte
      // kaart markeert de gewonnen stapel.
      const eerste = slag[0];
      for (const item of slag) verwijderMesh(item.mesh);
      if (eerste) {
        // Eigen mesh (met eigen materialen) zodat verwijderMesh hem later
        // veilig kan opruimen; hij ligt gedekt, dus de voorkant is onzichtbaar.
        const marker = maakMesh(eerste.card);
        marker.userData = { pijlerVanStapel: true };
        marker.scale.setScalar(WON_SCHAAL);
        marker.renderOrder = 0;
        // Stapel blijft bewust laag (gecapt) zodat hij nooit boven de centrale
        // slag uitkomt en die niet bedekt; alleen een lichte x/z-spreiding.
        marker.position.set(
          stapelBasis.x + (Math.random() - 0.5) * 0.012,
          stapelBasis.y + Math.min(teller, 10) * 0.0004,
          stapelBasis.z + (Math.random() - 0.5) * 0.012,
        );
        marker.quaternion.copy(vlakkeQuat(winnaarYaw + (Math.random() - 0.5) * 0.2, false));
        scene.add(marker);
        stapelMeshes.push(marker);
      }
      gewonnenTellers.set(winner, teller + 1);
      slag.length = 0;
    },

    animateArrangeHand(seat: Seat): Promise<void> {
      return legHandNeer(seat, true);
    },

    cancelAll(): void {
      for (const h of [...handles]) h.cancel();
      handles.clear();
    },
  };
}
