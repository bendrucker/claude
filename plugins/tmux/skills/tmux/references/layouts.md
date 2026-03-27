# Layout Presets

## sidebar-right

30% commander on the left, 70% main area on the right.

```
┌──────────┬────────────────────────┐
│          │                        │
│ commander│        main            │
│  (30%)   │        (70%)           │
│          │                        │
└──────────┴────────────────────────┘
```

```bash
bun plugins/tmux/scripts/layout.ts sidebar-right
```

```json
{
  "preset": "sidebar-right",
  "panes": [
    { "id": "%0", "position": "left" },
    { "id": "%1", "position": "right" }
  ]
}
```

## sidebar-left

70% main area on the left, 30% commander on the right.

```
┌────────────────────────┬──────────┐
│                        │          │
│        main            │ commander│
│        (70%)           │  (30%)   │
│                        │          │
└────────────────────────┴──────────┘
```

```bash
bun plugins/tmux/scripts/layout.ts sidebar-left
```

## stack-right

30% sidebar on the left, n stacked panes on the right.

```
┌──────────┬────────────────────────┐
│          │       right-0          │
│          ├────────────────────────┤
│ commander│       right-1          │
│  (30%)   ├────────────────────────┤
│          │       right-2          │
└──────────┴────────────────────────┘
```

```bash
bun plugins/tmux/scripts/layout.ts stack-right --count 3
```

```json
{
  "preset": "stack-right",
  "panes": [
    { "id": "%0", "position": "left" },
    { "id": "%1", "position": "right-0" },
    { "id": "%2", "position": "right-1" },
    { "id": "%3", "position": "right-2" }
  ]
}
```

## grid-2x2

Four equal panes.

```
┌────────────────┬────────────────┐
│                │                │
│   top-left     │   top-right    │
│                │                │
├────────────────┼────────────────┤
│                │                │
│  bottom-left   │  bottom-right  │
│                │                │
└────────────────┴────────────────┘
```

```bash
bun plugins/tmux/scripts/layout.ts grid-2x2
```

## main-bottom

75% top, 25% bottom.

```
┌─────────────────────────────────┐
│                                 │
│            top (75%)            │
│                                 │
├─────────────────────────────────┤
│          bottom (25%)           │
└─────────────────────────────────┘
```

```bash
bun plugins/tmux/scripts/layout.ts main-bottom
```

## Common Options

All presets accept `--target <pane_id>` to specify the origin pane. Defaults to `$TMUX_PANE`.

Output is always JSON with the `preset` name and an array of `panes` with `id` and `position` fields. Use the pane IDs to register tracked panes or send commands.
