import { describe, expect, it } from "bun:test";
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
  it("returns body field", () => {
    expect(extractMarkdownFromMcp({ body: "content" })).toBe("content");
  });

  it("returns description field", () => {
    expect(extractMarkdownFromMcp({ description: "content" })).toBe("content");
  });

  it("prefers body over description", () => {
    expect(extractMarkdownFromMcp({ body: "body", description: "desc" })).toBe("body");
  });

  it("returns null for no matching fields", () => {
    expect(extractMarkdownFromMcp({ title: "test" })).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractMarkdownFromMcp(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(extractMarkdownFromMcp("string")).toBeNull();
  });
});

describe("extractMarkdownFromBash", () => {
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

  it("returns null for nonexistent --body-file", async () => {
    expect(await extractMarkdownFromBash("gh pr create --body-file /nonexistent.md")).toBeNull();
  });
});
