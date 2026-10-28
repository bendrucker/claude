import { expect, test } from "bun:test";
import { parse } from "yaml";
import { CaseFile } from "../../../../../packages/evals/layout";
import { caseYaml, prompt, truth } from "./search-cases";

const label = (tags: string[]) => ({
  id: "x",
  query: "remove utils.go",
  relevant: [{ session_id: "s1" }],
  tags,
});

test("prompt asks for one session or a topic's sessions by the label's kind", () => {
  expect(prompt(label(["dev", "known-item"]))).toContain("Give its session id");
  expect(prompt(label(["holdout", "topical"]))).toContain("List their session ids");
});

test("truth lists the sessions as keys and checks the search query was used", () => {
  expect(truth(["a", "b'c"])).toBe(
    "-- reference: queries/search\\.sql\nSELECT key FROM (VALUES ('a'), ('b''c')) AS t(key);\n",
  );
});

test("case tags carry the label's split", () => {
  expect(CaseFile.parse(parse(caseYaml(label(["holdout", "topical"])))).tags).toEqual([
    "search",
    "holdout",
    "topical",
  ]);
});
