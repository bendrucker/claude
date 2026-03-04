import UrlPattern from "url-pattern";

export type GitHubPrSource = {
  type: "github-pr";
  owner: string;
  repo: string;
  number: number;
  url: string;
};

export type GitHubIssueSource = {
  type: "github-issue";
  owner: string;
  repo: string;
  number: number;
  url: string;
};

export type GitLabMrSource = {
  type: "gitlab-mr";
  project: string;
  iid: number;
  url: string;
};

export type GitLabIssueSource = {
  type: "gitlab-issue";
  project: string;
  iid: number;
  url: string;
};

export type LinearSource = {
  type: "linear";
  id: string;
  url: string;
};

export type ThingsSource = {
  type: "things";
  id: string;
};

export type Source =
  | GitHubPrSource
  | GitHubIssueSource
  | GitLabMrSource
  | GitLabIssueSource
  | LinearSource
  | ThingsSource;

const githubPrPattern = new UrlPattern("/:owner/:repo/pull/:number");
const githubIssuePattern = new UrlPattern("/:owner/:repo/issues/:number");
const linearPattern = new UrlPattern("/:workspace/issue/:id");

export function parseUrl(url: string): Source {
  if (url.startsWith("things:")) {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("id");
    if (!id) throw new Error(`Missing id parameter in Things URL: ${url}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid Things ID: ${id}`);
    }
    return { type: "things", id };
  }

  const parsed = new URL(url);
  const host = parsed.hostname;
  const path = parsed.pathname;

  if (host === "github.com") {
    const prMatch = githubPrPattern.match(path);
    if (prMatch) {
      return {
        type: "github-pr",
        owner: prMatch.owner as string,
        repo: prMatch.repo as string,
        number: Number(prMatch.number),
        url,
      };
    }

    const issueMatch = githubIssuePattern.match(path);
    if (issueMatch) {
      return {
        type: "github-issue",
        owner: issueMatch.owner as string,
        repo: issueMatch.repo as string,
        number: Number(issueMatch.number),
        url,
      };
    }
  }

  if (host === "gitlab.com") {
    const mrMatch = path.match(/^\/(.+)\/-\/merge_requests\/(\d+)/);
    if (mrMatch) {
      return {
        type: "gitlab-mr",
        project: mrMatch[1]!,
        iid: Number(mrMatch[2]),
        url,
      };
    }

    const issueMatch = path.match(/^\/(.+)\/-\/issues\/(\d+)/);
    if (issueMatch) {
      return {
        type: "gitlab-issue",
        project: issueMatch[1]!,
        iid: Number(issueMatch[2]),
        url,
      };
    }
  }

  if (host === "linear.app") {
    const match = linearPattern.match(path);
    if (match) {
      const id = match.id as string;
      if (!/^[A-Z]+-\d+$/.test(id)) {
        throw new Error(`Invalid Linear issue ID: ${id}`);
      }
      return {
        type: "linear",
        id,
        url,
      };
    }
  }

  throw new Error(`Unsupported URL: ${url}`);
}

export type GitHubPrContext = {
  type: "github-pr";
  source: GitHubPrSource;
  metadata: Record<string, unknown>;
  diff: string;
};

export type GitHubIssueContext = {
  type: "github-issue";
  source: GitHubIssueSource;
  metadata: Record<string, unknown>;
};

export type GitLabMrContext = {
  type: "gitlab-mr";
  source: GitLabMrSource;
  metadata: Record<string, unknown>;
  diff: string;
};

export type GitLabIssueContext = {
  type: "gitlab-issue";
  source: GitLabIssueSource;
  metadata: Record<string, unknown>;
};

export type LinearContext = {
  type: "linear";
  source: LinearSource;
  metadata: Record<string, unknown>;
  relations: Record<string, unknown>[];
  attachments: Array<{ url?: string }>;
};

export type ThingsContext = {
  type: "things";
  source: ThingsSource;
  name: string;
  notes: string;
  tags: string[];
  checklist: string[];
  project: string;
  area: string;
};

export type FetchedContext =
  | GitHubPrContext
  | GitHubIssueContext
  | GitLabMrContext
  | GitLabIssueContext
  | LinearContext
  | ThingsContext;

function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  return proc.exited.then(async (exitCode) => {
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr}`);
    }
    const stdout = await new Response(proc.stdout).text();
    return stdout.trim();
  });
}

export async function fetchContext(source: Source): Promise<FetchedContext> {
  switch (source.type) {
    case "github-pr": {
      const [metadataJson, diff] = await Promise.all([
        run([
          "gh",
          "pr",
          "view",
          source.url,
          "--json",
          "title,body,state,additions,deletions,changedFiles,reviews,comments,labels,headRefName,baseRefName",
        ]),
        run(["gh", "pr", "diff", source.url]),
      ]);
      return {
        type: "github-pr",
        source,
        metadata: JSON.parse(metadataJson) as Record<string, unknown>,
        diff,
      };
    }

    case "github-issue": {
      const metadataJson = await run([
        "gh",
        "issue",
        "view",
        source.url,
        "--json",
        "title,body,state,comments,labels,assignees",
      ]);
      return {
        type: "github-issue",
        source,
        metadata: JSON.parse(metadataJson) as Record<string, unknown>,
      };
    }

    case "gitlab-mr": {
      const [metadataJson, diff] = await Promise.all([
        run(["glab", "mr", "view", String(source.iid), "-R", source.project, "-F", "json"]),
        run(["glab", "mr", "diff", String(source.iid), "-R", source.project]),
      ]);
      return {
        type: "gitlab-mr",
        source,
        metadata: JSON.parse(metadataJson) as Record<string, unknown>,
        diff,
      };
    }

    case "gitlab-issue": {
      const metadataJson = await run([
        "glab",
        "issue",
        "view",
        String(source.iid),
        "-R",
        source.project,
        "-F",
        "json",
      ]);
      return {
        type: "gitlab-issue",
        source,
        metadata: JSON.parse(metadataJson) as Record<string, unknown>,
      };
    }

    case "linear": {
      const metadataJson = await run(["linear", "issue", "view", source.id, "--json"]);
      const relationsJson = await run([
        "linear",
        "api",
        "--query",
        `{ issue(id: "${source.id}") { relations { nodes { type relatedIssue { identifier title state { name } } } } children { nodes { identifier title state { name } } } attachments { nodes { url } } } }`,
      ]);
      const relationsResponse = JSON.parse(relationsJson) as {
        data?: {
          issue?: {
            relations?: { nodes?: Record<string, unknown>[] };
            children?: { nodes?: Record<string, unknown>[] };
            attachments?: { nodes?: Array<{ url?: string }> };
          };
        };
      };
      const issue = relationsResponse.data?.issue;
      const relationNodes = issue?.relations?.nodes ?? [];
      const childNodes = (issue?.children?.nodes ?? []).map((c) => ({
        type: "child",
        relatedIssue: c,
      }));
      return {
        type: "linear",
        source,
        metadata: JSON.parse(metadataJson) as Record<string, unknown>,
        relations: [...relationNodes, ...childNodes],
        attachments: issue?.attachments?.nodes ?? [],
      };
    }

    case "things": {
      const jxa = `
        const things = Application("Things3");
        const todo = things.toDos.whose({id: "${source.id}"})[0];
        JSON.stringify({
          name: todo.name(),
          notes: todo.notes(),
          tags: todo.tagNames().split(", ").filter(Boolean),
          checklist: todo.toDoItems().map(i => i.name()),
          project: todo.project() ? todo.project().name() : "",
          area: todo.area() ? todo.area().name() : "",
        });
      `;
      const result = await run(["osascript", "-l", "JavaScript", "-e", jxa]);
      const data = JSON.parse(result) as {
        name: string;
        notes: string;
        tags: string[];
        checklist: string[];
        project: string;
        area: string;
      };
      return {
        type: "things",
        source,
        ...data,
      };
    }
  }
}
