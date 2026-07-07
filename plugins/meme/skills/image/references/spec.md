# Layout Spec

JSON file passed via `--spec`. Use it for multi-label formats, custom placement, style overrides, or any text containing `!`. All coordinates and font sizes are normalized: positions and sizes are fractions of the image dimensions (font sizes are fractions of image height). Caption bars are added outside the image, so box coordinates always refer to the original image area.

## Schema

```json
{
  "boxes": [
    {
      "text": "required non-empty string",
      "preset": "classic | label | subtitle (default classic)",
      "anchor": "top | bottom | center (mutually exclusive with region)",
      "region": { "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.25 },
      "align": "left | center | right (default center)",
      "valign": "top | middle | bottom (default follows anchor; regions default middle)",
      "style": {
        "fill": "#rrggbb",
        "stroke": "#rrggbb",
        "fontSize": 0.08,
        "font": "font family name",
        "uppercase": true
      }
    }
  ],
  "captions": [
    { "text": "required", "position": "top | bottom (default top)" }
  ]
}
```

At least one box or caption is required. `style` fields are sparse overrides on the preset; `fontSize` sets the starting size, and text still shrinks if it does not fit.

## Presets

| Preset | Look | Defaults |
|--------|------|----------|
| `classic` | Impact, uppercase, white fill, thick black stroke | anchor top, max size 0.10 x H |
| `label` | Helvetica bold, mixed case, black fill, thin white stroke | anchor center, max size 0.06 x H |
| `subtitle` | Helvetica bold, mixed case, yellow `#ffe400`, thin black outline | anchor bottom, max size 0.045 x H |

Anchors map to canned regions: top `{x: 0.05, y: 0.02, w: 0.9, h: 0.3}`, bottom `{x: 0.05, y: 0.68, w: 0.9, h: 0.3}`, center `{x: 0.05, y: 0.35, w: 0.9, h: 0.3}`.

Fixed constants (not spec surface): line height 1.15, region padding 4% per side, shrink floor (classic 0.028 x H, absolute floor 12px). Text wraps automatically; explicit newlines collapse to spaces.

## Worked Examples

### Classic Macro (Flags, No Spec Needed)

```sh
render.ts photo.jpg --top "I'm telling you" --bottom "the tests pass on my machine" -o tmp/pepe-silvia-works-on-my-machine.png
```

### TV Subtitle (Flags)

```sh
render.ts still.jpeg --subtitle "♪ workin' hard for the money ♪" -o tmp/dolly-would-approve.png
```

Renders yellow bottom-center subtitle text. Unicode like ♪ works in both flags and specs.

### Two-Panel Labels (Jim's Whiteboard, 421x475)

One label box per whiteboard panel, regions traced from the Read image:

```json
{
  "boxes": [
    {
      "text": "just one more refactor",
      "preset": "label",
      "region": { "x": 0.06, "y": 0.07, "w": 0.44, "h": 0.3 }
    },
    {
      "text": "and the codebase will be clean",
      "preset": "label",
      "region": { "x": 0.08, "y": 0.57, "w": 0.46, "h": 0.26 }
    }
  ]
}
```

### Drake Format (Two Right-Half Rows)

```json
{
  "boxes": [
    { "text": "rejected option", "preset": "label", "region": { "x": 0.52, "y": 0.05, "w": 0.45, "h": 0.4 } },
    { "text": "preferred option", "preset": "label", "region": { "x": 0.52, "y": 0.55, "w": 0.45, "h": 0.4 } }
  ]
}
```

### Caption Bar Plus Overlay Text

```json
{
  "captions": [{ "text": "staging and production", "position": "top" }],
  "boxes": [{ "text": "They're the same picture.", "preset": "subtitle" }]
}
```

The caption bar expands the canvas; the subtitle box still positions relative to the original image.
