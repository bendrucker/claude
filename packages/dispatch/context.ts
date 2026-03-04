import type { FetchedContext, Source } from "./sources";

export type Mode = "plan" | "review" | "prefill";

export function inferMode(sourceType: Source["type"]): Mode {
  switch (sourceType) {
    case "github-pr":
    case "gitlab-mr":
      return "review";
    case "github-issue":
    case "gitlab-issue":
    case "linear":
    case "things":
      return "plan";
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tag(name: string, attrs: Record<string, string | number>, content?: string): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(" ");
  if (content === undefined) return `<${name} ${attrStr} />`;
  return `<${name} ${attrStr}>\n${content}\n</${name}>`;
}

function section(name: string, content: string | undefined): string {
  if (!content) return "";
  return `  <${name}>${escapeXml(content)}</${name}>`;
}

function sectionRaw(name: string, content: string | undefined): string {
  if (!content) return "";
  return `  <${name}>\n${content}\n  </${name}>`;
}

function formatComments(comments: unknown[]): string {
  if (comments.length === 0) return "";
  const formatted = comments
    .map((c) => {
      const comment = c as Record<string, unknown>;
      const author = (comment.author as Record<string, unknown> | undefined)?.login ?? "unknown";
      return `    <comment author="${escapeXml(String(author))}">${escapeXml(String(comment.body ?? ""))}</comment>`;
    })
    .join("\n");
  return `  <comments>\n${formatted}\n  </comments>`;
}

function formatLabels(labels: unknown[]): string {
  if (labels.length === 0) return "";
  const names = labels
    .map((l) => {
      const label = l as Record<string, unknown>;
      return String(label.name ?? l);
    })
    .join(", ");
  return `  <labels>${escapeXml(names)}</labels>`;
}

function formatReviews(reviews: unknown[]): string {
  if (reviews.length === 0) return "";
  const formatted = reviews
    .map((r) => {
      const review = r as Record<string, unknown>;
      const author = (review.author as Record<string, unknown> | undefined)?.login ?? "unknown";
      const state = String(review.state ?? "");
      const body = String(review.body ?? "");
      if (!body)
        return `    <review author="${escapeXml(String(author))}" state="${escapeXml(state)}" />`;
      return `    <review author="${escapeXml(String(author))}" state="${escapeXml(state)}">${escapeXml(body)}</review>`;
    })
    .join("\n");
  return `  <review-comments>\n${formatted}\n  </review-comments>`;
}

export function formatContext(context: FetchedContext, mode: Mode): string {
  const parts: string[] = [];

  switch (context.type) {
    case "github-pr": {
      const m = context.metadata;
      const inner = [
        section("title", String(m.title ?? "")),
        section("description", String(m.body ?? "")),
        tag("stats", {
          additions: Number(m.additions ?? 0),
          deletions: Number(m.deletions ?? 0),
          files: Number(m.changedFiles ?? 0),
        }),
        formatReviews((m.reviews as unknown[]) ?? []),
        formatComments((m.comments as unknown[]) ?? []),
        sectionRaw("diff", context.diff),
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(
        tag(
          "pull-request",
          {
            source: "github",
            number: context.source.number,
            url: context.source.url,
            head: String(m.headRefName ?? ""),
            base: String(m.baseRefName ?? ""),
          },
          inner,
        ),
      );
      break;
    }

    case "github-issue": {
      const m = context.metadata;
      const inner = [
        section("title", String(m.title ?? "")),
        section("description", String(m.body ?? "")),
        formatLabels((m.labels as unknown[]) ?? []),
        formatComments((m.comments as unknown[]) ?? []),
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(
        tag(
          "task",
          {
            source: "github",
            number: context.source.number,
            url: context.source.url,
          },
          inner,
        ),
      );
      break;
    }

    case "gitlab-mr": {
      const m = context.metadata;
      const inner = [
        section("title", String(m.title ?? "")),
        section("description", String(m.description ?? "")),
        sectionRaw("diff", context.diff),
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(
        tag(
          "pull-request",
          {
            source: "gitlab",
            iid: context.source.iid,
            url: context.source.url,
          },
          inner,
        ),
      );
      break;
    }

    case "gitlab-issue": {
      const m = context.metadata;
      const inner = [
        section("title", String(m.title ?? "")),
        section("description", String(m.description ?? "")),
        formatLabels((m.labels as unknown[]) ?? []),
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(
        tag(
          "task",
          {
            source: "gitlab",
            iid: context.source.iid,
            url: context.source.url,
          },
          inner,
        ),
      );
      break;
    }

    case "linear": {
      const m = context.metadata;
      const inner = [
        section("title", String(m.title ?? "")),
        section("description", String(m.description ?? "")),
        formatRelations(context.relations),
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(
        tag(
          "task",
          {
            source: "linear",
            id: context.source.id,
            url: context.source.url,
          },
          inner,
        ),
      );
      break;
    }

    case "things": {
      const inner = [
        section("title", context.name),
        section("notes", context.notes),
        section("tags", context.tags.join(", ")),
        context.checklist.length > 0
          ? `  <checklist>\n${context.checklist.map((i) => `    <item>${escapeXml(i)}</item>`).join("\n")}\n  </checklist>`
          : "",
        section("project", context.project),
        section("area", context.area),
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(tag("task", { source: "things", id: context.source.id }, inner));
      break;
    }
  }

  const xml = parts.join("\n");

  switch (mode) {
    case "review":
      return `${xml}\n\nReview the pull request above. Focus on correctness, edge cases, and code quality.`;
    case "plan":
      return `${xml}\n\nReview the task above and create an implementation plan.`;
    case "prefill":
      return xml;
  }
}

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
