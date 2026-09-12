import { describe, expect, test } from "bun:test";
import { HerdrAgentListSchema } from "./server";

describe("herdr agent list envelope", () => {
  test("accepts the CLI envelope and a bare list", () => {
    const agent = { pane_id: "w1:p2", agent_session: { value: "abc" } };
    expect(
      HerdrAgentListSchema.parse({ id: "cli:agent:list", result: { agents: [agent] } }),
    ).toMatchObject({
      result: { agents: [agent] },
    });
    expect(HerdrAgentListSchema.parse({ agents: [agent] })).toMatchObject({ agents: [agent] });
  });
});
