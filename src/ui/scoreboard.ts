/**
 * src/ui/scoreboard.ts
 * Scorebord-zijpaneel: tabel met per-geving scores (ScoreRow[]) en totalen,
 * negatieve rondes en troefrondes visueel onderscheiden, beste/slechtste
 * gemarkeerd. Bevat een gereserveerd (uitgeschakeld) chat-tabblad voor de
 * latere online modus.
 */

import '../styles.css';
import type { ScoreRow } from '../core/scoresheet.ts';
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
  paneel.setAttribute('aria-label', 'Scorebord');

  // Kop
  const kop = el('div', 'kg-scorebord__kop');
  kop.appendChild(el('h3', undefined, 'Scorebord'));
  const sluit = el('button', 'kg-scorebord__sluit', '✕');
  sluit.type = 'button';
  sluit.title = 'Sluiten';
  kop.appendChild(sluit);
  paneel.appendChild(kop);

  // Tabbladen: Score actief, Chat gereserveerd voor online multiplayer.
  const tabs = el('div', 'kg-tabs');
  const tabScore = el('button', 'kg-tab is-actief', 'Score');
  tabScore.type = 'button';
  const tabChat = el('button', 'kg-tab');
  tabChat.type = 'button';
  tabChat.disabled = true;
  tabChat.append(document.createTextNode('Chat'), el('span', 'kg-tab__badge', 'binnenkort'));
  tabChat.title = 'Online chat komt later';
  tabs.append(tabScore, tabChat);
  paneel.appendChild(tabs);

  // Inhoud
  const inhoud = el('div', 'kg-scorebord__inhoud');
  const scoreTab = el('div');
  scoreTab.appendChild(el('p', 'kg-scorebord__leeg', 'Nog geen gevingen gespeeld.'));
  const chatTab = el('div', 'kg-chat-placeholder');
  chatTab.hidden = true;
  chatTab.appendChild(el('p', undefined, 'Online chat komt later.'));
  inhoud.append(scoreTab, chatTab);
  paneel.appendChild(inhoud);

  root.appendChild(paneel);

  const bord: Scoreboard = {
    update(rows: ScoreRow[], names: string[]): void {
      scoreTab.innerHTML = '';
      if (rows.length === 0) {
        scoreTab.appendChild(el('p', 'kg-scorebord__leeg', 'Nog geen gevingen gespeeld.'));
        return;
      }

      const tabel = el('table', 'kg-scoretabel');

      // Kop: rondenaam + spelersnamen.
      const thead = el('thead');
      const kopRij = el('tr');
      kopRij.appendChild(el('th', undefined, 'Geving'));
      for (const naam of names) kopRij.appendChild(el('th', undefined, naam));
      thead.appendChild(kopRij);
      tabel.appendChild(thead);

      // Per-geving rijen.
      const tbody = el('tbody');
      for (const rij of rows) {
        const tr = el('tr', rij.roundKind === 'troef' ? 'kg-rij--troef' : 'kg-rij--negatief');
        const naamCel = el('td', undefined, `${rij.roundIndex + 1}. ${rij.roundLabel}`);
        naamCel.title = rij.roundLabel;
        tr.appendChild(naamCel);
        for (let i = 0; i < names.length; i++) {
          tr.appendChild(scoreCel(rij.scores[i] ?? 0));
        }
        tbody.appendChild(tr);
      }
      tabel.appendChild(tbody);

      // Voet: totalen, beste/slechtste gemarkeerd.
      const laatste = rows[rows.length - 1];
      const totalen = names.map((_, i) => laatste?.runningTotals[i] ?? 0);
      const beste = Math.max(...totalen);
      const slechtste = Math.min(...totalen);

      const tfoot = el('tfoot');
      const totaalRij = el('tr');
      totaalRij.appendChild(el('td', undefined, 'Totaal'));
      totalen.forEach((totaal) => {
        const td = scoreCel(totaal);
        td.classList.remove('kg-score-pos', 'kg-score-neg', 'kg-score-nul');
        if (totaal === beste && beste !== slechtste) {
          td.classList.add('is-beste');
          td.title = 'Beste score';
        } else if (totaal === slechtste && beste !== slechtste) {
          td.classList.add('is-slechtste');
          td.title = 'Slechtste score';
        }
        totaalRij.appendChild(td);
      });
      tfoot.appendChild(totaalRij);
      tabel.appendChild(tfoot);

      scoreTab.appendChild(tabel);
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
