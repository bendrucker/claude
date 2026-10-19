import { describe, expect, test } from "bun:test";
import { normalize, statements } from "./sql";

const DB = "~/.local/share/claude-sessions/session.duckdb";
const INIT = "-init $CLAUDE_SKILL_DIR/resources/limits.sql";

describe("statements", () => {
  test.each([
    ["an argument", `duckdb -readonly -json ${INIT} ${DB} "SELECT count(*) FROM sessions"`],
    ["-c", `duckdb -readonly -c 'SELECT count(*) FROM sessions' ${DB}`],
    ["a heredoc", `duckdb -readonly -json ${DB} <<'SQL'\nSELECT count(*) FROM sessions\nSQL`],
    ["a herestring", `duckdb -readonly ${DB} <<< "SELECT count(*) FROM sessions"`],
    ["an echo pipe", `echo "SELECT count(*) FROM sessions" | duckdb -readonly -json ${DB}`],
    [
      "an env prefix",
      `D=$(bun refresh.ts) && TZ=UTC duckdb -readonly "$D" "SELECT count(*) FROM sessions"`,
    ],
  ])("reads SQL from %s", (_, command) => {
    expect(statements(command)).toEqual([{ sql: "SELECT count(*) FROM sessions" }]);
  });

  test("reads a named query and its piped params", () => {
    const command = `{ echo "SET VARIABLE after_date = '2026-10-01';"; cat \${CLAUDE_SKILL_DIR}/resources/queries/hook-blocks.sql; } | duckdb -readonly -json ${INIT} ${DB}`;
    expect(statements(command)).toEqual([
      { name: "hook-blocks", sql: "SET VARIABLE after_date = '2026-10-01';" },
    ]);
  });

  test("reads a named query from a redirect with -cmd params", () => {
    const command = `duckdb -readonly -cmd "SET VARIABLE term = 'x';" ${DB} < ~/s/resources/queries/search.sql`;
    expect(statements(command)).toEqual([{ name: "search", sql: "SET VARIABLE term = 'x';" }]);
  });

  test("keeps every call in a compound command and ignores other programs", () => {
    const command = `cd /tmp && duckdb ${DB} "SELECT 1" ; grep duckdb x | head\nduckdb ${DB} "SELECT 2"`;
    expect(statements(command).map((s) => s.sql)).toEqual(["SELECT 1", "SELECT 2"]);
  });

  test("returns nothing for a bare open", () => {
    expect(statements(`duckdb -readonly ${DB}`)).toEqual([]);
  });
});

test("normalize groups queries that differ only in literals and spacing", () => {
  expect(normalize("SELECT *\nFROM sessions WHERE day > '2026-10-01' LIMIT 5;")).toBe(
    normalize("select * from sessions   where day > '2026-09-01' limit 50"),
  );
});
