import { describe, expect, it } from "bun:test";
import { renderSetVariables } from "./query";
import {
  Bucket,
  daysAgo,
  formatTimeline,
  formatTopSessions,
  timelineParams,
  topSessionsParams,
} from "./usage";

process.env.TZ = "UTC";

const sessions = [
  {
    session_id: "abcdef1234567890",
    host: "local",
    repo: "claude",
    msgs: 412,
    cost_usd_est: 12.3456,
    last_activity: "2026-08-30 11:00:00",
  },
  {
    session_id: "fedcba0987654321",
    host: "work",
    repo: null,
    msgs: 8,
    cost_usd_est: 0.4,
    last_activity: "2026-08-29 09:30:00",
  },
];

const buckets = [
  {
    bucket: "2026-08-30 11:00:00",
    msgs: 12,
    cost_usd_est: 1.5,
    input_tokens: 900,
    output_tokens: 4200,
    cache_write_tokens: 30_000,
    cache_read_tokens: 120_000,
    cache_miss_ratio: 0.2,
    max_context_tokens: 88_000,
    top_model: "claude-opus-5",
  },
  {
    bucket: "2026-08-30 11:10:00",
    msgs: 3,
    cost_usd_est: 0.25,
    input_tokens: 100,
    output_tokens: 600,
    cache_write_tokens: 0,
    cache_read_tokens: 40_000,
    cache_miss_ratio: 0.75,
    max_context_tokens: 91_000,
    top_model: "claude-opus-5",
  },
];

describe("params", () => {
  it("dates the lookback window back from today", () => {
    expect(daysAgo(0)).toBe(new Date().toISOString().slice(0, 10));
    expect(daysAgo(14)).toBe(new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10));
  });

  it("omits an unset host so the query spans every one", () => {
    expect(renderSetVariables(topSessionsParams(undefined, 14))).toBe(
      `SET VARIABLE "after_date" = '${daysAgo(14)}';\nSET VARIABLE "limit" = 10;\n`,
    );
  });

  it("binds the host when one is given", () => {
    expect(renderSetVariables(timelineParams("abc", "work", 30))).toBe(
      `SET VARIABLE "session" = 'abc';\nSET VARIABLE "host" = 'work';\nSET VARIABLE "bucket_minutes" = 30;\n`,
    );
  });
});

describe("Bucket", () => {
  it("decodes the token sums duckdb -json renders as strings", () => {
    const row = { ...buckets[0], output_tokens: "4200", cache_read_tokens: "120000" };
    expect(Bucket.parse(row)).toEqual(buckets[0]!);
  });

  it("rejects a null aggregate rather than reading it as zero", () => {
    expect(() => Bucket.parse({ ...buckets[0], output_tokens: null })).toThrow();
  });
});

describe("formatTopSessions", () => {
  it("renders a table", () => {
    expect(formatTopSessions(sessions, 14)).toMatchInlineSnapshot(`
      "Top sessions by estimated cost, last 14 days:

      ╔══════════╤═══════╤════════╤══════╤════════╗
      ║ SESSION  │ HOST  │ REPO   │ MSGS │ COST $ ║
      ╟──────────┼───────┼────────┼──────┼────────╢
      ║ abcdef12 │ local │ claude │ 412  │ \x1B[33m12.35\x1B[39m  ║
      ╟──────────┼───────┼────────┼──────┼────────╢
      ║ fedcba09 │ work  │ -      │ 8    │ \x1B[33m0.40\x1B[39m   ║
      ╚══════════╧═══════╧════════╧══════╧════════╝

      \x1B[2mPass --session <id> for a burn timeline. Cost is an estimate (see README).\x1B[0m"
    `);
  });

  it("says so when nothing is in the window", () => {
    expect(formatTopSessions([], 3)).toBe("No sessions with usage in the last 3 days.");
  });
});

describe("formatTimeline", () => {
  it("renders buckets, bars and a summary", () => {
    expect(formatTimeline(buckets, "abcdef12", 10)).toMatchInlineSnapshot(`
      "╔════════════════════╤══════╤══════════════════════════╤════════╤══════╗
      ║ TIME               │ MSGS │ BURN                     │ COST $ │ MISS ║
      ╟────────────────────┼──────┼──────────────────────────┼────────┼──────╢
      ║ Aug 30 at 11:00 AM │ 12   │ \x1B[36m████████████████████████\x1B[39m │ \x1B[33m1.50\x1B[39m   │ 0.20 ║
      ╟────────────────────┼──────┼──────────────────────────┼────────┼──────╢
      ║ Aug 30 at 11:10 AM │ 3    │ \x1B[36m████\x1B[39m                     │ \x1B[33m0.25\x1B[39m   │ \x1B[31m0.75\x1B[39m ║
      ╚════════════════════╧══════╧══════════════════════════╧════════╧══════╝

      session abcdef12\x1B[2m | \x1B[0m2 buckets of 10m\x1B[2m | \x1B[0m15 msgs\x1B[2m | \x1B[0mout 4,800 tok\x1B[2m | \x1B[0mcache read 160,000 / write 30,000 tok\x1B[2m | \x1B[0mpeak context 91,000 tok\x1B[2m | \x1B[0m\x1B[33m~$1.75 est\x1B[0m"
    `);
  });

  it("says so when the session has no usage", () => {
    expect(formatTimeline([], "abcdef12", 10)).toBe(
      "No assistant usage found for session abcdef12.",
    );
  });
});
