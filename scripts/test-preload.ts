import { afterAll } from "bun:test";

function git(...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  return result.success ? result.stdout.toString().trim() : undefined;
}

// Resolved before stripping, so under a git hook this is the hook's repository.
const commonDir = git("rev-parse", "--path-format=absolute", "--git-common-dir");

// A git hook exports GIT_DIR, which overrides a spawned git's cwd, and GIT_AUTHOR_*, which override fixture identities.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

// Other worktrees write branch and tool sections mid-run, so only watch what test fixtures set.
const watched = /^(user|author|committer|commit|tag|gpg|init|core)\./;

function watchedConfig(path: string): string[] {
  return (git("config", "--file", path, "--list") ?? "")
    .split("\n")
    .filter((line) => watched.test(line));
}

if (commonDir !== undefined) {
  const path = `${commonDir}/config`;
  const before = watchedConfig(path);
  afterAll(() => {
    const after = watchedConfig(path);
    if (after.join("\n") !== before.join("\n")) {
      const added = after.filter((line) => !before.includes(line));
      const removed = before.filter((line) => !after.includes(line));
      throw new Error(
        `Tests changed ${path}: added [${added.join(", ")}] removed [${removed.join(", ")}]`,
      );
    }
  });
}
