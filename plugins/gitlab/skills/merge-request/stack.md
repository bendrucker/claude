# Stacked Diffs

`glab stack` manages stacked diffs—small changes that build on each other while earlier ones are under review.

## Workflow

```bash
glab stack create          # Initialize a new stack
glab stack save            # Save current changes to stack
glab stack sync            # Sync with remote (rebase, push)
glab stack list            # Show all changes in stack
```

## Navigation

```bash
glab stack first           # Go to first change
glab stack last            # Go to last change
glab stack next            # Next change
glab stack prev            # Previous change
glab stack switch          # Switch between stacks
```

## Reordering

```bash
glab stack move            # Move commits within stack
glab stack reorder         # Rearrange commit sequence
glab stack amend           # Modify existing stack commits
```

Use `glab stack --help` for full options. This feature is experimental.
