/**
 * @kingen/client — net/wsTransport.ts
 * Transport-implementatie over een echte WebSocket naar de server. Spiegelt
 * LocalTransport, maar stuurt/ontvangt NetMessages over het netwerk. De room-
 * methodes zijn in Fase 1 nog minimaal (de server zet je bij verbinden in de
 * ene room 'ONLINE'); Fase 2 maakt er volwaardige lobby-calls van.
 */

import type {
  ChatMessage,
  ConnectionState,
  MessageHandler,
  NetMessage,
  RoomInfo,
  Transport,
  Unsubscribe,
} from '@shared/net/protocol.ts';
import type { PlayerConfig, Seat } from '@shared/core/types.ts';

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();
  private readonly chatHandlers = new Set<(message: ChatMessage) => void>();

  constructor(private readonly url: string) {}

  get state(): ConnectionState {
    return this.connectionState;
  }

  private setState(state: ConnectionState): void {
    if (state === this.connectionState) return;
    this.connectionState = state;
    for (const handler of [...this.stateHandlers]) handler(state);
  }

  connect(): Promise<void> {
    if (this.connectionState === 'connected') return Promise.resolve();
    this.setState('connecting');
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.setState('connected');
        resolve();
      });
      ws.addEventListener('message', (ev) => {
        let msg: NetMessage;
        try {
          msg = JSON.parse(String(ev.data)) as NetMessage;
        } catch {
          return;
        }
        for (const handler of [...this.messageHandlers]) handler(msg);
        if (msg.kind === 'chat') {
          for (const handler of [...this.chatHandlers]) handler(msg.message);
        }
      });
      ws.addEventListener('close', () => this.setState('disconnected'));
      ws.addEventListener('error', () => {
        if (this.connectionState === 'connecting') reject(new Error('WebSocket-verbinding mislukt'));
        this.setState('disconnected');
      });
    });
  }

  async disconnect(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }

  send(message: NetMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  // --- Rooms (Fase 2: volwaardige lobby; Fase 1 doet de server impliciet) ---
  createRoom(_naam: string, _gameId: string, _maxPlayers: number): Promise<RoomInfo> {
    return Promise.reject(new Error('createRoom: lobby volgt in Fase 2'));
  }
  joinRoom(_roomId: string, _player: PlayerConfig): Promise<{ room: RoomInfo; seat: Seat }> {
    return Promise.reject(new Error('joinRoom: lobby volgt in Fase 2'));
  }
  leaveRoom(_roomId: string): Promise<void> {
    return Promise.resolve();
  }
  listRooms(): Promise<RoomInfo[]> {
    return Promise.resolve([]);
  }

  // --- Chat ---
  sendChat(roomId: string, tekst: string): void {
    this.send({
      kind: 'chat',
      message: { id: '', roomId, from: null, fromName: '', tekst, timestamp: 0 },
    });
  }
  onChat(handler: (message: ChatMessage) => void): Unsubscribe {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }
}

/** WebSocket-URL: in dev via de Vite-proxy (/ws → server), in productie same-origin. */
export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
