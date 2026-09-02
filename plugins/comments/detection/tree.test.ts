import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { scoreTree } from "./tree";

const comment = (i: number) =>
  `// Explains step ${i} of the procedure in far more prose than the line below needs to justify.`;

const heavy = (count: number, commented = count) =>
  `${Array.from({ length: count }, (_, i) =>
    i < commented ? `${comment(i)}\nconst step${i} = ${i};` : `const step${i} = ${i};`,
  ).join("\n")}\n`;

let dir: string;
let git: typeof $;

async function write(path: string, content: string): Promise<void> {
  await Bun.write(join(dir, path), content);
}

async function commit(message: string): Promise<void> {
  await git`git add -A`.quiet();
  await git`git commit -m ${message}`.quiet();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "comments-tree-"));
  git = $.cwd(dir).env({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" });
  await git`git init -b main`.quiet();
  await git`git config user.email test@example.com`.quiet();
  await git`git config user.name Test`.quiet();
  await write("base.ts", heavy(20, 20));
  await commit("init");
  await git`git checkout -b work`.quiet();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const excess = async () => (await scoreTree({ cwd: dir })).session.excessChars;

describe("scoreTree", () => {
  test("scores the comments a branch introduced, committed or not", async () => {
    await write("committed.ts", heavy(20));
    await commit("add committed");
    await write("pending.ts", heavy(20));

    const { files } = await scoreTree({ cwd: dir });
    expect(files.map((file) => file.path).toSorted()).toEqual(["committed.ts", "pending.ts"]);
  });

  test("leaves files the base already carried out of the score", async () => {
    expect(await excess()).toBe(0);
  });

  test("falls to zero once the introduced comments are trimmed away", async () => {
    await write("heavy.ts", heavy(30));
    const before = await excess();
    expect(before).toBeGreaterThan(0);

    await write("heavy.ts", heavy(30, 15));
    const trimmed = await excess();
    expect(trimmed).toBeLessThan(before);

    await write("heavy.ts", heavy(30, 0));
    expect(await excess()).toBe(0);
  });

  test("scores the same tree the same however many edits produced it", async () => {
    await write("heavy.ts", heavy(30));
    const once = await excess();
    await write("heavy.ts", heavy(30, 15));
    await write("heavy.ts", heavy(30));
    expect(await excess()).toBe(once);
  });

  test("charges a renamed file only for what the move changed", async () => {
    await git`git mv base.ts moved.ts`.quiet();
    const moved = await excess();

    await write("moved.ts", `${heavy(20)}${await Bun.file(join(dir, "moved.ts")).text()}`);
    expect(moved).toBe(0);
    expect(await excess()).toBeGreaterThan(0);
  });

  test("narrows to the requested paths", async () => {
    await write("one.ts", heavy(20));
    await write("two.ts", heavy(20));

    const both = await scoreTree({ cwd: dir });
    const narrowed = await scoreTree({ cwd: dir, paths: [join(dir, "one.ts")] });
    expect(both.files).toHaveLength(2);
    expect(narrowed.files.map((file) => file.path)).toEqual(["one.ts"]);
    expect(narrowed.session.excessChars).toBeLessThan(both.session.excessChars);
  });

  test("skips paths with no known language and deleted files", async () => {
    await write("notes.txt", "prose, not code\n");
    await git`git rm -q base.ts`.quiet();

    expect((await scoreTree({ cwd: dir })).files).toEqual([]);
  });

  test("scores nothing outside a git repo", async () => {
    const loose = await mkdtemp(join(tmpdir(), "comments-loose-"));
    try {
      await Bun.write(join(loose, "heavy.ts"), heavy(30));
      const { files, session } = await scoreTree({ cwd: loose });
      expect(files).toEqual([]);
      expect(session.excessChars).toBe(0);
    } finally {
      await rm(loose, { recursive: true, force: true });
    }
  });
});
