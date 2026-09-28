---
fail: [keeps-quirk]
---
<out>
Title: Automatically populate configuration aliases before `terraform validate`

When a module has configuration aliases, automatically generate the matching `provider` block to satisfy `terraform validate`. We've used this approach in various repositories as needed, so build it into the workflow instead.
</out>
