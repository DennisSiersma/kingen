/**
 * src/ui/hud.ts
 * HUD-overlay tijdens het spel: rondenaam + voortgang, troefindicator,
 * beurtindicator, slagentellers en spelersnamen rond de tafel.
 * Rechtsboven: scorebord-knop en instellingenmenu (omgeving wisselen,
 * taalkeuze, terug naar setup). Alle teksten via src/ui/i18n.ts; bij een
 * taalwissel wordt het HUD live opnieuw getekend vanuit de laatste state.
 */

import '../styles.css';
import type { Seat, Suit } from '../core/types.ts';
import { SUIT_SYMBOLS } from '../core/types.ts';
import type { EnvironmentId } from '../render/types.ts';
import { ENVIRONMENT_IDS } from '../render/types.ts';
import type { Lang } from './i18n.ts';
import {
  environmentName,
  getLang,
  onLangChange,
  roundKindExplanation,
  roundKindName,
  setLang,
  suitName,
  t,
} from './i18n.ts';
import type { Hud } from './types.ts';
import { el, emitEnvironmentChange, emitUiEvent } from './uiBus.ts';

function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

export function createHud(root: HTMLElement): Hud {
  const hud = el('div', 'kg-hud');
  hud.hidden = true;

  // Laatst bekende state, zodat een taalwissel alles opnieuw kan tekenen.
  let huidigeRonde: { kind: string; index: number; total: number } | null = null;
  let huidigeTroef: Suit | null = null;
  let huidigeNamen: string[] = [];
  let huidigeSoorten: ('human' | 'ai')[] = [];
  let huidigeSlagen: number[] = [];
  let huidigeBeurt: Seat | null = null;

  // --- Linksboven: ronde + troef -------------------------------------
  const rondePaneel = el('div', 'kg-hud__ronde');

  const rondeBlok = el('div');
  const rondeLabel = el('div', 'kg-hud__rondelabel', '—');
  const rondeTeller = el('div', 'kg-hud__rondeteller', '');
  rondeBlok.append(rondeLabel, rondeTeller);

  const infoKnop = el('button', 'kg-hud__info kg-klikbaar');
  infoKnop.type = 'button';
  infoKnop.appendChild(el('span', undefined, 'i'));
  const tooltip = el('div', 'kg-hud__tooltip', '');
  infoKnop.appendChild(tooltip);

  const troefBadge = el('div', 'kg-hud__troef is-leeg');

  rondePaneel.append(rondeBlok, infoKnop, troefBadge);
  hud.appendChild(rondePaneel);

  // --- Bovenmidden: spelerschips --------------------------------------
  const spelersStrip = el('div', 'kg-hud__spelers');
  hud.appendChild(spelersStrip);

  interface ChipRefs {
    chip: HTMLDivElement;
    soort: HTMLDivElement;
    slagen: HTMLSpanElement;
  }
  let chips: ChipRefs[] = [];

  // --- Rechtsboven: knoppen + instellingenmenu -------------------------
  const knoppen = el('div', 'kg-hud__knoppen');

  const scoreKnop = el('button', 'kg-hud__knop kg-klikbaar');
  scoreKnop.type = 'button';
  scoreKnop.addEventListener('click', () => emitUiEvent(root, { type: 'toggleScoreboard' }));

  const instelKnop = el('button', 'kg-hud__knop kg-klikbaar');
  instelKnop.type = 'button';

  knoppen.append(scoreKnop, instelKnop);
  hud.appendChild(knoppen);

  // Instellingenmenu (uitklapbaar)
  const menu = el('div', 'kg-hud__menu');
  menu.hidden = true;
  const menuKop = el('h4');
  menu.appendChild(menuKop);

  const omgevingRegel = el('div', 'kg-menu-regel');
  const omgevingLabel = el('label');
  omgevingLabel.htmlFor = 'kg-hud-omgeving';
  const omgevingSelect = el('select', 'kg-select');
  omgevingSelect.id = 'kg-hud-omgeving';
  for (const id of ENVIRONMENT_IDS) {
    const opt = el('option');
    opt.value = id;
    omgevingSelect.appendChild(opt);
  }
  omgevingSelect.addEventListener('change', () => {
    emitEnvironmentChange(root, omgevingSelect.value as EnvironmentId);
  });
  omgevingRegel.append(omgevingLabel, omgevingSelect);
  menu.appendChild(omgevingRegel);

  // Taalkeuze (NL/EN), ook tijdens het spel te wisselen.
  const taalRegel = el('div', 'kg-menu-regel');
  const taalLabel = el('label');
  taalLabel.htmlFor = 'kg-hud-taal';
  const taalSelect = el('select', 'kg-select');
  taalSelect.id = 'kg-hud-taal';
  for (const [lang, naam] of [['nl', 'Nederlands'], ['en', 'English']] as const) {
    const opt = el('option', undefined, naam);
    opt.value = lang;
    taalSelect.appendChild(opt);
  }
  taalSelect.addEventListener('change', () => {
    setLang(taalSelect.value as Lang);
  });
  taalRegel.append(taalLabel, taalSelect);
  menu.appendChild(taalRegel);

  // Geluid: gereserveerd, nog niet aanwezig in deze versie.
  const geluidRegel = el('div', 'kg-menu-regel kg-menu-uit');
  const geluidLabel = el('span');
  const geluidHint = el('span', 'kg-hint');
  geluidRegel.append(geluidLabel, geluidHint);
  menu.appendChild(geluidRegel);

  menu.appendChild(el('hr', 'kg-divider'));

  const stopKnop = el('button', 'kg-btn kg-btn--stil');
  stopKnop.type = 'button';
  stopKnop.style.width = '100%';
  stopKnop.addEventListener('click', () => {
    if (window.confirm(t('hud.quitConfirm'))) {
      menu.hidden = true;
      emitUiEvent(root, { type: 'quitToSetup' });
    }
  });
  menu.appendChild(stopKnop);
  hud.appendChild(menu);

  instelKnop.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) menu.hidden = true;
  });

  // --- Ondermidden: claim-knop (variant 'hand afleggen') ----------------
  const claimKnop = el('button', 'kg-hud__claim kg-btn kg-btn--stil kg-klikbaar');
  claimKnop.type = 'button';
  claimKnop.hidden = true;
  claimKnop.addEventListener('click', () => {
    if (window.confirm(t('hud.claimConfirm'))) {
      emitUiEvent(root, { type: 'claimRequested', seat: 0 });
    }
  });
  hud.appendChild(claimKnop);

  root.appendChild(hud);

  // ------------------------------------------------------------------
  // (Her)tekenen vanuit de laatste state — ook na een taalwissel
  // ------------------------------------------------------------------

  function tekenRonde(): void {
    if (huidigeRonde && huidigeRonde.kind) {
      rondeLabel.textContent = roundKindName(huidigeRonde.kind);
      rondeTeller.textContent = t('hud.roundOf', {
        num: huidigeRonde.index + 1,
        total: huidigeRonde.total,
      });
      tooltip.textContent = roundKindExplanation(huidigeRonde.kind);
    } else {
      rondeLabel.textContent = '—';
      rondeTeller.textContent = '';
      tooltip.textContent = '';
    }
  }

  function tekenTroef(): void {
    troefBadge.classList.toggle('is-leeg', huidigeTroef === null);
    troefBadge.innerHTML = '';
    if (huidigeTroef === null) return;
    const sym = el('span',
      `kg-troefsymbool ${isRedSuit(huidigeTroef) ? 'kg-suit-rood' : 'kg-suit-zwart'}`,
      SUIT_SYMBOLS[huidigeTroef]);
    troefBadge.append(el('span', undefined, t('hud.trumpPrefix')), sym,
      el('span', undefined, suitName(huidigeTroef)));
  }

  function tekenChips(): void {
    spelersStrip.innerHTML = '';
    chips = huidigeNamen.map((naam, i) => {
      const chip = el('div', 'kg-chip');
      const initiaal = naam.trim().charAt(0).toUpperCase() || '?';
      chip.appendChild(el('div', 'kg-chip__avatar', initiaal));
      const tekst = el('div');
      tekst.appendChild(el('div', 'kg-chip__naam', naam));
      const soort = el('div', 'kg-chip__soort',
        huidigeSoorten[i] === 'ai' ? t('hud.chipAi') : t('hud.chipHuman'));
      tekst.appendChild(soort);
      chip.appendChild(tekst);
      const slagen = el('span', 'kg-chip__slagen', String(huidigeSlagen[i] ?? 0));
      slagen.title = t('hud.tricksTitle');
      chip.appendChild(slagen);
      chip.classList.toggle('is-aan-beurt', huidigeBeurt !== null && i === huidigeBeurt);
      spelersStrip.appendChild(chip);
      return { chip, soort, slagen };
    });
  }

  /** Statische teksten (knoppen, menu, tooltips) in de actieve taal zetten. */
  function tekenStatisch(): void {
    infoKnop.setAttribute('aria-label', t('hud.roundInfoAria'));
    scoreKnop.textContent = t('hud.scoreboard');
    scoreKnop.title = t('hud.scoreboardTitle');
    instelKnop.textContent = t('hud.settings');
    instelKnop.title = t('hud.settingsHeading');
    menuKop.textContent = t('hud.settingsHeading');
    omgevingLabel.textContent = t('hud.environment');
    for (const opt of omgevingSelect.options) {
      opt.textContent = environmentName(opt.value as EnvironmentId);
    }
    taalLabel.textContent = t('hud.language');
    taalSelect.value = getLang();
    geluidLabel.textContent = t('hud.sound');
    geluidHint.textContent = t('hud.comingSoon');
    stopKnop.textContent = t('hud.quit');
    claimKnop.textContent = t('hud.claim');
    claimKnop.title = t('hud.claimTitle');
  }

  function tekenAlles(): void {
    tekenStatisch();
    tekenRonde();
    tekenTroef();
    tekenChips();
  }

  tekenAlles();
  onLangChange(() => tekenAlles());

  // ------------------------------------------------------------------
  // Publieke API
  // ------------------------------------------------------------------

  return {
    setRound(kind: string, index: number, total: number): void {
      huidigeRonde = { kind, index, total };
      tekenRonde();
    },

    setTrump(trump: Suit | null): void {
      huidigeTroef = trump;
      tekenTroef();
    },

    setTurn(seat): void {
      huidigeBeurt = seat;
      chips.forEach((refs, i) => {
        refs.chip.classList.toggle('is-aan-beurt', seat !== null && i === seat);
      });
    },

    setTrickCounts(counts: number[]): void {
      huidigeSlagen = counts.slice();
      counts.forEach((aantal, i) => {
        const refs = chips[i];
        if (refs) refs.slagen.textContent = String(aantal);
      });
    },

    setPlayers(names: string[], kinds: ('human' | 'ai')[]): void {
      huidigeNamen = names.slice();
      huidigeSoorten = kinds.slice();
      huidigeSlagen = new Array<number>(names.length).fill(0);
      huidigeBeurt = null;
      tekenChips();
    },

    setClaimAvailable(beschikbaar: boolean): void {
      claimKnop.hidden = !beschikbaar;
    },

    show(): void {
      hud.hidden = false;
    },

    hide(): void {
      hud.hidden = true;
      menu.hidden = true;
      claimKnop.hidden = true;
    },
  };
}
