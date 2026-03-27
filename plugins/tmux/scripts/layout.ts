#!/usr/bin/env bun

import { cli } from "cleye";
import { currentPane, tmuxSync } from "./tmux";

const argv = cli({
  name: "layout",
  parameters: ["<preset>"],
  flags: {
    target: {
      type: String,
      description: "Target pane ID (default: $TMUX_PANE)",
    },
    count: {
      type: Number,
      description: "Number of panes for stack-right preset",
      default: 3,
    },
  },
});

const preset = argv._.preset;
const target = argv.flags.target ?? currentPane();

interface PaneResult {
  id: string;
  position: string;
}

interface LayoutResult {
  preset: string;
  panes: PaneResult[];
}

function splitWindow(
  direction: "h" | "v",
  sizePercent: number,
  targetPane: string,
  before = false,
): string | null {
  const args = [
    "split-window",
    `-${direction}`,
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-t",
    targetPane,
    "-l",
    `${sizePercent}%`,
  ];
  if (before) args.push("-b");
  return tmuxSync(...args);
}

function sidebarRight(): LayoutResult {
  const right = splitWindow("h", 70, target);
  if (!right) {
    console.error("Failed to create sidebar-right layout");
    process.exit(1);
  }
  return {
    preset: "sidebar-right",
    panes: [
      { id: target, position: "left" },
      { id: right, position: "right" },
    ],
  };
}

function sidebarLeft(): LayoutResult {
  const left = splitWindow("h", 70, target, true);
  if (!left) {
    console.error("Failed to create sidebar-left layout");
    process.exit(1);
  }
  return {
    preset: "sidebar-left",
    panes: [
      { id: left, position: "left" },
      { id: target, position: "right" },
    ],
  };
}

function stackRight(count: number): LayoutResult {
  const right = splitWindow("h", 70, target);
  if (!right) {
    console.error("Failed to create stack-right layout");
    process.exit(1);
  }

  const panes: PaneResult[] = [
    { id: target, position: "left" },
    { id: right, position: "right-0" },
  ];

  let lastPane = right;
  for (let i = 1; i < count; i++) {
    const heightPercent = Math.round(100 / (count - i + 1));
    const next = splitWindow("v", heightPercent, lastPane);
    if (!next) break;
    panes.push({ id: next, position: `right-${i}` });
    lastPane = next;
  }

  return { preset: "stack-right", panes };
}

function grid2x2(): LayoutResult {
  const right = splitWindow("h", 50, target);
  if (!right) {
    console.error("Failed to create grid-2x2 layout");
    process.exit(1);
  }

  const bottomLeft = splitWindow("v", 50, target);
  const bottomRight = splitWindow("v", 50, right);

  const panes: PaneResult[] = [
    { id: target, position: "top-left" },
    { id: right, position: "top-right" },
  ];
  if (bottomLeft) panes.push({ id: bottomLeft, position: "bottom-left" });
  if (bottomRight) panes.push({ id: bottomRight, position: "bottom-right" });

  return { preset: "grid-2x2", panes };
}

function mainBottom(): LayoutResult {
  const bottom = splitWindow("v", 25, target);
  if (!bottom) {
    console.error("Failed to create main-bottom layout");
    process.exit(1);
  }
  return {
    preset: "main-bottom",
    panes: [
      { id: target, position: "top" },
      { id: bottom, position: "bottom" },
    ],
  };
}

let result: LayoutResult;

switch (preset) {
  case "sidebar-right":
    result = sidebarRight();
    break;
  case "sidebar-left":
    result = sidebarLeft();
    break;
  case "stack-right":
    result = stackRight(argv.flags.count);
    break;
  case "grid-2x2":
    result = grid2x2();
    break;
  case "main-bottom":
    result = mainBottom();
    break;
  default:
    console.error(`Unknown preset: ${preset}`);
    console.error("Presets: sidebar-right, sidebar-left, stack-right, grid-2x2, main-bottom");
    process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
