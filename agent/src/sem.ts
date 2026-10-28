/** Counting semaphore: caps how many Claude sessions run at once across all stages. */
export class Semaphore {
  private waiting: (() => void)[] = [];
  active = 0;
  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
