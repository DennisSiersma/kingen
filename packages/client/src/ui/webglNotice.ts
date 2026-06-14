/**
 * @kingen/client — ui/webglNotice.ts
 * Overlay die verschijnt wanneer de WebGL-context verloren gaat (iOS Safari dumpt
 * 'm bij geheugendruk/tab-wissel). Zonder dit blijft het 3D-canvas permanent zwart;
 * nu krijgt de speler een leesbare melding met een 'herlaad'-knop. Verdwijnt weer
 * als de browser de context herstelt.
 *
 * Path-agnostisch: scene.ts (render-laag) seint via window-events
 * 'kg-webgl-context-lost' / 'kg-webgl-context-restored'; deze UI-laag toont de
 * tekst tweetalig. Eénmalig installeren in main(), net als de draai-prompt.
 */

import '../styles.css';
import { el } from './uiBus.ts';
import { onLangChange, t } from './i18n.ts';

export function installWebglNotice(uiRoot: HTMLElement): void {
  const overlay = el('div', 'kg-webgl-notice');
  overlay.setAttribute('role', 'alertdialog');
  overlay.hidden = true;

  const titel = el('h2', 'kg-webgl-notice__titel');
  const tekst = el('p', 'kg-webgl-notice__tekst');
  const knop = el('button', 'kg-btn kg-webgl-notice__knop');
  knop.addEventListener('click', () => location.reload());
  overlay.append(titel, tekst, knop);
  uiRoot.appendChild(overlay);

  const hertaal = (): void => {
    titel.textContent = t('webgl.lostTitle');
    tekst.textContent = t('webgl.lostBody');
    knop.textContent = t('webgl.reload');
  };
  hertaal();
  onLangChange(hertaal);

  window.addEventListener('kg-webgl-context-lost', () => {
    overlay.hidden = false;
  });
  window.addEventListener('kg-webgl-context-restored', () => {
    overlay.hidden = true;
  });
}
