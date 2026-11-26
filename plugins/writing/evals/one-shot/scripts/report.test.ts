import { expect, test } from "bun:test";
import { render, type Result, summarize } from "./report";

const makeResult = (overrides: Partial<Result> = {}): Result => ({
  id: "a",
  before: [],
  after: [],
  words: { before: 100, after: 100 },
  meaning: { preserved: true, lost: [] },
  ...overrides,
});

const found = (...checks: string[]) => checks.map((check) => ({ Check: check }));

const results = [
  makeResult({
    id: "a",
    before: found("em dash", "em dash", "contrast"),
    after: found("em dash"),
    meaning: { preserved: false, lost: ["a cause"] },
  }),
  makeResult({ id: "b", before: found("em dash"), after: found("tricolon") }),
];

test("summarize counts fixes, survivors, introductions, and lossy drafts per check", () => {
  expect(summarize(results).rows).toEqual([
    { check: "em dash", drafts: 2, before: 3, residual: 1, introduced: 0, lossy: 1 },
    { check: "contrast", drafts: 1, before: 1, residual: 0, introduced: 0, lossy: 1 },
    { check: "tricolon", drafts: 0, before: 0, residual: 0, introduced: 1, lossy: 0 },
  ]);
});

test("render sets a base run's figures beside the current ones", () => {
  const base = summarize([
    makeResult({ id: "a", before: found("em dash"), after: found("em dash") }),
  ]);
  expect(render(summarize(results), base)).toMatchSnapshot();
});
