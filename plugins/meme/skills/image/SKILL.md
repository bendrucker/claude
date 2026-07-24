---
name: image
description: Generate a meme by overlaying text on an image. Use when asked to make a meme, caption an image, add meme text, or produce classic Impact macros, TV-subtitle stills, white-bar captions, or multi-label formats (Drake, distracted boyfriend, whiteboard).
argument-hint: "[image-path] [meme text or idea]"
allowed-tools:
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render.ts:*)"
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render.ts:*)"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/image/scripts/setup.ts"
          once: true
---

# Meme Image

Overlay meme text on an image with a deterministic renderer. You judge layout, placement, and legibility; the script guarantees the classic look (Impact stroke, subtitle yellow, caption bars).

## Workflow

1. Resolve the image. Use the user's path directly. If they name a meme format instead of a path, check the template library first (below). Otherwise WebSearch for the image and download with `curl -L -o tmp/<name>.jpg <url>`. Never pass a URL to the renderer.
2. Read the image. Note the subjects, where faces and action are, contrast, and aspect ratio.
3. Choose a mode:
   - Top/bottom macro text: `--top` / `--bottom`
   - TV-subtitle quote (yellow, bottom center): `--subtitle`
   - White bar above or below the image: `--caption` (optionally `--caption-position top|bottom`, default top)
   - Multi-label formats or custom placement: write a JSON spec file. Read [references/spec.md](references/spec.md) first.
4. Pick the output filename. It is part of the joke: witty and meme-relevant, kebab or snake case, `.png`. Never `meme.png` or another generic name. If the user supplies a filename, use theirs.
5. Render, then Read the output PNG. Check legibility, that text does not cover key subjects, line-break placement, and any fit warnings on stderr. Adjust and re-render until it reads well.
6. Deliver: copy the file reference to the clipboard so a paste keeps the filename:

   ```sh
   osascript -e 'set the clipboard to POSIX file "<absolute output path>"'
   ```

   Report the path. If the clipboard copy is declined or fails, reveal the file instead: `open -R <path>`.

## Template Library

`${CLAUDE_PLUGIN_DATA}/templates/` holds the user's meme templates, synced outside git. Never copy its images into the repo. Each image may have a sidecar spec of the same basename (`drake.jpg` + `drake.json`): a ready-made layout whose `text` values are `<slot descriptions>` and whose `description` says how the format works.

- User names a format: `ls` the library and match by filename. With a sidecar, copy it to `tmp/`, replace each slot with the actual joke, and render with `--spec`. Panel counts matter: fill every slot the joke needs and drop boxes the format leaves empty.
- No sidecar (new template): Read the image, trace regions, render, iterate. Once the layout looks right, save it back as a sidecar with `<slot description>` placeholders so the next use skips the tracing.

## Rendering

```sh
bun ${CLAUDE_SKILL_DIR}/scripts/render.ts <image> [flags] -o tmp/<joke-name>.png
```

| Flag | Meaning |
|------|---------|
| `--top`, `--bottom` | Classic Impact macro text |
| `--subtitle` | TV-subtitle text at the bottom |
| `--caption` | White-bar caption (expands the canvas); `--caption-position top\|bottom` |
| `--spec`, `-s` | JSON layout spec file (mutually exclusive with the text flags) |
| `--out`, `-o` | Output PNG path (always required) |

On success the script prints the absolute output path. Fit problems are warnings, not errors: the text still renders at the shrink floor. Treat every warning as a cue to shorten text or enlarge its region.

## Gotchas

- Web search returns template *pages*, not image files, and meme-site pages are often JS-rendered so the image URL is not in the static HTML. Imgflip: the direct image is `https://i.imgflip.com/<id36>.jpg` where `<id36>` is the numeric template ID from the page URL in base36 (`(55311130).toString(36)` → `wxica`). Always `file` the download to confirm it is an image before rendering.
- Multi-panel formats: set `"linkFontSizes": true` in the spec so all panels share one font size instead of each fitting independently.
- Images narrower than 400px are auto-upscaled 2x before drawing, so tiny templates still get readable text. Expect output dimensions to differ from the input.
- Spec coordinates and font sizes are normalized (0-1 fractions of image dimensions). Judge placement from the Read image in fractions, not pixels: Read may downscale.
