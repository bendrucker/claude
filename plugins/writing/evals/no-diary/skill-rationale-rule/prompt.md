this skill section reads like a diary, clean it up

---
## Quoting

Quote every shell argument with single quotes. We used double quotes until the March incident, when a branch named `fix-$HOME` expanded to a path and a cleanup step deleted the wrong directory. Single quotes stop the shell expanding `$`, backticks, and `!` inside the argument, so apply them to any value that came from a user, a branch name, or a file path. This rule was added after a long discussion in #88.
---
