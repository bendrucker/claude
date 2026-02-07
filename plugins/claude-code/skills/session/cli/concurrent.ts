import { log } from "./debug";

const DEFAULT_CONCURRENCY = 20;

export async function* mapConcurrent<T, U>(
  items: AsyncIterable<T>,
  fn: (item: T) => Promise<U>,
  options: { concurrency?: number } = {},
): AsyncGenerator<U> {
  const { concurrency = DEFAULT_CONCURRENCY } = options;
  const pending = new Map<number, Promise<{ index: number; result: U }>>();
  let nextIndex = 0;
  let nextYield = 0;
  const results = new Map<number, U>();

  const iterator = items[Symbol.asyncIterator]();

  async function startNext(): Promise<boolean> {
    const { done, value } = await iterator.next();
    if (done) return false;

    const index = nextIndex++;
    const promise = fn(value).then((result) => ({ index, result }));
    pending.set(index, promise);
    return true;
  }

  // Fill initial pool
  for (let i = 0; i < concurrency; i++) {
    if (!(await startNext())) break;
  }

  try {
    let processed = 0;
    while (pending.size > 0) {
      const { index, result } = await Promise.race(pending.values());
      pending.delete(index);
      results.set(index, result);

      processed++;
      if (processed % 50 === 0) {
        log(`Processed ${processed} items...`);
      }

      // Start next item
      await startNext();

      // Yield in order
      while (results.has(nextYield)) {
        yield results.get(nextYield)!;
        results.delete(nextYield);
        nextYield++;
      }
    }
  } finally {
    for (const promise of pending.values()) {
      promise.catch(() => {});
    }
  }
}

export async function collectConcurrent<T, U>(
  items: AsyncIterable<T>,
  fn: (item: T) => Promise<U>,
  options: { concurrency?: number } = {},
): Promise<U[]> {
  const results: U[] = [];
  for await (const result of mapConcurrent(items, fn, options)) {
    results.push(result);
  }
  return results;
}
