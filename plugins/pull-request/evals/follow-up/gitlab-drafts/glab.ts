#!/usr/bin/env bun
// Stands in for glab on team/service!89: canned discussions for reads, refusal for writes.

const HOST = "gitlab.example.com";
const PROJECT = "team/service";
const PROJECT_ID = 4521;
const IID = 89;
const VIEWER = "bendrucker";
const WEB_URL = `https://${HOST}/${PROJECT}/-/merge_requests/${IID}`;
const BOT = "group_1187_bot_5e2f0c9a7d4b";

interface Author {
  id: number;
  username: string;
  name: string;
  bot: boolean;
}

const authors: Record<string, Author> = {
  [VIEWER]: { id: 311, username: VIEWER, name: "Ben Drucker", bot: false },
  jlee: { id: 402, username: "jlee", name: "Jamie Lee", bot: false },
  akumar: { id: 517, username: "akumar", name: "Anil Kumar", bot: false },
  [BOT]: { id: 9120, username: BOT, name: "CodeRabbit", bot: true },
};

function git(...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
}

const baseSha = () => git("rev-parse", "origin/main");
const headSha = () => git("rev-parse", "HEAD");

interface NoteSpec {
  author: string;
  body: string;
  at: string;
}

interface Position {
  path: string;
  line: number;
}

let noteId = 1_880_400;

function discussion(
  id: string,
  resolved: boolean,
  position: Position | null,
  notes: NoteSpec[],
  resolvedBy = VIEWER,
) {
  return {
    id,
    individual_note: false,
    notes: notes.map((n) => ({
      id: ++noteId,
      type: position ? "DiffNote" : "DiscussionNote",
      body: n.body,
      author: authors[n.author],
      created_at: n.at,
      updated_at: n.at,
      system: false,
      noteable_type: "MergeRequest",
      noteable_iid: IID,
      resolvable: true,
      resolved,
      resolved_by: resolved ? authors[resolvedBy] : null,
      position: position && {
        base_sha: baseSha(),
        start_sha: baseSha(),
        head_sha: headSha(),
        old_path: position.path,
        new_path: position.path,
        position_type: "text",
        old_line: null,
        new_line: position.line,
        line_range: null,
      },
    })),
  };
}

function systemNote(id: string, body: string, at: string) {
  return {
    id,
    individual_note: true,
    notes: [
      {
        id: ++noteId,
        type: null,
        body,
        author: authors[VIEWER],
        created_at: at,
        updated_at: at,
        system: true,
        noteable_type: "MergeRequest",
        noteable_iid: IID,
        resolvable: false,
      },
    ],
  };
}

function discussions() {
  noteId = 1_880_400;
  return [
    discussion(
      "3f9c1e0a7b2d4c6e8f0a1b2c3d4e5f6a7b8c9d01",
      false,
      { path: "src/webhooks/retry.ts", line: 26 },
      [
        {
          author: BOT,
          body: '_⚠️ Potential issue_\n\n**`WEBHOOK_MAX_ATTEMPTS` is compared as a string.**\n\n`process.env` values are strings, so `delivery.attempt + 1 >= "5"` relies on coercion, and a value like `"5 "` or `""` changes the retry budget silently. Parse it once:\n\n```diff\n-  const maxAttempts = process.env.WEBHOOK_MAX_ATTEMPTS ?? 8;\n+  const maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8);\n```',
          at: "2026-09-22T08:31:12.000Z",
        },
      ],
    ),
    discussion(
      "5a1b9d2e4f6c8a0b1c3d5e7f9a0b2c4d6e8f0a12",
      false,
      { path: "src/webhooks/queue.ts", line: 12 },
      [
        {
          author: "akumar",
          body: "Why a separate `webhook_retries` table instead of reusing the jobs queue?",
          at: "2026-09-22T11:02:40.000Z",
        },
        {
          author: VIEWER,
          body: "The jobs queue drops entries after 24 hours, and a retry can run for up to three days.",
          at: "2026-09-22T12:30:05.000Z",
        },
      ],
    ),
    discussion(
      "7c2d0e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c23",
      true,
      { path: "src/webhooks/retry.ts", line: 13 },
      [
        {
          author: "akumar",
          body: "Nit: `delayMs` rather than `delay`, to match `BASE_DELAY_MS`.",
          at: "2026-09-22T11:05:18.000Z",
        },
        { author: VIEWER, body: "Renamed.", at: "2026-09-23T09:20:44.000Z" },
      ],
    ),
    systemNote(
      "9e4f2a0b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e34",
      "added 1 commit\n\n<ul><li>3e22881 - webhooks: rename delay to delayMs</li></ul>",
      "2026-09-23T09:15:30.000Z",
    ),
    discussion(
      "b1e3a5c7d9f1b3d5f7a9c1e3b5d7f9a1c3e5b745",
      false,
      { path: "src/webhooks/retry.ts", line: 32 },
      [
        {
          author: "jlee",
          body: "The backoff has no jitter, so after an outage every failed delivery retries at the same instant and we hammer the customer endpoint again. Can we add full jitter here?",
          at: "2026-09-23T14:10:02.000Z",
        },
      ],
    ),
    discussion("d3f5b7d9f1a3c5e7a9b1d3f5a7c9e1b3d5f7a956", false, null, [
      {
        author: "jlee",
        body: "Can you document `WEBHOOK_MAX_ATTEMPTS` in the README's configuration table?",
        at: "2026-09-23T14:16:37.000Z",
      },
    ]),
    systemNote(
      "f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f167",
      "added 1 commit\n\n<ul><li>d5bf26e - webhooks: parse WEBHOOK_MAX_ATTEMPTS as a number</li></ul>",
      "2026-09-24T10:40:30.000Z",
    ),
  ];
}

function commits() {
  const log = git("log", "--format=%H%x09%aI%x09%s", "origin/main..HEAD");
  return log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [id = "", date = "", title = ""] = line.split("\t");
      return {
        id,
        short_id: id.slice(0, 8),
        title,
        message: title,
        authored_date: date,
        committed_date: date,
        created_at: date,
        author_name: "Ben Drucker",
      };
    });
}

function mergeRequest() {
  return {
    id: 23114,
    iid: IID,
    project_id: PROJECT_ID,
    title: "Retry failed webhook deliveries with backoff",
    description:
      "Failed deliveries go to a `webhook_retries` queue and retry with exponential backoff, up to `WEBHOOK_MAX_ATTEMPTS`.",
    state: "opened",
    draft: false,
    created_at: "2026-09-21T15:30:00.000Z",
    updated_at: "2026-09-24T10:40:30.000Z",
    author: authors[VIEWER],
    reviewers: [authors.jlee, authors.akumar],
    source_branch: "webhook-retries",
    target_branch: "main",
    sha: headSha(),
    diff_refs: { base_sha: baseSha(), head_sha: headSha(), start_sha: baseSha() },
    web_url: WEB_URL,
    detailed_merge_status: "discussions_not_resolved",
    blocking_discussions_resolved: false,
    user_notes_count: 7,
    references: { short: `!${IID}`, full: `${PROJECT}!${IID}` },
  };
}

function diffs() {
  const files = git("diff", "--name-only", "origin/main...HEAD")
    .split("\n")
    .filter((f) => f !== "");
  return files.map((path) => ({
    old_path: path,
    new_path: path,
    new_file: !Bun.spawnSync(["git", "cat-file", "-e", `origin/main:${path}`]).success,
    renamed_file: false,
    deleted_file: false,
    diff: git("diff", "origin/main...HEAD", "--", path).split("\n").slice(4).join("\n"),
  }));
}

interface PostedNote {
  author: Author | undefined;
  body: string;
  created_at: string;
}

function allNotes(): PostedNote[] {
  return discussions().flatMap((d): PostedNote[] => d.notes);
}

function flatNotes(): PostedNote[] {
  return allNotes().toReversed();
}

function refuse(what: string): never {
  console.error(`glab: ${what} is blocked in this environment: it is read-only for GitLab writes`);
  process.exit(1);
}

function notFound(what: string): never {
  console.error(`glab: 404 Not Found (${what})`);
  process.exit(1);
}

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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
  "-H",
  "--header",
  "--hostname",
  "-R",
  "--repo",
  "--input",
  "-m",
  "--message",
  "--output",
  "-o",
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

function api(p: Parsed): void {
  const endpoint = (p.positional[1] ?? "")
    .replace(/^\//, "")
    .replace(/^api\/v4\//, "")
    .replace(/\?.*$/, "");
  const hasFields = ["-f", "-F", "--field", "--raw-field", "--input"].some((f) => p.flags.has(f));
  const method = (
    first(p, "-X", "--method") ?? (hasFields && endpoint !== "graphql" ? "POST" : "GET")
  ).toUpperCase();

  if (endpoint === "graphql") {
    const query =
      [...(p.flags.get("-f") ?? []), ...(p.flags.get("--raw-field") ?? [])].find((f) =>
        f.startsWith("query="),
      ) ?? "";
    if (/\bmutation\b/.test(query)) refuse("GraphQL mutation");
    emit({
      data: {
        currentUser: { username: VIEWER },
        project: {
          fullPath: PROJECT,
          mergeRequest: { iid: String(IID), title: mergeRequest().title, webUrl: WEB_URL },
        },
      },
    });
    return;
  }
  if (method !== "GET") refuse(`${method} ${endpoint}`);
  if (endpoint === "user") {
    emit(authors[VIEWER]);
    return;
  }

  const match = /^projects\/([^/]+)(?:\/(.*))?$/.exec(endpoint);
  if (!match) notFound(endpoint);
  const [, project = "", rest = ""] = match;
  if (![":id", String(PROJECT_ID), "team%2Fservice", "team%2fservice"].includes(project))
    notFound(endpoint);

  const mr = `merge_requests/${IID}`;
  const routes: Record<string, () => object> = {
    "": () => ({
      id: PROJECT_ID,
      path_with_namespace: PROJECT,
      default_branch: "main",
      web_url: `https://${HOST}/${PROJECT}`,
    }),
    [mr]: mergeRequest,
    [`${mr}/discussions`]: discussions,
    [`${mr}/notes`]: flatNotes,
    [`${mr}/commits`]: commits,
    [`${mr}/diffs`]: diffs,
    [`${mr}/changes`]: () => ({ ...mergeRequest(), changes: diffs() }),
    [`${mr}/versions`]: () => [
      {
        id: 1,
        head_commit_sha: headSha(),
        base_commit_sha: baseSha(),
        start_commit_sha: baseSha(),
        created_at: "2026-09-24T10:40:30.000Z",
        state: "collected",
      },
    ],
    [`${mr}/draft_notes`]: () => [],
    [`${mr}/approvals`]: () => ({
      approved: false,
      approvals_required: 1,
      approvals_left: 1,
      approved_by: [],
    }),
    [`${mr}/participants`]: () => Object.values(authors),
    merge_requests: () => [mergeRequest()],
    "members/all": () => Object.values(authors),
  };
  const discussionMatch = new RegExp(`^${mr}/discussions/([0-9a-f]+)$`).exec(rest);
  if (discussionMatch) {
    const found = discussions().find((d) => d.id === discussionMatch[1]);
    if (!found) notFound(endpoint);
    emit(found);
    return;
  }
  const route = routes[rest];
  if (!route) notFound(endpoint);
  emit(route());
}

function mrText(comments: boolean): string {
  const m = mergeRequest();
  const lines = [
    `title:\t${m.title}`,
    `state:\topen`,
    `author:\t${VIEWER}`,
    `labels:\t`,
    `assignees:\t${VIEWER}`,
    `reviewers:\tjlee, akumar`,
    `comments:\t${m.user_notes_count}`,
    `number:\t${IID}`,
    `url:\t${WEB_URL}`,
    "--",
    m.description,
  ];
  if (comments) {
    for (const n of allNotes()) {
      lines.push("", `${n.author?.username ?? ""} commented ${n.created_at}`, n.body);
    }
  }
  return lines.join("\n");
}

function mrCommand(p: Parsed): void {
  const sub = p.positional[1] ?? "";
  if (sub === "note" && p.positional[2] === "list") {
    for (const n of flatNotes())
      console.log(`${n.author?.username ?? ""} commented ${n.created_at}\n${n.body}\n`);
    return;
  }
  const target = p.positional[2];
  if (
    target !== undefined &&
    ![String(IID), `!${IID}`, WEB_URL, "webhook-retries"].includes(target)
  ) {
    console.error(`glab: no merge request found for ${target}`);
    process.exit(1);
  }
  const json = ["json"].includes(first(p, "-F", "--output", "-o") ?? "");
  switch (sub) {
    case "view":
      if (json) emit(mergeRequest());
      else console.log(mrText(p.flags.has("-c") || p.flags.has("--comments")));
      return;
    case "diff":
      process.stdout.write(Bun.spawnSync(["git", "diff", "origin/main...HEAD"]).stdout);
      return;
    case "list":
      if (json) emit([mergeRequest()]);
      else
        console.log(
          `!${IID}\t${PROJECT}!${IID}\t${mergeRequest().title}\t(main) ← (webhook-retries)`,
        );
      return;
    default:
      refuse(`glab mr ${sub}`.trim());
  }
}

const args = Bun.argv.slice(2);
const parsed = parse(args);
switch (parsed.positional[0] ?? "") {
  case "api":
    api(parsed);
    break;
  case "mr":
    mrCommand(parsed);
    break;
  case "auth":
    console.log(
      `${HOST}\n  ✓ Logged in to ${HOST} as ${VIEWER}\n  ✓ Git operations for ${HOST} configured to use https protocol.`,
    );
    break;
  case "repo":
    if (parsed.positional[1] !== "view") refuse(`glab repo ${parsed.positional[1] ?? ""}`);
    emit({
      id: PROJECT_ID,
      path_with_namespace: PROJECT,
      default_branch: "main",
      web_url: `https://${HOST}/${PROJECT}`,
    });
    break;
  default:
    refuse(`glab ${args.join(" ")}`);
}
