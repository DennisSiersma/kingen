/**
 * src/ui/gamePage.ts
 * Spelpagina: per gekozen familie de omschrijving, een variantkiezer (als de
 * familie meerdere varianten heeft) en twee knoppen — lokaal tegen de computer
 * of online tegen anderen. Geeft de keuze (incl. registry-gameId) terug aan
 * main.ts. Taalbewust (NL/EN).
 */

import '../styles.css';
import { el } from './uiBus.ts';
import { onLangChange, t } from './i18n.ts';
import type { GameFamily } from './gameCatalog.ts';

export type GamePageResult =
  | { action: 'local'; gameId: string; family: GameFamily }
  | { action: 'online'; gameId: string; family: GameFamily }
  | { action: 'back' };

export interface GamePage {
  /** Toon de pagina voor `familie` en wacht op een keuze (of terug). */
  toon(familie: GameFamily): Promise<GamePageResult>;
  verberg(): void;
}

export function createGamePage(ui: HTMLElement): GamePage {
  let resolver: ((r: GamePageResult) => void) | null = null;
  let familie: GameFamily | null = null;
  let gekozenGameId = '';

  const overlay = el('div', 'kg-gamepage');
  overlay.hidden = true;

  const kaart = el('div', 'kg-gamepage__kaart');
  overlay.appendChild(kaart);

  const terug = el('button', 'kg-gamepage__terug kg-klikbaar') as HTMLButtonElement;
  terug.type = 'button';
  terug.addEventListener('click', () => resolver?.({ action: 'back' }));
  kaart.appendChild(terug);

  const embleem = el('div', 'kg-gamepage__embleem');
  const titel = el('h2', 'kg-gamepage__titel');
  const desc = el('p', 'kg-gamepage__desc');
  const spelers = el('div', 'kg-gamepage__spelers');
  kaart.append(embleem, titel, desc, spelers);

  // Variantkiezer (alleen zichtbaar bij >1 variant).
  const variantBlok = el('div', 'kg-gamepage__varianten');
  const variantLabel = el('div', 'kg-gamepage__variantlabel');
  const variantKnoppen = el('div', 'kg-gamepage__variantknoppen');
  const variantUitleg = el('div', 'kg-gamepage__variantuitleg');
  variantBlok.append(variantLabel, variantKnoppen, variantUitleg);
  kaart.appendChild(variantBlok);

  // Speelknoppen.
  const knoppen = el('div', 'kg-gamepage__knoppen');
  const lokaalKnop = el('button', 'kg-btn kg-btn--primair kg-btn--groot') as HTMLButtonElement;
  lokaalKnop.type = 'button';
  lokaalKnop.addEventListener('click', () => {
    if (familie) resolver?.({ action: 'local', gameId: gekozenGameId, family: familie });
  });
  const onlineKnop = el('button', 'kg-btn kg-btn--groot') as HTMLButtonElement;
  onlineKnop.type = 'button';
  onlineKnop.addEventListener('click', () => {
    if (familie) resolver?.({ action: 'online', gameId: gekozenGameId, family: familie });
  });
  knoppen.append(lokaalKnop, onlineKnop);
  kaart.appendChild(knoppen);

  ui.appendChild(overlay);

  type Sleutel = import('./i18n.ts').TranslationKey;
  let variantRefs: { knop: HTMLButtonElement; labelKey: Sleutel; descKey: Sleutel }[] = [];

  /** Markeer de gekozen variant en toon de bijbehorende uitleg eronder. */
  function tekenVariantselectie(): void {
    variantRefs.forEach(({ knop }, i) => {
      knop.classList.toggle('is-gekozen', familie?.variants[i]?.gameId === gekozenGameId);
    });
    const gekozen = familie?.variants.find((v) => v.gameId === gekozenGameId);
    variantUitleg.textContent = gekozen ? t(gekozen.descKey) : '';
  }

  function bouwVarianten(): void {
    variantKnoppen.innerHTML = '';
    variantRefs = [];
    if (!familie) return;
    const meer = familie.variants.length > 1;
    variantBlok.hidden = !meer;
    if (!meer) return;
    for (const v of familie.variants) {
      const knop = el('button', 'kg-variantknop kg-klikbaar') as HTMLButtonElement;
      knop.type = 'button';
      knop.addEventListener('click', () => {
        gekozenGameId = v.gameId;
        tekenVariantselectie();
      });
      variantKnoppen.appendChild(knop);
      variantRefs.push({ knop, labelKey: v.labelKey, descKey: v.descKey });
    }
  }

  function teken(): void {
    if (!familie) return;
    terug.textContent = t('gamePage.back');
    embleem.textContent = familie.embleem;
    titel.textContent = t(familie.titleKey);
    desc.textContent = t(familie.descKey);
    spelers.textContent = t('landing.playersBadge', { players: familie.players });
    variantLabel.textContent = t('gamePage.variant');
    variantRefs.forEach(({ knop, labelKey, descKey }) => {
      knop.textContent = t(labelKey);
      knop.title = t(descKey); // tooltip met de variantuitleg
    });
    tekenVariantselectie();
    lokaalKnop.textContent = t('gamePage.playLocal');
    lokaalKnop.title = t('gamePage.playLocalHint');
    onlineKnop.textContent = t('gamePage.playOnline');
    onlineKnop.title = t('gamePage.playOnlineHint');
  }

  onLangChange(() => teken());

  return {
    toon(f: GameFamily): Promise<GamePageResult> {
      familie = f;
      gekozenGameId = f.variants[0]!.gameId;
      overlay.style.setProperty('--accent', f.accent);
      bouwVarianten();
      teken();
      overlay.hidden = false;
      return new Promise<GamePageResult>((resolve) => {
        resolver = (r) => {
          resolver = null;
          overlay.hidden = true;
          resolve(r);
        };
      });
    },
    verberg(): void {
      overlay.hidden = true;
    },
  };
}
