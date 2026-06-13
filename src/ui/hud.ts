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
import type { SnelheidNiveau } from '../core/speed.ts';
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

/** Totaalscore met expliciet teken: strafpunten (negatief) vs bonus (positief). */
function scoreTekst(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `−${Math.abs(score)}`; // echte min-teken
  return '0';
}

// Persistente HUD-instellingen (best-effort; localStorage kan geblokkeerd zijn).
const HELDERHEID_KEY = 'kingen.brightness';
const CAMERA_KEY = 'kingen.cameraMotion';
const RONDE_UITLEG_KEY = 'kingen.roundHelp';
const SNELHEID_KEY = 'kingen.speed';

const SNELHEID_NIVEAUS: SnelheidNiveau[] = ['langzaam', 'normaal', 'snel', 'direct'];

/** Het opgeslagen snelheidsniveau (default 'normaal'). */
export function leesSnelheidNiveau(): SnelheidNiveau {
  try {
    const v = window.localStorage.getItem(SNELHEID_KEY) as SnelheidNiveau | null;
    if (v && SNELHEID_NIVEAUS.includes(v)) return v;
  } catch {
    // val terug op default
  }
  return 'normaal';
}

function leesOpgeslagen(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function bewaar(key: string, waarde: string): void {
  try {
    window.localStorage.setItem(key, waarde);
  } catch {
    // Persistentie is best-effort.
  }
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

  // "?"-knop: toont/verbergt het paneel met het doel van de huidige ronde.
  // Zichtbaarheid persist in localStorage; standaard AAN bij eerste gebruik.
  let uitlegAan = leesOpgeslagen(RONDE_UITLEG_KEY) !== '0';
  const infoKnop = el('button', 'kg-hud__info kg-klikbaar', '?');
  infoKnop.type = 'button';

  const troefBadge = el('div', 'kg-hud__troef is-geen');

  rondePaneel.append(rondeBlok, infoKnop, troefBadge);
  hud.appendChild(rondePaneel);

  // Compact uitlegpaneel onder het rondepaneel.
  const uitlegPaneel = el('div', 'kg-hud__uitleg');
  const uitlegKop = el('div', 'kg-hud__uitlegkop', '');
  const uitlegTekst = el('div', 'kg-hud__uitlegtekst', '');
  uitlegPaneel.append(uitlegKop, uitlegTekst);
  uitlegPaneel.hidden = true;
  hud.appendChild(uitlegPaneel);

  infoKnop.addEventListener('click', () => {
    uitlegAan = !uitlegAan;
    bewaar(RONDE_UITLEG_KEY, uitlegAan ? '1' : '0');
    tekenRonde();
  });

  // --- Bovenmidden: spelerschips --------------------------------------
  const spelersStrip = el('div', 'kg-hud__spelers');
  hud.appendChild(spelersStrip);

  interface ChipRefs {
    chip: HTMLDivElement;
    soort: HTMLDivElement;
    slagen: HTMLSpanElement;
    punten: HTMLSpanElement;
  }
  let chips: ChipRefs[] = [];
  let huidigeScores: number[] = [];

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

  // Helderheid: 50-160%, default 100%; werkt direct op de renderer-exposure.
  const helderRegel = el('div', 'kg-menu-regel');
  const helderLabel = el('label');
  helderLabel.htmlFor = 'kg-hud-helderheid';
  const helderRij = el('div', 'kg-slider-rij');
  const helderSlider = el('input', 'kg-slider');
  helderSlider.id = 'kg-hud-helderheid';
  helderSlider.type = 'range';
  helderSlider.min = '50';
  helderSlider.max = '160';
  helderSlider.step = '5';
  const opgeslagenHelderheid = Number(leesOpgeslagen(HELDERHEID_KEY));
  const beginHelderheid =
    Number.isFinite(opgeslagenHelderheid) && opgeslagenHelderheid >= 50 && opgeslagenHelderheid <= 160
      ? opgeslagenHelderheid
      : 100;
  helderSlider.value = String(beginHelderheid);
  const helderWaarde = el('span', 'kg-slider-waarde', `${beginHelderheid}%`);
  helderSlider.addEventListener('input', () => {
    const pct = Number(helderSlider.value);
    helderWaarde.textContent = `${pct}%`;
    bewaar(HELDERHEID_KEY, String(pct));
    emitUiEvent(root, { type: 'brightnessChanged', percent: pct });
  });
  helderRij.append(helderSlider, helderWaarde);
  helderRegel.append(helderLabel, helderRij);
  menu.appendChild(helderRegel);

  // Camerabeweging (muis-parallax): standaard UIT; persist in localStorage.
  const cameraRegel = el('div', 'kg-menu-regel kg-menu-schakel');
  const cameraLabel = el('label');
  cameraLabel.htmlFor = 'kg-hud-camera';
  const cameraToggle = el('input');
  cameraToggle.id = 'kg-hud-camera';
  cameraToggle.type = 'checkbox';
  cameraToggle.checked = leesOpgeslagen(CAMERA_KEY) === '1';
  cameraToggle.addEventListener('change', () => {
    bewaar(CAMERA_KEY, cameraToggle.checked ? '1' : '0');
    emitUiEvent(root, { type: 'cameraMotionChanged', enabled: cameraToggle.checked });
  });
  cameraRegel.append(cameraLabel, cameraToggle);
  menu.appendChild(cameraRegel);

  // Speelsnelheid: schaalt AI-denktijd en animaties; persist in localStorage.
  const snelheidRegel = el('div', 'kg-menu-regel');
  const snelheidLabel = el('label');
  snelheidLabel.htmlFor = 'kg-hud-snelheid';
  const snelheidSelect = el('select', 'kg-select');
  snelheidSelect.id = 'kg-hud-snelheid';
  for (const niveau of SNELHEID_NIVEAUS) {
    const opt = el('option');
    opt.value = niveau;
    snelheidSelect.appendChild(opt);
  }
  snelheidSelect.value = leesSnelheidNiveau();
  snelheidSelect.addEventListener('change', () => {
    const niveau = snelheidSelect.value as SnelheidNiveau;
    bewaar(SNELHEID_KEY, niveau);
    emitUiEvent(root, { type: 'speedChanged', niveau });
  });
  snelheidRegel.append(snelheidLabel, snelheidSelect);
  menu.appendChild(snelheidRegel);

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
    const heeftRonde = huidigeRonde !== null && huidigeRonde.kind !== '';
    if (huidigeRonde && heeftRonde) {
      rondeLabel.textContent = roundKindName(huidigeRonde.kind);
      rondeTeller.textContent = t('hud.roundOf', {
        num: huidigeRonde.index + 1,
        total: huidigeRonde.total,
      });
      uitlegKop.textContent = t('hud.roundGoal');
      uitlegTekst.textContent = roundKindExplanation(huidigeRonde.kind);
    } else {
      rondeLabel.textContent = '—';
      rondeTeller.textContent = '';
      uitlegKop.textContent = '';
      uitlegTekst.textContent = '';
    }
    uitlegPaneel.hidden = !uitlegAan || !heeftRonde;
    infoKnop.classList.toggle('is-actief', uitlegAan);
  }

  function tekenTroef(): void {
    troefBadge.innerHTML = '';
    // Ook in de negatieve rondes (geen troef) tonen we de badge expliciet, zodat
    // de speler ziet dát er geen troef is in plaats van zich af te vragen waar
    // de troefindicator bleef.
    if (huidigeTroef === null) {
      troefBadge.classList.add('is-geen');
      troefBadge.append(el('span', 'kg-troefsymbool', '∅'),
        el('span', undefined, t('hud.noTrump')));
      return;
    }
    troefBadge.classList.remove('is-geen');
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
      // Tellers rechts in de chip: totaal (straf)punten (prominent) en
      // gewonnen slagen deze ronde (klein), zoals in het scorebord.
      const tellers = el('div', 'kg-chip__tellers');
      const score = huidigeScores[i] ?? 0;
      const punten = el('span', 'kg-chip__punten', scoreTekst(score));
      punten.classList.toggle('is-positief', score > 0);
      punten.classList.toggle('is-negatief', score < 0);
      punten.title = t('hud.pointsTitle');
      const slagen = el('span', 'kg-chip__slagen', String(huidigeSlagen[i] ?? 0));
      slagen.title = t('hud.tricksTitle');
      tellers.append(punten, slagen);
      chip.appendChild(tellers);
      chip.classList.toggle('is-aan-beurt', huidigeBeurt !== null && i === huidigeBeurt);
      spelersStrip.appendChild(chip);
      return { chip, soort, slagen, punten };
    });
  }

  /** Statische teksten (knoppen, menu, tooltips) in de actieve taal zetten. */
  function tekenStatisch(): void {
    infoKnop.setAttribute('aria-label', t('hud.roundInfoAria'));
    infoKnop.title = t('hud.roundInfoAria');
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
    helderLabel.textContent = t('hud.brightness');
    cameraLabel.textContent = t('hud.cameraMotion');
    cameraRegel.title = t('hud.cameraMotionHint');
    snelheidLabel.textContent = t('hud.speed');
    for (const opt of snelheidSelect.options) {
      const niveau = opt.value as SnelheidNiveau;
      opt.textContent = t(`hud.speed${niveau.charAt(0).toUpperCase()}${niveau.slice(1)}` as Parameters<typeof t>[0]);
    }
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
    setEnvironment(id: EnvironmentId): void {
      omgevingSelect.value = id;
    },

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

    setScores(totals: number[]): void {
      huidigeScores = totals.slice();
      totals.forEach((score, i) => {
        const refs = chips[i];
        if (!refs) return;
        refs.punten.textContent = scoreTekst(score);
        refs.punten.classList.toggle('is-positief', score > 0);
        refs.punten.classList.toggle('is-negatief', score < 0);
      });
    },

    setPlayers(names: string[], kinds: ('human' | 'ai')[]): void {
      huidigeNamen = names.slice();
      huidigeSoorten = kinds.slice();
      huidigeSlagen = new Array<number>(names.length).fill(0);
      huidigeScores = new Array<number>(names.length).fill(0);
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
