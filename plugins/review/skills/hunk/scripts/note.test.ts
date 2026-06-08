import { describe, expect, test } from "bun:test";
import { decodeNotes, deriveAnchor, type HunkNote } from "./note";

function note(overrides: Partial<HunkNote>): HunkNote {
  return {
    noteId: "user:1",
    source: "user",
    filePath: "user/settings.json",
    hunkIndex: 0,
    newRange: null,
    oldRange: null,
    body: "comment",
    ...overrides,
  };
}

describe("deriveAnchor", () => {
  test("prefers new-side when newRange is present", () => {
    expect(deriveAnchor(note({ newRange: [150, 150] }))).toEqual({
      side: "new",
      line: 150,
      path: "user/settings.json",
    });
  });

  test("falls back to old-side when only oldRange is present", () => {
    expect(deriveAnchor(note({ filePath: "old.txt", oldRange: [11, 11] }))).toEqual({
      side: "old",
      line: 11,
      path: "old.txt",
    });
  });

  test("throws when the note has no range", () => {
    expect(() => deriveAnchor(note({ newRange: null, oldRange: null }))).toThrow(
      "note has no anchor",
    );
  });
});

describe("decodeNotes", () => {
  test("decodes a bare array of notes", () => {
    const notes = decodeNotes(JSON.stringify([note({ noteId: "user:1" })]));
    expect(notes.map((n) => n.noteId)).toEqual(["user:1"]);
  });

  test("decodes a { comments: [...] } envelope", () => {
    const notes = decodeNotes(JSON.stringify({ comments: [note({ noteId: "user:2" })] }));
    expect(notes.map((n) => n.noteId)).toEqual(["user:2"]);
  });
});
