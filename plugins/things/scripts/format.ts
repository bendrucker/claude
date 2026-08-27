export { table } from "table";

export function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export function stringify(value: unknown): string {
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

export function selectColumns(
  headers: string[],
  rows: string[][],
  columns: string[] | undefined,
): [string[], string[][]] {
  if (!columns || columns.length === 0) return [headers, rows];

  const headerMap = new Map(headers.map((header, index) => [normalize(header), { header, index }]));

  const selected: { header: string; index: number }[] = [];
  for (const col of columns) {
    const match = headerMap.get(normalize(col));
    if (match === undefined) {
      console.error(`Unknown column: ${col}. Available: ${headers.join(", ")}`);
      process.exit(1);
    }
    selected.push(match);
  }

  return [
    selected.map((c) => c.header),
    rows.map((row) => selected.map((c) => row[c.index] ?? "")),
  ];
}
