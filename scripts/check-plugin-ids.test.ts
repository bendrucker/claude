import { expect, test } from "bun:test";
import {
  type PluginId,
  parseId,
  sources,
  unusedMarketplaces,
  violations,
} from "./check-plugin-ids";

test.each<{ name: string; id: string; expected: PluginId | null }>([
  {
    name: "plugin and marketplace",
    id: "linear@bendrucker",
    expected: { name: "linear", marketplace: "bendrucker" },
  },
  { name: "no marketplace", id: "linear", expected: null },
  { name: "empty marketplace", id: "linear@", expected: null },
  { name: "empty plugin", id: "@bendrucker", expected: null },
])("$name", ({ id, expected }) => {
  expect(parseId(id)).toEqual(expected);
});

const marketplaces = new Set(["bendrucker", "worktrunk"]);
const listed = new Set(["linear", "review"]);

test.each<{ name: string; ids: string[]; expected: number }>([
  { name: "own marketplace, listed", ids: ["linear@bendrucker"], expected: 0 },
  { name: "own marketplace, renamed away", ids: ["lienar@bendrucker"], expected: 1 },
  { name: "third party, declared", ids: ["worktrunk@worktrunk"], expected: 0 },
  { name: "third party, undeclared marketplace", ids: ["ast-grep@ast-grep"], expected: 1 },
  { name: "malformed id", ids: ["linear"], expected: 1 },
])("$name", ({ ids, expected }) => {
  expect(violations({ ids, marketplaces, listed })).toHaveLength(expected);
});

test("a third-party name is not resolved", () => {
  expect(violations({ ids: ["no-such-plugin@worktrunk"], marketplaces, listed })).toBeEmpty();
});

test.each<{ name: string; ids: string[]; expected: string[] }>([
  {
    name: "every declared marketplace used",
    ids: ["linear@bendrucker", "worktrunk@worktrunk"],
    expected: [],
  },
  { name: "declared marketplace with no id", ids: ["linear@bendrucker"], expected: ["worktrunk"] },
  {
    name: "malformed id does not use a marketplace",
    ids: ["bendrucker", "worktrunk@worktrunk"],
    expected: ["bendrucker"],
  },
])("$name", ({ ids, expected }) => {
  expect(unusedMarketplaces({ ids, marketplaces, listed })).toEqual(expected);
});

test("every enabled plugin in this repo resolves", async () => {
  expect(violations(await sources())).toBeEmpty();
});

test("every declared marketplace is used", async () => {
  expect(unusedMarketplaces(await sources())).toBeEmpty();
});
