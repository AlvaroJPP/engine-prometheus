type Handler = (payload: unknown) => void

/**
 * Event bus tipado e independente do runtime da engine.
 *
 * A emissão percorre um snapshot: listeners adicionados durante um evento
 * começam a receber eventos na próxima emissão, e listeners removidos antes
 * da sua vez são ignorados imediatamente.
 */
export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler>>()

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>()
    set.add(fn as Handler)
    this.handlers.set(type, set)

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      set.delete(fn as Handler)
      if (set.size === 0 && this.handlers.get(type) === set) {
        this.handlers.delete(type)
      }
    }
  }

  once<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let unsubscribe = () => {}
    unsubscribe = this.on(type, (payload) => {
      unsubscribe()
      fn(payload)
    })
    return unsubscribe
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const current = this.handlers.get(type)
    if (!current?.size) return

    for (const handler of [...current]) {
      if (this.handlers.get(type)?.has(handler)) handler(payload)
    }
  }

  listenerCount<K extends keyof E>(type: K): number {
    return this.handlers.get(type)?.size ?? 0
  }

  clear<K extends keyof E>(type?: K): void {
    if (type === undefined) {
      this.handlers.clear()
      return
    }
    this.handlers.delete(type)
  }
}
