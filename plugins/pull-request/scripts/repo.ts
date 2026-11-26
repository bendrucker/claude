// What the hook learns about the repository behind the command: whether a hex
// run names one of its commits.

import type { RepoContext } from "./body-rules";

async function commitExists(cwd: string, sha: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`], {
      cwd,
      env: process.env,
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    return false;
  }
}

export function gitRepo(cwd: string): RepoContext {
  return {
    hasCommit: (sha) => commitExists(cwd, sha),
  };
}
