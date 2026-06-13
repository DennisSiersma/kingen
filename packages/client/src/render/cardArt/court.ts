/**
 * src/render/cardArt/court.ts
 * Procedurele hofkaart-illustraties (Boer/Vrouw/Heer) in klassieke stijl:
 * een symmetrische, 180 graden gespiegelde halffiguur met gezicht, kroon of
 * baret, geornamenteerd gewaad en attribuut (zwaard/bloem/hellebaard), in een
 * goud/blauw/rood-palet. Volledig vector-getekend op canvas, geen assets.
 *
 * Tekenruimte: de halffiguur wordt getekend in een 100x100-ruimte waarbij
 * x 0..100 de framebreedte beslaat en y 0..100 de BOVENSTE helft van het
 * frame (y=100 is het midden van de kaart). De onderhelft is dezelfde
 * tekening, 180 graden geroteerd.
 */

import type { Card, Rank, Suit } from '@shared/core/types.ts';
import { JACK, QUEEN, KING } from '@shared/core/types.ts';
import { drawSuitSymbol, isRedSuit, suitColor } from './suits.ts';

/** Klassiek hofkaart-palet. */
const PAL = {
  goud: '#c9a23f',
  goudLicht: '#ecd283',
  goudDonker: '#8f7022',
  blauw: '#2e4a8f',
  blauwLicht: '#5273bd',
  blauwDonker: '#1f3463',
  rood: '#a92433',
  roodLicht: '#c6505b',
  roodDonker: '#7c1824',
  wit: '#f7f2e3',
  lijn: '#2c261f',
  huid: '#f1d3ab',
  huidSchaduw: '#d8b285',
  haar: '#6b4a2b',
  haarGrijs: '#b9b3a4',
  staal: '#c7ccd6',
  staalDonker: '#8b93a3',
  groen: '#3f6b46',
} as const;

interface CourtColors {
  /** Hoofdkleur gewaad (rood bij rode kleuren, blauw bij zwarte). */
  main: string;
  mainLicht: string;
  mainDonker: string;
  /** Contrastkleur (omgekeerd). */
  accent: string;
  accentLicht: string;
}

function courtColors(suit: Suit): CourtColors {
  return isRedSuit(suit)
    ? { main: PAL.rood, mainLicht: PAL.roodLicht, mainDonker: PAL.roodDonker, accent: PAL.blauw, accentLicht: PAL.blauwLicht }
    : { main: PAL.blauw, mainLicht: PAL.blauwLicht, mainDonker: PAL.blauwDonker, accent: PAL.rood, accentLicht: PAL.roodLicht };
}

/**
 * Teken de volledige hofkaart-illustratie (frame + gespiegelde figuur)
 * op een kaartvlak van w x h pixels.
 */
export function drawCourtArt(ctx: CanvasRenderingContext2D, card: Card, w: number, h: number): void {
  const x0 = w * 0.135;
  const x1 = w * 0.865;
  const y0 = h * 0.115;
  const y1 = h * 0.885;
  const fw = x1 - x0;
  const fh = y1 - y0;
  const cc = courtColors(card.suit);

  ctx.save();

  // --- paneel-achtergrond -------------------------------------------------
  ctx.fillStyle = '#fbf7eb';
  ctx.fillRect(x0, y0, fw, fh);

  // Fijn diagonaal weefpatroon, heel subtiel.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, fw, fh);
  ctx.clip();
  ctx.strokeStyle = 'rgba(140, 120, 70, 0.08)';
  ctx.lineWidth = Math.max(1, w * 0.0015);
  const stap = fw / 14;
  for (let d = -fh; d < fw + fh; d += stap) {
    ctx.beginPath();
    ctx.moveTo(x0 + d, y0);
    ctx.lineTo(x0 + d + fh, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + d + fh, y0);
    ctx.lineTo(x0 + d, y1);
    ctx.stroke();
  }
  ctx.restore();

  // --- figuur: bovenhelft + 180 graden gespiegelde onderhelft -------------
  const sx = fw / 100;
  const sy = fh / 2 / 100;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, fw, fh);
  ctx.clip();

  // Bovenhelft.
  ctx.save();
  ctx.translate(x0, y0);
  ctx.scale(sx, sy);
  drawHalfFigure(ctx, card, cc);
  ctx.restore();

  // Onderhelft (puntsymmetrisch gespiegeld).
  ctx.save();
  ctx.translate(x1, y1);
  ctx.scale(-sx, -sy);
  drawHalfFigure(ctx, card, cc);
  ctx.restore();

  // Subtiele scheidslijn door het midden.
  ctx.strokeStyle = 'rgba(44, 38, 31, 0.28)';
  ctx.lineWidth = Math.max(1, w * 0.002);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + fh / 2);
  ctx.lineTo(x1, y0 + fh / 2);
  ctx.stroke();

  ctx.restore(); // frame-clip

  // --- kader ---------------------------------------------------------------
  ctx.strokeStyle = PAL.goud;
  ctx.lineWidth = w * 0.008;
  ctx.strokeRect(x0, y0, fw, fh);
  ctx.strokeStyle = suitColor(card.suit);
  ctx.lineWidth = w * 0.0035;
  const k = w * 0.012;
  ctx.strokeRect(x0 - k, y0 - k, fw + 2 * k, fh + 2 * k);

  ctx.restore();
}

/** Eén halffiguur in de 100x100-ruimte (y=100 = midden van de kaart). */
function drawHalfFigure(ctx: CanvasRenderingContext2D, card: Card, cc: CourtColors): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = PAL.lijn;
  ctx.lineWidth = 1.1;

  // Kleurteken van de kaart naast het hoofd (klassieke plek).
  drawSuitSymbol(ctx, card.suit, 14, 20, 13);

  drawGarment(ctx, card.rank, cc);
  drawAttribute(ctx, card, cc, 'achter');
  drawHead(ctx, card.rank, cc);
  drawHeaddress(ctx, card.rank, cc);
  drawAttribute(ctx, card, cc, 'voor');

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Gewaad
// ---------------------------------------------------------------------------

function drawGarment(ctx: CanvasRenderingContext2D, rank: Rank, cc: CourtColors): void {
  // Mantel: brede klokvorm vanaf de schouders tot het kaartmidden.
  ctx.beginPath();
  ctx.moveTo(16, 100);
  ctx.bezierCurveTo(18, 76, 24, 58, 33, 50);
  ctx.bezierCurveTo(40, 44, 60, 44, 67, 50);
  ctx.bezierCurveTo(76, 58, 82, 76, 84, 100);
  ctx.closePath();
  ctx.fillStyle = cc.main;
  ctx.fill();
  ctx.stroke();

  // Schoudervlakken in contrastkleur.
  ctx.beginPath();
  ctx.moveTo(33, 50);
  ctx.bezierCurveTo(27, 56, 22, 68, 20, 84);
  ctx.bezierCurveTo(26, 80, 31, 72, 33, 62);
  ctx.closePath();
  ctx.fillStyle = cc.accent;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(67, 50);
  ctx.bezierCurveTo(73, 56, 78, 68, 80, 84);
  ctx.bezierCurveTo(74, 80, 69, 72, 67, 62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Middenpaneel met gouden biezen.
  ctx.beginPath();
  ctx.moveTo(39, 54);
  ctx.bezierCurveTo(44, 50, 56, 50, 61, 54);
  ctx.lineTo(65, 100);
  ctx.lineTo(35, 100);
  ctx.closePath();
  ctx.fillStyle = rank === QUEEN ? cc.accentLicht : cc.mainLicht;
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = PAL.goud;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(38.5, 55);
  ctx.lineTo(35.5, 100);
  ctx.moveTo(61.5, 55);
  ctx.lineTo(64.5, 100);
  ctx.stroke();

  // Gouden ornamentstippen op het middenpaneel.
  ctx.fillStyle = PAL.goudLicht;
  for (let i = 0; i < 4; i++) {
    const y = 64 + i * 9;
    ctx.beginPath();
    ctx.arc(44, y, 1.3, 0, Math.PI * 2);
    ctx.arc(56, y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gouden ketting / halssieraad.
  ctx.strokeStyle = PAL.goud;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(40, 55);
  ctx.quadraticCurveTo(50, 64, 60, 55);
  ctx.stroke();
  ctx.fillStyle = PAL.goudLicht;
  ctx.beginPath();
  ctx.arc(50, 60.5, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PAL.lijn;
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // Hermelijnen kraag.
  ctx.beginPath();
  ctx.moveTo(36, 51);
  ctx.bezierCurveTo(42, 46.5, 58, 46.5, 64, 51);
  ctx.bezierCurveTo(58, 54.5, 42, 54.5, 36, 51);
  ctx.closePath();
  ctx.fillStyle = PAL.wit;
  ctx.fill();
  ctx.strokeStyle = PAL.lijn;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Hermelijn-stipjes.
  ctx.fillStyle = PAL.lijn;
  for (const tx of [42, 47, 53, 58]) {
    ctx.beginPath();
    ctx.ellipse(tx, 50.6, 0.7, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineWidth = 1.1;
}

// ---------------------------------------------------------------------------
// Hoofd en gezicht
// ---------------------------------------------------------------------------

function drawHead(ctx: CanvasRenderingContext2D, rank: Rank, cc: CourtColors): void {
  // Haar achter het gezicht.
  ctx.fillStyle = rank === KING ? PAL.haarGrijs : PAL.haar;
  if (rank === QUEEN) {
    // Lang golvend haar tot op de schouders.
    ctx.beginPath();
    ctx.moveTo(50, 16);
    ctx.bezierCurveTo(36, 16, 33, 28, 34, 40);
    ctx.bezierCurveTo(33, 50, 30, 56, 28, 60);
    ctx.bezierCurveTo(34, 60, 39, 56, 41, 50);
    ctx.lineTo(59, 50);
    ctx.bezierCurveTo(61, 56, 66, 60, 72, 60);
    ctx.bezierCurveTo(70, 56, 67, 50, 66, 40);
    ctx.bezierCurveTo(67, 28, 64, 16, 50, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // Pagekapsel / zijlokken.
    ctx.beginPath();
    ctx.moveTo(50, 17);
    ctx.bezierCurveTo(37, 17, 35.5, 27, 36.5, 38);
    ctx.bezierCurveTo(36.5, 46, 39, 50, 42, 51);
    ctx.lineTo(58, 51);
    ctx.bezierCurveTo(61, 50, 63.5, 46, 63.5, 38);
    ctx.bezierCurveTo(64.5, 27, 63, 17, 50, 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Gezicht.
  ctx.beginPath();
  ctx.ellipse(50, 33, 10.2, 12.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = PAL.huid;
  ctx.fill();
  ctx.strokeStyle = PAL.huidSchaduw;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.strokeStyle = PAL.lijn;
  ctx.lineWidth = 1.1;

  // Ogen met wenkbrauwen.
  for (const ex of [45.3, 54.7]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, 31, 2.1, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.lijn;
    ctx.beginPath();
    ctx.arc(ex, 31.2, 0.95, 0, Math.PI * 2);
    ctx.fill();
    // Wenkbrauw.
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(ex - 2.6, 28.4);
    ctx.quadraticCurveTo(ex, 27, ex + 2.6, 28.4);
    ctx.stroke();
  }

  // Neus.
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(50, 32);
  ctx.quadraticCurveTo(48.7, 36.5, 50.4, 37.2);
  ctx.stroke();

  // Mond.
  if (rank === QUEEN) {
    ctx.fillStyle = PAL.rood;
    ctx.beginPath();
    ctx.ellipse(50, 41, 2.4, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Blosjes.
    ctx.fillStyle = 'rgba(198, 80, 91, 0.25)';
    ctx.beginPath();
    ctx.arc(43.5, 37.5, 2.2, 0, Math.PI * 2);
    ctx.arc(56.5, 37.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(47.2, 41);
    ctx.quadraticCurveTo(50, 42.4, 52.8, 41);
    ctx.stroke();
  }

  // Heer: volle baard en snor. Boer: gladgeschoren.
  if (rank === KING) {
    ctx.fillStyle = PAL.haarGrijs;
    ctx.beginPath();
    ctx.moveTo(41, 37);
    ctx.bezierCurveTo(41, 47, 44, 54, 50, 55.5);
    ctx.bezierCurveTo(56, 54, 59, 47, 59, 37);
    ctx.bezierCurveTo(57, 43, 54.5, 45.5, 50, 45.5);
    ctx.bezierCurveTo(45.5, 45.5, 43, 43, 41, 37);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Snor.
    ctx.beginPath();
    ctx.moveTo(50, 39.4);
    ctx.quadraticCurveTo(45, 38.6, 43.4, 41.2);
    ctx.moveTo(50, 39.4);
    ctx.quadraticCurveTo(55, 38.6, 56.6, 41.2);
    ctx.stroke();
  }

  ctx.lineWidth = 1.1;
}

// ---------------------------------------------------------------------------
// Kroon / baret
// ---------------------------------------------------------------------------

function drawHeaddress(ctx: CanvasRenderingContext2D, rank: Rank, cc: CourtColors): void {
  if (rank === JACK) {
    // Baret met gouden band en veer.
    // Veer (eerst, achter de baret).
    ctx.strokeStyle = cc.accentLicht;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(59, 13);
    ctx.quadraticCurveTo(70, 8, 76, 1.5);
    ctx.stroke();
    ctx.strokeStyle = PAL.lijn;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(59, 13);
    ctx.quadraticCurveTo(70, 8, 76, 1.5);
    ctx.stroke();
    // Baret.
    ctx.beginPath();
    ctx.ellipse(50, 13.5, 16, 6.2, -0.06, 0, Math.PI * 2);
    ctx.fillStyle = cc.accent;
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // Band.
    ctx.beginPath();
    ctx.moveTo(37, 17.5);
    ctx.bezierCurveTo(42, 20.5, 58, 20.5, 63, 17.5);
    ctx.lineTo(63, 21);
    ctx.bezierCurveTo(58, 23.6, 42, 23.6, 37, 21);
    ctx.closePath();
    ctx.fillStyle = PAL.goud;
    ctx.fill();
    ctx.stroke();
    return;
  }

  // Kroon (Heer breed en hoog, Vrouw iets fijner).
  const breed = rank === KING ? 14 : 11.5;
  const top = rank === KING ? 4 : 7;
  const bandY = 17;

  ctx.beginPath();
  ctx.moveTo(50 - breed, bandY);
  ctx.lineTo(50 - breed, bandY - 4);
  // Drie punten.
  ctx.lineTo(50 - breed + 2, top + 3);
  ctx.lineTo(50 - breed / 2, bandY - 6);
  ctx.lineTo(50, top);
  ctx.lineTo(50 + breed / 2, bandY - 6);
  ctx.lineTo(50 + breed - 2, top + 3);
  ctx.lineTo(50 + breed, bandY - 4);
  ctx.lineTo(50 + breed, bandY);
  ctx.closePath();
  ctx.fillStyle = PAL.goud;
  ctx.fill();
  ctx.stroke();

  // Band met juwelen.
  ctx.fillStyle = PAL.goudLicht;
  ctx.fillRect(50 - breed, bandY, breed * 2, 3.6);
  ctx.strokeRect(50 - breed, bandY, breed * 2, 3.6);
  const juwelen = [cc.accent, cc.main, cc.accent] as const;
  juwelen.forEach((kleur, i) => {
    ctx.fillStyle = kleur;
    ctx.beginPath();
    ctx.arc(50 + (i - 1) * breed * 0.62, bandY + 1.8, 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.stroke();
  });
  ctx.lineWidth = 1.1;

  // Pareltjes op de kroonpunten.
  ctx.fillStyle = PAL.wit;
  for (const px of [50 - breed + 2, 50, 50 + breed - 2]) {
    const py = px === 50 ? top : top + 3;
    ctx.beginPath();
    ctx.arc(px, py - 0.6, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.lineWidth = 1.1;
}

// ---------------------------------------------------------------------------
// Attributen: zwaard (Heer), bloem (Vrouw), hellebaard (Boer)
// ---------------------------------------------------------------------------

function drawAttribute(
  ctx: CanvasRenderingContext2D,
  card: Card,
  cc: CourtColors,
  laag: 'achter' | 'voor',
): void {
  switch (card.rank) {
    case KING: {
      if (laag === 'achter') {
        // Zwaard: kling omhoog naast het hoofd.
        const bx = 75.5;
        ctx.fillStyle = PAL.staal;
        ctx.beginPath();
        ctx.moveTo(bx - 1.7, 70);
        ctx.lineTo(bx - 1.7, 26);
        ctx.lineTo(bx, 19.5);
        ctx.lineTo(bx + 1.7, 26);
        ctx.lineTo(bx + 1.7, 70);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Middenrib.
        ctx.strokeStyle = PAL.staalDonker;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(bx, 23);
        ctx.lineTo(bx, 69);
        ctx.stroke();
        ctx.strokeStyle = PAL.lijn;
        ctx.lineWidth = 1.1;
        // Pareerstang + greep.
        ctx.fillStyle = PAL.goud;
        ctx.fillRect(bx - 6.5, 70, 13, 3.2);
        ctx.strokeRect(bx - 6.5, 70, 13, 3.2);
        ctx.fillRect(bx - 1.6, 73.2, 3.2, 9);
        ctx.strokeRect(bx - 1.6, 73.2, 3.2, 9);
        ctx.beginPath();
        ctx.arc(bx, 84.5, 2.3, 0, Math.PI * 2);
        ctx.fillStyle = PAL.goudLicht;
        ctx.fill();
        ctx.stroke();
      } else {
        // Hand om de greep.
        ctx.fillStyle = PAL.huid;
        ctx.beginPath();
        ctx.ellipse(75.5, 76.5, 3.4, 2.8, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case QUEEN: {
      if (laag === 'achter') {
        // Bloemsteel met blaadjes.
        ctx.strokeStyle = PAL.groen;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(69, 78);
        ctx.bezierCurveTo(67, 66, 64.5, 56, 64, 46);
        ctx.stroke();
        ctx.fillStyle = PAL.groen;
        ctx.beginPath();
        ctx.ellipse(68.6, 62, 4, 1.7, -0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = PAL.lijn;
        ctx.lineWidth = 1.1;
      } else {
        // Bloem: krans van blaadjes rond gouden hart.
        const fx = 64;
        const fy = 42.5;
        ctx.fillStyle = cc.accentLicht;
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          ctx.save();
          ctx.translate(fx, fy);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.ellipse(0, -4.1, 2.2, 4.1, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 0.7;
          ctx.stroke();
          ctx.restore();
        }
        ctx.lineWidth = 1.1;
        ctx.fillStyle = PAL.goudLicht;
        ctx.beginPath();
        ctx.arc(fx, fy, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Hand om de steel.
        ctx.fillStyle = PAL.huid;
        ctx.beginPath();
        ctx.ellipse(69, 79, 3.2, 2.7, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    default: {
      // Boer: hellebaard.
      if (laag === 'achter') {
        const px = 76;
        // Schacht.
        ctx.strokeStyle = PAL.goudDonker;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(px, 100);
        ctx.lineTo(px, 8);
        ctx.stroke();
        ctx.strokeStyle = PAL.lijn;
        ctx.lineWidth = 1.1;
        // Bijlblad.
        ctx.fillStyle = PAL.staal;
        ctx.beginPath();
        ctx.moveTo(px - 1, 10);
        ctx.bezierCurveTo(px - 10, 11, px - 12.5, 18, px - 10, 25);
        ctx.bezierCurveTo(px - 6, 22, px - 2.5, 21, px - 1, 21);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Punt.
        ctx.beginPath();
        ctx.moveTo(px - 1.4, 8);
        ctx.lineTo(px, 2.5);
        ctx.lineTo(px + 1.4, 8);
        ctx.closePath();
        ctx.fillStyle = PAL.staal;
        ctx.fill();
        ctx.stroke();
      } else {
        // Hand om de schacht.
        ctx.fillStyle = PAL.huid;
        ctx.beginPath();
        ctx.ellipse(76, 72, 3.2, 2.7, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
  }
}
