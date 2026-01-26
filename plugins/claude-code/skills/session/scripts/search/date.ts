import * as chrono from "chrono-node";

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function parseDate(dateStr: string): Date {
  const parsed = chrono.parseDate(dateStr);
  if (!parsed) {
    throw new Error(`Unable to parse date: "${dateStr}"`);
  }
  return startOfDay(parsed);
}
