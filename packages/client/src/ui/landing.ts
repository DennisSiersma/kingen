/**
 * src/ui/landing.ts
 * Landingsgalerij: kies een kaartspel uit een raster van tegels. Praat niet met
 * het netwerk of de engine; de aanroeper (main.ts) krijgt de gekozen familie en
 * gaat naar de spelpagina. Taalbewust (NL/EN) en herbruikbaar (toon/verberg).
 */

import '../styles.css';
import { el } from './uiBus.ts';
import { getLang, onLangChange, setLang, t } from './i18n.ts';
import { GAME_FAMILIES, type GameFamily } from './gameCatalog.ts';

export interface Landing {
  /** Toon de galerij en wacht tot de speler een spel kiest. */
  kies(): Promise<GameFamily>;
  toon(): void;
  verberg(): void;
}

export function createLanding(ui: HTMLElement): Landing {
  let resolver: ((f: GameFamily) => void) | null = null;

  const overlay = el('div', 'kg-landing');
  overlay.hidden = true;

  const kop = el('div', 'kg-landing__kop');
  const titel = el('h1', 'kg-landing__titel');
  const sub = el('p', 'kg-landing__sub');
  const taal = el('div', 'kg-lobby-taal');
  const nlKnop = el('button', 'kg-taalwissel__knop', 'NL') as HTMLButtonElement;
  const enKnop = el('button', 'kg-taalwissel__knop', 'EN') as HTMLButtonElement;
  nlKnop.type = 'button';
  enKnop.type = 'button';
  nlKnop.addEventListener('click', () => setLang('nl'));
  enKnop.addEventListener('click', () => setLang('en'));
  taal.append(nlKnop, enKnop);
  const kopTekst = el('div');
  kopTekst.append(titel, sub);
  kop.append(kopTekst, taal);
  overlay.appendChild(kop);

  const raster = el('div', 'kg-landing__raster');
  overlay.appendChild(raster);

  interface TegelRefs {
    titel: HTMLElement;
    desc: HTMLElement;
    spelers: HTMLElement;
  }
  const tegels: TegelRefs[] = [];

  for (const familie of GAME_FAMILIES) {
    const tegel = el('button', 'kg-tegel kg-klikbaar') as HTMLButtonElement;
    tegel.type = 'button';
    tegel.style.setProperty('--accent', familie.accent);
    const embleem = el('div', 'kg-tegel__embleem', familie.embleem);
    const tTitel = el('div', 'kg-tegel__titel');
    const tDesc = el('div', 'kg-tegel__desc');
    const tSpelers = el('div', 'kg-tegel__spelers');
    tegel.append(embleem, tTitel, tDesc, tSpelers);
    tegel.addEventListener('click', () => resolver?.(familie));
    raster.appendChild(tegel);
    tegels.push({ titel: tTitel, desc: tDesc, spelers: tSpelers });
  }

  ui.appendChild(overlay);

  function teken(): void {
    titel.textContent = t('landing.title');
    sub.textContent = t('landing.subtitle');
    nlKnop.classList.toggle('is-actief', getLang() === 'nl');
    enKnop.classList.toggle('is-actief', getLang() === 'en');
    GAME_FAMILIES.forEach((familie, i) => {
      const refs = tegels[i];
      if (!refs) return;
      refs.titel.textContent = t(familie.titleKey);
      refs.desc.textContent = t(familie.descKey);
      refs.spelers.textContent = t('landing.playersBadge', { players: familie.players });
    });
  }

  teken();
  onLangChange(() => teken());

  return {
    kies(): Promise<GameFamily> {
      overlay.hidden = false;
      return new Promise<GameFamily>((resolve) => {
        resolver = (f) => {
          resolver = null;
          resolve(f);
        };
      });
    },
    toon(): void {
      overlay.hidden = false;
    },
    verberg(): void {
      overlay.hidden = true;
    },
  };
}
