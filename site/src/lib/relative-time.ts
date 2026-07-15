const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * Formats a date as relative text ("3 days ago"). Callers rerun this against
 * a fresh `now` client-side so a page that only rebuilds on push does not go
 * stale between builds.
 */
export function relativeTime(dateStr: string, now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diffMs = new Date(dateStr).getTime() - now.getTime();

  for (const [unit, unitMs] of UNITS) {
    if (Math.abs(diffMs) >= unitMs) return rtf.format(Math.round(diffMs / unitMs), unit);
  }
  return rtf.format(0, "minute");
}
