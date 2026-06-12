/**
 * src/ui/notifications.ts
 * Toast-meldingen, grote ronde-aankondigingen en keuzedialogen
 * (troefkeuze, dubbelkingen-spelkeuze, eindstand).
 */

import '../styles.css';
import type { Seat, Suit } from '../core/types.ts';
import { SUITS, SUIT_SYMBOLS } from '../core/types.ts';
import type { KingenRoundKind } from '../games/kingen/types.ts';
import { ALL_ROUND_KINDS } from '../games/kingen/types.ts';
import { roundKindExplanation, roundKindName, suitName, t } from './i18n.ts';
import type { ChoiceDialogs, Notifications } from './types.ts';
import { el } from './uiBus.ts';

function wacht(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

// ---------------------------------------------------------------------------
// Meldingen
// ---------------------------------------------------------------------------

export function createNotifications(root: HTMLElement): Notifications {
  const toasts = el('div', 'kg-toasts');
  root.appendChild(toasts);

  const aankondiging = el('div', 'kg-aankondiging');
  aankondiging.hidden = true;
  const aankondigingTekst = el('div', 'kg-aankondiging__tekst');
  aankondiging.appendChild(aankondigingTekst);
  root.appendChild(aankondiging);

  return {
    async toon(tekst, opts): Promise<void> {
      const duur = opts?.duurMs ?? 2200;
      const soort = opts?.soort ?? 'info';
      const toast = el('div', `kg-toast kg-toast--${soort}`, tekst);
      toasts.appendChild(toast);

      // In- en uitfaden via CSS-transities.
      await wacht(20);
      toast.classList.add('is-zichtbaar');
      await wacht(duur);
      toast.classList.remove('is-zichtbaar');
      await wacht(260);
      toast.remove();
    },

    async kondigRondeAan(label: string): Promise<void> {
      aankondigingTekst.textContent = label;
      aankondiging.hidden = false;
      await wacht(20);
      aankondigingTekst.classList.add('is-zichtbaar');
      await wacht(1900);
      aankondigingTekst.classList.remove('is-zichtbaar');
      await wacht(340);
      aankondiging.hidden = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Keuzedialogen
// ---------------------------------------------------------------------------

export function createChoiceDialogs(root: HTMLElement): ChoiceDialogs {
  /**
   * Bouw een modale overlay met paneel; retourneert beide.
   * `kijkdoor`: lichte overlay hoog in beeld zodat de tafel (en de eigen,
   * zojuist gedeelde hand) zichtbaar blijft tijdens de keuze.
   */
  function maakDialoog(
    extraKlasse: string,
    kijkdoor = false,
  ): { overlay: HTMLDivElement; panel: HTMLDivElement } {
    const overlay = el('div', kijkdoor ? 'kg-overlay kg-overlay--kijkdoor' : 'kg-overlay');
    const panel = el('div', `kg-panel ${extraKlasse}`);
    overlay.appendChild(panel);
    root.appendChild(overlay);
    return { overlay, panel };
  }

  return {
    vraagTroef(legal: Suit[]): Promise<Suit> {
      return new Promise((resolve) => {
        const { overlay, panel } = maakDialoog('kg-dialoog', true);
        panel.appendChild(el('h3', undefined, t('dialog.chooseTrump')));
        panel.appendChild(el('p', 'kg-dialoog__sub', t('dialog.chooseTrumpSub')));

        const keuze = el('div', 'kg-troefkeuze');
        for (const suit of SUITS) {
          const knop = el('button', 'kg-troefknop');
          knop.type = 'button';
          knop.disabled = !legal.includes(suit);
          if (knop.disabled) knop.title = t('dialog.suitNotAllowed');
          const sym = el('span',
            `kg-troefknop__symbool ${isRedSuit(suit) ? 'kg-suit-rood' : 'kg-suit-zwart'}`,
            SUIT_SYMBOLS[suit]);
          knop.appendChild(sym);
          knop.appendChild(el('span', 'kg-troefknop__naam', suitName(suit)));
          knop.addEventListener('click', () => {
            overlay.remove();
            resolve(suit);
          });
          keuze.appendChild(knop);
        }
        panel.appendChild(keuze);
      });
    },

    vraagRondeKeuze(available: KingenRoundKind[]): Promise<KingenRoundKind> {
      return new Promise((resolve) => {
        const { overlay, panel } = maakDialoog('kg-dialoog', true);
        panel.appendChild(el('h3', undefined, t('dialog.chooseGame')));
        panel.appendChild(el('p', 'kg-dialoog__sub', t('dialog.chooseGameSub')));

        const lijst = el('div', 'kg-rondekeuze');
        for (const kind of ALL_ROUND_KINDS) {
          const knop = el('button', 'kg-rondeknop');
          knop.type = 'button';
          knop.disabled = !available.includes(kind);

          const tekst = el('div');
          tekst.appendChild(el('div', 'kg-rondeknop__naam', roundKindName(kind)));
          tekst.appendChild(el('div', 'kg-rondeknop__uitleg', roundKindExplanation(kind)));
          knop.appendChild(tekst);
          if (knop.disabled) {
            knop.appendChild(el('span', 'kg-rondeknop__status', t('dialog.unavailable')));
          }

          knop.addEventListener('click', () => {
            overlay.remove();
            resolve(kind);
          });
          lijst.appendChild(knop);
        }
        panel.appendChild(lijst);
      });
    },

    toonEindstand(names: string[], totals: number[], winners: Seat[]): Promise<'opnieuw' | 'setup'> {
      return new Promise((resolve) => {
        const { overlay, panel } = maakDialoog('kg-eindstand');

        panel.appendChild(el('div', 'kg-eindstand__kroon', '♛'));
        panel.appendChild(el('h3', undefined, t('end.title')));

        const winnaarNamen = winners
          .map((s) => names[s])
          .filter((n): n is string => n !== undefined);
        panel.appendChild(el('p', 'kg-eindstand__winnaar',
          winnaarNamen.length > 1
            ? t('end.sharedWin', { names: winnaarNamen.join(t('end.and')) })
            : t('end.wins', { name: winnaarNamen[0] ?? t('end.nobody') })));

        // Ranglijst: gesorteerd op totaal (winnaars bovenaan).
        const volgorde = names
          .map((naam, i) => ({ naam, totaal: totals[i] ?? 0, seat: i }))
          .sort((a, b) =>
            (winners.includes(b.seat as Seat) ? 1 : 0) - (winners.includes(a.seat as Seat) ? 1 : 0)
            || b.totaal - a.totaal);

        const lijst = el('ol', 'kg-eindstand__lijst');
        volgorde.forEach((regel, plek) => {
          const li = el('li', 'kg-eindstand__rij');
          if (winners.includes(regel.seat as Seat)) li.classList.add('is-winnaar');
          li.appendChild(el('span', 'kg-eindstand__plek', `${plek + 1}.`));
          li.appendChild(el('span', 'kg-eindstand__naam', regel.naam));
          li.appendChild(el('span',
            `kg-eindstand__punten ${regel.totaal > 0 ? 'kg-score-pos' : regel.totaal < 0 ? 'kg-score-neg' : 'kg-score-nul'}`,
            regel.totaal > 0 ? `+${regel.totaal}` : String(regel.totaal)));
          lijst.appendChild(li);
        });
        panel.appendChild(lijst);

        const knoppen = el('div', 'kg-eindstand__knoppen');
        const opnieuw = el('button', 'kg-btn kg-btn--groot', t('end.playAgain'));
        opnieuw.type = 'button';
        opnieuw.addEventListener('click', () => {
          overlay.remove();
          resolve('opnieuw');
        });
        const setup = el('button', 'kg-btn kg-btn--stil', t('end.changeSettings'));
        setup.type = 'button';
        setup.addEventListener('click', () => {
          overlay.remove();
          resolve('setup');
        });
        knoppen.append(opnieuw, setup);
        panel.appendChild(knoppen);
      });
    },
  };
}
