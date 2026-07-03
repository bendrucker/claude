import { describe, expect, test } from "bun:test";
import { type FetchResult, fetchUrls, newUrls } from "./poll";

describe("fetchUrls", () => {
  test.each<[string, string, FetchResult]>([
    [
      "success",
      `echo '[{"url":"https://example.test/1"},{"url":"https://example.test/2"}]'`,
      { ok: true, urls: ["https://example.test/1", "https://example.test/2"] },
    ],
    ["empty queue", "echo '[]'", { ok: true, urls: [] }],
    [
      "non-zero exit with stderr",
      "echo 'auth failed' >&2; exit 1",
      { ok: false, reason: "auth failed" },
    ],
    ["non-zero exit with no stderr", "exit 2", { ok: false, reason: "exited with code 2" }],
  ])("%s", async (_name, cmd, expected) => {
    expect(await fetchUrls(cmd)).toEqual(expected);
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
  test.each<[string, string[], Set<string>, string[]]>([
    ["keeps only untracked URLs", ["u1", "u2"], new Set(["u1"]), ["u2"]],
    ["dedupes a URL seen on more than one platform", ["u2", "u2"], new Set(), ["u2"]],
    ["preserves fetch order", ["u3", "u2"], new Set(), ["u3", "u2"]],
    ["returns nothing when every URL is tracked", ["u1"], new Set(["u1"]), []],
  ])("%s", (_name, urls, tracked, expected) => {
    expect(newUrls(urls, tracked)).toEqual(expected);
  });
});
