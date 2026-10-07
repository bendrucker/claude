import type { EngineInterface, On } from "claude-code";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];
import { describe, expect, test, type Engine } from "claude-code/testing";

const PLUGIN = "run-command";

const REPLY = {
  text: "Try these:\n\n- ! git status --short\n\n`! wt list`\n\nor run ! pwd inline",
  isFirstOfReply: true,
};

const SHELL = { isDraft: false, isWorking: false, hint: "! for shell mode" };
const IDLE = { isDraft: false, isWorking: false, hint: "? for shortcuts" };

function core(on: On, events: ModEventsInput[] = []): string[] {
  const fills: string[] = [];
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    events.push(e);
    return { value: undefined };
  });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("prompt.edit", ($, e) => ({ text: e.inputText, cursor: e.inputText.length }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{e.component}</Text>;
  });
  on("prompt.fill", ($, e) => {
    fills.push(e.text);
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  return fills;
}

function reply($: Engine) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: "terminal",
    component: "AssistantMessage",
    props: REPLY,
    requestId: "m1",
  });
}

function hint($: Engine, props: typeof SHELL) {
  return $.ui.mount({ plugin: PLUGIN, surface: "terminal", component: "PromptHint", props });
}

function band($: Engine) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  });
}

const SEQUENCE = {
  text: "Run these:\n\n! git restore -- a\n\n! rm -r b\n```\n! git push --force-with-lease\n```\nThen:\n! pwd",
  isFirstOfReply: true,
};

describe("register", () => {
  test("draws nothing outside bash mode", async ($, on) => {
    core(on);
    const message = await reply($);
    await hint($, IDLE);
    expect(await message.findAll({ type: "Button" })).toHaveLength(0);
    expect(await (await band($)).findAll({ type: "Button" })).toHaveLength(0);
  });

  test("a reply's button fills its command in bash mode", async ($, on) => {
    const fills = core(on);
    const message = await reply($);
    await hint($, SHELL);
    const buttons = await message.findAll({ type: "Button" });
    expect(buttons.map((button) => button.text)).toEqual(["▸ git status --short", "▸ wt list"]);
    await message.press({ key: "run-command:1:wt list" });
    expect(fills).toEqual(["wt list"]);
  });

  test("the list above the prompt numbers the latest reply's commands", async ($, on) => {
    const fills = core(on);
    await reply($);
    await hint($, SHELL);
    const list = await band($);
    const buttons = await list.findAll({ type: "Button" });
    expect(buttons.map((button) => button.text)).toEqual([
      "git status --short",
      "wt list",
      "run all 1–2",
    ]);
    await list.press({ key: "run-command:0:git status --short" });
    expect(fills).toEqual(["git status --short"]);
  });

  test("run all fills a block joined with && from a click or 0", async ($, on) => {
    const events: ModEventsInput[] = [];
    const fills = core(on, events);
    await $.ui.mount({
      plugin: PLUGIN,
      surface: "terminal",
      component: "AssistantMessage",
      props: SEQUENCE,
      requestId: "m1",
    });
    await hint($, SHELL);
    const list = await band($);
    const buttons = await list.findAll({ type: "Button" });
    expect(buttons.map((button) => button.text).at(-1)).toBe("run all 1–3");
    const joined = "git restore -- a && rm -r b && git push --force-with-lease";
    await list.press({ key: `run-command:all0:${joined}` });
    expect(fills).toEqual([joined]);
    // @ts-expect-error -- the kit raises prompt.edit, but its `$.prompt` type omits `edit`.
    const edited = await $.prompt.edit({
      origin: { kind: "composer" },
      text: "",
      cursor: 0,
      start: 0,
      end: 0,
      inputText: "0",
    });
    expect(edited.text).toBe(joined);
    expect(events).toEqual([
      { mod: "run-command", event: "list.shown", detail: { count: 4 } },
      { mod: "run-command", event: "pick.all", detail: { count: 3, source: "click" } },
      { mod: "run-command", event: "pick.all", detail: { count: 3, source: "digit" } },
    ]);
  });

  test("run all records the clicked block when two join to the same text", async ($, on) => {
    const events: ModEventsInput[] = [];
    core(on, events);
    await $.ui.mount({
      plugin: PLUGIN,
      surface: "terminal",
      component: "AssistantMessage",
      props: { text: "! a && b\n! c\n\nThen:\n! a\n! b\n! c", isFirstOfReply: true },
      requestId: "m1",
    });
    await hint($, SHELL);
    await (await band($)).press({ key: "run-command:all1:a && b && c" });
    expect(events.at(-1)).toEqual({
      mod: "run-command",
      event: "pick.all",
      detail: { count: 3, source: "click" },
    });
  });

  test("a newer reply without commands clears the list", async ($, on) => {
    core(on);
    await reply($);
    await $.ui.mount({
      plugin: PLUGIN,
      surface: "terminal",
      component: "AssistantMessage",
      props: { text: "Done.", isFirstOfReply: true },
      requestId: "m2",
    });
    await hint($, SHELL);
    expect(await (await band($)).findAll({ type: "Button" })).toHaveLength(0);
  });

  test("records the heartbeat, each list shown, and each pick with its source", async ($, on) => {
    const events: ModEventsInput[] = [];
    core(on, events);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const message = await reply($);
    await hint($, SHELL);
    await band($);
    await band($);
    // @ts-expect-error -- the kit raises prompt.edit, but its `$.prompt` type omits `edit`.
    await $.prompt.edit({
      origin: { kind: "composer" },
      text: "",
      cursor: 0,
      start: 0,
      end: 0,
      inputText: "2",
    });
    await message.press({ key: "run-command:0:git status --short" });

    expect(events).toEqual([
      { mod: "run-command", event: "session.start" },
      { mod: "run-command", event: "list.shown", detail: { count: 2 } },
      { mod: "run-command", event: "pick", detail: { command: "wt list", source: "digit" } },
      {
        mod: "run-command",
        event: "pick",
        detail: { command: "git status --short", source: "click" },
      },
    ]);
  });
});
