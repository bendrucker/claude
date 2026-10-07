/** Runs `fn` over `items` with at most `concurrency` calls in flight, results in input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    const next = queue.next();
    if (next.done) return;
    const [index, item] = next.value;
    results[index] = await fn(item, index);
    return worker();
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
