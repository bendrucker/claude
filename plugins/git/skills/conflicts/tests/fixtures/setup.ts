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
