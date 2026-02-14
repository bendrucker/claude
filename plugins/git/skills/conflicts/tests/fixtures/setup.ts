import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export type Fixture = {
  path: string;
  cleanup: () => Promise<void>;
};

export async function createConflictFixture(): Promise<Fixture> {
  const path = await mkdtemp(join(tmpdir(), "git-conflicts-test-"));

  const git = (args: string) => $`git ${args.split(" ")}`.cwd(path).quiet();

  await git("init -b main");
  await git("config user.email test@test.com");
  await git("config user.name Test");

  await Bun.write(join(path, "file.txt"), "line 1\nline 2\nline 3\n");
  await git("add file.txt");
  await git("commit -m initial");

  await git("checkout -b feature");
  await Bun.write(join(path, "file.txt"), "line 1\nfeature change\nline 3\n");
  await git("commit -am feature");

  await git("checkout main");
  await Bun.write(join(path, "file.txt"), "line 1\nmain change\nline 3\n");
  await git("commit -am main");

  await $`git merge feature`.cwd(path).quiet().nothrow();

  return {
    path,
    cleanup: () => rm(path, { recursive: true }),
  };
}

export type DivergenceFixture = Fixture & {
  originPath: string;
};

export async function createDivergenceFixture(options?: {
  overlapping?: boolean;
}): Promise<DivergenceFixture> {
  const base = await mkdtemp(join(tmpdir(), "git-upstream-"));
  const originPath = join(base, "origin");
  const clonePath = join(base, "clone");

  await $`git init -b main ${originPath}`.quiet();
  const originGit = (args: string) => $`git ${args.split(" ")}`.cwd(originPath).quiet();
  await originGit("config user.email test@test.com");
  await originGit("config user.name Test");

  await Bun.write(join(originPath, "shared.txt"), "original\n");
  await Bun.write(join(originPath, "origin-only.txt"), "origin\n");
  await originGit("add .");
  await originGit("commit -m initial");

  await $`git clone ${originPath} ${clonePath}`.quiet();
  const cloneGit = (args: string) => $`git ${args.split(" ")}`.cwd(clonePath).quiet();
  await cloneGit("config user.email test@test.com");
  await cloneGit("config user.name Test");
  await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`
    .cwd(clonePath)
    .quiet();

  await cloneGit("checkout -b feature");

  if (options?.overlapping) {
    await Bun.write(join(clonePath, "shared.txt"), "feature change\n");
    await cloneGit("commit -am feature-shared");
  } else {
    await Bun.write(join(clonePath, "feature-only.txt"), "feature\n");
    await cloneGit("add .");
    await cloneGit("commit -m feature-only");
  }

  if (options?.overlapping) {
    await Bun.write(join(originPath, "shared.txt"), "origin change\n");
  } else {
    await Bun.write(join(originPath, "origin-only.txt"), "updated\n");
  }
  await originGit("commit -am upstream-advance");

  return {
    path: clonePath,
    originPath,
    cleanup: () => rm(base, { recursive: true }),
  };
}
