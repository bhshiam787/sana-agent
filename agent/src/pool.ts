import { UsageLimitError } from "./llm.ts";

/**
 * Runs `fn` over items with at most `n` in flight. A usage-limit error stops
 * new work and is rethrown after in-flight items finish; other errors are the
 * callers' to handle inside `fn`.
 */
export async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  let stop: UsageLimitError | null = null;
  const worker = async () => {
    while (!stop && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (e) {
        if (e instanceof UsageLimitError) stop = e;
        else throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (stop) throw stop;
}
