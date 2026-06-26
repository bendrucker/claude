import { describe, expect, it } from "bun:test";
import { buildContext, parseEnvelope, processPrompt } from "./relay";

const envelope = (attrs: string, body = "do the thing") => `[[tmux-relay ${attrs}]]\n${body}`;

describe("parseEnvelope", () => {
  it("parses a full envelope", () => {
    expect(parseEnvelope(envelope("from=%3 reply-to=%3 kind=handoff window=feat/auth:2"))).toEqual({
      from: "%3",
      replyTo: "%3",
      kind: "handoff",
      window: "feat/auth:2",
      body: "do the thing",
    });
  });

  it("defaults reply-to to from and kind to message", () => {
    const env = parseEnvelope(envelope("from=%5"));
    expect(env?.replyTo).toBe("%5");
    expect(env?.kind).toBe("message");
    expect(env?.window).toBeNull();
  });

  it("keeps a multi-line body intact", () => {
    expect(parseEnvelope(envelope("from=%1", "line one\nline two"))?.body).toBe(
      "line one\nline two",
    );
  });

  it("returns null for an ordinary prompt", () => {
    expect(parseEnvelope("fix the failing test in foo.ts")).toBeNull();
  });

  it("returns null when the envelope is not at the start", () => {
    expect(parseEnvelope("hey [[tmux-relay from=%3]]\nbody")).toBeNull();
  });

  it("returns null when from is missing", () => {
    expect(parseEnvelope("[[tmux-relay kind=message]]\nbody")).toBeNull();
  });
});

describe("buildContext", () => {
  it("includes origin, reply target, and kind", () => {
    const text = buildContext({
      from: "%3",
      replyTo: "%3",
      kind: "handoff",
      window: "feat/auth:2",
      body: "x",
    });
    expect(text).toContain("%3 (window feat/auth:2)");
    expect(text).toContain("Reply to pane: %3");
    expect(text).toContain("Kind: handoff");
    expect(text).toContain("tmux:relay");
  });

  it("omits the window clause when unknown", () => {
    const text = buildContext({
      from: "%3",
      replyTo: "%3",
      kind: "message",
      window: null,
      body: "x",
    });
    expect(text).toContain("From pane: %3\n");
    expect(text).not.toContain("window");
  });
});

describe("processPrompt", () => {
  it("returns UserPromptSubmit context for a relay prompt", () => {
    const result = processPrompt(envelope("from=%4 reply-to=%4 kind=message"));
    const output = result?.hookSpecificOutput as Record<string, unknown>;
    expect(output?.hookEventName).toBe("UserPromptSubmit");
    expect(output?.additionalContext).toContain("Reply to pane: %4");
  });

  it("returns null for an ordinary prompt", () => {
    expect(processPrompt("just a normal message")).toBeNull();
  });

  it("returns null for an undefined prompt", () => {
    expect(processPrompt(undefined)).toBeNull();
  });
});
