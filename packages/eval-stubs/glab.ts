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

interface User {
  id: number;
  username: string;
  name: string;
}

interface Version {
  id: number;
  head: string;
  base: string;
  start: string;
  created_at: string;
}

/** A note as written, with the fields the text views and merge state read. */
interface Note {
  raw: Record<string, unknown>;
  author: Record<string, unknown> | undefined;
  username: string;
  body: string;
  created_at: string;
  system: boolean;
  open: boolean;
}

interface Discussion {
  raw: Record<string, unknown>;
  id: string;
  notes: Note[];
}

interface Reviewer {
  raw: Record<string, unknown>;
  username: string;
}

/** A merge request snapshot: the fixture's `meta.json`, with the SHAs its scaffold committed. */
export interface Meta {
  root: string;
  host: string;
  project: string;
  projectId: number;
  viewer: User;
  mr: {
    iid: number;
    title: string;
    description: string;
    author: User;
    reviewers: Reviewer[];
    source_branch: string;
    target_branch: string;
    created_at: string;
    updated_at: string;
  };
  versions: Version[];
  /** The discussions API response, served as written. */
  discussions: Discussion[];
}

function decodeUser(u: Fields, id?: number): User {
  return { id: u.number("id", id), username: u.string("username"), name: u.string("name") };
}

function decodeNote(n: Fields): Note {
  const author = n.has("author") ? n.object("author") : undefined;
  return {
    raw: n.raw,
    author: author?.raw,
    username: author?.string("username", "") ?? "",
    body: n.string("body", ""),
    created_at: n.string("created_at", ""),
    system: n.boolean("system", false),
    open: n.boolean("resolvable", false) && !n.boolean("resolved", false),
  };
}

function decode(m: Fields): Meta {
  const req = m.object("mr");
  return {
    root: m.string("root"),
    host: m.string("host"),
    project: m.string("project"),
    projectId: m.number("projectId"),
    viewer: decodeUser(m.object("viewer")),
    mr: {
      iid: req.number("iid"),
      title: req.string("title"),
      description: req.string("description"),
      author: decodeUser(req.object("author"), 42),
      reviewers: req
        .list("reviewers", [])
        .map((r) => ({ raw: r.raw, username: r.string("username") })),
      source_branch: req.string("source_branch"),
      target_branch: req.string("target_branch", "main"),
      created_at: req.string("created_at"),
      updated_at: req.string("updated_at"),
    },
    versions: m.list("versions").map((v) => ({
      id: v.number("id"),
      head: v.string("head"),
      base: v.string("base"),
      start: v.string("start"),
      created_at: v.string("created_at"),
    })),
    discussions: m.list("discussions").map((d) => ({
      raw: d.raw,
      id: d.string("id"),
      notes: d.list("notes").map(decodeNote),
    })),
  };
}

const argv = process.argv.slice(2);
const snapshot = await readSnapshot();
const meta = decode(snapshot ?? (await echo("glab", argv)));
const { root } = meta;
const latest = meta.versions.at(-1) ?? fail("snapshot: no MR versions");
const webUrl = `https://${meta.host}/${meta.project}/-/merge_requests/${meta.mr.iid}`;

const BOOLEANS = new Set([
  "--paginate",
  "-i",
  "--include",
  "--silent",
  "--raw",
  "--comments",
  "-c",
  "--web",
  "-w",
  "--system-logs",
]);

function diffs(from: string, to: string) {
  return fileDiffs(root, from, to).map((f) => ({
    old_path: f.oldPath,
    new_path: f.newPath,
    a_mode: "100644",
    b_mode: "100644",
    new_file: f.status === "added",
    renamed_file: f.status === "renamed",
    deleted_file: f.status === "removed",
    diff: f.patch,
  }));
}

function glCommits(from: string, to: string) {
  return commits(root, from, to)
    .toReversed()
    .map((c) => ({
      id: c.sha,
      short_id: c.sha.slice(0, 8),
      title: c.message.split("\n")[0],
      message: c.message,
      author_name: c.author,
      author_email: c.email,
      authored_date: c.date,
      created_at: c.date,
      web_url: `https://${meta.host}/${meta.project}/-/commit/${c.sha}`,
    }));
}

const notes = () => meta.discussions.flatMap((d) => d.notes);
const unresolved = () => notes().some((n) => n.open);

/** The author, the viewer, the reviewers, and everyone who wrote a note. */
function participants(): object[] {
  const all: [string, object | undefined][] = [
    [meta.mr.author.username, meta.mr.author],
    [meta.viewer.username, meta.viewer],
    ...meta.mr.reviewers.map((r): [string, object] => [r.username, r.raw]),
    ...notes().map((n): [string, object | undefined] => [n.username, n.author]),
  ];
  const byName = new Map<string, object>();
  for (const [username, u] of all) {
    if (u !== undefined && username !== "" && !byName.has(username)) byName.set(username, u);
  }
  return [...byName.values()];
}

function mr() {
  return {
    id: meta.projectId * 1000 + meta.mr.iid,
    iid: meta.mr.iid,
    project_id: meta.projectId,
    title: meta.mr.title,
    description: meta.mr.description,
    state: "opened",
    draft: false,
    author: meta.mr.author,
    reviewers: meta.mr.reviewers.map((r) => r.raw),
    source_branch: meta.mr.source_branch,
    target_branch: meta.mr.target_branch,
    sha: latest.head,
    diff_refs: { base_sha: latest.base, head_sha: latest.head, start_sha: latest.start },
    web_url: webUrl,
    created_at: meta.mr.created_at,
    updated_at: meta.mr.updated_at,
    merge_status: "can_be_merged",
    detailed_merge_status: unresolved() ? "discussions_not_resolved" : "mergeable",
    blocking_discussions_resolved: !unresolved(),
    user_notes_count: notes().filter((n) => !n.system).length,
    references: { short: `!${meta.mr.iid}`, full: `${meta.project}!${meta.mr.iid}` },
  };
}

function version(v: Version) {
  return {
    id: v.id,
    head_commit_sha: v.head,
    base_commit_sha: v.base,
    start_commit_sha: v.start,
    created_at: v.created_at,
    merge_request_id: mr().id,
    state: "collected",
    real_size: String(diffs(v.base, v.head).length),
  };
}

function resolve(ref: string): string {
  if (ref === meta.mr.source_branch) return latest.head;
  if (ref === meta.mr.target_branch) return latest.base;
  return git(root, "rev-parse", "--verify", `${ref}^{commit}`).trim();
}

function isProject(segment: string): boolean {
  const decoded = decodeURIComponent(segment);
  return segment.startsWith(":") || decoded === meta.project || decoded === String(meta.projectId);
}

type Out = string | { json: unknown };

function graphql(q: string): Out {
  if (/\bmutation\b/.test(q)) refuse("glab", "a GraphQL mutation");
  if (/\bcurrentUser\b/.test(q) && !/\b(project|mergeRequest)\b/.test(q))
    return {
      json: {
        data: { currentUser: { ...meta.viewer, id: `gid://gitlab/User/${meta.viewer.id}` } },
      },
    };
  return fail("glab: GraphQL is unavailable in this snapshot. Use the REST endpoints.");
}

function api(args: Args): Out {
  const fieldMap = fields(args);
  const raw = (args.positional[0] ?? "").replace(/^\/?(api\/v4\/)?/, "");
  if (raw === "graphql") return graphql(fieldMap.get("query") ?? "");
  const method = (
    flag(args, "-X", "--method") ?? (fieldMap.size > 0 || has(args, "--input") ? "POST" : "GET")
  ).toUpperCase();
  if (method !== "GET") refuse("glab", `${method} ${raw}`);
  const [path = "", search = ""] = raw.split("?");
  const query = new URLSearchParams(search);
  for (const [k, v] of fieldMap) query.set(k, v);
  if (Number(query.get("page") ?? "1") > 1) return { json: [] };

  if (path === "user")
    return {
      json: {
        ...meta.viewer,
        state: "active",
        web_url: `https://${meta.host}/${meta.viewer.username}`,
      },
    };
  const parts = path.split("/");
  if (parts[0] !== "projects" || !isProject(parts[1] ?? "")) return fail("glab: 404 Not Found");
  const rest = parts.slice(2).join("/");
  const mrPath = `merge_requests/${meta.mr.iid}`;

  if (rest === "")
    return {
      json: {
        id: meta.projectId,
        path_with_namespace: meta.project,
        default_branch: meta.mr.target_branch,
        web_url: `https://${meta.host}/${meta.project}`,
      },
    };
  if (rest === "merge_requests") return { json: [mr()] };
  if (rest === "members/all") return { json: participants() };
  if (rest === mrPath) return { json: mr() };
  if (rest === `${mrPath}/versions`) return { json: meta.versions.map(version).toReversed() };
  const v = new RegExp(`^${mrPath}/versions/(\\d+)$`).exec(rest);
  if (v) {
    const found = meta.versions.find((x) => x.id === Number(v[1]));
    if (found === undefined) return fail("glab: 404 Not Found");
    return {
      json: {
        ...version(found),
        commits: glCommits(found.base, found.head),
        diffs: diffs(found.base, found.head),
      },
    };
  }
  if (rest === `${mrPath}/discussions`) return { json: meta.discussions.map((x) => x.raw) };
  const d = new RegExp(`^${mrPath}/discussions/([^/]+)$`).exec(rest);
  if (d)
    return {
      json: meta.discussions.find((x) => x.id === d[1])?.raw ?? fail("glab: 404 Not Found"),
    };
  if (rest === `${mrPath}/notes`)
    return {
      json: notes()
        .map((n) => n.raw)
        .toReversed(),
    };
  if (rest === `${mrPath}/participants`) return { json: participants() };
  if (rest === `${mrPath}/changes`)
    return { json: { ...mr(), changes: diffs(latest.base, latest.head) } };
  if (rest === `${mrPath}/diffs`) return { json: diffs(latest.base, latest.head) };
  if (rest === `${mrPath}/commits`) return { json: glCommits(latest.base, latest.head) };
  if (rest === `${mrPath}/approvals` || rest === `${mrPath}/approval_state`)
    return { json: { approved: false, approvals_required: 1, approvals_left: 1, approved_by: [] } };
  if (rest === `${mrPath}/draft_notes`) return { json: [] };
  if (rest === "repository/compare") {
    const from = resolve(query.get("from") ?? "");
    const to = resolve(query.get("to") ?? "");
    const list = glCommits(from, to);
    return {
      json: {
        commit: list[0] ?? null,
        commits: list,
        diffs: diffs(from, to),
        compare_same_ref: from === to,
      },
    };
  }
  const c = /^repository\/commits\/([^/]+)(\/diff)?$/.exec(rest);
  if (c) {
    const sha = resolve(c[1] ?? "");
    if (c[2] !== undefined) return { json: diffs(`${sha}~1`, sha) };
    return { json: glCommits(`${sha}~1`, sha)[0] ?? fail("glab: 404 Not Found") };
  }
  const file = /^repository\/files\/(.+?)(\/raw)?$/.exec(rest);
  if (file) {
    const text = git(
      root,
      "show",
      `${resolve(query.get("ref") ?? meta.mr.target_branch)}:${decodeURIComponent(file[1] ?? "")}`,
    );
    if (file[2] !== undefined) return text;
    return {
      json: {
        file_path: decodeURIComponent(file[1] ?? ""),
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
      },
    };
  }
  return fail("glab: 404 Not Found");
}

function matches(target: string | undefined): boolean {
  if (target === undefined) return true;
  const n = String(meta.mr.iid);
  return (
    target === n ||
    target === `!${n}` ||
    target === meta.mr.source_branch ||
    target.replace(/\/(diffs|commits)?\/?$/, "") === webUrl
  );
}

const noteText = (n: Note) => `${n.username} commented ${n.created_at}\n${n.body}\n`;

/** `glab mr view` text, with every note oldest first under `--comments`. */
function viewText(comments: boolean): string {
  const m = mr();
  const head = [
    `title:\t${m.title}`,
    "state:\topen",
    `author:\t${m.author.username}`,
    "labels:\t",
    `assignees:\t${m.author.username}`,
    `reviewers:\t${meta.mr.reviewers.map((r) => r.username).join(", ")}`,
    `comments:\t${m.user_notes_count}`,
    `number:\t${m.iid}`,
    `url:\t${webUrl}`,
    "--",
    `${m.description}\n`,
  ].join("\n");
  return comments ? `${head}\n${notes().map(noteText).join("\n")}` : head;
}

function noteList(): string {
  return notes()
    .toReversed()
    .map((n) => `${noteText(n)}\n`)
    .join("");
}

function mrCommand(sub: string, args: Args): Out {
  const json = (flag(args, "--output", "-F") ?? "") === "json";
  if (sub === "list") {
    if (json) return { json: [mr()] };
    return `!${meta.mr.iid}\t${meta.project}!${meta.mr.iid}\t${meta.mr.title}\t(${meta.mr.target_branch}) ← (${meta.mr.source_branch})\n`;
  }
  if (sub === "note" && args.positional[0] === "list") {
    if (!matches(args.positional[1]))
      fail(`glab: no merge request found for ${args.positional[1]}`);
    return noteList();
  }
  if (!matches(args.positional[0])) fail(`glab: no merge request found for ${args.positional[0]}`);
  if (sub === "view") {
    if (json) return { json: mr() };
    return viewText(has(args, "--comments", "-c"));
  }
  if (sub === "diff") return git(root, "diff", latest.base, latest.head);
  if (sub === "checkout")
    return fail(
      `glab: could not reach ${meta.host}: the network is unavailable in this environment`,
    );
  return refuse("glab", `glab mr ${sub}`);
}

function main([cmd = "", sub = "", ...rest]: string[]): Out {
  if (cmd === "--version" || cmd === "version") return "glab 1.102.2 (snapshot)\n";
  if (cmd === "auth" && sub === "status")
    return `${meta.host}\n  ✓ Logged in to ${meta.host} as ${meta.viewer.username}\n`;
  if (cmd === "api") return api(parseArgs([sub, ...rest], BOOLEANS));
  if (cmd === "mr") return mrCommand(sub, parseArgs(rest, BOOLEANS));
  if (cmd === "repo" && sub === "view")
    return api(parseArgs([`projects/${encodeURIComponent(meta.project)}`], BOOLEANS));
  return refuse("glab", `glab ${cmd} ${sub}`.trim());
}

const out = main(argv);
if (typeof out === "string") process.stdout.write(out);
else emit(out.json, flag(parseArgs(argv, BOOLEANS), "--jq"));
