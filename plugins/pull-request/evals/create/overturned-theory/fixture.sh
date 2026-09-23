#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/proc-runner.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p src

cat > src/run.ts <<'TS'
import { spawn } from "node:child_process";

export async function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const child = spawn(cmd, args);
  const exit = new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
  const code = await exit;
  let stdout = "";
  for await (const chunk of child.stdout) stdout += chunk;
  return { code, stdout };
}
TS
git add -A && git commit -qm "run: add spawn wrapper"

git switch -qc fix-exit-race
cat > src/run.ts <<'TS'
import { spawn } from "node:child_process";

export async function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const child = spawn(cmd, args);
  const exit = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
  let stdout = "";
  for await (const chunk of child.stdout) stdout += chunk;
  return { code: await exit, stdout };
}
TS
git commit -qam "run: read stdout before awaiting exit"
