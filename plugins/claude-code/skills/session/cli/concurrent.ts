import { type DebugContext, debug, incrementCount } from "./debug";

const DEFAULT_CONCURRENCY = 20;

export async function* mapConcurrent<T, U>(
  items: AsyncIterable<T>,
  fn: (item: T) => Promise<U>,
  options: { concurrency?: number; ctx?: DebugContext } = {},
): AsyncGenerator<U> {
  const { concurrency = DEFAULT_CONCURRENCY, ctx } = options;
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

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    pending.delete(index);
    results.set(index, result);

    if (ctx) {
      incrementCount(ctx, "items_processed");
      if (results.size % 50 === 0) {
        debug(ctx, `Processed ${results.size} items...`);
      }
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
}

export async function collectConcurrent<T, U>(
  items: AsyncIterable<T>,
  fn: (item: T) => Promise<U>,
  options: { concurrency?: number; ctx?: DebugContext } = {},
): Promise<U[]> {
  const results: U[] = [];
  for await (const result of mapConcurrent(items, fn, options)) {
    results.push(result);
  }
  return results;
}
