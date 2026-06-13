---
name: wireframe
description: Create wireframes for UI mockups. Supports SVG (precise layouts) and HTML/Tailwind (standard UI patterns). Use when creating wireframes, mockups, or skeletal UI layouts.
allowed-tools:
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render.ts:*)"
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render-html.ts:*)"
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render.ts:*)|Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render-html.ts:*)"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/wireframe/scripts/setup.ts"
          once: true
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: {dangerouslyDisableSandbox: true}}}'
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/wireframe/scripts/validate-hook.ts"
---

# Wireframe

Create wireframes for UI mockups with two approaches.

Wireframes are skeletal, black-and-white representations of UI layout, focused on structure, content priority, and function—not visual design. No colors, no styling, minimal fidelity.

## Choose Your Approach

| Use | When | Render Script |
|-----|------|---------------|
| **SVG** | Precise positioning, overlapping elements, custom shapes, artistic layouts | `render.ts` |
| **HTML/Tailwind** | Standard UI patterns (forms, grids, navigation, modals), flexbox layouts | `render-html.ts` |

**Before creating any wireframe**: Read the reference file for your chosen approach. The references contain required patterns, component examples, and the rendering workflow.

## References

- [SVG Reference](./references/svg.md) — Absolute positioning with validation
- [HTML Reference](./references/html.md) — Tailwind/flexbox patterns

## Rendering

Use ONLY the provided render scripts. Do not improvise alternative methods (Chrome headless, third-party CLI tools, etc.).

| Format | Command |
|--------|---------|
| SVG | `bun {SKILL_DIR}/scripts/render.ts [--scale N] <file.svg> [output.png]` |
| HTML | `bun {SKILL_DIR}/scripts/render-html.ts [--scale N] <file.html> [output.png]` |

## Common Sizes

| Device | Width | Height |
|--------|-------|--------|
| iPhone | 375 | 667 |
| iPad | 768 | 1024 |
| Desktop | 1280 | 800 |
| Mobile web | 360 | 640 |

## Iteration Process

1. Create wireframe in the scratchpad directory
2. Run validation (SVG) or render directly (HTML)
3. Render to PNG (1x for quick verification)
4. Read the PNG file to visually inspect
5. Iterate until satisfied
6. Render final version at 2x for sharing
