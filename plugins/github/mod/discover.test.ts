import { describe, expect, test } from "claude-code/testing";
import { bashOf, parsePrCommand, parsePrUrl, prUrlsOf } from "./discover.ts";

const PR = "https://github.com/o/r/pull/12";

const createOutput = ["Creating pull request for x into main in o/r", "", PR].join("\n");

const submitOutput = [
  "Pushed 3 branches",
  "https://github.com/o/r/pull/1",
  "https://github.com/o/r/pull/2",
  "https://github.com/o/r/pull/3",
].join("\n");

const pushOutput = [
  "remote: ",
  "remote: Create a pull request for 'x' on GitHub by visiting:",
  "remote:      https://github.com/o/r/pull/new/x",
  "remote: ",
].join("\n");

const refs = (command: string, output: string) =>
  prUrlsOf(command, output).map((r) => [r.ref.key, r.origin]);

describe("parsePrUrl", () => {
  test("parses a github.com URL", () => {
    expect(parsePrUrl(PR)).toEqual({
      host: "github.com",
      owner: "o",
      repo: "r",
      pr: 12,
      url: PR,
      key: "github.com/o/r#12",
    });
  });

  test("keeps scheme and port", () => {
    expect(parsePrUrl("http://ghe.corp:8443/a/b/pull/3")).toEqual({
      host: "ghe.corp:8443",
      owner: "a",
      repo: "b",
      pr: 3,
      url: "http://ghe.corp:8443/a/b/pull/3",
      key: "ghe.corp:8443/a/b#3",
    });
  });

  test("drops trailing path, query, and fragment from url", () => {
    expect(parsePrUrl(`${PR}/files`)?.url).toBe(PR);
    expect(parsePrUrl(`${PR}#issuecomment-1`)?.url).toBe(PR);
    expect(parsePrUrl(`${PR}?x=1`)?.url).toBe(PR);
  });

  test("finds a URL inside surrounding text", () => {
    expect(parsePrUrl(`see (${PR}) now`)?.pr).toBe(12);
  });

  test("rejects pull/new links", () => {
    expect(parsePrUrl("https://github.com/o/r/pull/new/x")).toBeUndefined();
    expect(parsePrUrl("https://github.com/o/r/pull/new")).toBeUndefined();
  });

  test("rejects non-PR text", () => {
    expect(parsePrUrl("https://github.com/o/r/issues/1")).toBeUndefined();
    expect(parsePrUrl("https://github.com/o/r/pull/12abc")).toBeUndefined();
    expect(parsePrUrl("")).toBeUndefined();
  });
});

describe("prUrlsOf", () => {
  test("gh pr create counts the URL in output as created", () => {
    expect(refs("gh pr create --fill", createOutput)).toEqual([["github.com/o/r#12", "created"]]);
  });

  test("gh stack submit counts every URL as stacked", () => {
    expect(refs("gh stack submit", submitOutput)).toEqual([
      ["github.com/o/r#1", "stacked"],
      ["github.com/o/r#2", "stacked"],
      ["github.com/o/r#3", "stacked"],
    ]);
  });

  test("gh stack link and push are stacked", () => {
    expect(refs("gh stack link", PR)).toEqual([["github.com/o/r#12", "stacked"]]);
    expect(refs("gh stack push", PR)).toEqual([["github.com/o/r#12", "stacked"]]);
  });

  test("git push with a pull/new link returns nothing", () => {
    expect(refs("git push -u origin x", pushOutput)).toEqual([]);
  });

  test("gh pr create ignores pull/new links", () => {
    expect(refs("gh pr create", `${createOutput}\nhttps://github.com/o/r/pull/new/x`)).toEqual([
      ["github.com/o/r#12", "created"],
    ]);
  });

  test("gh pr list output is ignored", () => {
    expect(refs("gh pr list", `#1 A\n${PR}`)).toEqual([]);
  });

  test("other commands are ignored", () => {
    for (const command of [
      "gh pr view 12",
      "gh api repos/o/r/pulls",
      "git push",
      "echo gh pr create",
      "gh stack view",
    ]) {
      expect(refs(command, `${createOutput}\n${submitOutput}`)).toEqual([]);
    }
  });

  test("enterprise host with port", () => {
    const url = "https://ghe.corp:8443/a/b/pull/5";
    expect(refs("gh pr create", url)).toEqual([["ghe.corp:8443/a/b#5", "created"]]);
  });

  test("chained commands and env assignments", () => {
    expect(refs("git push && gh pr create --fill", createOutput)).toEqual([
      ["github.com/o/r#12", "created"],
    ]);
    expect(refs("cd foo; gh pr create", createOutput)).toEqual([["github.com/o/r#12", "created"]]);
    expect(refs("make || gh stack submit", PR)).toEqual([["github.com/o/r#12", "stacked"]]);
    expect(refs("GH_HOST=ghe.corp gh pr create", createOutput)).toEqual([
      ["github.com/o/r#12", "created"],
    ]);
  });

  test("dedupes repeated URLs", () => {
    expect(refs("gh pr create", `${PR}\n${PR}/files`)).toEqual([["github.com/o/r#12", "created"]]);
  });
});

describe("bashOf", () => {
  const bash = (response: unknown) => ({
    tool_name: "Bash",
    tool_input: { command: "gh pr create" },
    tool_response: response,
  });

  test("joins stdout then stderr with a newline", () => {
    expect(bashOf(bash({ stdout: "out", stderr: "err" }))).toEqual({
      command: "gh pr create",
      output: "out\nerr",
    });
  });

  test("tolerates a missing stream", () => {
    expect(bashOf(bash({ stderr: "err" }))).toEqual({ command: "gh pr create", output: "err" });
    expect(bashOf(bash({ stdout: "out" }))).toEqual({ command: "gh pr create", output: "out" });
    expect(bashOf(bash({}))).toEqual({ command: "gh pr create", output: "" });
  });

  test("uses a string response as output", () => {
    expect(bashOf(bash("plain"))).toEqual({ command: "gh pr create", output: "plain" });
  });

  test("ignores other tools", () => {
    expect(bashOf({ ...bash({ stdout: "x" }), tool_name: "Read" })).toBeUndefined();
  });

  test("rejects malformed shapes", () => {
    expect(bashOf(undefined)).toBeUndefined();
    expect(bashOf("Bash")).toBeUndefined();
    expect(bashOf({ tool_name: "Bash" })).toBeUndefined();
    expect(bashOf({ tool_name: "Bash", tool_input: {}, tool_response: "x" })).toBeUndefined();
    expect(
      bashOf({ tool_name: "Bash", tool_input: { command: 1 }, tool_response: "x" }),
    ).toBeUndefined();
    expect(bashOf(bash(null))).toBeUndefined();
    expect(bashOf(bash(5))).toBeUndefined();
  });
});

describe("parsePrCommand", () => {
  const ref = parsePrUrl(PR);
  const usage = "usage: /pr [track <url> | untrack <url|#n>]";

  test("empty args toggle", () => {
    expect(parsePrCommand("")).toEqual({ kind: "toggle" });
    expect(parsePrCommand("   ")).toEqual({ kind: "toggle" });
  });

  test("track with a URL", () => {
    expect(parsePrCommand(`  track ${PR} `)).toEqual({ kind: "track", ref });
  });

  test("track without a valid URL is invalid", () => {
    expect(parsePrCommand("track nope")).toEqual({
      kind: "invalid",
      reason: "not a pull request URL: nope",
    });
    expect(parsePrCommand("track https://github.com/o/r/pull/new/x").kind).toBe("invalid");
  });

  test("track needs exactly one argument", () => {
    expect(parsePrCommand("track")).toEqual({ kind: "invalid", reason: usage });
    expect(parsePrCommand(`track ${PR} ${PR}`)).toEqual({ kind: "invalid", reason: usage });
  });

  test("untrack accepts a URL, #n, or bare integer", () => {
    expect(parsePrCommand(`untrack ${PR}`)).toEqual({ kind: "untrack", ref });
    expect(parsePrCommand("untrack #12")).toEqual({ kind: "untrack", pr: 12 });
    expect(parsePrCommand("untrack 12")).toEqual({ kind: "untrack", pr: 12 });
  });

  test("untrack rejects zero and junk", () => {
    expect(parsePrCommand("untrack #0").kind).toBe("invalid");
    expect(parsePrCommand("untrack abc")).toEqual({
      kind: "invalid",
      reason: "not a pull request URL or #n: abc",
    });
  });

  test("unknown or wrong-case subcommands are invalid", () => {
    expect(parsePrCommand("list")).toEqual({ kind: "invalid", reason: usage });
    expect(parsePrCommand(`Track ${PR}`)).toEqual({ kind: "invalid", reason: usage });
  });
});
