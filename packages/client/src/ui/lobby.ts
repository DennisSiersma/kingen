/**
 * @kingen/client — ui/lobby.ts
 * Lobby-overlay voor online spelen (Fase 2). Drie fasen in één overlay:
 *  1. naam      — naam invullen + verbinden
 *  2. browser   — open tafels (meedoen), nieuwe tafel maken, meedoen via code
 *  3. wachtkamer — stoelen, deelbare code, starten, verlaten
 * Praat niet zelf met het netwerk; online.ts koppelt de callbacks/methodes.
 */

import '../styles.css';
import type { RoomInfo } from '@shared/net/protocol.ts';
import type { ConnectionState } from '@shared/net/protocol.ts';
import type { Seat } from '@shared/core/types.ts';
import { el } from './uiBus.ts';
import { getLang, onLangChange, setLang, t, type Lang } from './i18n.ts';

export interface CreateOpts {
  naam: string;
  maxPlayers: number;
  zichtbaarheid: 'open' | 'prive';
}

export interface Lobby {
  onConnect(cb: (name: string) => void): void;
  onCreate(cb: (opts: CreateOpts) => void): void;
  onJoinCode(cb: (code: string) => void): void;
  onStart(cb: () => void): void;
  onLeave(cb: () => void): void;
  setStatus(state: ConnectionState): void;
  toonNaam(): void;
  toonBrowser(): void;
  updateRoomList(rooms: RoomInfo[]): void;
  toonWachtkamer(room: RoomInfo, mySeat: Seat): void;
  updateRoom(room: RoomInfo): void;
  getNaam(): string;
  verberg(): void;
}

export function createLobby(ui: HTMLElement, beginNaam: string): Lobby {
  let naam = beginNaam;
  let cbConnect: ((name: string) => void) | null = null;
  let cbCreate: ((o: CreateOpts) => void) | null = null;
  let cbJoinCode: ((code: string) => void) | null = null;
  let cbStart: (() => void) | null = null;
  let cbLeave: (() => void) | null = null;

  const overlay = el('div', 'kg-online-lobby');
  const kaart = el('div', 'kg-online-kaart');
  overlay.appendChild(kaart);

  const kop = el('div', 'kg-online-kop');
  const titel = el('h2', undefined, t('online.title'));
  const taalwissel = el('div', 'kg-lobby-taal');
  const nlKnop = el('button', 'kg-taalwissel__knop', 'NL') as HTMLButtonElement;
  const enKnop = el('button', 'kg-taalwissel__knop', 'EN') as HTMLButtonElement;
  nlKnop.type = 'button';
  enKnop.type = 'button';
  nlKnop.addEventListener('click', () => setLang('nl'));
  enKnop.addEventListener('click', () => setLang('en'));
  taalwissel.append(nlKnop, enKnop);
  kop.append(titel, taalwissel);
  kaart.appendChild(kop);
  const status = el('p', 'kg-online-status', t('online.disconnected'));
  kaart.appendChild(status);

  // --- Fase 1: naam ---
  const naamFase = el('div', 'kg-lobby-fase');
  const naamRij = el('div', 'kg-online-rij');
  const naamInput = el('input', 'kg-online-input') as HTMLInputElement;
  naamInput.type = 'text';
  naamInput.maxLength = 16;
  naamInput.placeholder = t('online.namePlaceholder');
  naamInput.value = beginNaam;
  const verbindKnop = el('button', 'kg-btn', t('online.connect')) as HTMLButtonElement;
  naamRij.append(naamInput, verbindKnop);
  naamFase.appendChild(naamRij);
  kaart.appendChild(naamFase);

  // --- Fase 2: browser ---
  const browserFase = el('div', 'kg-lobby-fase');
  browserFase.hidden = true;
  const kopOpen = el('h3', 'kg-lobby-kop');
  browserFase.appendChild(kopOpen);
  const tafelLijst = el('ul', 'kg-lobby-tafels');
  browserFase.appendChild(tafelLijst);

  browserFase.appendChild(el('hr', 'kg-divider'));
  const kopNieuw = el('h3', 'kg-lobby-kop');
  browserFase.appendChild(kopNieuw);
  const naamTafelInput = el('input', 'kg-online-input') as HTMLInputElement;
  naamTafelInput.type = 'text';
  naamTafelInput.maxLength = 40;
  browserFase.appendChild(naamTafelInput);
  const opt2 = el('div', 'kg-online-rij');
  const spelersTekst = el('span');
  const spelersLabel = el('label', 'kg-lobby-veld');
  const spelersSel = el('select', 'kg-select') as HTMLSelectElement;
  for (const num of [3, 4, 5]) {
    const o = el('option', undefined, String(num));
    o.value = String(num);
    if (num === 4) o.selected = true;
    spelersSel.appendChild(o);
  }
  spelersLabel.append(spelersTekst, spelersSel);
  const zichtbaarTekst = el('span');
  const zichtbaarLabel = el('label', 'kg-lobby-veld');
  const zichtbaarSel = el('select', 'kg-select') as HTMLSelectElement;
  const optOpen = el('option') as HTMLOptionElement;
  optOpen.value = 'open';
  const optPrive = el('option') as HTMLOptionElement;
  optPrive.value = 'prive';
  zichtbaarSel.append(optOpen, optPrive);
  zichtbaarLabel.append(zichtbaarTekst, zichtbaarSel);
  opt2.append(spelersLabel, zichtbaarLabel);
  browserFase.appendChild(opt2);
  const maakKnop = el('button', 'kg-btn kg-btn--primair') as HTMLButtonElement;
  browserFase.appendChild(maakKnop);

  browserFase.appendChild(el('hr', 'kg-divider'));
  const kopCode = el('h3', 'kg-lobby-kop');
  browserFase.appendChild(kopCode);
  const codeRij = el('div', 'kg-online-rij');
  const codeInput = el('input', 'kg-online-input') as HTMLInputElement;
  codeInput.type = 'text';
  codeInput.maxLength = 8;
  const codeKnop = el('button', 'kg-btn') as HTMLButtonElement;
  codeRij.append(codeInput, codeKnop);
  browserFase.appendChild(codeRij);
  kaart.appendChild(browserFase);

  // --- Fase 3: wachtkamer ---
  const wachtFase = el('div', 'kg-lobby-fase');
  wachtFase.hidden = true;
  const wachtKop = el('h3', 'kg-lobby-kop');
  wachtFase.appendChild(wachtKop);
  const codeRegel = el('p', 'kg-lobby-code');
  wachtFase.appendChild(codeRegel);
  const stoelenLijst = el('ul', 'kg-online-stoelen');
  wachtFase.appendChild(stoelenLijst);
  const startKnop = el('button', 'kg-btn kg-btn--primair') as HTMLButtonElement;
  const verlaatKnop = el('button', 'kg-btn kg-btn--stil') as HTMLButtonElement;
  wachtFase.append(startKnop, verlaatKnop);
  kaart.appendChild(wachtFase);

  const terugLink = el('a', 'kg-online-terug') as HTMLAnchorElement;
  terugLink.href = location.pathname;
  kaart.appendChild(terugLink);

  ui.appendChild(overlay);

  // Onthoud de laatst getoonde data zodat hertekenen (taalwissel) klopt.
  let huidigeRooms: RoomInfo[] = [];
  let huidigeRoom: RoomInfo | null = null;

  /** (Her)zet alle zichtbare teksten in de actieve taal. */
  function herteken(): void {
    titel.textContent = t('online.title');
    naamInput.placeholder = t('online.namePlaceholder');
    verbindKnop.textContent = t('online.connect');
    kopOpen.textContent = t('lobby.openTables');
    kopNieuw.textContent = t('lobby.newTable');
    spelersTekst.textContent = t('lobby.players');
    zichtbaarTekst.textContent = t('lobby.visibility');
    optOpen.textContent = t('lobby.open');
    optPrive.textContent = t('lobby.private');
    maakKnop.textContent = t('lobby.create');
    kopCode.textContent = t('lobby.joinByCode');
    naamTafelInput.placeholder = t('lobby.defaultTableName', { name: naam });
    codeInput.placeholder = t('lobby.codePlaceholder');
    codeKnop.textContent = t('lobby.join');
    wachtKop.textContent = t('lobby.waitingRoom');
    startKnop.textContent = t('online.start');
    verlaatKnop.textContent = t('lobby.leave');
    terugLink.textContent = t('online.backLocal');
    nlKnop.classList.toggle('is-actief', getLang() === 'nl');
    enKnop.classList.toggle('is-actief', getLang() === 'en');
    tekenTafels(huidigeRooms);
    if (huidigeRoom) codeRegel.textContent = t('lobby.shareCode', { code: huidigeRoom.code ?? '' });
  }

  // --- gedrag ---
  verbindKnop.addEventListener('click', () => {
    naam = naamInput.value.trim() || t('online.defaultName');
    verbindKnop.disabled = true;
    naamInput.disabled = true;
    cbConnect?.(naam);
  });
  maakKnop.addEventListener('click', () => {
    const tafelNaam = naamTafelInput.value.trim() || t('lobby.defaultTableName', { name: naam });
    cbCreate?.({
      naam: tafelNaam,
      maxPlayers: Number(spelersSel.value),
      zichtbaarheid: zichtbaarSel.value as 'open' | 'prive',
    });
  });
  codeKnop.addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (code) cbJoinCode?.(code);
  });
  startKnop.addEventListener('click', () => cbStart?.());
  verlaatKnop.addEventListener('click', () => cbLeave?.());

  function toonFase(welke: 'naam' | 'browser' | 'wacht'): void {
    overlay.hidden = false;
    naamFase.hidden = welke !== 'naam';
    browserFase.hidden = welke !== 'browser';
    wachtFase.hidden = welke !== 'wacht';
  }

  function tekenTafels(rooms: RoomInfo[]): void {
    tafelLijst.innerHTML = '';
    if (rooms.length === 0) {
      tafelLijst.appendChild(el('li', 'kg-lobby-leeg', t('lobby.noTables')));
      return;
    }
    for (const room of rooms) {
      const li = el('li', 'kg-lobby-tafel');
      li.appendChild(el('span', 'kg-lobby-tafel__naam', `${room.naam} (${room.players.length}/${room.maxPlayers})`));
      const knop = el('button', 'kg-btn kg-btn--klein', t('lobby.join')) as HTMLButtonElement;
      knop.addEventListener('click', () => {
        if (room.code) cbJoinCode?.(room.code);
      });
      li.appendChild(knop);
      tafelLijst.appendChild(li);
    }
  }

  function tekenStoelen(room: RoomInfo, mySeat?: Seat): void {
    stoelenLijst.innerHTML = '';
    for (const p of room.players) {
      stoelenLijst.appendChild(
        el('li', undefined, `${p.seat + 1}. ${p.config.name}${p.seat === mySeat ? ' (jij)' : ''}`),
      );
    }
  }

  let mijnStoel: Seat | undefined;

  herteken();
  onLangChange(() => herteken());

  return {
    onConnect(cb) {
      cbConnect = cb;
    },
    onCreate(cb) {
      cbCreate = cb;
    },
    onJoinCode(cb) {
      cbJoinCode = cb;
    },
    onStart(cb) {
      cbStart = cb;
    },
    onLeave(cb) {
      cbLeave = cb;
    },
    setStatus(state) {
      if (state === 'connecting') status.textContent = t('online.connecting');
      else if (state === 'connected') status.textContent = t('online.connected');
      else status.textContent = t('online.disconnected');
    },
    toonNaam() {
      toonFase('naam');
    },
    toonBrowser() {
      naamTafelInput.placeholder = t('lobby.defaultTableName', { name: naam });
      toonFase('browser');
    },
    updateRoomList(rooms) {
      huidigeRooms = rooms;
      tekenTafels(rooms);
    },
    toonWachtkamer(room, mySeat) {
      mijnStoel = mySeat;
      huidigeRoom = room;
      codeRegel.textContent = t('lobby.shareCode', { code: room.code ?? '' });
      tekenStoelen(room, mySeat);
      toonFase('wacht');
    },
    updateRoom(room) {
      huidigeRoom = room;
      tekenStoelen(room, mijnStoel);
    },
    getNaam() {
      return naam;
    },
    verberg() {
      overlay.hidden = true;
    },
  };
}
