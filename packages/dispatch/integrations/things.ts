import type { Integration } from "../integration";
import { pickRepo } from "../repo";
import { run } from "../run";
import { escapeXml, section, tag } from "../xml";

export type ThingsSource = {
  type: "things";
  id: string;
};

export type ThingsContext = {
  type: "things";
  source: ThingsSource;
  name: string;
  notes: string;
  tags: string[];
  checklist: string[];
  project: string;
  area: string;
};

export const things: Integration = {
  type: "things",
  mode: "plan",

  parse(url: string) {
    if (!url.startsWith("things:")) return null;
    const parsed = new URL(url);
    const id = parsed.searchParams.get("id");
    if (!id) throw new Error(`Missing id parameter in Things URL: ${url}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid Things ID: ${id}`);
    }
    return { type: "things", id } satisfies ThingsSource;
  },

  async fetch(source) {
    const s = source as ThingsSource;
    const jxa = `
      const things = Application("Things3");
      const todo = things.toDos.whose({id: "${s.id}"})[0];
      JSON.stringify({
        name: todo.name(),
        notes: todo.notes(),
        tags: todo.tagNames().split(", ").filter(Boolean),
        checklist: todo.toDoItems().map(i => i.name()),
        project: todo.project() ? todo.project().name() : "",
        area: todo.area() ? todo.area().name() : "",
      });
    `;
    const result = await run(["osascript", "-l", "JavaScript", "-e", jxa]);
    const data = JSON.parse(result) as {
      name: string;
      notes: string;
      tags: string[];
      checklist: string[];
      project: string;
      area: string;
    };
    return {
      type: "things",
      source: s,
      ...data,
    } satisfies ThingsContext;
  },

  format(context) {
    const ctx = context as ThingsContext;
    const inner = [
      section("title", ctx.name),
      section("notes", ctx.notes),
      section("tags", ctx.tags.join(", ")),
      ctx.checklist.length > 0
        ? `  <checklist>\n${ctx.checklist.map((i) => `    <item>${escapeXml(i)}</item>`).join("\n")}\n  </checklist>`
        : "",
      section("project", ctx.project),
      section("area", ctx.area),
    ]
      .filter(Boolean)
      .join("\n");

    return tag("task", { source: "things", id: ctx.source.id }, inner);
  },

  async resolveRepo() {
    return pickRepo();
  },
};
