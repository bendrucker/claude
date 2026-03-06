import { existsSync } from "node:fs";
import { join } from "node:path";
import UrlPattern from "url-pattern";
import type { Integration } from "../integration";
import { pickRepo, srcRoot } from "../repo";
import { run } from "../run";
import { escapeXml, section, tag } from "../xml";

export type LinearSource = {
  type: "linear";
  id: string;
  url: string;
};

export type LinearContext = {
  type: "linear";
  source: LinearSource;
  metadata: Record<string, unknown>;
  relations: Record<string, unknown>[];
  attachments: Array<{ url?: string }>;
};

const pattern = new UrlPattern("/:workspace/issue/:id");

function formatRelations(relations: Record<string, unknown>[]): string {
  if (relations.length === 0) return "";
  const formatted = relations
    .map((r) => {
      const relType = String(r.type ?? "related");
      const issue = r.relatedIssue as Record<string, unknown> | undefined;
      if (!issue) return "";
      const id = String(issue.identifier ?? "");
      const title = String(issue.title ?? "");
      const state = (issue.state as Record<string, unknown> | undefined)?.name ?? "";
      return `    <issue type="${escapeXml(relType)}" id="${escapeXml(id)}" state="${escapeXml(String(state))}">${escapeXml(title)}</issue>`;
    })
    .filter(Boolean)
    .join("\n");
  if (!formatted) return "";
  return `  <related-issues>\n${formatted}\n  </related-issues>`;
}

function resolveFromAttachments(attachments: Array<{ url?: string }>): string | undefined {
  for (const attachment of attachments) {
    const url = attachment.url;
    if (!url) continue;

    const ghMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      const repoPath = join(srcRoot, ghMatch[1]!, ghMatch[2]!);
      if (existsSync(repoPath)) return repoPath;
    }

    const glMatch = url.match(/gitlab\.com\/(.+)\/-\//);
    if (glMatch) {
      const segments = glMatch[1]!.split("/");
      const org = segments[segments.length - 2];
      const repo = segments[segments.length - 1];
      if (org && repo) {
        const repoPath = join(srcRoot, org, repo);
        if (existsSync(repoPath)) return repoPath;
      }
    }
  }

  return undefined;
}

export const linear: Integration = {
  type: "linear",
  mode: "plan",

  parse(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "linear.app") return null;
    const match = pattern.match(parsed.pathname);
    if (!match) return null;
    const id = match.id as string;
    if (!/^[A-Z]+-\d+$/.test(id)) {
      throw new Error(`Invalid Linear issue ID: ${id}`);
    }
    return { type: "linear", id, url } satisfies LinearSource;
  },

  async fetch(source) {
    const s = source as LinearSource;
    const metadataJson = await run(["linear", "issue", "view", s.id, "--json"]);
    const relationsJson = await run([
      "linear",
      "api",
      "--query",
      `{ issue(id: "${s.id}") { relations { nodes { type relatedIssue { identifier title state { name } } } } children { nodes { identifier title state { name } } } attachments { nodes { url } } } }`,
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
      source: s,
      metadata: JSON.parse(metadataJson) as Record<string, unknown>,
      relations: [...relationNodes, ...childNodes],
      attachments: issue?.attachments?.nodes ?? [],
    } satisfies LinearContext;
  },

  format(context) {
    const ctx = context as LinearContext;
    const m = ctx.metadata;
    const inner = [
      section("title", String(m.title ?? "")),
      section("description", String(m.description ?? "")),
      formatRelations(ctx.relations),
    ]
      .filter(Boolean)
      .join("\n");

    return tag(
      "task",
      {
        source: "linear",
        id: ctx.source.id,
        url: ctx.source.url,
      },
      inner,
    );
  },

  async resolveRepo(context) {
    const ctx = context as LinearContext;
    const repoPath = resolveFromAttachments(ctx.attachments);
    if (repoPath) return repoPath;
    return pickRepo();
  },
};
