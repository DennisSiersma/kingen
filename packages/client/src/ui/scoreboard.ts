/**
 * src/ui/scoreboard.ts
 * Scorebord-zijpaneel: tabel met per-ronde scores (ScoreRow[]) en totalen,
 * negatieve rondes en troefrondes visueel onderscheiden, beste/slechtste
 * gemarkeerd. Bevat een gereserveerd (uitgeschakeld) chat-tabblad voor de
 * latere online modus. Teksten via i18n; rondenamen worden taalbewust
 * afgeleid uit row.roundKind en bij een taalwissel opnieuw getekend.
 */

import '../styles.css';
import type { ScoreRow } from '@shared/core/scoresheet.ts';
import { onLangChange, roundKindName, t } from './i18n.ts';
import type { Scoreboard } from './types.ts';
import { el } from './uiBus.ts';

function scoreCel(waarde: number): HTMLTableCellElement {
  const td = el('td');
  td.textContent = waarde > 0 ? `+${waarde}` : String(waarde);
  td.className = waarde > 0 ? 'kg-score-pos' : waarde < 0 ? 'kg-score-neg' : 'kg-score-nul';
  return td;
}

export function createScoreboard(root: HTMLElement): Scoreboard {
  const paneel = el('aside', 'kg-scorebord');

  // Laatst getoonde data, zodat een taalwissel opnieuw kan tekenen.
  let laatsteRows: ScoreRow[] = [];
  let laatsteNames: string[] = [];

  // Kop
  const kop = el('div', 'kg-scorebord__kop');
  const titel = el('h3');
  kop.appendChild(titel);
  const sluit = el('button', 'kg-scorebord__sluit', '✕');
  sluit.type = 'button';
  kop.appendChild(sluit);
  paneel.appendChild(kop);

  // Tabbladen: Score actief, Chat gereserveerd voor online multiplayer.
  const tabs = el('div', 'kg-tabs');
  const tabScore = el('button', 'kg-tab is-actief');
  tabScore.type = 'button';
  const tabChat = el('button', 'kg-tab');
  tabChat.type = 'button';
  tabChat.disabled = true;
  const tabChatTekst = document.createTextNode('');
  const tabChatBadge = el('span', 'kg-tab__badge');
  tabChat.append(tabChatTekst, tabChatBadge);
  tabs.append(tabScore, tabChat);
  paneel.appendChild(tabs);

  // Inhoud
  const inhoud = el('div', 'kg-scorebord__inhoud');
  const scoreTab = el('div');
  const chatTab = el('div', 'kg-chat-placeholder');
  chatTab.hidden = true;
  const chatTekst = el('p');
  chatTab.appendChild(chatTekst);
  inhoud.append(scoreTab, chatTab);
  paneel.appendChild(inhoud);

  root.appendChild(paneel);

  /** Statische teksten in de actieve taal. */
  function tekenStatisch(): void {
    paneel.setAttribute('aria-label', t('score.ariaLabel'));
    titel.textContent = t('score.title');
    sluit.title = t('score.close');
    tabScore.textContent = t('score.tabScore');
    tabChatTekst.textContent = t('score.tabChat');
    tabChatBadge.textContent = t('score.chatSoon');
    tabChat.title = t('score.chatLaterTitle');
    chatTekst.textContent = t('score.chatLater');
  }

  /** De scoretabel opnieuw opbouwen vanuit de laatst bekende data. */
  function tekenTabel(): void {
    scoreTab.innerHTML = '';
    if (laatsteRows.length === 0) {
      scoreTab.appendChild(el('p', 'kg-scorebord__leeg', t('score.noRounds')));
      return;
    }

    const tabel = el('table', 'kg-scoretabel');

    // Kop: rondenaam + spelersnamen.
    const thead = el('thead');
    const kopRij = el('tr');
    kopRij.appendChild(el('th', undefined, t('score.roundColumn')));
    for (const naam of laatsteNames) kopRij.appendChild(el('th', undefined, naam));
    thead.appendChild(kopRij);
    tabel.appendChild(thead);

    // Per-ronde rijen; de zichtbare naam komt taalbewust uit roundKind.
    const tbody = el('tbody');
    for (const rij of laatsteRows) {
      const tr = el('tr', rij.roundKind === 'troef' ? 'kg-rij--troef' : 'kg-rij--negatief');
      const naam = roundKindName(rij.roundKind);
      const naamCel = el('td', undefined, `${rij.roundIndex + 1}. ${naam}`);
      naamCel.title = naam;
      tr.appendChild(naamCel);
      for (let i = 0; i < laatsteNames.length; i++) {
        tr.appendChild(scoreCel(rij.scores[i] ?? 0));
      }
      tbody.appendChild(tr);
    }
    tabel.appendChild(tbody);

    // Voet: totalen, beste/slechtste gemarkeerd.
    const laatste = laatsteRows[laatsteRows.length - 1];
    const totalen = laatsteNames.map((_, i) => laatste?.runningTotals[i] ?? 0);
    const beste = Math.max(...totalen);
    const slechtste = Math.min(...totalen);

    const tfoot = el('tfoot');
    const totaalRij = el('tr');
    totaalRij.appendChild(el('td', undefined, t('score.total')));
    totalen.forEach((totaal) => {
      const td = scoreCel(totaal);
      td.classList.remove('kg-score-pos', 'kg-score-neg', 'kg-score-nul');
      if (totaal === beste && beste !== slechtste) {
        td.classList.add('is-beste');
        td.title = t('score.best');
      } else if (totaal === slechtste && beste !== slechtste) {
        td.classList.add('is-slechtste');
        td.title = t('score.worst');
      }
      totaalRij.appendChild(td);
    });
    tfoot.appendChild(totaalRij);
    tabel.appendChild(tfoot);

    scoreTab.appendChild(tabel);
  }

  tekenStatisch();
  tekenTabel();
  onLangChange(() => {
    tekenStatisch();
    tekenTabel();
  });

  const bord: Scoreboard = {
    update(rows: ScoreRow[], names: string[]): void {
      laatsteRows = rows.slice();
      laatsteNames = names.slice();
      tekenTabel();
    },

    show(): void {
      paneel.classList.add('is-open');
    },

    hide(): void {
      paneel.classList.remove('is-open');
    },

    toggle(): void {
      paneel.classList.toggle('is-open');
    },
  };

  sluit.addEventListener('click', () => bord.hide());

  return bord;
}
