type Attrs = Record<string, string | boolean | number>;

export function xml(tag: string, content: string): string;
export function xml(tag: string, attrs: Attrs, content: string): string;
export function xml(
  tag: string,
  attrsOrContent: Attrs | string,
  content?: string,
): string {
  const hasAttrs = typeof attrsOrContent !== "string";
  const attrs = hasAttrs ? attrsOrContent : {};
  const body = hasAttrs ? content : attrsOrContent;

  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");

  return `<${tag}${attrStr}>\n${body}\n</${tag}>`;
}
