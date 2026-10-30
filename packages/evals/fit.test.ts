import { expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { chars, fit, SUMMARY_LIMIT } from "./fit";

const LINK = "https://example.com/artifact";

const table = (rows: number, label = "case") =>
  [
    "| case/arm | this run |",
    "| --- | --- |",
    ...Array.from({ length: rows }, (_, i) => `| ${label}-${i}/with | 0.50 |`),
  ].join("\n");

const details = (title: string, rows: number) =>
  `<details><summary>${title}</summary>\n\n${table(rows, title)}\n\n</details>\n`;

const report = (graderRows: number) =>
  [
    "22 cases · cost $41.20 · [run](https://example.com/run)\n",
    `### Case score\n\n${table(44)}\n`,
    details("Case minimum", 44),
    details("Grader pass rate", graderRows),
  ].join("\n");

test("a report under the limit is unchanged", () => {
  const small = report(10);
  expect(fit(small, LINK)).toBe(small);
});

test("an oversized report drops collapsed sections and keeps the score table", () => {
  const big = report(3000);
  expect(chars(big)).toBeGreaterThan(SUMMARY_LIMIT);
  const out = fit(big, LINK);
  expect(chars(out)).toBeLessThanOrEqual(SUMMARY_LIMIT);
  expect(out).toContain("22 cases · cost $41.20");
  expect(out).toContain(table(44));
  expect(out).toContain(details("Case minimum", 44));
  expect(out).not.toContain("Grader pass rate");
  expect(out).toContain(
    `1 section cut to fit GitHub's check summary limit. [Full report](${LINK})`,
  );
});

test("the limit counts characters, not bytes", () => {
  const text = `${"†".repeat(90)}\n\n${"x".repeat(5)}\n`;
  expect(fit(text, LINK, 100)).toBe(text);
});

test("open blocks go once the collapsed ones are not enough", () => {
  const out = fit(report(3000), LINK, 2500);
  expect(chars(out)).toBeLessThanOrEqual(2500);
  expect(out).toContain("22 cases");
  expect(out).not.toContain("<details>");
  expect(out).toContain("[Full report]");
});

test("a header block over the limit is cut at a line boundary", () => {
  const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
  const out = fit(text, LINK, 150);
  expect(chars(out)).toBeLessThanOrEqual(150);
  expect(out.startsWith("line 0\n")).toBe(true);
});

test("output never exceeds the limit and a fitting report passes through", () => {
  hegel.test((tc) => {
    const text = tc.draw(gs.text({ alphabet: "ab†\n<>/detailsum", maxSize: 2000 }));
    const limit = tc.draw(gs.integers({ minValue: 200, maxValue: 2500 }));
    const out = fit(text, LINK, limit);
    expect(chars(out)).toBeLessThanOrEqual(limit);
    if (chars(text) <= limit) expect(out).toBe(text);
  });
});
