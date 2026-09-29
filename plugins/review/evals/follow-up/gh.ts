import { spawnSync } from "node:child_process";
import { z } from "zod";
import {
  type Args,
  commits,
  emit,
  fail,
  fileDiffs,
  flag,
  git,
  has,
  load,
  parseArgs,
  refuse,
} from "./snapshot";

const Comment = z.object({
  author: z.string(),
  bot: z.boolean().default(false),
  body: z.string(),
  createdAt: z.string(),
  commit: z.string(),
});

const Meta = z.object({
  repo: z.string(),
  viewer: z.string(),
  base: z.string(),
  head: z.string(),
  pull: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string(),
    author: z.string(),
    headRefName: z.string(),
    baseRefName: z.string().default("main"),
    createdAt: z.string(),
  }),
  reviews: z.array(
    z.object({
      id: z.number(),
      author: z.string(),
      state: z.string(),
      submittedAt: z.string(),
      commit: z.string(),
      body: z.string().default(""),
    }),
  ),
  threads: z.array(
    z.object({
      id: z.string(),
      isResolved: z.boolean(),
      isOutdated: z.boolean().default(false),
      path: z.string(),
      line: z.number().nullable(),
      startLine: z.number().nullable().default(null),
      comments: z.array(Comment),
    }),
  ),
});

const meta = await load(Meta);
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
    user: user(r.author),
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

function graphql(query: string) {
  if (/\bmutation\b/.test(query)) refuse("gh", "a GraphQL mutation");
  const pull = {
    number: meta.pull.number,
    title: meta.pull.title,
    body: meta.pull.body,
    url,
    state: "OPEN",
    author: actor(meta.pull.author),
    headRefName: meta.pull.headRefName,
    baseRefName: meta.pull.baseRefName,
    headRefOid: meta.head,
    baseRefOid: meta.base,
    reviews: {
      totalCount: meta.reviews.length,
      nodes: meta.reviews.map((r) => ({
        id: `PRR_${r.id}`,
        author: actor(r.author),
        state: r.state,
        submittedAt: r.submittedAt,
        body: r.body,
        commit: { oid: r.commit },
      })),
    },
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
      totalCount: prCommits().length,
      nodes: prCommits().map((c) => ({
        commit: { oid: c.sha, messageHeadline: c.message.split("\n")[0], committedDate: c.date },
      })),
    },
  };
  return { data: { viewer: { login: meta.viewer }, repository: { pullRequest: pull } } };
}

function fields(args: Args): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of ["-f", "-F", "--field", "--raw-field"]) {
    for (const kv of args.flags.get(f) ?? []) {
      const eq = kv.indexOf("=");
      let value = kv.slice(eq + 1);
      if (value.startsWith("@")) {
        const read = spawnSync("cat", [value.slice(1)], { encoding: "utf8" });
        if (read.status !== 0) fail(`gh: open ${value.slice(1)}: no such file or directory`);
        value = read.stdout;
      }
      out.set(kv.slice(0, eq), value);
    }
  }
  return out;
}

function api(argv: string[]): Out {
  const args = parseArgs(argv, BOOLEANS);
  const fieldMap = fields(args);
  const raw = (args.positional[0] ?? "").replace(/^\//, "");
  if (raw === "graphql") return { json: graphql(fieldMap.get("query") ?? "") };

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

function prJson() {
  const files = prFiles();
  const reviews = meta.reviews.map((r) => ({
    author: { login: r.author },
    state: r.state,
    submittedAt: r.submittedAt,
    body: r.body,
    commit: { oid: r.commit },
  }));
  return {
    number: meta.pull.number,
    title: meta.pull.title,
    body: meta.pull.body,
    state: "OPEN",
    url,
    author: { login: meta.pull.author },
    headRefName: meta.pull.headRefName,
    baseRefName: meta.pull.baseRefName,
    headRefOid: meta.head,
    baseRefOid: meta.base,
    isDraft: false,
    createdAt: meta.pull.createdAt,
    reviewDecision: "CHANGES_REQUESTED",
    mergeable: "MERGEABLE",
    commits: prCommits().map((c) => ({
      oid: c.sha,
      messageHeadline: c.message.split("\n")[0],
      messageBody: c.message.split("\n").slice(1).join("\n").trim(),
      authoredDate: c.date,
      authors: [{ name: c.author, email: c.email }],
    })),
    reviews,
    latestReviews: reviews,
    files: files.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changedFiles: files.length,
    comments: [],
    reviewRequests: [],
  };
}

function pr(sub: string, argv: string[]): Out {
  const args = parseArgs(argv, BOOLEANS);
  const repo = flag(args, "-R", "--repo");
  if (repo !== undefined && repo.replace(/^https:\/\/github\.com\//, "") !== meta.repo)
    fail(`GraphQL: Could not resolve to a Repository with the name '${repo}'. (repository)`);
  if (sub === "list")
    return `${meta.pull.number}\t${meta.pull.title}\t${meta.pull.headRefName}\tOPEN\n`;
  if (!matches(args.positional[0])) fail(`no pull requests found for ${args.positional[0]}`);
  if (sub === "view") {
    const json = flag(args, "--json");
    const full = prJson();
    if (json === undefined)
      return `title:\t${full.title}\nstate:\tOPEN\nauthor:\t${meta.pull.author}\nnumber:\t${meta.pull.number}\nurl:\t${url}\n--\n${full.body}\n`;
    const picked = Object.fromEntries(
      json.split(",").map((k) => [k, (full as Record<string, unknown>)[k] ?? null]),
    );
    return { json: picked };
  }
  if (sub === "diff") {
    if (has(args, "--name-only")) return git(root, "diff", "--name-only", meta.base, meta.head);
    if (has(args, "--patch"))
      return git(root, "format-patch", "--stdout", `${meta.base}..${meta.head}`);
    return git(root, "diff", meta.base, meta.head);
  }
  if (sub === "checks") return "no checks reported on the branch\n";
  if (sub === "checkout")
    return fail("error connecting to github.com: the network is unavailable in this environment");
  return refuse("gh", `gh pr ${sub}`);
}

type Out = string | { json: unknown };

function main([cmd = "", sub = "", ...rest]: string[]): Out {
  if (cmd === "--version" || cmd === "version") return "gh version 2.80.0 (snapshot)\n";
  if (cmd === "auth" && sub === "status")
    return `github.com\n  ✓ Logged in to github.com account ${meta.viewer} (keyring)\n`;
  if (cmd === "api") return api([sub, ...rest]);
  if (cmd === "pr") return pr(sub, rest);
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

const argv = process.argv.slice(2);
const out = main(argv);
if (typeof out === "string") process.stdout.write(out);
else emit(out.json, flag(parseArgs(argv, BOOLEANS), "--jq", "-q"));
