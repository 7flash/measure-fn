export type ContextStorage<T> = {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
};

export type Span = {
  id: string;
  fullId: string;
  traceId: string;
  parentId: string | undefined;
  depth: number;
  childCounter: number;
};

/** Synchronous context only. Never leave a global span active across await. */
export class StackContextStorage<T> implements ContextStorage<T> {
  private current: T | undefined;

  getStore(): T | undefined {
    return this.current;
  }

  run<R>(store: T, fn: () => R): R {
    const previous = this.current;
    this.current = store;
    try {
      return fn();
    } finally {
      this.current = previous;
    }
  }
}
