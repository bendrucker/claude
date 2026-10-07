---
fail: []
---
<out>
Title: Automatically populate configuration aliases before `terraform validate`

When a module has [configuration aliases](https://www.terraform.io/language/modules/develop/providers#provider-aliases-within-modules), automatically generate appropriate `provider` blocks to satisfy `terraform validate`. We've used this approach in various repositories as needed but might as well enable it at the workflow level so repository authors don't have to be aware of the specific quirks of this situation.
</out>
