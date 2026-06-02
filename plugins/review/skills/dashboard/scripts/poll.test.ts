import { describe, expect, test } from "bun:test";
import { newUrls } from "./poll";

describe("newUrls", () => {
  test("keeps only URLs not already tracked", () => {
    const tracked = new Set(["https://example.test/1"]);
    expect(newUrls(["https://example.test/1", "https://example.test/2"], tracked)).toEqual([
      "https://example.test/2",
    ]);
  });

  test("dedupes a URL that appears on more than one platform", () => {
    expect(newUrls(["https://example.test/2", "https://example.test/2"], new Set())).toEqual([
      "https://example.test/2",
    ]);
  });

  test("preserves fetch order", () => {
    expect(newUrls(["https://example.test/3", "https://example.test/2"], new Set())).toEqual([
      "https://example.test/3",
      "https://example.test/2",
    ]);
  });

  test("returns nothing when every fetched URL is tracked", () => {
    expect(newUrls(["https://example.test/1"], new Set(["https://example.test/1"]))).toEqual([]);
  });
});
