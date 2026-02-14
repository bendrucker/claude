import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export async function getDefaultBranch(cwd?: string): Promise<string | null> {
  try {
    const dir = cwd ?? process.cwd();

    const repoRoot = (await $`git rev-parse --show-toplevel`.cwd(dir).quiet()).text().trim();
    const safePath = repoRoot.replace(/\//g, "_");
    const tmpDir = process.env.TMPDIR || tmpdir();
    const cacheFile = join(tmpDir, `claude-default-branch${safePath}`);

    if (await Bun.file(cacheFile).exists()) {
      return (await Bun.file(cacheFile).text()).trim();
    }

    let defaultBranch: string | null = null;

    const symref = await $`git symbolic-ref refs/remotes/origin/HEAD`.cwd(dir).quiet().nothrow();
    if (symref.exitCode === 0) {
      defaultBranch = symref.text().trim().replace(/^refs\/remotes\/origin\//, "");
    } else {
      const gh = await $`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`
        .cwd(dir)
        .quiet()
        .nothrow();
      if (gh.exitCode === 0) {
        defaultBranch = gh.text().trim();
      }
    }

    if (defaultBranch) {
      await Bun.write(cacheFile, defaultBranch);
    }

    return defaultBranch || null;
  } catch {
    return null;
  }
}
