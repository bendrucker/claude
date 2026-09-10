# Bruh

Replaces `jargon`, which kept every claim the message made and so could only trade words for other words. Asking for shorter is what makes the skill worth typing. The context pass and the instruction to reuse names already in play come from `jargon`'s last revision (#1402).

## Prior Art

- [`bro`](https://github.com/dmmulroy/.dotfiles/blob/cdba491f1f9c952979af37f15e4c3efb26f625df/home/.agents/skills/bro/SKILL.md) by [Dillon Mulroy](https://github.com/dmmulroy). One sentence asking for the last message again, plainly and concisely, as one human to another. `jargon` came from this and dropped the concision half.
- [`wait-what`](https://github.com/mattpocock/skills/blob/5c89081d4bbeb3d039a42093653f90bb698d780e/skills/productivity/wait-what/SKILL.md) by [Matt Pocock](https://github.com/mattpocock), written up at [aihero.dev](https://www.aihero.dev/skills-wait-what). Frames the trigger as the listener losing the thread rather than as an instruction to be brief, on the argument that the first makes a model back up and explain while the second makes it write telegrams. It also reads project vocabulary from a `CONTEXT.md`. This reuses the names already in play instead, which needs no file.

Both are typed-entry only, as this is.

## Scope

Chat only. Where the target is a file, a PR body, or a review comment, `writing:no-diary` owns it and this hands off.
