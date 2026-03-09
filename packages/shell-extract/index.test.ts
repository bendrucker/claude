import { afterEach, describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractMarkdownFromBash, extractMarkdownFromMcp, hasBashCommand } from "./index";

describe("hasBashCommand", () => {
  it("returns true for object with string command", () => {
    expect(hasBashCommand({ command: "echo hello" })).toBe(true);
  });

  it("returns false for empty object", () => {
    expect(hasBashCommand({})).toBe(false);
  });

  it("returns false for null", () => {
    expect(hasBashCommand(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(hasBashCommand("string")).toBe(false);
  });

  it("returns false for non-string command", () => {
    expect(hasBashCommand({ command: 123 })).toBe(false);
  });
});

describe("extractMarkdownFromMcp", () => {
  it("returns string field with newline", () => {
    expect(extractMarkdownFromMcp({ body: "line1\nline2" })).toBe("line1\nline2");
  });

  it("returns string field at length threshold", () => {
    const long = "a".repeat(80);
    expect(extractMarkdownFromMcp({ description: long })).toBe(long);
  });

  it("skips string just below length threshold", () => {
    expect(extractMarkdownFromMcp({ description: "a".repeat(79) })).toBeNull();
  });

  it("skips short strings without newlines", () => {
    expect(extractMarkdownFromMcp({ title: "test" })).toBeNull();
  });

  it("skips non-string values", () => {
    expect(extractMarkdownFromMcp({ count: 42, enabled: true })).toBeNull();
  });

  it("returns first qualifying field", () => {
    expect(extractMarkdownFromMcp({ title: "short", body: "line1\nline2" })).toBe("line1\nline2");
  });

  it("returns null for null input", () => {
    expect(extractMarkdownFromMcp(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(extractMarkdownFromMcp("string")).toBeNull();
  });
});

describe("extractMarkdownFromBash", () => {
  const tmpFile = join(tmpdir(), "shell-extract-test.md");

  afterEach(() => {
    try {
      unlinkSync(tmpFile);
    } catch {}
  });

  it("returns null for command without body", async () => {
    expect(await extractMarkdownFromBash("echo hello")).toBeNull();
  });

  it("extracts heredoc content", async () => {
    const cmd = `gh pr create --body "$(cat <<'EOF'
## Summary
Hello
EOF
)"`;
    expect(await extractMarkdownFromBash(cmd)).toBe("## Summary\nHello\n");
  });

  it("reads --body-file content", async () => {
    writeFileSync(tmpFile, "## Changes\nUpdated the API");
    expect(await extractMarkdownFromBash(`gh pr create --body-file ${tmpFile}`)).toBe(
      "## Changes\nUpdated the API",
    );
  });

  it("returns null for nonexistent --body-file", async () => {
    expect(await extractMarkdownFromBash("gh pr create --body-file /nonexistent.md")).toBeNull();
  });
});
