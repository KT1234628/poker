// Single-flight async mutex.
// Used by Room to serialize all state-changing operations: action handling,
// sit-down/stand-up, RIT vote resolution, hand-start, chat persistence.

export class Mutex {
  private chain: Promise<unknown> = Promise.resolve();

  /** Run `fn` after all prior runs settle. Resolves with fn's value. */
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.chain.then(() => fn(), () => fn());
    // Don't let one rejection block subsequent runs.
    this.chain = next.then(() => undefined, () => undefined);
    return next as Promise<T>;
  }
}
