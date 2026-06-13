/**
 * @kingen/server — roomManager.ts
 * Beheert meerdere tafels (Rooms): aanmaken (met deelbare code), opzoeken op
 * code, de lobbylijst van open tafels, en het opruimen van lege tafels.
 */

import type { RoomInfo } from '@kingen/shared/net/protocol.ts';
import { DEFAULT_VARIANT } from '@kingen/shared/games/kingen/types.ts';
import { Room } from './room.ts';

export interface RoomManagerOpts {
  maxRooms: number;
  aiThinkDelayMs?: [number, number];
  moveTimeoutMs?: number;
  /** Aangeroepen wanneer de lobbylijst verandert (tafel erbij/af/gewijzigd). */
  onLobbyChange?: () => void;
}

const CODE_ALFABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // zonder verwarrende tekens

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private teller = 0;

  constructor(private readonly opts: RoomManagerOpts) {}

  get aantal(): number {
    return this.rooms.size;
  }

  /** Maak een tafel. Null als het maximum bereikt is. */
  create(naam: string, maxPlayers: number, zichtbaarheid: 'open' | 'prive'): Room | null {
    if (this.rooms.size >= this.opts.maxRooms) return null;
    const id = `r${++this.teller}`;
    const aantal = Math.min(5, Math.max(3, Math.round(maxPlayers))) as 3 | 4 | 5;
    const room = new Room({
      id,
      naam: naam.trim().slice(0, 40) || 'Tafel',
      code: this.uniekeCode(),
      zichtbaarheid,
      variant: { ...DEFAULT_VARIANT, playerCount: aantal },
      aiThinkDelayMs: this.opts.aiThinkDelayMs,
      moveTimeoutMs: this.opts.moveTimeoutMs,
      onChange: () => this.opRoomWijziging(room),
    });
    this.rooms.set(id, room);
    this.opts.onLobbyChange?.();
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  byCode(code: string): Room | undefined {
    const c = code.trim().toUpperCase();
    for (const room of this.rooms.values()) if (room.code === c) return room;
    return undefined;
  }

  /** Open, niet-volle, niet-gestarte tafels voor de lobbylijst. */
  openList(): RoomInfo[] {
    const lijst: RoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.zichtbaarheid === 'open' && !room.bezig && room.aantalVerbonden < room.maxPlayers) {
        lijst.push(room.info());
      }
    }
    return lijst;
  }

  /** Ruim een tafel op zodra hij leeg is en geen partij draait. */
  private opRoomWijziging(room: Room): void {
    if (room.aantalVerbonden === 0 && !room.bezig) {
      this.rooms.delete(room.id);
    }
    this.opts.onLobbyChange?.();
  }

  private uniekeCode(): string {
    for (let poging = 0; poging < 50; poging++) {
      let s = 'K';
      for (let i = 0; i < 4; i++) s += CODE_ALFABET[Math.floor(Math.random() * CODE_ALFABET.length)];
      if (!this.byCode(s)) return s;
    }
    return `K${this.teller}${Math.floor(Math.random() * 9000 + 1000)}`;
  }
}
