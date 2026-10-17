import { spawnSync } from "node:child_process";
import { echo } from "./echo";
import {
  type Args,
  commits,
  emit,
  fail,
  type Fields,
  fields,
  fileDiffs,
  flag,
  git,
  has,
  parseArgs,
  readSnapshot,
  refuse,
} from "./snapshot";

interface Comment {
  author: string;
  bot: boolean;
  body: string;
  createdAt: string;
  commit: string;
}

interface Thread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  resolvedBy: string | null;
  comments: Comment[];
}

interface Review {
  id: number;
  author: string;
  bot: boolean;
  state: string;
  submittedAt: string;
  commit: string;
  body: string;
}

interface Check {
  name: string;
  state: string;
  elapsed: string;
  link: string;
}

/** A pull request snapshot: the fixture's `meta.json`, with the SHAs its scaffold committed. */
export interface Meta {
  root: string;
  repo: string;
  viewer: string;
  base: string;
  head: string;
  pull: {
    number: number;
    title: string;
    body: string;
    author: string;
    headRefName: string;
    baseRefName: string;
    createdAt: string;
  };
  reviews: Review[];
  threads: Thread[];
  /** `gh pr checks` rows, or none reported when absent. */
  checks: Check[] | undefined;
}

function decode(m: Fields): Meta {
  const pull = m.object("pull");
  return {
    root: m.string("root"),
    repo: m.string("repo"),
    viewer: m.string("viewer"),
    base: m.string("base"),
    head: m.string("head"),
    pull: {
      number: pull.number("number"),
      title: pull.string("title"),
      body: pull.string("body"),
      author: pull.string("author"),
      headRefName: pull.string("headRefName"),
      baseRefName: pull.string("baseRefName", "main"),
      createdAt: pull.string("createdAt"),
    },
    reviews: m.list("reviews").map((r) => ({
      id: r.number("id"),
      author: r.string("author"),
      bot: r.boolean("bot", false),
      state: r.string("state"),
      submittedAt: r.string("submittedAt"),
      commit: r.string("commit"),
      body: r.string("body", ""),
    })),
    threads: m.list("threads").map((t) => ({
      id: t.string("id"),
      isResolved: t.boolean("isResolved"),
      isOutdated: t.boolean("isOutdated", false),
      path: t.string("path"),
      line: t.nullableNumber("line"),
      startLine: t.nullableNumber("startLine"),
      resolvedBy: t.nullableString("resolvedBy"),
      comments: t.list("comments").map((c) => ({
        author: c.string("author"),
        bot: c.boolean("bot", false),
        body: c.string("body"),
        createdAt: c.string("createdAt"),
        commit: c.string("commit"),
      })),
    })),
    checks: m.has("checks")
      ? m.list("checks").map((c) => ({
          name: c.string("name"),
          state: c.string("state"),
          elapsed: c.string("elapsed", "0s"),
          link: c.string("link", ""),
        }))
      : undefined,
  };
}

const argv = process.argv.slice(2);
const snapshot = await readSnapshot();
if (snapshot === undefined) echo("gh", argv);
const meta = decode(snapshot);
const { root } = meta;
const [owner = "", name = ""] = meta.repo.split("/");
const url = `https://github.com/${meta.repo}/pull/${meta.pull.number}`;

const BOOLEANS = new Set([
  "--paginate",
  "--slurp",
  "-i",
  "--include",
  "--silent",
  "--verbose",
  "--name-only",
  "--patch",
  "--comments",
  "--web",
  "-w",
  "--color",
]);

function actor(login: string, bot = false) {
  return { login, __typename: bot ? "Bot" : "User" };
}

function user(login: string, bot = false) {
  return { login, type: bot ? "Bot" : "User" };
}

/** Maps a branch name to the SHA the server holds, since local branches may lag origin. */
function resolve(ref: string): string {
  if (ref === meta.pull.headRefName) return meta.head;
  if (ref === meta.pull.baseRefName) return meta.base;
  const out = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (out.status !== 0) fail(`gh: No commit found for SHA: ${ref} (HTTP 404)`);
  return out.stdout.trim();
}

/** Each author's last review, as `latestReviews` reports them: a later comment keeps an approval or change request standing. */
function latest(): Review[] {
  const byAuthor = new Map<string, Review>();
  for (const r of meta.reviews) {
    const prior = byAuthor.get(r.author);
    if (prior === undefined || r.state !== "COMMENTED" || prior.state === "COMMENTED")
      byAuthor.set(r.author, r);
  }
  return [...byAuthor.values()];
}

function reviewDecision(): string {
  const states = new Set(latest().map((r) => r.state));
  if (states.has("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (states.has("APPROVED")) return "APPROVED";
  return "REVIEW_REQUIRED";
}

function prCommits(from = meta.base, to = meta.head) {
  return commits(root, from, to);
}

function prFiles(from = meta.base, to = meta.head) {
  return fileDiffs(root, from, to).map((f) => ({
    filename: f.newPath,
    previous_filename: f.status === "renamed" ? f.oldPath : undefined,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.additions + f.deletions,
    patch: f.patch,
  }));
}

function restCommit(c: ReturnType<typeof prCommits>[number]) {
  return {
    sha: c.sha,
    commit: { message: c.message, author: { name: c.author, email: c.email, date: c.date } },
    author: user(c.author === meta.pull.author ? meta.pull.author : c.author),
    html_url: `https://github.com/${meta.repo}/commit/${c.sha}`,
  };
}

function restPull() {
  const files = prFiles();
  return {
    number: meta.pull.number,
    title: meta.pull.title,
    body: meta.pull.body,
    state: "open",
    html_url: url,
    user: user(meta.pull.author),
    head: { ref: meta.pull.headRefName, sha: meta.head },
    base: { ref: meta.pull.baseRefName, sha: meta.base },
    created_at: meta.pull.createdAt,
    draft: false,
    commits: prCommits().length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changed_files: files.length,
  };
}

function restReviews() {
  return meta.reviews.map((r) => ({
    id: r.id,
    user: user(r.author, r.bot),
    body: r.body,
    state: r.state,
    submitted_at: r.submittedAt,
    commit_id: r.commit,
    html_url: `${url}#pullrequestreview-${r.id}`,
  }));
}

function restComments() {
  return meta.threads.flatMap((t, i) => {
    const first = 1_000_000 + i * 100;
    return t.comments.map((c, j) => ({
      id: first + j,
      pull_request_review_id: null,
      in_reply_to_id: j === 0 ? undefined : first,
      user: user(c.author, c.bot),
      body: c.body,
      path: t.path,
      line: t.isOutdated ? null : t.line,
      original_line: t.line,
      start_line: t.startLine,
      side: "RIGHT",
      commit_id: t.isOutdated ? c.commit : meta.head,
      original_commit_id: c.commit,
      created_at: c.createdAt,
      updated_at: c.createdAt,
      html_url: `${url}#discussion_r${first + j}`,
    }));
  });
}

function graphqlReview(r: Review) {
  return {
    id: `PRR_${r.id}`,
    author: actor(r.author, r.bot),
    state: r.state,
    submittedAt: r.submittedAt,
    body: r.body,
    commit: { oid: r.commit },
  };
}

function graphql(query: string, variables: Map<string, string>) {
  if (/\bmutation\b/.test(query)) refuse("gh", "a GraphQL mutation");
  const asked = [variables.get("owner"), variables.get("repo") ?? variables.get("name")];
  if (asked[0] !== undefined && asked.join("/") !== meta.repo) {
    const message = `Could not resolve to a Repository with the name '${asked.join("/")}'.`;
    return { data: { repository: null }, errors: [{ type: "NOT_FOUND", message }] };
  }
  const list = prCommits();
  const pull = {
    number: meta.pull.number,
    title: meta.pull.title,
    body: meta.pull.body,
    url,
    state: "OPEN",
    isDraft: false,
    createdAt: meta.pull.createdAt,
    author: actor(meta.pull.author),
    headRefName: meta.pull.headRefName,
    baseRefName: meta.pull.baseRefName,
    headRefOid: meta.head,
    baseRefOid: meta.base,
    reviewDecision: reviewDecision(),
    reviews: { totalCount: meta.reviews.length, nodes: meta.reviews.map(graphqlReview) },
    latestReviews: { totalCount: latest().length, nodes: latest().map(graphqlReview) },
    comments: { totalCount: 0, nodes: [] },
    reviewThreads: {
      totalCount: meta.threads.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: meta.threads.map((t) => ({
        id: t.id,
        isResolved: t.isResolved,
        isOutdated: t.isOutdated,
        path: t.path,
        line: t.isOutdated ? null : t.line,
        originalLine: t.line,
        startLine: t.startLine,
        diffSide: "RIGHT",
        resolvedBy: t.resolvedBy === null ? null : { login: t.resolvedBy },
        comments: {
          totalCount: t.comments.length,
          nodes: t.comments.map((c) => ({
            author: actor(c.author, c.bot),
            body: c.body,
            createdAt: c.createdAt,
            path: t.path,
            commit: { oid: t.isOutdated ? c.commit : meta.head },
            originalCommit: { oid: c.commit },
          })),
        },
      })),
    },
    commits: {
      totalCount: list.length,
      nodes: list.map((c) => ({
        commit: {
          oid: c.sha,
          messageHeadline: c.message.split("\n")[0],
          committedDate: c.date,
          authoredDate: c.date,
        },
      })),
    },
  };
  return { data: { viewer: { login: meta.viewer }, repository: { pullRequest: pull } } };
}

function api(args: Args): Out {
  const fieldMap = fields(args, true);
  const raw = (args.positional[0] ?? "").replace(/^\//, "");
  if (raw === "graphql") return { json: graphql(fieldMap.get("query") ?? "", fieldMap) };

  const method = (
    flag(args, "-X", "--method") ?? (fieldMap.size > 0 || has(args, "--input") ? "POST" : "GET")
  ).toUpperCase();
  if (method !== "GET") refuse("gh", `${method} ${raw}`);
  const accept = (args.flags.get("-H") ?? args.flags.get("--header") ?? []).join(" ").toLowerCase();
  const wantsDiff = accept.includes("diff");
  const endpoint = raw.replaceAll("{owner}", owner).replaceAll("{repo}", name).split("?")[0] ?? "";
  const query = new URLSearchParams(raw.split("?")[1] ?? "");
  for (const [k, v] of fieldMap) query.set(k, v);

  if (endpoint === "user") return { json: { login: meta.viewer, type: "User" } };
  const prefix = `repos/${meta.repo}`;
  if (!endpoint.startsWith(prefix)) fail(`gh: Not Found (HTTP 404)`);
  const rest = endpoint.slice(prefix.length).replace(/^\//, "");
  const pullPath = `pulls/${meta.pull.number}`;

  if (rest === "")
    return {
      json: {
        full_name: meta.repo,
        name,
        owner: { login: owner },
        default_branch: meta.pull.baseRefName,
        private: false,
      },
    };
  if (rest === "pulls") return { json: [restPull()] };
  if (rest === pullPath) {
    if (wantsDiff) return git(root, "diff", meta.base, meta.head);
    return { json: restPull() };
  }
  if (rest === `${pullPath}/reviews`) return { json: restReviews() };
  if (rest === `${pullPath}/comments`) return { json: restComments() };
  if (rest === `${pullPath}/commits`) return { json: prCommits().map(restCommit) };
  if (rest === `${pullPath}/files`) return { json: prFiles() };
  if (rest === `${pullPath}/requested_reviewers`) return { json: { users: [], teams: [] } };
  if (rest === `issues/${meta.pull.number}/comments`) return { json: [] };

  const compare = /^compare\/(.+?)\.{2,3}(.+)$/.exec(rest);
  if (compare) {
    const from = resolve(decodeURIComponent(compare[1] ?? ""));
    const to = resolve(decodeURIComponent(compare[2] ?? ""));
    if (wantsDiff) return git(root, "diff", from, to);
    const list = prCommits(from, to);
    return {
      json: {
        status: "ahead",
        ahead_by: list.length,
        behind_by: 0,
        total_commits: list.length,
        commits: list.map(restCommit),
        files: prFiles(from, to),
      },
    };
  }
  const commit = /^commits\/([^/]+)(\/pulls)?$/.exec(rest);
  if (commit) {
    if (commit[2] !== undefined) return { json: [restPull()] };
    const sha = resolve(commit[1] ?? "");
    if (wantsDiff) return git(root, "show", "--format=", sha);
    const [c] = prCommits(`${sha}~1`, sha);
    if (c === undefined) return fail("gh: Not Found (HTTP 404)");
    return { json: { ...restCommit(c), files: prFiles(`${sha}~1`, sha) } };
  }
  const contents = /^contents\/(.+)$/.exec(rest);
  if (contents) {
    const ref = resolve(query.get("ref") ?? meta.pull.baseRefName);
    const path = contents[1] ?? "";
    const text = git(root, "show", `${ref}:${path}`);
    if (accept.includes("raw")) return text;
    return {
      json: {
        path,
        type: "file",
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
      },
    };
  }
  return fail(`gh: Not Found (HTTP 404)`);
}

function matches(target: string | undefined): boolean {
  if (target === undefined) return true;
  const n = String(meta.pull.number);
  return (
    target === n ||
    target === `#${n}` ||
    target === meta.pull.headRefName ||
    target.replace(/\/(files|commits|changes).*$/, "").replace(/\/$/, "") === url
  );
}

function review(r: Review) {
  return {
    author: { login: r.author, is_bot: r.bot },
    state: r.state,
    submittedAt: r.submittedAt,
    body: r.body,
    commit: { oid: r.commit },
  };
}

function prJson(): Record<string, unknown> {
  const files = prFiles();
  return {
    number: meta.pull.number,
    title: meta.pull.title,
    body: meta.pull.body,
    state: "OPEN",
    url,
    author: { login: meta.pull.author, is_bot: false },
    headRefName: meta.pull.headRefName,
    baseRefName: meta.pull.baseRefName,
    headRefOid: meta.head,
    baseRefOid: meta.base,
    isDraft: false,
    createdAt: meta.pull.createdAt,
    reviewDecision: reviewDecision(),
    mergeable: "MERGEABLE",
    commits: prCommits().map((c) => ({
      oid: c.sha,
      messageHeadline: c.message.split("\n")[0],
      messageBody: c.message.split("\n").slice(1).join("\n").trim(),
      authoredDate: c.date,
      committedDate: c.date,
      authors: [{ name: c.author, email: c.email }],
    })),
    reviews: meta.reviews.map(review),
    latestReviews: latest().map(review),
    files: files.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changedFiles: files.length,
    comments: [],
    reviewRequests: [],
  };
}

function pick(json: string): Record<string, unknown> {
  const full = prJson();
  return Object.fromEntries(json.split(",").map((k) => [k.trim(), full[k.trim()] ?? null]));
}

function checks(): string {
  if (meta.checks === undefined) return "no checks reported on the branch\n";
  return meta.checks.map((c) => `${c.name}\t${c.state}\t${c.elapsed}\t${c.link}\n`).join("");
}

function pr(sub: string, args: Args): Out {
  const repo = flag(args, "-R", "--repo");
  if (repo !== undefined && repo.replace(/^https:\/\/github\.com\//, "") !== meta.repo)
    fail(`GraphQL: Could not resolve to a Repository with the name '${repo}'. (repository)`);
  const json = flag(args, "--json");
  if (sub === "list" || sub === "status") {
    if (json !== undefined) return { json: [pick(json)] };
    return `${meta.pull.number}\t${meta.pull.title}\t${meta.pull.headRefName}\tOPEN\n`;
  }
  if (!matches(args.positional[0])) fail(`no pull requests found for ${args.positional[0]}`);
  if (sub === "view") {
    if (json !== undefined) return { json: pick(json) };
    return `title:\t${meta.pull.title}\nstate:\tOPEN\nauthor:\t${meta.pull.author}\nnumber:\t${meta.pull.number}\nurl:\t${url}\n--\n${meta.pull.body}\n`;
  }
  if (sub === "diff") {
    if (has(args, "--name-only")) return git(root, "diff", "--name-only", meta.base, meta.head);
    if (has(args, "--patch"))
      return git(root, "format-patch", "--stdout", `${meta.base}..${meta.head}`);
    return git(root, "diff", meta.base, meta.head);
  }
  if (sub === "checks") return checks();
  if (sub === "checkout")
    return fail("error connecting to github.com: the network is unavailable in this environment");
  return refuse("gh", `gh pr ${sub}`);
}

type Out = string | { json: unknown };

function main([cmd = "", sub = "", ...rest]: string[]): Out {
  if (cmd === "--version" || cmd === "version") return "gh version 2.80.0 (snapshot)\n";
  if (cmd === "auth" && sub === "status")
    return `github.com\n  ✓ Logged in to github.com account ${meta.viewer} (keyring)\n`;
  if (cmd === "api") return api(parseArgs([sub, ...rest], BOOLEANS));
  if (cmd === "pr") return pr(sub, parseArgs(rest, BOOLEANS));
  if (cmd === "repo" && sub === "view")
    return {
      json: {
        nameWithOwner: meta.repo,
        name,
        owner: { login: owner },
        defaultBranchRef: { name: meta.pull.baseRefName },
        url: `https://github.com/${meta.repo}`,
      },
    };
  return refuse("gh", `gh ${cmd} ${sub}`.trim());
}

const out = main(argv);
if (typeof out === "string") process.stdout.write(out);
else emit(out.json, flag(parseArgs(argv, BOOLEANS), "--jq", "-q"));
