/**
 * src/render/cardTextures.ts
 * High-res, volledig procedurele speelkaart-textures op canvas:
 *  - roomwit kaartoppervlak met subtiele gradient/vignet;
 *  - correcte pip-layouts per rang (2-10, gespiegelde onderhelft);
 *  - hoekindices met NL-rang (B/V/H/A) + kleurteken;
 *  - sierlijke hofkaarten (zie cardArt/court.ts);
 *  - azen met groot ornamentaal middenteken (schoppenaas extra ornamentaal);
 *  - klassieke geornamenteerde kaartrug (guilloche met wit kader);
 *  - afgeronde hoeken via alpha (transparante hoeken).
 * GEEN externe assets; alles wordt hier getekend.
 */

import type { Card, Rank, Suit } from '../core/types.ts';
import { ACE, RANKS, RANK_LABELS_NL, SUITS } from '../core/types.ts';
import { cardId } from '../core/deck.ts';
import { drawSuitSymbol, suitColor, traceSuitPath } from './cardArt/suits.ts';
import { drawCourtArt } from './cardArt/court.ts';

/** Hoogte/breedte-verhouding van een kaarttexture (poker-formaat). */
export const CARD_ASPECT = 1.4;

/** Hoekradius als fractie van de kaartbreedte (zoals echte bridgekaarten). */
export const CORNER_RADIUS_FRAC = 0.055;

export type BackTheme = 'blauw' | 'rood' | 'groen';

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** Zet een afgerond-rechthoekpad uit (roept zelf beginPath aan). */
export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Sierlijke krul (filigraan), gespiegeld te gebruiken. */
function drawFlourish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth: number,
  flipX = false,
  flipY = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flipX ? -size : size, flipY ? -size : size);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth / size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(0.55, -0.1, 0.85, -0.45, 0.62, -0.72);
  ctx.bezierCurveTo(0.46, -0.9, 0.2, -0.78, 0.28, -0.58);
  ctx.bezierCurveTo(0.33, -0.45, 0.5, -0.47, 0.52, -0.6);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pip-layouts (rang 2-10), exact zoals echte kaarten
// ---------------------------------------------------------------------------

/**
 * Per rang een lijst [kolom, rij]:
 *  kolom: 0 = links, 0.5 = midden, 1 = rechts;
 *  rij:   0..1 binnen het pip-gebied; rij > 0.5 wordt 180 graden gedraaid
 *         (gespiegelde onderste helft).
 */
const PIP_LAYOUTS: Readonly<Partial<Record<Rank, ReadonlyArray<readonly [number, number]>>>> = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

function drawPips(ctx: CanvasRenderingContext2D, card: Card, w: number, h: number): void {
  const layout = PIP_LAYOUTS[card.rank];
  if (!layout) return;
  const xL = w * 0.345;
  const xC = w * 0.5;
  const xR = w * 0.655;
  const yTop = h * 0.2;
  const yBot = h * 0.8;
  const pipSize = w * 0.158;
  for (const [col, rij] of layout) {
    const x = col === 0 ? xL : col === 1 ? xR : xC;
    const y = yTop + (yBot - yTop) * rij;
    drawSuitSymbol(ctx, card.suit, x, y, pipSize, undefined, rij > 0.5);
  }
}

// ---------------------------------------------------------------------------
// Hoekindices
// ---------------------------------------------------------------------------

function drawCornerIndex(ctx: CanvasRenderingContext2D, card: Card, w: number, h: number, rotated: boolean): void {
  ctx.save();
  if (rotated) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  }
  const label = RANK_LABELS_NL[card.rank];
  const cx = w * 0.088;
  const fontSize = label.length > 1 ? w * 0.105 : w * 0.125;
  ctx.font = `700 ${fontSize}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = suitColor(card.suit);
  ctx.fillText(label, cx, h * 0.063);
  drawSuitSymbol(ctx, card.suit, cx, h * 0.063 + w * 0.137, w * 0.098);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Azen
// ---------------------------------------------------------------------------

function drawAce(ctx: CanvasRenderingContext2D, card: Card, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const goud = '#b8923a';
  const goudLicht = '#dcc176';

  if (card.suit === 'spades') {
    // --- Schoppenaas: extra ornamentaal -----------------------------------
    // Stralenkrans van fijne gouden bladeren achter het teken.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(184, 146, 58, 0.55)';
    ctx.lineWidth = w * 0.004;
    const nBlad = 16;
    for (let i = 0; i < nBlad; i++) {
      ctx.save();
      ctx.rotate((i / nBlad) * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, -w * 0.3, w * 0.028, w * 0.085, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Dubbele sierring.
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.375, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = w * 0.002;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.395, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Grote schoppen met verticale gradient (pad in device-ruimte bakken).
    const s = w * 0.52;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    traceSuitPath(ctx, 'spades');
    ctx.restore();
    const grad = ctx.createLinearGradient(cx, cy - s / 2, cx, cy + s / 2);
    grad.addColorStop(0, '#0e0e16');
    grad.addColorStop(0.55, '#26262f');
    grad.addColorStop(1, '#13131b');
    ctx.fillStyle = grad;
    ctx.fill();

    // Gouden binnen-schoppen (filigraan-outline).
    ctx.save();
    ctx.translate(cx, cy - s * 0.02);
    ctx.scale(s * 0.66, s * 0.66);
    traceSuitPath(ctx, 'spades');
    ctx.restore();
    ctx.strokeStyle = goudLicht;
    ctx.lineWidth = w * 0.0045;
    ctx.stroke();

    // Krul-ornamenten links/rechts en boven/onder.
    drawFlourish(ctx, cx - w * 0.3, cy + h * 0.155, w * 0.17, goud, w * 0.005, true, false);
    drawFlourish(ctx, cx + w * 0.3, cy + h * 0.155, w * 0.17, goud, w * 0.005, false, false);
    drawFlourish(ctx, cx - w * 0.3, cy - h * 0.155, w * 0.17, goud, w * 0.005, true, true);
    drawFlourish(ctx, cx + w * 0.3, cy - h * 0.155, w * 0.17, goud, w * 0.005, false, true);

    // Kleine schoppen boven en onder (onderste gespiegeld).
    drawSuitSymbol(ctx, 'spades', cx, cy - h * 0.295, w * 0.085);
    drawSuitSymbol(ctx, 'spades', cx, cy + h * 0.295, w * 0.085, undefined, true);
  } else {
    // --- Overige azen: groot middenteken met sierring ----------------------
    const kleur = suitColor(card.suit);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(184, 146, 58, 0.5)';
    ctx.lineWidth = w * 0.0035;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.31, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = kleur === '#c0152d' ? 'rgba(192, 21, 45, 0.3)' : 'rgba(29, 28, 34, 0.3)';
    ctx.lineWidth = w * 0.002;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.33, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawFlourish(ctx, cx - w * 0.26, cy + h * 0.13, w * 0.13, goud, w * 0.0045, true, false);
    drawFlourish(ctx, cx + w * 0.26, cy + h * 0.13, w * 0.13, goud, w * 0.0045, false, false);
    drawFlourish(ctx, cx - w * 0.26, cy - h * 0.13, w * 0.13, goud, w * 0.0045, true, true);
    drawFlourish(ctx, cx + w * 0.26, cy - h * 0.13, w * 0.13, goud, w * 0.0045, false, true);

    drawSuitSymbol(ctx, card.suit, cx, cy, w * 0.42);
  }
}

// ---------------------------------------------------------------------------
// Voorkant
// ---------------------------------------------------------------------------

/** Teken de complete voorkant van een kaart op een canvas van w x h px. */
export function drawCardFace(ctx: CanvasRenderingContext2D, card: Card, w: number, h: number): void {
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Afgeronde hoeken via alpha: alles binnen dit pad clippen.
  const r = w * CORNER_RADIUS_FRAC;
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();

  // Roomwit oppervlak met subtiel vignet.
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.44, w * 0.12, w * 0.5, h * 0.5, h * 0.72);
  bg.addColorStop(0, '#fffefb');
  bg.addColorStop(0.7, '#fbf8f0');
  bg.addColorStop(1, '#efe9da');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Heel lichte diagonale glans (papier-sheen).
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(120, 105, 70, 0.05)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // Middendeel per rang.
  if (card.rank === ACE) {
    drawAce(ctx, card, w, h);
  } else if (card.rank >= 11) {
    drawCourtArt(ctx, card, w, h);
  } else {
    drawPips(ctx, card, w, h);
  }

  // Hoekindices (linksboven + gespiegeld rechtsonder).
  drawCornerIndex(ctx, card, w, h, false);
  drawCornerIndex(ctx, card, w, h, true);

  // Fijne randlijn voor definitie.
  roundedRectPath(ctx, w * 0.006, w * 0.006, w - w * 0.012, h - w * 0.012, r * 0.92);
  ctx.strokeStyle = 'rgba(70, 58, 40, 0.18)';
  ctx.lineWidth = Math.max(1, w * 0.0035);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Kaartrug
// ---------------------------------------------------------------------------

interface BackPalette {
  donker: string;
  midden: string;
  licht: string;
  highlight: string;
}

const BACK_THEMES: Readonly<Record<BackTheme, BackPalette>> = {
  blauw: { donker: '#142a57', midden: '#1f3d7a', licht: '#6f8bc4', highlight: '#bcc9e8' },
  rood: { donker: '#581521', midden: '#7d1f2c', licht: '#bc7e88', highlight: '#e8c2c8' },
  groen: { donker: '#103a26', midden: '#1b5639', licht: '#79ad90', highlight: '#c2dfce' },
};

function drawBackRosette(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, pal: BackPalette): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = pal.highlight;
  ctx.lineWidth = radius * 0.035;
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((i / petals) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, -radius * 0.62, radius * 0.16, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = pal.licht;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Teken de klassieke geornamenteerde kaartrug (guilloche + wit kader). */
export function drawCardBack(ctx: CanvasRenderingContext2D, w: number, h: number, theme: BackTheme): void {
  const pal = BACK_THEMES[theme];
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const r = w * CORNER_RADIUS_FRAC;
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();

  // Wit kader.
  ctx.fillStyle = '#f8f4ea';
  ctx.fillRect(0, 0, w, h);

  // Binnenpaneel.
  const m = w * 0.06;
  const iw = w - 2 * m;
  const ih = h - 2 * m;
  ctx.save();
  roundedRectPath(ctx, m, m, iw, ih, w * 0.032);
  ctx.clip();

  const grad = ctx.createLinearGradient(m, m, m + iw, m + ih);
  grad.addColorStop(0, pal.donker);
  grad.addColorStop(0.5, pal.midden);
  grad.addColorStop(1, pal.donker);
  ctx.fillStyle = grad;
  ctx.fillRect(m, m, iw, ih);

  // Guilloche-laag 1: diagonaal ruitennet.
  ctx.strokeStyle = pal.licht;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = Math.max(1, w * 0.0028);
  const stap = w / 18;
  for (let d = -ih; d < iw + ih; d += stap) {
    ctx.beginPath();
    ctx.moveTo(m + d, m);
    ctx.lineTo(m + d + ih, m + ih);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m + d + ih, m);
    ctx.lineTo(m + d, m + ih);
    ctx.stroke();
  }

  // Guilloche-laag 2: verweven cirkelraster.
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = pal.highlight;
  const cr = w / 9;
  for (let row = 0; row * cr <= ih + cr; row++) {
    const offset = row % 2 === 0 ? 0 : cr / 2;
    for (let col = 0; col * cr <= iw + cr; col++) {
      ctx.beginPath();
      ctx.arc(m + offset + col * cr, m + row * cr, cr * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Centraal medaillon.
  const cx = w / 2;
  const cy = h / 2;
  ctx.fillStyle = pal.donker;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.215, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pal.highlight;
  ctx.lineWidth = Math.max(1, w * 0.003);
  ctx.stroke();
  drawBackRosette(ctx, cx, cy, w * 0.185, pal);

  // Vier kleine kleurtekens rond het hart van het medaillon.
  const tekens: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
  tekens.forEach((suit, i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    drawSuitSymbol(ctx, suit, cx + Math.cos(a) * w * 0.115, cy + Math.sin(a) * w * 0.115, w * 0.05, pal.highlight);
  });

  // Hoek-rozetten (puntsymmetrisch, dus ook mooi op de gespiegelde rugzijde).
  const hoekR = w * 0.085;
  drawBackRosette(ctx, m + hoekR * 0.9, m + hoekR * 0.9, hoekR, pal);
  drawBackRosette(ctx, w - m - hoekR * 0.9, m + hoekR * 0.9, hoekR, pal);
  drawBackRosette(ctx, m + hoekR * 0.9, h - m - hoekR * 0.9, hoekR, pal);
  drawBackRosette(ctx, w - m - hoekR * 0.9, h - m - hoekR * 0.9, hoekR, pal);

  ctx.restore(); // binnenpaneel-clip

  // Dubbel sierkader rond het paneel.
  ctx.strokeStyle = pal.midden;
  ctx.lineWidth = Math.max(1, w * 0.004);
  roundedRectPath(ctx, m - w * 0.012, m - w * 0.012, iw + w * 0.024, ih + w * 0.024, w * 0.04);
  ctx.stroke();
  ctx.strokeStyle = pal.licht;
  ctx.lineWidth = Math.max(1, w * 0.002);
  roundedRectPath(ctx, m + w * 0.008, m + w * 0.008, iw - w * 0.016, ih - w * 0.016, w * 0.026);
  ctx.stroke();

  // Fijne randlijn langs de kaartrand.
  roundedRectPath(ctx, w * 0.006, w * 0.006, w - w * 0.012, h - w * 0.012, r * 0.92);
  ctx.strokeStyle = 'rgba(60, 50, 40, 0.2)';
  ctx.lineWidth = Math.max(1, w * 0.003);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Zelftest
// ---------------------------------------------------------------------------

export interface CardTextureSelfTestResult {
  ok: boolean;
  tested: number;
  errors: string[];
}

/**
 * Genereer alle 52 kaartvoorkanten en de drie rugthema's op een offscreen
 * canvas en controleer per texture dat de hoeken transparant zijn (afgeronde
 * hoeken via alpha) en het midden dekkend is. Gooit zelf geen errors;
 * retourneert een rapport.
 */
export function selfTestCardTextures(resolution = 256): CardTextureSelfTestResult {
  const errors: string[] = [];
  let tested = 0;
  const w = resolution;
  const h = Math.round(resolution * CARD_ASPECT);

  const maakContext = (): CanvasRenderingContext2D => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D-canvascontext niet beschikbaar');
    return ctx;
  };

  const controleer = (ctx: CanvasRenderingContext2D, naam: string): void => {
    const hoekAlpha = ctx.getImageData(1, 1, 1, 1).data[3] ?? -1;
    const middenAlpha = ctx.getImageData(w >> 1, h >> 1, 1, 1).data[3] ?? -1;
    if (hoekAlpha !== 0) errors.push(`${naam}: hoek niet transparant (alpha ${hoekAlpha})`);
    if (middenAlpha !== 255) errors.push(`${naam}: midden niet dekkend (alpha ${middenAlpha})`);
  };

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const card: Card = { id: cardId(suit, rank), suit, rank };
      try {
        const ctx = maakContext();
        drawCardFace(ctx, card, w, h);
        controleer(ctx, card.id);
        tested++;
      } catch (err) {
        errors.push(`${card.id}: ${String(err)}`);
      }
    }
  }

  const themes: readonly BackTheme[] = ['blauw', 'rood', 'groen'];
  for (const theme of themes) {
    try {
      const ctx = maakContext();
      drawCardBack(ctx, w, h, theme);
      controleer(ctx, `rug-${theme}`);
      tested++;
    } catch (err) {
      errors.push(`rug-${theme}: ${String(err)}`);
    }
  }

  return { ok: errors.length === 0, tested, errors };
}
