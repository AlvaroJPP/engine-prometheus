type Handler = (payload: unknown) => void

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler>>()

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>()
    set.add(fn as Handler)
    this.handlers.set(type, set)
    return () => {
      set.delete(fn as Handler)
    }
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.handlers.get(type)?.forEach((fn) => fn(payload))
  }
}
