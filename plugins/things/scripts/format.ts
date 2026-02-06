export { table } from "table";

export function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}
