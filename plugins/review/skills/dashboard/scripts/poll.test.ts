import { describe, expect, test } from "bun:test";
import { fetchUrls, newUrls } from "./poll";

describe("fetchUrls", () => {
  test("returns ok:true with extracted URLs on success", async () => {
    const result = await fetchUrls(
      `echo '[{"url":"https://example.test/1"},{"url":"https://example.test/2"}]'`,
    );
    expect(result).toEqual({
      ok: true,
      urls: ["https://example.test/1", "https://example.test/2"],
    });
  });

  test("returns ok:true with empty array when queue is empty", async () => {
    const result = await fetchUrls("echo '[]'");
    expect(result).toEqual({ ok: true, urls: [] });
  });

  test("returns ok:false with stderr reason when command exits non-zero", async () => {
    const result = await fetchUrls("echo 'auth failed' >&2; exit 1");
    expect(result).toEqual({ ok: false, reason: "auth failed" });
  });

  test("returns ok:false with exit-code reason when command fails with no stderr", async () => {
    const result = await fetchUrls("exit 2");
    expect(result).toEqual({ ok: false, reason: "exited with code 2" });
  });

  test("returns ok:false when output is not valid JSON", async () => {
    const result = await fetchUrls("echo 'not json'");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/JSON parse failed/);
    }
  });
});

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
