/**
 * src/render/cardArt/suits.ts
 * Vector-paden voor de vier kaartkleuren (♥♦♣♠), getekend als echte
 * bezier-paden (geen font-glyphs) zodat ze op elke resolutie scherp zijn.
 *
 * Alle paden worden getekend in een genormaliseerde "unit box":
 * x en y lopen van -0.5 tot 0.5, y positief = omlaag. Schalen gebeurt via
 * de canvas-transform in drawSuitSymbol.
 */

import type { Suit } from '@shared/core/types.ts';

/** Diep speelkaart-rood. */
export const RED_SUIT = '#c0152d';
/** Bijna-zwart met een vleugje warmte. */
export const BLACK_SUIT = '#1d1c22';

export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

export function suitColor(suit: Suit): string {
  return isRedSuit(suit) ? RED_SUIT : BLACK_SUIT;
}

/**
 * Zet het pad van een kleursymbool uit in de huidige transform-ruimte
 * (unit box van -0.5..0.5). Roept zelf beginPath aan.
 */
export function traceSuitPath(ctx: CanvasRenderingContext2D, suit: Suit): void {
  ctx.beginPath();
  switch (suit) {
    case 'hearts': {
      ctx.moveTo(0, 0.46);
      ctx.bezierCurveTo(-0.34, 0.18, -0.5, -0.02, -0.5, -0.2);
      ctx.bezierCurveTo(-0.5, -0.385, -0.365, -0.5, -0.24, -0.5);
      ctx.bezierCurveTo(-0.12, -0.5, -0.03, -0.425, 0, -0.31);
      ctx.bezierCurveTo(0.03, -0.425, 0.12, -0.5, 0.24, -0.5);
      ctx.bezierCurveTo(0.365, -0.5, 0.5, -0.385, 0.5, -0.2);
      ctx.bezierCurveTo(0.5, -0.02, 0.34, 0.18, 0, 0.46);
      ctx.closePath();
      break;
    }
    case 'diamonds': {
      ctx.moveTo(0, -0.5);
      ctx.quadraticCurveTo(0.09, -0.21, 0.37, 0);
      ctx.quadraticCurveTo(0.09, 0.21, 0, 0.5);
      ctx.quadraticCurveTo(-0.09, 0.21, -0.37, 0);
      ctx.quadraticCurveTo(-0.09, -0.21, 0, -0.5);
      ctx.closePath();
      break;
    }
    case 'spades': {
      // Blad (omgekeerd hart) + uitlopende voet.
      ctx.moveTo(0, -0.5);
      ctx.bezierCurveTo(0.07, -0.36, 0.5, -0.1, 0.5, 0.08);
      ctx.bezierCurveTo(0.5, 0.25, 0.375, 0.33, 0.265, 0.33);
      ctx.bezierCurveTo(0.165, 0.33, 0.085, 0.27, 0.052, 0.185);
      ctx.bezierCurveTo(0.055, 0.305, 0.105, 0.415, 0.185, 0.5);
      ctx.lineTo(-0.185, 0.5);
      ctx.bezierCurveTo(-0.105, 0.415, -0.055, 0.305, -0.052, 0.185);
      ctx.bezierCurveTo(-0.085, 0.27, -0.165, 0.33, -0.265, 0.33);
      ctx.bezierCurveTo(-0.375, 0.33, -0.5, 0.25, -0.5, 0.08);
      ctx.bezierCurveTo(-0.5, -0.1, -0.07, -0.36, 0, -0.5);
      ctx.closePath();
      break;
    }
    case 'clubs': {
      const r = 0.195;
      // Drie blaadjes (cirkels)...
      ctx.arc(0, -0.285, r, 0, Math.PI * 2);
      ctx.moveTo(-0.215 + r, 0.055);
      ctx.arc(-0.215, 0.055, r, 0, Math.PI * 2);
      ctx.moveTo(0.215 + r, 0.055);
      ctx.arc(0.215, 0.055, r, 0, Math.PI * 2);
      // ...en de uitlopende steel.
      ctx.moveTo(0.165, 0.5);
      ctx.bezierCurveTo(0.075, 0.405, 0.048, 0.3, 0.048, 0.1);
      ctx.lineTo(-0.048, 0.1);
      ctx.bezierCurveTo(-0.048, 0.3, -0.075, 0.405, -0.165, 0.5);
      ctx.closePath();
      break;
    }
  }
}

/**
 * Teken een gevuld kleursymbool.
 * @param size hoogte van het symbool in pixels
 * @param color afwijkende vulkleur (default: officiele kaartkleur)
 * @param rotated 180 graden gedraaid (voor de gespiegelde onderhelft)
 */
export function drawSuitSymbol(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  x: number,
  y: number,
  size: number,
  color?: string,
  rotated = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (rotated) ctx.rotate(Math.PI);
  ctx.scale(size, size);
  traceSuitPath(ctx, suit);
  ctx.fillStyle = color ?? suitColor(suit);
  ctx.fill();
  ctx.restore();
}
