import { describe, expect, test } from "claude-code/testing";
import { bashOf, mrUrlsOf, parseMrCommand, parseMrUrl } from "./discover.ts";

const MR = "https://gitlab.com/g/r/-/merge_requests/12";

const createOutput = [
  "Creating merge request for x into main in g/r",
  "",
  "!12 Add thing (x)",
  MR,
].join("\n");

const pushOutput = [
  "remote: ",
  "remote: To create a merge request for x, visit:",
  "remote:   https://gitlab.com/g/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=x",
  "remote: ",
].join("\n");

const pushViewOutput = [
  "remote: ",
  "remote: View merge request for x:",
  "remote:   https://gitlab.com/g/r/-/merge_requests/12",
  "remote: ",
  "To gitlab.com:g/r.git",
].join("\n");

const keys = (command: string, output: string) => mrUrlsOf(command, output).map((r) => r.key);

describe("parseMrUrl", () => {
  test("parses a gitlab.com URL", () => {
    expect(parseMrUrl(MR)).toEqual({
      host: "gitlab.com",
      projectPath: "g/r",
      iid: 12,
      url: MR,
      key: "gitlab.com/g/r!12",
    });
  });

  test("keeps scheme, port, and nested groups", () => {
    expect(parseMrUrl("http://git.corp:8443/a/b/c/proj/-/merge_requests/3")).toEqual({
      host: "git.corp:8443",
      projectPath: "a/b/c/proj",
      iid: 3,
      url: "http://git.corp:8443/a/b/c/proj/-/merge_requests/3",
      key: "git.corp:8443/a/b/c/proj!3",
    });
  });

  test("drops trailing path, query, and fragment from url", () => {
    expect(parseMrUrl(`${MR}/diffs`)?.url).toBe(MR);
    expect(parseMrUrl(`${MR}#note_1`)?.url).toBe(MR);
    expect(parseMrUrl(`${MR}?tab=1`)?.url).toBe(MR);
  });

  test("finds a URL inside surrounding text", () => {
    expect(parseMrUrl(`see (${MR}) now`)?.iid).toBe(12);
  });

  test("rejects merge_requests/new", () => {
    expect(parseMrUrl("https://gitlab.com/g/r/-/merge_requests/new")).toBeUndefined();
    expect(parseMrUrl("https://gitlab.com/g/r/-/merge_requests/new?x=1")).toBeUndefined();
  });

  test("rejects a project without a group", () => {
    expect(parseMrUrl("https://gitlab.com/r/-/merge_requests/1")).toBeUndefined();
  });

  test("rejects non-MR text", () => {
    expect(parseMrUrl("https://gitlab.com/g/r/-/issues/1")).toBeUndefined();
    expect(parseMrUrl("")).toBeUndefined();
  });
});

describe("mrUrlsOf", () => {
  test("glab mr create counts the URL in output", () => {
    expect(keys("glab mr create --fill", createOutput)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("glab mr new is an alias", () => {
    expect(keys("glab mr new", createOutput)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("glab mr create ignores new-MR links", () => {
    const output = `${createOutput}\nhttps://gitlab.com/g/r/-/merge_requests/new?x=1`;
    expect(keys("glab mr create", output)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("git push counts the URL after the view line", () => {
    expect(keys("git push", pushViewOutput)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("git push with only the create link returns nothing", () => {
    expect(keys("git push -u origin x", pushOutput)).toEqual([]);
  });

  test("git push ignores other MR URLs in output", () => {
    const output = `${MR.replace("12", "99")}\n${pushViewOutput}`;
    expect(keys("git push", output)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("git push with both create link and view line counts only the view", () => {
    const output = [
      "remote: View merge request for x:",
      "remote:   https://gitlab.com/g/r/-/merge_requests/12",
      "remote: To create a merge request for y, visit:",
      "remote:   https://gitlab.com/g/r/-/merge_requests/new?a=1",
    ].join("\n");
    expect(keys("git push", output)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("glab mr list output is ignored", () => {
    expect(keys("glab mr list", `!1 A\n${MR}`)).toEqual([]);
  });

  test("other glab and git commands are ignored", () => {
    for (const command of [
      "glab mr view 12",
      "glab api projects/1",
      "git pull",
      "echo push",
      "git commit -m push",
    ]) {
      expect(keys(command, `${createOutput}\n${pushViewOutput}`)).toEqual([]);
    }
  });

  test("self-managed host with port and nested groups", () => {
    const url = "https://git.corp:8443/a/b/proj/-/merge_requests/5";
    expect(keys("glab mr create", `!5 T (x)\n${url}`)).toEqual(["git.corp:8443/a/b/proj!5"]);
  });

  test("chained commands", () => {
    expect(keys("git add . && git push -u origin x", pushViewOutput)).toEqual([
      "gitlab.com/g/r!12",
    ]);
    expect(keys("cd foo; glab mr create --fill", createOutput)).toEqual(["gitlab.com/g/r!12"]);
    expect(keys("make test || git push", pushViewOutput)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("git with global options before push", () => {
    expect(keys("git -C dir push", pushViewOutput)).toEqual(["gitlab.com/g/r!12"]);
    expect(keys("git -c push.default=current push", pushViewOutput)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("leading env assignments", () => {
    expect(keys("GIT_SSH_COMMAND=ssh git push", pushViewOutput)).toEqual(["gitlab.com/g/r!12"]);
  });

  test("create and push in one command union and dedupe in first-seen order", () => {
    const output = [
      "https://gitlab.com/g/r/-/merge_requests/12",
      "",
      "remote: View merge request for x:",
      "remote:   https://gitlab.com/g/r/-/merge_requests/7",
      "remote:   https://gitlab.com/g/r/-/merge_requests/12",
    ].join("\n");
    expect(keys("glab mr create && git push", output)).toEqual([
      "gitlab.com/g/r!12",
      "gitlab.com/g/r!7",
    ]);
  });

  test("dedupes repeated URLs", () => {
    expect(keys("glab mr create", `${MR}\n${MR}/diffs`)).toEqual(["gitlab.com/g/r!12"]);
  });
});

describe("bashOf", () => {
  const bash = (response: unknown) => ({
    tool_name: "Bash",
    tool_input: { command: "git push" },
    tool_response: response,
  });

  test("joins stdout then stderr with a newline", () => {
    expect(bashOf(bash({ stdout: "out", stderr: "err" }))).toEqual({
      command: "git push",
      output: "out\nerr",
    });
  });

  test("tolerates a missing stream", () => {
    expect(bashOf(bash({ stderr: "err" }))).toEqual({ command: "git push", output: "err" });
    expect(bashOf(bash({ stdout: "out" }))).toEqual({ command: "git push", output: "out" });
    expect(bashOf(bash({}))).toEqual({ command: "git push", output: "" });
  });

  test("uses a string response as output", () => {
    expect(bashOf(bash("plain"))).toEqual({ command: "git push", output: "plain" });
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

describe("parseMrCommand", () => {
  const ref = parseMrUrl(MR);

  test("empty args toggle", () => {
    expect(parseMrCommand("")).toEqual({ kind: "toggle" });
    expect(parseMrCommand("   ")).toEqual({ kind: "toggle" });
  });

  test("track with a URL", () => {
    expect(parseMrCommand(`  track ${MR} `)).toEqual({ kind: "track", ref });
  });

  test("track without a valid URL is invalid", () => {
    expect(parseMrCommand("track nope")).toEqual({
      kind: "invalid",
      reason: "not a merge request URL: nope",
    });
    expect(parseMrCommand("track https://gitlab.com/g/r/-/merge_requests/new")).toEqual({
      kind: "invalid",
      reason: "not a merge request URL: https://gitlab.com/g/r/-/merge_requests/new",
    });
  });

  test("track needs exactly one argument", () => {
    const usage = "usage: /mr [track <url> | untrack <url|!iid>]";
    expect(parseMrCommand("track")).toEqual({ kind: "invalid", reason: usage });
    expect(parseMrCommand(`track ${MR} ${MR}`)).toEqual({ kind: "invalid", reason: usage });
  });

  test("untrack accepts a URL, !iid, or bare integer", () => {
    expect(parseMrCommand(`untrack ${MR}`)).toEqual({ kind: "untrack", ref });
    expect(parseMrCommand("untrack !12")).toEqual({ kind: "untrack", iid: 12 });
    expect(parseMrCommand("untrack 12")).toEqual({ kind: "untrack", iid: 12 });
  });

  test("untrack rejects zero and junk", () => {
    expect(parseMrCommand("untrack !0").kind).toBe("invalid");
    expect(parseMrCommand("untrack abc")).toEqual({
      kind: "invalid",
      reason: "not a merge request URL or !iid: abc",
    });
  });

  test("unknown or wrong-case subcommands are invalid", () => {
    const usage = "usage: /mr [track <url> | untrack <url|!iid>]";
    expect(parseMrCommand("list")).toEqual({ kind: "invalid", reason: usage });
    expect(parseMrCommand(`Track ${MR}`)).toEqual({ kind: "invalid", reason: usage });
  });
});
