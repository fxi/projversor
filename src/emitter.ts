/** Typed events: `E` maps each event name to its payload. */
export class Emitter<E> {
  private readonly listeners = new Map<keyof E, Set<(detail: never) => void>>();

  /** Listen to an event; returns the unsubscribe function. */
  on<K extends keyof E>(type: K, listener: (detail: E[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (detail: never) => void);
    return () => set.delete(listener as (detail: never) => void);
  }

  emit<K extends keyof E>(type: K, detail: E[K]): void {
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (detail: E[K]) => void)(detail);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
