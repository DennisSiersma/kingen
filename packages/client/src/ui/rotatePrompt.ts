/**
 * @kingen/client — ui/rotatePrompt.ts
 * Landscape-first draai-prompt voor mobiel. De 3D-speeltafel (kaart- én
 * dobbelscene) is op een brede beeldverhouding afgesteld en is in portret op
 * een telefoon onbruikbaar; daarom tonen we tijdens een 3D-partij in portret op
 * een touch-toestel een nette overlay "draai je toestel".
 *
 * Scene-agnostisch: i.p.v. de render-code aan te raken koppelen we de zichtbaar-
 * heid aan de aanwezigheid van een <canvas> in #app (createSceneManager voegt er
 * één toe en haalt 'm weg bij dispose). De overlay zelf wordt puur door CSS
 * getoond/verborgen op basis van oriëntatie + pointer-type; deze module schakelt
 * alleen de body-klasse `kg-in-game` en houdt de tekst tweetalig.
 */

import '../styles.css';
import { el } from './uiBus.ts';
import { onLangChange, t } from './i18n.ts';

/**
 * Installeert de draai-prompt eenmalig. Veilig om vroeg in main() aan te roepen,
 * vóór een eventuele online-redirect.
 */
export function installRotatePrompt(uiRoot: HTMLElement, app: HTMLElement): void {
  const overlay = el('div', 'kg-draai');
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');

  const icoon = el('div', 'kg-draai__icoon', '📱↻');
  const titel = el('h2', 'kg-draai__titel');
  const tekst = el('p', 'kg-draai__tekst');
  overlay.append(icoon, titel, tekst);
  uiRoot.appendChild(overlay);

  const hertaal = (): void => {
    titel.textContent = t('rotate.title');
    tekst.textContent = t('rotate.body');
  };
  hertaal();
  onLangChange(hertaal);

  // `kg-in-game` aan zodra er een 3D-canvas in #app staat, eraf zodra het weg is.
  const sync = (): void => {
    const inGame = app.querySelector('canvas') !== null;
    document.body.classList.toggle('kg-in-game', inGame);
  };
  sync();
  new MutationObserver(sync).observe(app, { childList: true });
}
