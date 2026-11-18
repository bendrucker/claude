import { describe, expect, test } from "bun:test";
import { feedbackFrom, isExcluded, tagRedirect, type Tag } from "./redirect";

describe("tagRedirect", () => {
  test.each<{ name: string; text: string; tag: Tag }>([
    { name: "simpler", text: "Make this simpler, it is a lot", tag: "simplify" },
    { name: "upstream", text: "Fix it upstream instead", tag: "simplify" },
    { name: "overkill", text: "That is overkill for one flag", tag: "simplify" },
    { name: "existing", text: "Use the existing helper", tag: "simplify" },
    { name: "test", text: "How will we test this?", tag: "measure" },
    { name: "benchmark", text: "Benchmark it first", tag: "measure" },
    { name: "skeptic", text: "Poke holes in this", tag: "skeptic" },
    { name: "push back", text: "Please push back on the premise", tag: "skeptic" },
    { name: "why", text: "Why this approach", tag: "decision" },
    { name: "alternative", text: "What was the alternative", tag: "decision" },
    { name: "none", text: "Add a README section too", tag: "other" },
    { name: "simplify outranks measure", text: "Simplify, then test", tag: "simplify" },
    { name: "word boundary", text: "The whyever hook", tag: "other" },
  ])("$name", ({ text, tag }) => {
    expect(tagRedirect(text)).toBe(tag);
  });
});

describe("isExcluded", () => {
  const long = "Rework the second section so it covers the failure path as well.";
  test.each<{ name: string; text: string; excluded: boolean }>([
    { name: "plain feedback", text: long, excluded: false },
    { name: "too short", text: "Simpler please", excluded: true },
    { name: "empty", text: "   ", excluded: true },
    {
      name: "file under parent",
      text: `${long} Also file it under the parent issue.`,
      excluded: true,
    },
    {
      name: "stack on",
      text: "Stack this on the PR that is open right now for the lint rule",
      excluded: true,
    },
    {
      name: "about to land",
      text: "That change is about to land so wait for it before planning",
      excluded: true,
    },
    {
      name: "new branch",
      text: "Do this in a new branch after the planning discussion ends",
      excluded: true,
    },
  ])("$name", ({ text, excluded }) => {
    expect(isExcluded(text)).toBe(excluded);
  });
});

describe("feedbackFrom", () => {
  test.each<{ name: string; result: string | null; feedback: string | null }>([
    {
      name: "feedback",
      result: "The tool use was rejected. the user said:\nDrop step 3",
      feedback: "Drop step 3",
    },
    { name: "silent rejection", result: "The user doesn't want to proceed.", feedback: null },
    { name: "empty after marker", result: "the user said:\n  ", feedback: null },
    { name: "no result", result: null, feedback: null },
  ])("$name", ({ result, feedback }) => {
    expect(feedbackFrom(result)).toBe(feedback);
  });
});
