import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    limit: { type: "string", default: "10" },
    repo: { type: "string", default: "anthropics/claude-code" },
  },
});

const limit = Number(values.limit);
const repo = values.repo;
const [owner, name] = repo.split("/");

const query = `query($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    releases(first: $limit, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { tagName publishedAt description }
    }
  }
}`;

const result = Bun.spawnSync([
  "gh", "api", "graphql",
  "-f", `query=${query}`,
  "-F", `owner=${owner}`,
  "-F", `name=${name}`,
  "-F", `limit=${limit}`,
  "--jq", ".data.repository.releases.nodes",
]);

if (result.exitCode !== 0) {
  console.error(result.stderr.toString());
  process.exit(1);
}

interface Release {
  tagName: string;
  publishedAt: string;
  description: string;
}

const releases: Release[] = JSON.parse(result.stdout.toString());
const now = Date.now();

function relativeAge(publishedAt: string): string {
  const ms = now - new Date(publishedAt).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (hours < 24) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return "1 week ago";
  return `${weeks} weeks ago`;
}

for (const release of releases) {
  const age = relativeAge(release.publishedAt);
  console.log(`## ${release.tagName} (${age})\n`);
  console.log(release.description);
  console.log();
}
