import matter from "gray-matter";

// Parses a refined issue artifact (YAML frontmatter + body). The title and type
// are frontmatter fields, so callers read them here rather than off a leading
// H1. When frontmatter is absent, the whole input is the body and the metadata
// fields come back empty.

export interface ParsedIssue {
  title: string;
  type: string;
  body: string;
  data: Record<string, unknown>;
}

export function parseIssue(raw: string): ParsedIssue {
  const { data, content } = matter(raw);
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const type = typeof data.type === "string" ? data.type.trim() : "";
  return { title, type, body: content.trim(), data };
}
