# HTML Wireframes

Create HTML wireframes using Tailwind CSS for quick prototyping with PNG rendering.

## Workflow

1. **Create HTML wireframe** with Tailwind CSS classes
2. **Render to PNG** using the render script
3. **Review PNG** visually and iterate

## When to Use HTML vs SVG

Use **HTML/Tailwind** when:
- Layout uses standard web patterns (flexbox, grid)
- Rapid iteration is more important than precise positioning
- Content is text-heavy or has complex nesting
- You need responsive behavior

Use **SVG** when:
- Precise pixel positioning matters
- Layout validation is important
- Creating diagrams or non-standard layouts
- You need exact coordinate control

## Tailwind Patterns

Wireframes use black borders on white background:

- **Containers**: `border border-dashed border-black` for sections
- **Interactive elements**: `border border-black` (solid) for buttons, inputs
- **Text**: Default black text, no fancy typography
- **Spacing**: Use standard Tailwind spacing (`p-4`, `gap-4`, `m-2`)

## Component Examples

### Input Field

```html
<div class="border border-black p-3">
  <span class="text-sm">Email</span>
</div>
```

### Button

```html
<button class="border border-black px-4 py-2 w-full">
  Submit
</button>
```

### Card

```html
<div class="border border-dashed border-black p-4">
  <h3 class="font-medium mb-2">Card Title</h3>
  <p class="text-sm">Card content goes here</p>
</div>
```

### Table

```html
<table class="w-full border border-black">
  <thead>
    <tr class="border-b border-black">
      <th class="p-2 text-left">Name</th>
      <th class="p-2 text-left">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr class="border-b border-black">
      <td class="p-2">Item 1</td>
      <td class="p-2">Active</td>
    </tr>
  </tbody>
</table>
```

### Image Placeholder

Use a bordered div with centered placeholder text (not X-pattern):

```html
<div class="border border-black h-48 flex items-center justify-center text-gray-400">
  [image]
</div>
```

### Grid Layout

```html
<div class="grid grid-cols-3 gap-4">
  <div class="border border-dashed border-black p-4">Item 1</div>
  <div class="border border-dashed border-black p-4">Item 2</div>
  <div class="border border-dashed border-black p-4">Item 3</div>
</div>
```

## Example Assets

Reference examples in `{SKILL_DIR}/assets-html/`:

| File | Layout Pattern |
|------|----------------|
| `login-screen.html` | Login form with inputs and buttons |
| `form.html` | Multi-field form layout |
| `two-column.html` | Sidebar + main content grid |
| `grid.html` | Responsive card layout |
| `table.html` | Table with headers |
| `modal.html` | Modal dialog overlay |
| `nested-groups.html` | Complex nested containers |

Read these files for reference when creating similar layouts.

## Render Script

```bash
bun {SKILL_DIR}/scripts/render-html.ts [--scale N] <html-file> [output.png]
```

Renders HTML to PNG using Playwright. Output path defaults to same name with `.png` extension.

**Scale options:**
- `--scale 1` (default): 1x resolution for quick verification
- `--scale 2`: 2x resolution for sharing (outputs `@2x.png` suffix)

## Example HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=375, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { width: 375px; min-height: 667px; }
  </style>
</head>
<body class="bg-white p-4">
  <!-- Header -->
  <div class="border border-dashed border-black p-4 mb-4">
    <h1 class="text-center font-medium">Screen Title</h1>
  </div>

  <!-- Form -->
  <div class="space-y-4">
    <div class="border border-black p-3">
      <span class="text-sm">Email</span>
    </div>
    <div class="border border-black p-3">
      <span class="text-sm">Password</span>
    </div>
    <button class="border border-black w-full py-3">
      Sign In
    </button>
  </div>

  <!-- Image placeholder -->
  <div class="border border-black h-48 mt-4 flex items-center justify-center text-gray-400">
    [image]
  </div>
</body>
</html>
```

## Common Sizes

Set viewport width in the `<meta>` tag and body style:

| Device | Width | Min Height |
|--------|-------|------------|
| iPhone | 375 | 667 |
| iPad | 768 | 1024 |
| Desktop | 1280 | 800 |
| Mobile web | 360 | 640 |
