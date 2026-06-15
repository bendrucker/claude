# SVG Wireframes

Create SVG wireframes for UI mockups with layout validation and PNG rendering.

## Workflow

1. **Create SVG wireframe** in the scratchpad directory
2. **Validate layout** using the validation script
3. **Render to PNG** using the render script
4. **Review PNG** visually and iterate

## Guidelines

Wireframes use only black strokes on a white background:

- **Containers**: `<rect>` with black stroke, dashed for sections (`stroke-dasharray="4"`)
- **Buttons/inputs**: `<rect>` with solid black stroke, no fill
- **Text**: `<text>` with `fill="black"`, no font styling beyond size
- **Image placeholders**: `<rect>` with diagonal cross pattern
- **Dividers**: `<line>` with black stroke

## Visual Rules

1. **Black and white only** — no color fills, no grays except for subtle distinction
2. **Dashed lines** for container boundaries
3. **Solid lines** for interactive elements (buttons, inputs)
4. **No styling** — no rounded corners, shadows, or decorative elements
5. **Minimal text** — labels where needed for clarity, placeholders elsewhere

## Content Guidelines

- Use actual copy when it clarifies function (e.g., "Email", "Submit")
- Use generic labels when specificity doesn't matter (e.g., "Field", "Button")
- Use lines (`———`) to represent text blocks/paragraphs
- Mark image areas with diagonal cross pattern

## Layout Rules

Enforced by validation:

1. **Child bounds**: Children must fit within parent containers
2. **No overlap**: Sibling elements must not overlap
3. **Text fit**: Text must fit within its container

## Coordinate System

- Origin (0,0) is top-left
- Use absolute positioning with `x`, `y` attributes
- Group related elements with `<g transform="translate(x,y)">`

## Example Structure

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="375" height="667" viewBox="0 0 375 667">
  <!-- Background -->
  <rect width="375" height="667" fill="white" stroke="black" stroke-dasharray="4"/>

  <!-- Header -->
  <g transform="translate(0,0)">
    <rect width="375" height="56" fill="none" stroke="black" stroke-dasharray="4"/>
    <text font-family="sans-serif" x="187" y="34" text-anchor="middle" font-size="16" fill="black">Screen Title</text>
  </g>

  <!-- Input field -->
  <g transform="translate(16,72)">
    <rect width="343" height="44" fill="none" stroke="black"/>
    <text font-family="sans-serif" x="12" y="28" font-size="14" fill="black">Email</text>
  </g>

  <!-- Button -->
  <g transform="translate(16,132)">
    <rect width="343" height="44" fill="none" stroke="black"/>
    <text font-family="sans-serif" x="171" y="28" text-anchor="middle" font-size="14" fill="black">Submit</text>
  </g>

  <!-- Image placeholder -->
  <g transform="translate(16,192)">
    <rect width="343" height="200" fill="none" stroke="black"/>
    <line x1="0" y1="0" x2="343" y2="200" stroke="black"/>
    <line x1="343" y1="0" x2="0" y2="200" stroke="black"/>
  </g>
</svg>
```

## Example Assets

Reference examples in `{SKILL_DIR}/assets/`:

| File | Layout Pattern |
|------|----------------|
| `login-screen.svg` | Form with inputs, links, buttons |
| `nested-groups.svg` | Profile page with avatar placeholder |
| `two-column.svg` | Sidebar + main content |
| `grid.svg` | 3x2 card grid with image placeholders |
| `table.svg` | Data table with skeleton placeholders |
| `form.svg` | Multi-field form with labels |
| `modal.svg` | Dialog overlay on dimmed background |

Read these files for reference when creating similar layouts.

## Scripts

Base path: `{SKILL_DIR}/scripts/`

### Validate

```bash
bun {SKILL_DIR}/scripts/validate.ts <svg-file> [svg-file...]
```

Checks layout constraints and reports violations. Exit code 0 if valid.

### Render

```bash
bun {SKILL_DIR}/scripts/render.ts [--scale N] <svg-file> [output.png]
```

Renders SVG to PNG using sharp. Output path defaults to the same name with `.png` extension.

**Scale options:**
- `--scale 1` (default): 1x resolution for quick verification during iteration
- `--scale 2`: 2x resolution for sharing (retina-quality, outputs `@2x.png` suffix)

## Common Sizes

| Device | Width | Height |
|--------|-------|--------|
| iPhone | 375 | 667 |
| iPad | 768 | 1024 |
| Desktop | 1280 | 800 |
| Mobile web | 360 | 640 |

## Iteration Process

1. Create initial SVG based on requirements
2. Run validation—fix any constraint violations
3. Render to PNG (1x for quick verification)
4. Read the PNG file to visually inspect the result
5. Iterate on layout issues until satisfied
6. Render final version at 2x for sharing
