---
type: llm
---
The hand-rolled `compare` treats a prerelease as greater than its release (`1.2.0-beta` sorts after `1.2.0`), compares prerelease tags as plain strings, accepts a leading `v`, and `parse` returns `null` for invalid input where a library may throw. The final reply names the differences between the old functions and the library's behavior that affect callers, at least the prerelease ordering, and says for each whether the old behavior was a bug the library fixes (asking the user to approve the change) or something kept through a wrapper. Fail when the reply calls the replacement equivalent and never mentions how prerelease versions now sort.
