import { describe, expect, test } from "bun:test";
import { reorder } from "./reorder";

// Both guards reject before reorder dispatches anything, so these run without
// Things. They previously called process.exit, which would have killed the MCP
// server rather than returning a tool error.
describe("reorder input guards", () => {
  test.each<[string, string, string[], string]>([
    ["empty ids", "today", [], "No IDs provided"],
    ["unknown list", "logbook", ["abc"], "Invalid list: logbook"],
  ])("rejects %s by throwing", (_name, list, ids, message) => {
    expect(reorder(list, ids)).rejects.toThrow(message);
  });
});
