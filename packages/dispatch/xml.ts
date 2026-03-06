export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function tag(
  name: string,
  attrs: Record<string, string | number>,
  content?: string,
): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(" ");
  if (content === undefined) return `<${name} ${attrStr} />`;
  return `<${name} ${attrStr}>\n${content}\n</${name}>`;
}

export function section(name: string, content: string | undefined): string {
  if (!content) return "";
  return `  <${name}>${escapeXml(content)}</${name}>`;
}

export function sectionRaw(name: string, content: string | undefined): string {
  if (!content) return "";
  return `  <${name}>\n${content}\n  </${name}>`;
}

export function formatComments(comments: unknown[]): string {
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

export function formatLabels(labels: unknown[]): string {
  if (labels.length === 0) return "";
  const names = labels
    .map((l) => {
      const label = l as Record<string, unknown>;
      return String(label.name ?? l);
    })
    .join(", ");
  return `  <labels>${escapeXml(names)}</labels>`;
}
