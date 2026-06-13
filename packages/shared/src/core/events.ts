/**
 * src/core/events.ts
 * Lichtgewicht, getypeerde EventBus. Wordt gebruikt door engine, render, UI
 * en net-laag om losjes gekoppeld te blijven.
 */

import type { GameEvent, GameEventType } from './types.ts';

export type Listener<E> = (event: E) => void;
export type Unsubscribe = () => void;

/**
 * Generieke event bus over een discriminated union met een `type`-veld.
 * Gebruik: `const bus = new EventBus<GameEvent>();`
 */
export class EventBus<E extends { type: string }> {
  private listeners = new Map<string, Set<Listener<E>>>();
  private anyListeners = new Set<Listener<E>>();

  /** Abonneer op één event-type. Retourneert een unsubscribe-functie. */
  on<T extends E['type']>(type: T, listener: Listener<Extract<E, { type: T }>>): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<E>);
    return () => set!.delete(listener as Listener<E>);
  }

  /** Abonneer op ALLE events (handig voor logging, net-laag, replays). */
  onAny(listener: Listener<E>): Unsubscribe {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  /** Eenmalig abonnement. */
  once<T extends E['type']>(type: T, listener: Listener<Extract<E, { type: T }>>): Unsubscribe {
    const off = this.on(type, (e) => {
      off();
      listener(e);
    });
    return off;
  }

  /** Publiceer een event naar alle relevante listeners (synchroon, in volgorde). */
  emit(event: E): void {
    const set = this.listeners.get(event.type);
    if (set) for (const l of [...set]) l(event);
    for (const l of [...this.anyListeners]) l(event);
  }

  /** Verwijder alle listeners (bij teardown/nieuwe partij). */
  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
  }
}

/** De standaard bus-instantie voor spel-events binnen één client. */
export type GameEventBus = EventBus<GameEvent>;

export function createGameEventBus(): GameEventBus {
  return new EventBus<GameEvent>();
}

export type { GameEvent, GameEventType };
