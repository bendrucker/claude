#!/usr/bin/env bun
// Stands in for gh on acme/api-server#247: canned review threads for reads, refusal for writes.

const OWNER = "acme";
const REPO = "api-server";
const NUMBER = 247;
const VIEWER = "bendrucker";
const URL = `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}`;

interface Author {
  login: string;
  __typename: "User" | "Bot";
}

interface Note {
  author: Author;
  body: string;
  createdAt: string;
}

const user = (login: string): Author => ({ login, __typename: "User" });
const bot = (login: string): Author => ({ login, __typename: "Bot" });
const note = (author: Author, body: string, createdAt: string): Note => ({
  author,
  body,
  createdAt,
});

interface Thread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number;
  startLine: number | null;
  resolvedBy: { login: string } | null;
  comments: { nodes: Note[] };
}

const thread = (
  id: string,
  path: string,
  line: number,
  resolved: boolean,
  comments: Note[],
): Thread => ({
  id,
  isResolved: resolved,
  isOutdated: false,
  path,
  line,
  startLine: null,
  resolvedBy: resolved ? { login: VIEWER } : null,
  comments: { nodes: comments },
});

const threads: Thread[] = [
  thread("PRRT_kwDOLr8b2M5f1aQ1", "test/rate-limit.test.ts", 31, true, [
    note(
      user("priya-k"),
      "This test sleeps for two real seconds. Fake timers (or passing `now` into `check`) would keep the suite fast.",
      "2026-09-20T14:02:11Z",
    ),
  ]),
  thread("PRRT_kwDOLr8b2M5f1aQ2", "src/middleware/rate-limit.ts", 18, true, [
    note(user("priya-k"), "Typo: `retryAfer`.", "2026-09-20T14:05:40Z"),
    note(user(VIEWER), "Fixed, it's `retryAfter` now.", "2026-09-22T09:31:02Z"),
  ]),
  thread("PRRT_kwDOLr8b2M5f1aQ3", "src/routes/orders.ts", 18, false, [
    note(
      bot("coderabbitai"),
      "_⚠️ Potential issue_\n\n**`limiter.check()` returns a Promise that is never awaited.**\n\n`result.allowed` is always `undefined` on a pending Promise, so the guard never rejects and the limit is not enforced.\n\n```diff\n-  const result = limiter.check(tenant);\n+  const result = await limiter.check(tenant);\n```",
      "2026-09-21T08:44:57Z",
    ),
  ]),
  thread("PRRT_kwDOLr8b2M5f1aQ4", "src/config.ts", 6, false, [
    note(
      user("mchen"),
      "Should the limit be configurable per tenant? Enterprise tenants will hit 100/min quickly.",
      "2026-09-21T16:20:33Z",
    ),
    note(
      user(VIEWER),
      "Keeping it global for this PR. Per-tenant limits need the tenant settings table, tracked in #251.",
      "2026-09-21T17:02:48Z",
    ),
  ]),
  thread("PRRT_kwDOLr8b2M5f1aQ5", "src/routes/orders.ts", 54, true, [
    note(
      user("mchen"),
      "Return 429 with a `Retry-After` header here instead of 503. Clients treat 503 as an outage and our SDK retries it immediately.",
      "2026-09-21T16:31:09Z",
    ),
  ]),
  thread("PRRT_kwDOLr8b2M5f1aQ6", "src/middleware/rate-limit.ts", 39, false, [
    note(
      user("mchen"),
      "This is a fixed window, so a tenant can send twice the limit across a window boundary (100 at 0:59, 100 at 1:00). Could this be a sliding window or a token bucket?",
      "2026-09-24T11:12:40Z",
    ),
  ]),
];

const reviews = [
  { author: user("priya-k"), submittedAt: "2026-09-20T14:06:00Z", state: "COMMENTED", body: "" },
  {
    author: bot("coderabbitai"),
    submittedAt: "2026-09-21T08:45:30Z",
    state: "COMMENTED",
    body: "**Actionable comments posted: 1**",
  },
  {
    author: user("mchen"),
    submittedAt: "2026-09-21T16:32:00Z",
    state: "CHANGES_REQUESTED",
    body: "A couple of API behavior questions.",
  },
  { author: user("mchen"), submittedAt: "2026-09-24T11:13:10Z", state: "COMMENTED", body: "" },
];

function git(...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
}

function commits() {
  const log = git("log", "--reverse", "--format=%H%x09%aI%x09%s", "origin/main..HEAD");
  return log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [oid, date, headline] = line.split("\t");
      return { oid, committedDate: date, authoredDate: date, messageHeadline: headline };
    });
}

function pullRequest() {
  const head = git("rev-parse", "HEAD");
  return {
    number: NUMBER,
    title: "Rate-limit order creation per tenant",
    body: "Adds a per-tenant limiter in front of `POST /v1/orders`, backed by Redis.",
    url: URL,
    state: "OPEN",
    isDraft: false,
    author: user(VIEWER),
    headRefName: "rate-limit-orders",
    baseRefName: "main",
    headRefOid: head,
    createdAt: "2026-09-19T16:00:00Z",
    updatedAt: "2026-09-24T11:13:10Z",
    reviewDecision: "CHANGES_REQUESTED",
    mergeable: "MERGEABLE",
    reviews: { nodes: reviews },
    latestReviews: { nodes: reviews.slice(1) },
    comments: { nodes: [] },
    commits: { totalCount: commits().length, nodes: commits().map((commit) => ({ commit })) },
    reviewThreads: {
      totalCount: threads.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: threads,
    },
  };
}

// REST review comments carry no resolution state, as on github.com.
function restReviewComments() {
  let id = 2340000100;
  return threads.flatMap((t) => {
    const first = id + 1;
    return t.comments.nodes.map((c, i) => ({
      id: ++id,
      in_reply_to_id: i === 0 ? undefined : first,
      path: t.path,
      line: t.line,
      original_line: t.line,
      side: "RIGHT",
      body: c.body,
      created_at: c.createdAt,
      updated_at: c.createdAt,
      user: { login: c.author.login, type: c.author.__typename },
      html_url: `${URL}#discussion_r${id}`,
    }));
  });
}

function restPull() {
  const pr = pullRequest();
  return {
    number: NUMBER,
    title: pr.title,
    body: pr.body,
    html_url: URL,
    state: "open",
    draft: false,
    user: { login: VIEWER, type: "User" },
    head: { ref: pr.headRefName, sha: pr.headRefOid },
    base: { ref: "main" },
    created_at: pr.createdAt,
    updated_at: pr.updatedAt,
    review_comments: restReviewComments().length,
    commits: pr.commits.totalCount,
  };
}

function refuse(what: string): never {
  console.error(`gh: ${what} is blocked in this environment: it is read-only for GitHub writes`);
  process.exit(1);
}

function notFound(what: string): never {
  console.error(`gh: Not Found (HTTP 404) ${what}`);
  process.exit(1);
}

function emit(value: unknown, jq: string | undefined): void {
  const json = JSON.stringify(value, null, 2);
  if (jq === undefined) {
    console.log(json);
    return;
  }
  const proc = Bun.spawnSync(["jq", "-r", jq], { stdin: Buffer.from(json) });
  process.stdout.write(proc.stdout);
  process.stderr.write(proc.stderr);
  process.exit(proc.exitCode);
}

function pick(value: Record<string, unknown>, fields: string | undefined) {
  if (fields === undefined) return value;
  const map: Record<string, unknown> = {
    ...value,
    author: { login: VIEWER, is_bot: false },
    reviews,
    latestReviews: reviews.slice(1),
    comments: [],
    commits: commits(),
  };
  return Object.fromEntries(fields.split(",").map((f) => [f, map[f.trim()] ?? null]));
}

interface Parsed {
  positional: string[];
  flags: Map<string, string[]>;
}

const VALUE_FLAGS = new Set([
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "-X",
  "--method",
  "-q",
  "--jq",
  "-H",
  "--header",
  "--json",
  "-R",
  "--repo",
  "-t",
  "--template",
  "--hostname",
  "--input",
  "-b",
  "--body",
  "-c",
]);

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    if (eq > 0) {
      const key = arg.slice(0, eq);
      flags.set(key, [...(flags.get(key) ?? []), arg.slice(eq + 1)]);
    } else if (VALUE_FLAGS.has(arg)) {
      flags.set(arg, [...(flags.get(arg) ?? []), args[++i] ?? ""]);
    } else if (arg.startsWith("-")) {
      flags.set(arg, [...(flags.get(arg) ?? []), ""]);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const first = (p: Parsed, ...names: string[]) =>
  names.map((n) => p.flags.get(n)?.[0]).find((v) => v !== undefined);
const all = (p: Parsed, ...names: string[]) => names.flatMap((n) => p.flags.get(n) ?? []);

function api(p: Parsed) {
  const endpoint = (p.positional[1] ?? "").replace(/^\//, "").replace(/\?.*$/, "");
  const fields = all(p, "-f", "-F", "--field", "--raw-field");
  const method = (
    first(p, "-X", "--method") ?? (fields.length > 0 && endpoint !== "graphql" ? "POST" : "GET")
  ).toUpperCase();
  const jq = first(p, "-q", "--jq");

  if (endpoint === "graphql") {
    const query = fields.find((f) => f.startsWith("query="))?.slice("query=".length) ?? "";
    if (/^\s*mutation\b/.test(query) || /\bmutation\s*[({]/.test(query)) refuse("GraphQL mutation");
    const variables = new Map(
      fields
        .filter((f) => !f.startsWith("query="))
        .map((f) => {
          const eq = f.indexOf("=");
          return [f.slice(0, eq), f.slice(eq + 1)] as const;
        }),
    );
    const owner = variables.get("owner");
    const repo = variables.get("repo");
    if (owner !== undefined && (owner !== OWNER || repo !== REPO)) {
      const message = `Could not resolve to a Repository with the name '${owner}/${repo ?? ""}'.`;
      emit({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message }] }, jq);
      return;
    }
    emit({ data: { viewer: { login: VIEWER }, repository: { pullRequest: pullRequest() } } }, jq);
    return;
  }

  if (method !== "GET") refuse(`${method} ${endpoint}`);
  if (endpoint === "user") {
    emit({ login: VIEWER, type: "User" }, jq);
    return;
  }

  const match = /^repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(endpoint);
  if (!match) notFound(endpoint);
  const [, owner, repo, rest = ""] = match;
  if (owner !== OWNER || repo !== REPO) notFound(endpoint);

  const routes: Record<string, () => object> = {
    "": () => ({ full_name: `${OWNER}/${REPO}`, default_branch: "main", private: true }),
    [`pulls/${NUMBER}`]: restPull,
    [`pulls/${NUMBER}/comments`]: restReviewComments,
    [`pulls/${NUMBER}/reviews`]: () =>
      reviews.map((r, i) => ({
        id: 1900 + i,
        user: { login: r.author.login, type: r.author.__typename },
        state: r.state,
        body: r.body,
        submitted_at: r.submittedAt,
      })),
    [`pulls/${NUMBER}/commits`]: () =>
      commits().map((c) => ({
        sha: c.oid,
        commit: {
          message: c.messageHeadline,
          author: { date: c.authoredDate },
          committer: { date: c.committedDate },
        },
      })),
    [`issues/${NUMBER}/comments`]: () => [],
    [`pulls/${NUMBER}/requested_reviewers`]: () => ({ users: [], teams: [] }),
  };
  const route = routes[rest];
  if (!route) notFound(endpoint);
  emit(route(), jq);
}

function pullRequestCommand(p: Parsed): void {
  const sub = p.positional[1];
  const target = p.positional[2];
  if (
    target !== undefined &&
    target !== String(NUMBER) &&
    target !== URL &&
    !target.startsWith(`${URL}/`)
  ) {
    console.error(`GraphQL: Could not resolve to a PullRequest with the number of ${target}.`);
    process.exit(1);
  }
  const jq = first(p, "-q", "--jq");
  switch (sub ?? "") {
    case "view": {
      const json = first(p, "--json");
      if (json !== undefined) {
        emit(pick(pullRequest(), json), jq);
        return;
      }
      console.log(
        `Rate-limit order creation per tenant ${OWNER}/${REPO}#${NUMBER}\nOpen • ${VIEWER} wants to merge ${commits().length} commits into main from rate-limit-orders\nReviewers: mchen (Changes requested), priya-k (Commented), coderabbitai (Commented)\n\n  Adds a per-tenant limiter in front of POST /v1/orders, backed by Redis.\n\nView this pull request on GitHub: ${URL}`,
      );
      return;
    }
    case "diff": {
      process.stdout.write(Bun.spawnSync(["git", "diff", "origin/main...HEAD"]).stdout);
      return;
    }
    case "checks":
      console.log(
        "test\tpass\t1m12s\thttps://github.com/acme/api-server/actions/runs/1\nlint\tpass\t31s\thttps://github.com/acme/api-server/actions/runs/1",
      );
      return;
    case "list":
    case "status":
      emit(
        [
          {
            number: NUMBER,
            title: pullRequest().title,
            headRefName: "rate-limit-orders",
            url: URL,
          },
        ],
        jq,
      );
      return;
    default:
      refuse(`gh pr ${sub ?? ""}`.trim());
  }
}

const args = Bun.argv.slice(2);
const parsed = parse(args);
switch (parsed.positional[0] ?? "") {
  case "api":
    api(parsed);
    break;
  case "pr":
    pullRequestCommand(parsed);
    break;
  case "auth":
    console.log(
      `github.com\n  ✓ Logged in to github.com account ${VIEWER} (keyring)\n  - Active account: true`,
    );
    break;
  case "repo":
    if (parsed.positional[1] !== "view") refuse(`gh repo ${parsed.positional[1] ?? ""}`);
    emit(
      {
        nameWithOwner: `${OWNER}/${REPO}`,
        defaultBranchRef: { name: "main" },
        url: `https://github.com/${OWNER}/${REPO}`,
      },
      first(parsed, "-q", "--jq"),
    );
    break;
  default:
    refuse(`gh ${args.join(" ")}`);
}
