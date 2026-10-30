# Rerere

With `rerere.enabled` set (`git config --global rerere.enabled true`), git records each manual resolution and reapplies it when the same conflict recurs. Check a reapplied resolution with `git diff` before staging it.

| Command | Purpose |
|---------|---------|
| `git rerere status` | Files with recorded resolutions |
| `git rerere diff` | What rerere would apply |
| `git rerere forget <file>` | Delete a recorded resolution |
