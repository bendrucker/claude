import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  areaRefs,
  blameOwners,
  changedFiles,
  selfIdentities,
  suggestReviewers,
} from "./suggest-reviewers";

const ME = { name: "Me Dev", email: "me@example.com" };
const OTHER = { name: "Other Dev", email: "other@example.com" };

describe("suggest-reviewers", () => {
  let dir: string;

  function git(args: string): string {
    return execSync(`git ${args}`, { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
  }

  async function commit(
    file: string,
    content: string,
    author: typeof ME,
    subject: string,
  ): Promise<void> {
    await Bun.write(path.join(dir, file), content);
    git(`add "${file}"`);
    git(`commit --author="${author.name} <${author.email}>" -m "${subject}"`);
  }

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "suggest-reviewers-")));
    git("init -q");
    git("symbolic-ref HEAD refs/heads/main");
    git(`config user.name "${ME.name}"`);
    git(`config user.email "${ME.email}"`);
    git("config commit.gpgsign false");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ranks blame owners and excludes you", async () => {
    await commit("foo.txt", "a\nb\nc\nd\n", OTHER, "feat: add foo (#10)");
    git("checkout -q -b feature");
    await commit("foo.txt", "a\nb\nc\nd\ne\n", ME, "tweak foo");

    const result = suggestReviewers(dir, "main");
    expect(result.owners).toEqual([{ name: OTHER.name, email: OTHER.email, lines: 4 }]);
    expect(result.soleAuthor).toBe(false);
    expect(result.areaRefs).toEqual(["#10"]);
  });

  it("flags sole authorship when only you touched the area", async () => {
    await commit("foo.txt", "a\nb\n", ME, "feat: add foo (#7)");
    git("checkout -q -b feature");
    await commit("foo.txt", "a\nb\nc\n", ME, "extend foo");

    const result = suggestReviewers(dir, "main");
    expect(result.owners).toHaveLength(0);
    expect(result.soleAuthor).toBe(true);
    expect(result.areaRefs).toEqual(["#7"]);
  });

  it("parses GitLab MR refs from in-area history", async () => {
    await commit("foo.txt", "a\n", OTHER, "feat: add foo\n\nSee merge request grp/proj!45");
    git("checkout -q -b feature");
    await commit("foo.txt", "a\nb\n", ME, "extend foo");

    expect(areaRefs(["foo.txt"], dir, "main")).toEqual(["!45"]);
  });

  it("excludes your name even when committed under a different email", async () => {
    await commit("foo.txt", "a\nb\n", { name: ME.name, email: "alias@example.com" }, "feat: foo");
    expect(blameOwners(["foo.txt"], selfIdentities(dir), dir)).toHaveLength(0);
  });

  it("ignores files deleted at HEAD", async () => {
    await commit("gone.txt", "x\n", OTHER, "add gone");
    git("checkout -q -b feature");
    git("rm -q gone.txt");
    git('commit -m "remove gone"');

    expect(changedFiles(dir, "main")).toEqual([]);
  });
});
