import { describe, expect, test } from "bun:test";
import { mergeDocuments, parseCorpus, serializeCorpus } from "./voice-corpus";

const sample = `===== https://github.com/o/r/pull/1 (2020-01-01T00:00:00Z, +10/-2) =====
First PR body.
Second line.


===== https://github.com/o/r/pull/2 (2020-02-01T00:00:00Z, +1/-0) =====
Another body.
`;

describe("parseCorpus", () => {
  test("splits documents on delimiter lines", () => {
    const docs = parseCorpus(sample);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.source).toBe("https://github.com/o/r/pull/1");
    expect(docs[0]?.meta).toBe("2020-01-01T00:00:00Z, +10/-2");
    expect(docs[0]?.body).toBe("First PR body.\nSecond line.");
    expect(docs[1]?.body).toBe("Another body.");
  });

  test("returns no documents for text without delimiters", () => {
    expect(parseCorpus("just some text\nno delimiters")).toHaveLength(0);
  });
});

describe("serializeCorpus", () => {
  test("round-trips through parse", () => {
    const docs = parseCorpus(sample);
    const reparsed = parseCorpus(serializeCorpus(docs));
    expect(reparsed.map((d) => d.source)).toEqual(docs.map((d) => d.source));
    expect(reparsed.map((d) => d.body)).toEqual(docs.map((d) => d.body));
  });
});

describe("mergeDocuments", () => {
  test("de-duplicates by source pointer, existing wins", () => {
    const existing = [{ source: "u/1", meta: "a", body: "old" }];
    const incoming = [
      { source: "u/1", meta: "b", body: "new" },
      { source: "u/2", meta: "c", body: "fresh" },
    ];
    const merged = mergeDocuments(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((d) => d.source === "u/1")?.body).toBe("old");
    expect(merged.find((d) => d.source === "u/2")?.body).toBe("fresh");
  });
});
