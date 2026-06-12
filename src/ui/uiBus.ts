/**
 * src/ui/uiBus.ts
 * Lichtgewicht event-doorgeefluik van de DOM-overlay naar de app-laag.
 *
 * UI-componenten dispatchen UiEvents als CustomEvent op het #ui-root-element;
 * main.ts abonneert zich met `onUiEvent(root, handler)`. Zo blijft de UI
 * volledig losgekoppeld van de engine (geen directe engine-imports).
 */

import type { UiEvent } from './types.ts';
import type { EnvironmentId } from '../render/types.ts';

/** Naam van het CustomEvent waarmee UiEvents over het root-element lopen. */
export const UI_EVENT_NAME = 'kingen-ui-event';

/** Apart kanaal voor live omgevingswissel vanuit het HUD-instellingenmenu. */
export const UI_ENVIRONMENT_EVENT_NAME = 'kingen-ui-environment';

/** Verstuur een UiEvent vanaf een UI-component. */
export function emitUiEvent(target: EventTarget, event: UiEvent): void {
  target.dispatchEvent(new CustomEvent<UiEvent>(UI_EVENT_NAME, { detail: event, bubbles: true }));
}

/** Abonneer op UiEvents (voor main.ts). Retourneert een unsubscribe-functie. */
export function onUiEvent(target: EventTarget, handler: (event: UiEvent) => void): () => void {
  const listener = (e: Event): void => {
    handler((e as CustomEvent<UiEvent>).detail);
  };
  target.addEventListener(UI_EVENT_NAME, listener);
  return () => target.removeEventListener(UI_EVENT_NAME, listener);
}

/** Verstuur een verzoek om live van omgeving te wisselen. */
export function emitEnvironmentChange(target: EventTarget, id: EnvironmentId): void {
  target.dispatchEvent(
    new CustomEvent<EnvironmentId>(UI_ENVIRONMENT_EVENT_NAME, { detail: id, bubbles: true }),
  );
}

/** Abonneer op omgevingswissel-verzoeken. */
export function onEnvironmentChange(
  target: EventTarget,
  handler: (id: EnvironmentId) => void,
): () => void {
  const listener = (e: Event): void => {
    handler((e as CustomEvent<EnvironmentId>).detail);
  };
  target.addEventListener(UI_ENVIRONMENT_EVENT_NAME, listener);
  return () => target.removeEventListener(UI_ENVIRONMENT_EVENT_NAME, listener);
}

// ---------------------------------------------------------------------------
// Kleine DOM-hulpjes (gedeeld door alle UI-modules)
// ---------------------------------------------------------------------------

/** Maak een element met optionele class en tekstinhoud. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** querySelector die gegarandeerd iets oplevert (gooit anders). */
export function must<T extends Element>(parent: ParentNode, selector: string): T {
  const found = parent.querySelector<T>(selector);
  if (!found) throw new Error(`UI-element niet gevonden: ${selector}`);
  return found;
}

/** Korte Nederlandse uitleg per Kingen-rondesoort (HUD-tooltip, dialogen, setup). */
export const ROUND_EXPLANATIONS_NL: Readonly<Record<string, string>> = {
  geenSlagen: 'Elke gewonnen slag kost 1 strafpunt. Vermijd dus elke slag.',
  geenHarten: 'Elke hartenkaart in je gewonnen slagen kost 1 strafpunt.',
  geenHerenBoeren: 'Elke heer of boer die je binnenhaalt kost 1 strafpunt.',
  geenDames: 'Elke dame die je binnenhaalt kost 2 strafpunten.',
  hartenheer: 'Wie de hartenheer (de King) pakt, krijgt de volle straf. De ronde kan stoppen zodra hij valt.',
  zevenLaatste: 'De zevende slag kost 2 strafpunten, de allerlaatste slag 3.',
  troef: 'Positieve ronde: elke gewonnen slag levert 1 punt op. Er geldt een troefkleur.',
};
