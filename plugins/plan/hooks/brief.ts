import type { List, ListItem, Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

export const MAX_DECISIONS = 5;

export interface BriefOptions {
  revisionRequired: boolean;
}

function startsWithLabel(node: RootContent | undefined, label: string): boolean {
  return node?.type === "paragraph" && toString(node).trimStart().startsWith(label);
}

function briefSection(children: RootContent[]): RootContent[] | null {
  const start = children.findIndex((node) => node.type === "heading" && node.depth === 2);
  if (start === -1) return null;
  const heading = children[start];
  if (heading === undefined || toString(heading).trim() !== "Brief") return null;
  const rest = children.slice(start + 1);
  const end = rest.findIndex((node) => node.type === "heading" && node.depth <= 2);
  return end === -1 ? rest : rest.slice(0, end);
}

function listAfter(section: RootContent[], index: number): List | null {
  const next = section[index + 1];
  return next?.type === "list" ? next : null;
}

function flatten(node: Nodes): Nodes[] {
  return "children" in node ? [node, ...node.children.flatMap(flatten)] : [node];
}

// A `Rejected:` clause cites its evidence with a code span or a link that follows the label.
function citesRejection(item: ListItem): boolean {
  let rejected = false;
  for (const node of flatten(item)) {
    if (node.type === "text" && node.value.includes("Rejected:")) rejected = true;
    else if (rejected && (node.type === "inlineCode" || node.type === "link")) return true;
  }
  return false;
}

function revisedBlock(section: RootContent[]): { at: number; list: List | null } | null {
  const at = section.findIndex((node) => startsWithLabel(node, "Revised:"));
  return at === -1 ? null : { at, list: listAfter(section, at) };
}

/** The plan with its Brief's `Revised:` line and list removed. */
export function stripRevised(plan: string): string {
  const section = briefSection(fromMarkdown(plan).children);
  const revised = section === null ? null : revisedBlock(section);
  const label = revised === null ? undefined : section?.[revised.at];
  const start = label?.position?.start.offset;
  const end = (revised?.list ?? label)?.position?.end.offset;
  if (start === undefined || end === undefined) return plan;
  const before = plan.slice(0, start).replace(/\n+$/, "");
  const after = plan.slice(end).replace(/^\n+/, "");
  return after === "" ? `${before}\n` : `${before}\n\n${after}`;
}

export function checkBrief(plan: string, { revisionRequired }: BriefOptions): string[] {
  const section = briefSection(fromMarkdown(plan).children);
  if (section === null) return ["The plan's first `##` heading must be `## Brief`."];

  const problems: string[] = [];
  const revised = revisedBlock(section);
  const revisedList = revised?.list ?? null;
  const body = section.filter((node, index) => index !== revised?.at && node !== revisedList);

  const decisionsAt = body.findIndex((node) => startsWithLabel(node, "Decisions:"));
  if (decisionsAt === -1) {
    problems.push("The Brief needs a `Decisions:` line followed by a list.");
  } else {
    const leading = body.slice(0, decisionsAt).filter((node) => node.type === "paragraph");
    if (leading.length > 1) {
      problems.push(`The Brief has ${leading.length} paragraphs before \`Decisions:\`. Keep one.`);
    }
    const decisions = listAfter(body, decisionsAt);
    if (decisions === null || decisions.children.length === 0) {
      problems.push("Follow `Decisions:` with a list of decisions.");
    } else {
      if (decisions.children.length > MAX_DECISIONS) {
        problems.push(
          `The Brief lists ${decisions.children.length} decisions. Keep at most ${MAX_DECISIONS}.`,
        );
      }
      for (const [index, item] of decisions.children.entries()) {
        if (!citesRejection(item)) {
          problems.push(
            `Decision ${index + 1} needs \`Rejected:\` followed by a code span or link citing why.`,
          );
        }
      }
    }
  }

  if (!body.some((node) => startsWithLabel(node, "Measure:"))) {
    problems.push("The Brief needs a `Measure:` line.");
  }

  if (revisionRequired && (revisedList === null || revisedList.children.length === 0)) {
    problems.push(
      "This plan revises one the user rejected. Add a `Revised:` list to the Brief naming what changed.",
    );
  }

  return problems;
}
