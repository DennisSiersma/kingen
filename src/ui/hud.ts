/**
 * src/ui/hud.ts
 * HUD-overlay tijdens het spel: rondenaam + voortgang, troefindicator,
 * beurtindicator, slagentellers en spelersnamen rond de tafel.
 * Rechtsboven: scorebord-knop en instellingenmenu (omgeving wisselen,
 * terug naar setup).
 */

import '../styles.css';
import type { Suit } from '../core/types.ts';
import { SUIT_NAMES_NL, SUIT_SYMBOLS } from '../core/types.ts';
import { ROUND_LABELS_NL } from '../games/kingen/types.ts';
import type { EnvironmentId } from '../render/types.ts';
import { ENVIRONMENT_IDS } from '../render/types.ts';
import type { Hud } from './types.ts';
import { ROUND_EXPLANATIONS_NL, el, emitEnvironmentChange, emitUiEvent } from './uiBus.ts';

const ENV_NAMES: Record<EnvironmentId, string> = {
  cafe: 'Bruin café',
  keukentafel: 'Keukentafel',
  casino: 'Casino',
};

function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

/** Zoek de uitleg bij een rondelabel (HUD krijgt alleen het label binnen). */
function uitlegBijLabel(label: string): string {
  for (const [kind, lbl] of Object.entries(ROUND_LABELS_NL)) {
    if (lbl === label) return ROUND_EXPLANATIONS_NL[kind] ?? '';
  }
  // Troefrondes kunnen als "Troef: ♠ schoppen" o.i.d. binnenkomen.
  if (label.toLowerCase().startsWith('troef')) return ROUND_EXPLANATIONS_NL['troef'] ?? '';
  return 'Speel de slagen volgens de opdracht van deze ronde.';
}

export function createHud(root: HTMLElement): Hud {
  const hud = el('div', 'kg-hud');
  hud.hidden = true;

  // --- Linksboven: ronde + troef -------------------------------------
  const rondePaneel = el('div', 'kg-hud__ronde');

  const rondeBlok = el('div');
  const rondeLabel = el('div', 'kg-hud__rondelabel', '—');
  const rondeTeller = el('div', 'kg-hud__rondeteller', '');
  rondeBlok.append(rondeLabel, rondeTeller);

  const infoKnop = el('button', 'kg-hud__info kg-klikbaar');
  infoKnop.type = 'button';
  infoKnop.setAttribute('aria-label', 'Uitleg van deze ronde');
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
    slagen: HTMLSpanElement;
  }
  let chips: ChipRefs[] = [];

  // --- Rechtsboven: knoppen + instellingenmenu -------------------------
  const knoppen = el('div', 'kg-hud__knoppen');

  const scoreKnop = el('button', 'kg-hud__knop kg-klikbaar', '♛ Scorebord');
  scoreKnop.type = 'button';
  scoreKnop.title = 'Scorebord tonen of verbergen';
  scoreKnop.addEventListener('click', () => emitUiEvent(root, { type: 'toggleScoreboard' }));

  const instelKnop = el('button', 'kg-hud__knop kg-klikbaar', '⚙ Instellingen');
  instelKnop.type = 'button';
  instelKnop.title = 'Instellingen';

  knoppen.append(scoreKnop, instelKnop);
  hud.appendChild(knoppen);

  // Instellingenmenu (uitklapbaar)
  const menu = el('div', 'kg-hud__menu');
  menu.hidden = true;
  menu.appendChild(el('h4', undefined, 'Instellingen'));

  const omgevingRegel = el('div', 'kg-menu-regel');
  const omgevingLabel = el('label', undefined, 'Omgeving');
  omgevingLabel.htmlFor = 'kg-hud-omgeving';
  const omgevingSelect = el('select', 'kg-select');
  omgevingSelect.id = 'kg-hud-omgeving';
  for (const id of ENVIRONMENT_IDS) {
    const opt = el('option', undefined, ENV_NAMES[id]);
    opt.value = id;
    omgevingSelect.appendChild(opt);
  }
  omgevingSelect.addEventListener('change', () => {
    emitEnvironmentChange(root, omgevingSelect.value as EnvironmentId);
  });
  omgevingRegel.append(omgevingLabel, omgevingSelect);
  menu.appendChild(omgevingRegel);

  // Geluid: gereserveerd, nog niet aanwezig in deze versie.
  const geluidRegel = el('div', 'kg-menu-regel kg-menu-uit');
  geluidRegel.appendChild(el('span', undefined, 'Geluid'));
  geluidRegel.appendChild(el('span', 'kg-hint', 'komt later'));
  menu.appendChild(geluidRegel);

  menu.appendChild(el('hr', 'kg-divider'));

  const stopKnop = el('button', 'kg-btn kg-btn--stil', 'Partij afbreken');
  stopKnop.type = 'button';
  stopKnop.style.width = '100%';
  stopKnop.addEventListener('click', () => {
    if (window.confirm('Partij afbreken en terug naar het startscherm?')) {
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
  const claimKnop = el('button', 'kg-hud__claim kg-btn kg-btn--stil kg-klikbaar', '✋ Hand afleggen');
  claimKnop.type = 'button';
  claimKnop.title = 'Leg je hand af en neem in één keer alle resterende strafpunten van deze ronde';
  claimKnop.hidden = true;
  claimKnop.addEventListener('click', () => {
    if (window.confirm('Hand afleggen en alle resterende strafpunten van deze ronde op je nemen?')) {
      emitUiEvent(root, { type: 'claimRequested', seat: 0 });
    }
  });
  hud.appendChild(claimKnop);

  root.appendChild(hud);

  // ------------------------------------------------------------------
  // Publieke API
  // ------------------------------------------------------------------

  return {
    setRound(label: string, index: number, total: number): void {
      rondeLabel.textContent = label;
      rondeTeller.textContent = `Geving ${index + 1} van ${total}`;
      tooltip.textContent = uitlegBijLabel(label);
    },

    setTrump(trump: Suit | null): void {
      troefBadge.classList.toggle('is-leeg', trump === null);
      troefBadge.innerHTML = '';
      if (trump === null) return;
      const sym = el('span', `kg-troefsymbool ${isRedSuit(trump) ? 'kg-suit-rood' : 'kg-suit-zwart'}`,
        SUIT_SYMBOLS[trump]);
      troefBadge.append(el('span', undefined, 'Troef:'), sym,
        el('span', undefined, SUIT_NAMES_NL[trump]));
    },

    setTurn(seat): void {
      chips.forEach((refs, i) => {
        refs.chip.classList.toggle('is-aan-beurt', seat !== null && i === seat);
      });
    },

    setTrickCounts(counts: number[]): void {
      counts.forEach((aantal, i) => {
        const refs = chips[i];
        if (refs) refs.slagen.textContent = String(aantal);
      });
    },

    setPlayers(names: string[], kinds: ('human' | 'ai')[]): void {
      spelersStrip.innerHTML = '';
      chips = names.map((naam, i) => {
        const chip = el('div', 'kg-chip');
        const initiaal = naam.trim().charAt(0).toUpperCase() || '?';
        chip.appendChild(el('div', 'kg-chip__avatar', initiaal));
        const tekst = el('div');
        tekst.appendChild(el('div', 'kg-chip__naam', naam));
        tekst.appendChild(el('div', 'kg-chip__soort', kinds[i] === 'ai' ? 'computer' : 'mens'));
        chip.appendChild(tekst);
        const slagen = el('span', 'kg-chip__slagen', '0');
        slagen.title = 'Gewonnen slagen deze ronde';
        chip.appendChild(slagen);
        spelersStrip.appendChild(chip);
        return { chip, slagen };
      });
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
