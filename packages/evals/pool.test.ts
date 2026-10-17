import { describe, expect, test } from "bun:test";
import { mapPool } from "./pool";

describe("mapPool", () => {
  test("runs every item and preserves result order regardless of concurrency", async () => {
    const results = await mapPool([1, 2, 3, 4, 5], 2, (n) => Promise.resolve(n * 10));
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  test.each([1, 2, 4])("keeps exactly %d calls in flight", async (concurrency) => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapPool([1, 2, 3, 4, 5, 6], concurrency, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(1);
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBe(concurrency);
  });
});
