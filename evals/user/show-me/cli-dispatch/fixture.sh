#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/deploy src/cloud
cat > src/main.ts <<'TS'
import { deploy } from "./deploy/deploy";
import { loadProfile } from "./cloud/profile";

const [cmd, env = "staging"] = process.argv.slice(2);
if (cmd === "deploy") await deploy(env, await loadProfile(env));
TS
cat > src/deploy/deploy.ts <<'TS'
import { buildImage, pushImage } from "./image";
import { rollout, waitHealthy, rollback } from "../cloud/rollout";
import { announce } from "./announce";

export async function deploy(env: string, profile: { cluster: string }) {
  const tag = await buildImage();
  await pushImage(tag, profile.cluster);
  const previous = await rollout(profile.cluster, tag);
  if (!(await waitHealthy(profile.cluster, 120))) {
    await rollback(profile.cluster, previous);
    throw new Error(`deploy to ${env} failed health checks`);
  }
  await announce(env, tag);
}
TS
cat > src/deploy/image.ts <<'TS'
export async function buildImage(): Promise<string> {
  const tag = gitSha();
  await Bun.$`docker build -t app:${tag} .`;
  return tag;
}
export async function pushImage(tag: string, cluster: string) {
  await Bun.$`docker push ${cluster}/app:${tag}`;
}
function gitSha() {
  return Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
}
TS
cat > src/deploy/announce.ts <<'TS'
export async function announce(env: string, tag: string) {
  console.log(`deployed ${tag} to ${env}`);
}
TS
cat > src/cloud/rollout.ts <<'TS'
export async function rollout(cluster: string, tag: string): Promise<string> {
  const previous = await currentTag(cluster);
  await Bun.$`kubectl --context ${cluster} set image deploy/app app=app:${tag}`;
  return previous;
}
export async function waitHealthy(cluster: string, seconds: number): Promise<boolean> {
  return (await Bun.$`kubectl --context ${cluster} rollout status deploy/app --timeout=${seconds}s`.nothrow()).exitCode === 0;
}
export async function rollback(cluster: string, tag: string) {
  await Bun.$`kubectl --context ${cluster} set image deploy/app app=app:${tag}`;
}
async function currentTag(cluster: string): Promise<string> {
  return (await Bun.$`kubectl --context ${cluster} get deploy/app -o jsonpath={..image}`.text()).split(":")[1]!;
}
TS
cat > src/cloud/profile.ts <<'TS'
export async function loadProfile(env: string) {
  return { cluster: env === "prod" ? "prod-east" : "staging-east" };
}
TS
