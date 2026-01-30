export interface DebugContext {
  enabled: boolean;
  timings: Map<string, number>;
  counts: Map<string, number>;
}

export function createDebugContext(enabled: boolean): DebugContext {
  return {
    enabled,
    timings: new Map(),
    counts: new Map(),
  };
}

export function debug(ctx: DebugContext, message: string): void {
  if (ctx.enabled) {
    console.error(`[debug] ${message}`);
  }
}

export function incrementCount(ctx: DebugContext, key: string, amount = 1): void {
  ctx.counts.set(key, (ctx.counts.get(key) ?? 0) + amount);
}

export function startTiming(ctx: DebugContext, key: string): () => void {
  const start = performance.now();
  return () => {
    const elapsed = performance.now() - start;
    ctx.timings.set(key, (ctx.timings.get(key) ?? 0) + elapsed);
  };
}

export function printTimingSummary(ctx: DebugContext): void {
  if (!ctx.enabled) return;

  console.error("\n[debug] Timing breakdown:");
  for (const [key, ms] of ctx.timings) {
    console.error(`[debug]   ${key}: ${ms.toFixed(0)}ms`);
  }

  if (ctx.counts.size > 0) {
    console.error("\n[debug] Counts:");
    for (const [key, count] of ctx.counts) {
      console.error(`[debug]   ${key}: ${count}`);
    }
  }
}
