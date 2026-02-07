export { table } from "table";

export function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export function selectColumns(
  headers: string[],
  rows: string[][],
  columns: string[] | undefined,
): [string[], string[][]] {
  if (!columns || columns.length === 0) return [headers, rows];

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
  const headerMap = new Map(headers.map((h, i) => [normalize(h), i]));

  const indices: number[] = [];
  for (const col of columns) {
    const idx = headerMap.get(normalize(col));
    if (idx === undefined) {
      console.error(`Unknown column: ${col}. Available: ${headers.join(", ")}`);
      process.exit(1);
    }
    indices.push(idx);
  }

  return [indices.map((i) => headers[i]!), rows.map((row) => indices.map((i) => row[i]!))];
}
