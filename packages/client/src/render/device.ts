/**
 * @kingen/client — render/device.ts
 * Eén bron van waarheid voor "is dit een compact/low-power toestel?" (telefoon of
 * tablet, touch-bediening). Bij true kiezen de render-laag, de kaart-textures en
 * de omgevingen een lichter pad: kleinere textures, geen anti-aliasing, goedkopere
 * schaduwen en een lagere pixel-ratio. Zo vermijden we iOS-geheugendruk/context-
 * loss en oververhitting. Desktop (pointer: fine) houdt de volledige kwaliteit.
 *
 * Gememoïseerd: de toestelklasse verandert niet tijdens een sessie.
 */

let memo: boolean | null = null;

export function isCompactDevice(): boolean {
  if (memo !== null) return memo;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
  memo = coarse || touch;
  return memo;
}
