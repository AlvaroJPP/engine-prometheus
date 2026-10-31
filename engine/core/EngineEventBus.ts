/**
 * Engine Event Bus
 *
 * High-performance event system with type-safe event handling,
 * priority-based listeners, and async support.
 */

import type { EngineEventMap, EngineEvents } from './EngineEvents.js';

export type EventName = string | symbol;

export interface EventMap {
  [key: EventName]: any;
}

export interface ListenerOptions {
  /** Priority (higher = called first) */
  priority?: number;

  /** Call once then remove */
  once?: boolean;

  /** Filter predicate */
  filter?: (event: any) => boolean;

  /** Async handler */
  async?: boolean;
}

export type EventListener<T = any> = (event: T) => void | Promise<void>;

export interface ListenerEntry<T = any> {
  listener: EventListener<T>;
  options: ListenerOptions;
  id: number;
}

/**
 * Typed Event Bus implementation
 */
export class EngineEventBus<E extends EventMap = EventMap> {
  private listeners = new Map<EventName, ListenerEntry[]>();
  private listenerId = 0;
  private eventHistory: { name: EventName; data: any; timestamp: number }[] = [];
  private maxHistory = 100;
  private isDispatching = false;
  private pendingRemovals = new Set<number>();

  /**
   * Subscribe to an event
   */
  on<K extends keyof E>(event: K, listener: EventListener<E[K]>, options: ListenerOptions = {}): () => void {
    return this.addListener(event as EventName, listener, options);
  }

  /**
   * Subscribe to an event (once)
   */
  once<K extends keyof E>(event: K, listener: EventListener<E[K]>, options: ListenerOptions = {}): () => void {
    return this.addListener(event as EventName, listener, { ...options, once: true });
  }

  /**
   * Subscribe with filter
   */
  when<K extends keyof E>(
    event: K,
    filter: (data: E[K]) => boolean,
    listener: EventListener<E[K]>,
    options: ListenerOptions = {}
  ): () => void {
    return this.addListener(event as EventName, listener, { ...options, filter });
  }

  /**
   * Subscribe to multiple events with same handler
   */
  onAny(listener: (event: { name: EventName; data: any }) => void, options: ListenerOptions = {}): () => void {
    return this.addListener('*', listener as EventListener, options);
  }

  private addListener(event: EventName, listener: EventListener, options: ListenerOptions): () => void {
    const entry: ListenerEntry = {
      listener,
      options: {
        priority: options.priority ?? 0,
        once: options.once ?? false,
        filter: options.filter,
        async: options.async ?? false,
      },
      id: ++this.listenerId,
    };

    const listeners = this.listeners.get(event) || [];
    listeners.push(entry);
    // Sort by priority (highest first) - priority is guaranteed to be number after default
    listeners.sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));
    this.listeners.set(event, listeners);

    // Return unsubscribe function
    return () => this.off(event, entry.id);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: EventName, listenerOrId: EventListener | number): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners) return false;

    const id = typeof listenerOrId === 'number' ? listenerOrId : -1;
    const listener = typeof listenerOrId === 'function' ? listenerOrId : null;

    const index = listeners.findIndex(entry =>
      id !== -1 ? entry.id === id : entry.listener === listener
    );

    if (index === -1) return false;

    if (this.isDispatching) {
      this.pendingRemovals.add(listeners[index].id);
    } else {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      this.listeners.delete(event);
    }

    return true;
  }

  /**
   * Remove all listeners for an event
   */
  offAll(event?: EventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Emit an event synchronously
   */
  emit<K extends keyof E>(event: K, data: E[K]): boolean {
    return this.dispatch(event as EventName, data);
  }

  /**
   * Emit an event asynchronously - awaits all async handlers
   */
  async emitAsync<K extends keyof E>(event: K, data: E[K]): Promise<boolean> {
    return this.dispatchAsync(event as EventName, data);
  }

  /**
   * Emit event to all listeners including wildcard (synchronous)
   */
  private dispatch(event: EventName, data: any): boolean {
    const specificListeners = this.listeners.get(event) || [];
    const wildcardListeners = this.listeners.get('*') || [];
    const allListeners = [...specificListeners, ...wildcardListeners];

    if (allListeners.length === 0) {
      this.recordHistory(event, data);
      return false;
    }

    this.isDispatching = true;
    let handled = false;

    try {
      for (const entry of allListeners) {
        // Check if removed during dispatch
        if (this.pendingRemovals.has(entry.id)) continue;

        // Check filter
        if (entry.options.filter && !entry.options.filter(data)) continue;

        // Only handle sync listeners in sync dispatch
        if (!entry.options.async) {
          handled = true;
          entry.listener(data);
          if (entry.options.once) {
            this.off(event, entry.id);
          }
        }
        // Async listeners are ignored in sync emit (they should use emitAsync)
      }
    } finally {
      this.isDispatching = false;
      // Process pending removals
      if (this.pendingRemovals.size > 0) {
        for (const [eventName, listeners] of this.listeners) {
          const filtered = listeners.filter(e => !this.pendingRemovals.has(e.id));
          if (filtered.length !== listeners.length) {
            if (filtered.length === 0) {
              this.listeners.delete(eventName);
            } else {
              this.listeners.set(eventName, filtered);
            }
          }
        }
        this.pendingRemovals.clear();
      }
    }

    this.recordHistory(event, data);
    return handled;
  }

  /**
   * Emit event asynchronously - awaits all async handlers
   */
  private async dispatchAsync(event: EventName, data: any): Promise<boolean> {
    const specificListeners = this.listeners.get(event) || [];
    const wildcardListeners = this.listeners.get('*') || [];
    const allListeners = [...specificListeners, ...wildcardListeners];

    if (allListeners.length === 0) {
      this.recordHistory(event, data);
      return false;
    }

    this.isDispatching = true;
    let handled = false;
    const errors: Error[] = [];

    try {
      const promises: Promise<void>[] = [];

      for (const entry of allListeners) {
        // Check if removed during dispatch
        if (this.pendingRemovals.has(entry.id)) continue;

        // Check filter
        if (entry.options.filter && !entry.options.filter(data)) continue;

        handled = true;

        const listenerPromise = Promise.resolve(entry.listener(data))
          .catch(err => {
            errors.push(err instanceof Error ? err : new Error(String(err)));
          });

        if (entry.options.once) {
          this.off(event, entry.id);
        }

        promises.push(listenerPromise);
      }

      // Wait for all async handlers to complete
      await Promise.all(promises);

      // Throw aggregated errors if any
      if (errors.length > 0) {
        const aggregateError = new Error(`Async event handlers failed: ${errors.map(e => e.message).join('; ')}`);
        (aggregateError as any).errors = errors;
        throw aggregateError;
      }
    } finally {
      this.isDispatching = false;
      // Process pending removals
      if (this.pendingRemovals.size > 0) {
        for (const [eventName, listeners] of this.listeners) {
          const filtered = listeners.filter(e => !this.pendingRemovals.has(e.id));
          if (filtered.length !== listeners.length) {
            if (filtered.length === 0) {
              this.listeners.delete(eventName);
            } else {
              this.listeners.set(eventName, filtered);
            }
          }
        }
        this.pendingRemovals.clear();
      }
    }

    this.recordHistory(event, data);
    return handled;
  }

  /**
   * Wait for an event (Promise-based)
   */
  waitFor<K extends keyof E>(event: K, timeout = 5000, filter?: (data: E[K]) => boolean): Promise<E[K]> {
    const eventName = event as EventName;
    const eventNameStr = typeof event === 'symbol' ? String(event) : String(event);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventNameStr}`));
      }, timeout);

      // Use addListener directly to get the listener ID for cleanup
      const entryId = ++this.listenerId;
      const entry: ListenerEntry<E[K]> = {
        listener: (data) => {
          if (!filter || filter(data)) {
            clearTimeout(timer);
            this.off(eventName, entryId);
            resolve(data);
          }
        },
        options: { once: true, filter },
        id: entryId,
      };

      const listeners = this.listeners.get(eventName) || [];
      listeners.push(entry);
      this.listeners.set(eventName, listeners);
    });
  }

  /**
   * Record event in history
   */
  private recordHistory(event: EventName, data: any): void {
    this.eventHistory.push({
      name: event,
      data,
      timestamp: Date.now(),
    });

    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history
   */
  getHistory(event?: EventName): { name: EventName; data: any; timestamp: number }[] {
    if (event) {
      return this.eventHistory.filter(e => e.name === event);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get listener count for event
   */
  listenerCount(event: EventName): number {
    const specific = this.listeners.get(event)?.length || 0;
    const wildcard = this.listeners.get('*')?.length || 0;
    return specific + wildcard;
  }

  /**
   * Check if event has listeners
   */
  hasListeners(event: EventName): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * Get all registered event names
   */
  getEventNames(): EventName[] {
    return Array.from(this.listeners.keys()).filter(e => e !== '*');
  }

  /**
   * Create a scoped event bus (child)
   */
  createChild(): EngineEventBus<E> {
    const child = new EngineEventBus<E>();
    // Inherit listeners from parent
    for (const [event, listeners] of this.listeners) {
      if (event === '*') continue; // Don't inherit wildcard
      for (const entry of listeners) {
        child.on(event as keyof E, entry.listener, entry.options);
      }
    }
    return child;
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.listeners.clear();
    this.eventHistory = [];
    this.pendingRemovals.clear();
  }
}

/**
 * Re-export EngineEvents and EngineEventMap from EngineEvents.ts
 * This ensures a single source of truth for all engine events.
 */
export { EngineEvents } from './EngineEvents.js';
export type { EngineEventMap, EngineEventPayload } from './EngineEvents.js';