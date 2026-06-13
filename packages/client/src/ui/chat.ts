/**
 * @kingen/client — ui/chat.ts
 * Lichtgewicht chatpaneel voor online spelen (Fase 3): inklapbaar, met een
 * berichtenlijst (eigen vs anderen vs systeem), een invoerregel en een
 * verbindingsstatus-regel. Praat niet zelf met het netwerk; online.ts koppelt
 * onVerstuur → transport.sendChat en transport.onChat → voegToe.
 */

import '../styles.css';
import type { ChatMessage } from '@shared/net/protocol.ts';
import type { Seat } from '@shared/core/types.ts';
import { el } from './uiBus.ts';
import { t, type TranslationKey } from './i18n.ts';

export interface ChatPanel {
  voegToe(msg: ChatMessage): void;
  onVerstuur(cb: (tekst: string) => void): void;
  setEigenStoel(seat: Seat): void;
  /** Verbindingsstatus-regel bovenin (null = verbergen). */
  setStatus(tekst: string | null): void;
  toon(): void;
  verberg(): void;
}

function tijdLabel(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function createChatPanel(root: HTMLElement): ChatPanel {
  let eigenStoel: Seat | null = null;
  let ingeklapt = false;
  let ongelezen = 0;
  let verstuurCb: ((tekst: string) => void) | null = null;

  const paneel = el('div', 'kg-chat');
  paneel.hidden = true;

  const kop = el('button', 'kg-chat__kop');
  kop.type = 'button';
  const kopTitel = el('span', 'kg-chat__titel', t('chat.title'));
  const badge = el('span', 'kg-chat__badge');
  badge.hidden = true;
  const chevron = el('span', 'kg-chat__chevron', '▾');
  kop.append(kopTitel, badge, chevron);
  paneel.appendChild(kop);

  const body = el('div', 'kg-chat__body');
  const statusRegel = el('div', 'kg-chat__status');
  statusRegel.hidden = true;
  const lijst = el('div', 'kg-chat__lijst');
  const invoerRij = el('form', 'kg-chat__invoer');
  const invoer = el('input', 'kg-chat__veld') as HTMLInputElement;
  invoer.type = 'text';
  invoer.maxLength = 300;
  invoer.placeholder = t('chat.placeholder');
  const verstuurKnop = el('button', 'kg-chat__verstuur', t('chat.send')) as HTMLButtonElement;
  verstuurKnop.type = 'submit';
  invoerRij.append(invoer, verstuurKnop);
  body.append(statusRegel, lijst, invoerRij);
  paneel.appendChild(body);

  root.appendChild(paneel);

  function zetIngeklapt(waarde: boolean): void {
    ingeklapt = waarde;
    body.hidden = waarde;
    chevron.textContent = waarde ? '▸' : '▾';
    if (!waarde) {
      ongelezen = 0;
      badge.hidden = true;
    }
  }

  kop.addEventListener('click', () => zetIngeklapt(!ingeklapt));

  invoerRij.addEventListener('submit', (e) => {
    e.preventDefault();
    const tekst = invoer.value.trim();
    if (!tekst) return;
    verstuurCb?.(tekst);
    invoer.value = '';
  });

  return {
    voegToe(msg: ChatMessage): void {
      const isSysteem = msg.from === null;
      const isEigen = !isSysteem && msg.from === eigenStoel;
      const regel = el(
        'div',
        `kg-chat__bericht${isSysteem ? ' is-systeem' : isEigen ? ' is-eigen' : ''}`,
      );
      if (isSysteem) {
        // Systeemmelding in de eigen taal tonen via de meegestuurde i18n-code;
        // valt terug op de letterlijke tekst als de code ontbreekt.
        regel.textContent = msg.systemCode
          ? t(msg.systemCode as TranslationKey, msg.params)
          : msg.tekst;
      } else {
        const meta = el('span', 'kg-chat__meta', `${msg.fromName}${tijdLabel(msg.timestamp) ? ' · ' + tijdLabel(msg.timestamp) : ''}`);
        const tekst = el('span', 'kg-chat__tekst', msg.tekst);
        regel.append(meta, tekst);
      }
      lijst.appendChild(regel);
      lijst.scrollTop = lijst.scrollHeight;
      if (ingeklapt) {
        ongelezen += 1;
        badge.textContent = String(ongelezen);
        badge.hidden = false;
      }
    },
    onVerstuur(cb): void {
      verstuurCb = cb;
    },
    setEigenStoel(seat): void {
      eigenStoel = seat;
    },
    setStatus(tekst): void {
      if (tekst) {
        statusRegel.textContent = tekst;
        statusRegel.hidden = false;
      } else {
        statusRegel.hidden = true;
      }
    },
    toon(): void {
      paneel.hidden = false;
    },
    verberg(): void {
      paneel.hidden = true;
    },
  };
}
