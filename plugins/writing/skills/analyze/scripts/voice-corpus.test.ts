import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import {
  documentKind,
  groupByKind,
  isDocumentKind,
  mergeDocuments,
  parseCorpus,
  serializeCorpus,
  type VoiceDocument,
} from "./voice-corpus";

// A document that survives serialize/parse: the source is a single non-empty
// token (the delimiter captures \S+), meta carries no ")" or newline (it sits
// inside the (...) group on the single-line delimiter), and body lines never
// open with "=" so none masquerade as a delimiter after trimming.
const voiceDocument = fc.record<VoiceDocument>({
  source: fc.string({ minLength: 1 }).map((s) => {
    const stripped = s.replaceAll(/\s/g, "");
    return stripped !== "" ? stripped : "x";
  }),
  meta: fc.string().map((s) => s.replaceAll(/[)\r\n]/g, "")),
  body: fc
    .array(fc.string().map((s) => s.replaceAll(/[\r\n]/g, " ").replace(/^[\s=]+/, "")))
    .map((lines) => lines.join("\n").trim()),
});

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

  test("round-trip preserves source and body for any documents", () => {
    fc.assert(
      fc.property(fc.array(voiceDocument), (docs) => {
        const reparsed = parseCorpus(serializeCorpus(docs));
        const project = (list: VoiceDocument[]) =>
          list.map((d) => ({ source: d.source, body: d.body }));
        expect(project(reparsed)).toEqual(project(docs));
      }),
    );
  });
});

describe("documentKind", () => {
  test.each([
    ["a3f9c1d2-7b44-4e10-9c8a-1f2e3d4b5a60#7", "chat"],
    ["/Users/ben/.claude/plans/2026-08-31-corpus.md#0", "plan"],
    ["/Users/ben/.claude/projects/-Users-ben-src/memory/project_voice.md#1", "memory"],
    ["/tmp/claude-501/scratchpad/notes.md#2", "scratch"],
    ["tmp/pr-body-writing.md#0", "scratch"],
    ["/Users/ben/src/bendrucker/claude/README.md#0", "docs"],
    ["/Users/ben/src/bendrucker/claude/.worktrees/x/docs/settings.md#4", "docs"],
    ["/Users/ben/src/bendrucker/claude/plugins/writing/detection/tropes.ts#0", "other"],
  ])("%s is %s", (source, kind) => {
    expect(documentKind(source)).toBe(kind);
  });

  // The occurrence index sits past the extension, so stripping it is what lets
  // the markdown check see the real suffix.
  test("classifies by extension despite the occurrence index", () => {
    expect(documentKind("/repo/NOTES.md#118")).toBe("docs");
  });
});

describe("groupByKind", () => {
  test("groups only the kinds present, keeping document order", () => {
    const docs: VoiceDocument[] = [
      { source: "/repo/a.md#0", meta: "", body: "first" },
      { source: "session-id#0", meta: "", body: "chatter" },
      { source: "/repo/b.md#0", meta: "", body: "second" },
    ];
    const groups = groupByKind(docs);
    expect([...groups.keys()].toSorted()).toEqual(["chat", "docs"]);
    expect(groups.get("docs")?.map((doc) => doc.body)).toEqual(["first", "second"]);
  });
});

describe("isDocumentKind", () => {
  test.each([
    ["docs", true],
    ["prose", false],
  ])("%s is a kind: %p", (value, expected) => {
    expect(isDocumentKind(value)).toBe(expected);
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
