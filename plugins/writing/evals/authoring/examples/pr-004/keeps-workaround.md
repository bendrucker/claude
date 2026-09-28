---
fail: [keeps-workaround]
---
<out>
Title: Automatically populate configuration aliases before `terraform validate`

When a module has configuration aliases, automatically generate the matching `provider` block to satisfy `terraform validate`, so authors don't have to be aware of the specific quirks of this situation.
</out>
