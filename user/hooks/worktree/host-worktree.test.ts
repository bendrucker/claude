import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostWorktree } from "./host-worktree";

let root: string;
let tree: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "host-worktree-")));
  tree = join(root, "tree");
  mkdirSync(join(tree, "sub"), { recursive: true });
  mkdirSync(join(root, "tree-sibling"));
  const link = Bun.spawnSync(["ln", "-s", tree, join(root, "link")]);
  if (link.exitCode !== 0) throw new Error(link.stderr.toString());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Case {
  name: string;
  cwd: () => string;
  declared: () => string | undefined;
  inside: boolean;
}

test.each<Case>([
  { name: "unset", cwd: () => tree, declared: () => undefined, inside: false },
  { name: "empty", cwd: () => tree, declared: () => "", inside: false },
  { name: "session at the worktree root", cwd: () => tree, declared: () => tree, inside: true },
  {
    name: "session below the worktree",
    cwd: () => join(tree, "sub"),
    declared: () => tree,
    inside: true,
  },
  {
    name: "declared through a symlink",
    cwd: () => tree,
    declared: () => join(root, "link"),
    inside: true,
  },
  {
    name: "session in a prefix-sharing sibling",
    cwd: () => join(root, "tree-sibling"),
    declared: () => tree,
    inside: false,
  },
  {
    name: "declared path missing",
    cwd: () => tree,
    declared: () => join(root, "absent"),
    inside: false,
  },
])("$name", ({ cwd, declared, inside }) => {
  expect(hostWorktree(cwd(), { CLAUDE_CODE_HOST_WORKTREE: declared() })).toBe(inside ? tree : null);
});
