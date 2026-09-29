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

const Meta = z.object({
  host: z.string(),
  project: z.string(),
  projectId: z.number(),
  viewer: z.object({ id: z.number(), username: z.string(), name: z.string() }),
  mr: z.object({
    iid: z.number(),
    title: z.string(),
    description: z.string(),
    author: z.object({ username: z.string(), name: z.string() }),
    source_branch: z.string(),
    target_branch: z.string().default("main"),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  versions: z.array(
    z.object({
      id: z.number(),
      head: z.string(),
      base: z.string(),
      start: z.string(),
      created_at: z.string(),
    }),
  ),
  discussions: z.array(z.looseObject({ id: z.string(), notes: z.array(z.looseObject({})) })),
});

const meta = await load(Meta);
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

function mr() {
  return {
    id: meta.projectId * 1000 + meta.mr.iid,
    iid: meta.mr.iid,
    project_id: meta.projectId,
    title: meta.mr.title,
    description: meta.mr.description,
    state: "opened",
    draft: false,
    author: { id: 42, ...meta.mr.author },
    source_branch: meta.mr.source_branch,
    target_branch: meta.mr.target_branch,
    sha: latest.head,
    diff_refs: { base_sha: latest.base, head_sha: latest.head, start_sha: latest.start },
    web_url: webUrl,
    created_at: meta.mr.created_at,
    updated_at: meta.mr.updated_at,
    merge_status: "can_be_merged",
    detailed_merge_status: "mergeable",
    user_notes_count: meta.discussions.reduce((n, d) => n + d.notes.length, 0),
    references: { full: `${meta.project}!${meta.mr.iid}` },
  };
}

function version(v: z.output<typeof Meta>["versions"][number]) {
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

function fields(args: Args): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of ["-f", "-F", "--field", "--raw-field"]) {
    for (const kv of args.flags.get(f) ?? []) {
      const eq = kv.indexOf("=");
      out.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
  }
  return out;
}

function isProject(segment: string): boolean {
  const decoded = decodeURIComponent(segment);
  return segment.startsWith(":") || decoded === meta.project || decoded === String(meta.projectId);
}

type Out = string | { json: unknown };

function api(argv: string[]): Out {
  const args = parseArgs(argv, BOOLEANS);
  const fieldMap = fields(args);
  const raw = (args.positional[0] ?? "").replace(/^\/?(api\/v4\/)?/, "");
  if (raw === "graphql") {
    const q = fieldMap.get("query") ?? "";
    if (/\bmutation\b/.test(q)) refuse("glab", "a GraphQL mutation");
    if (/\bcurrentUser\b/.test(q) && !/\b(project|mergeRequest)\b/.test(q))
      return {
        json: {
          data: {
            currentUser: { ...meta.viewer, id: `gid://gitlab/User/${meta.viewer.id}` },
          },
        },
      };
    return fail("glab: GraphQL is unavailable in this snapshot. Use the REST endpoints.");
  }
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
  if (rest === `${mrPath}/discussions`) return { json: meta.discussions };
  const d = new RegExp(`^${mrPath}/discussions/([^/]+)$`).exec(rest);
  if (d)
    return { json: meta.discussions.find((x) => x.id === d[1]) ?? fail("glab: 404 Not Found") };
  if (rest === `${mrPath}/notes`)
    return { json: meta.discussions.flatMap((x) => x.notes).toReversed() };
  if (rest === `${mrPath}/changes`)
    return { json: { ...mr(), changes: diffs(latest.base, latest.head) } };
  if (rest === `${mrPath}/diffs`) return { json: diffs(latest.base, latest.head) };
  if (rest === `${mrPath}/commits`) return { json: glCommits(latest.base, latest.head) };
  if (rest === `${mrPath}/approvals` || rest === `${mrPath}/approval_state`)
    return { json: { approved: false, approvals_required: 1, approved_by: [] } };
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

function notesText(): string {
  return meta.discussions
    .flatMap((x) => x.notes)
    .map((note) => JSON.stringify(note))
    .join("\n");
}

function mrCommand(sub: string, argv: string[]): Out {
  const args = parseArgs(argv, BOOLEANS);
  if (sub === "list")
    return `!${meta.mr.iid}\t${meta.project}!${meta.mr.iid}\t${meta.mr.title}\t(${meta.mr.target_branch}) ← (${meta.mr.source_branch})\n`;
  if (!matches(args.positional[0])) fail(`glab: no merge request found for ${args.positional[0]}`);
  if (sub === "view") {
    if ((flag(args, "--output", "-F") ?? "") === "json") return { json: mr() };
    const base = `title:\t${meta.mr.title}\nstate:\topen\nauthor:\t${meta.mr.author.username}\nurl:\t${webUrl}\n--\n${meta.mr.description}\n`;
    return has(args, "--comments", "-c") ? `${base}\n${notesText()}\n` : base;
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
  if (cmd === "api") return api([sub, ...rest]);
  if (cmd === "mr") return mrCommand(sub, rest);
  if (cmd === "repo" && sub === "view")
    return api([`projects/${encodeURIComponent(meta.project)}`]);
  return refuse("glab", `glab ${cmd} ${sub}`.trim());
}

const argv = process.argv.slice(2);
const out = main(argv);
if (typeof out === "string") process.stdout.write(out);
else emit(out.json, flag(parseArgs(argv, BOOLEANS), "--jq"));
