#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";

const QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        url
        title
        body
        mergedAt
        repository { nameWithOwner isPrivate }
      }
    }
  }
}`;

const q = "author:bendrucker is:pr is:merged is:public";
const outDir = `${import.meta.dir}/bodies`;
await mkdir(outDir, { recursive: true });

type PR = {
  url: string;
  title: string;
  body: string | null;
  mergedAt: string;
  repository: { nameWithOwner: string; isPrivate: boolean };
};

const all: PR[] = [];
let after: string | null = null;

for (let page = 0; page < 12; page++) {
  const proc = Bun.spawnSync([
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${QUERY}`,
    "-f",
    `q=${q}`,
    ...(after ? ["-f", `after=${after}`] : []),
  ]);
  if (proc.exitCode !== 0) {
    console.error(proc.stderr.toString());
    process.exit(1);
  }
  const data = JSON.parse(proc.stdout.toString()).data.search;
  const nodes: PR[] = data.nodes.filter((n: PR) => n && n.url);
  all.push(...nodes);
  console.error(`page ${page + 1}: +${nodes.length} (total ${all.length})`);
  if (!data.pageInfo.hasNextPage) break;
  after = data.pageInfo.endCursor;
}

// Write one markdown file per PR that has a body, plus a manifest.
let withBody = 0;
const manifest: { file: string; url: string; repo: string; title: string; mergedAt: string }[] = [];
for (let i = 0; i < all.length; i++) {
  const pr = all[i];
  if (pr.repository.isPrivate) continue;
  if (!pr.body || !pr.body.trim()) continue;
  withBody++;
  const num = pr.url.split("/").pop();
  const repoSlug = pr.repository.nameWithOwner.replace("/", "__");
  const file = `${repoSlug}__${num}.md`;
  await Bun.write(`${outDir}/${file}`, pr.body);
  manifest.push({
    file,
    url: pr.url,
    repo: pr.repository.nameWithOwner,
    title: pr.title,
    mergedAt: pr.mergedAt,
  });
}

await Bun.write(`${import.meta.dir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.error(`\ntotal PRs: ${all.length}, with non-empty body: ${withBody}`);
console.error(`wrote ${manifest.length} body files to ${outDir}`);
