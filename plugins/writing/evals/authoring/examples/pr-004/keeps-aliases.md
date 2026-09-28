---
fail: [keeps-aliases]
---
<out>
Title: Auto-generate provider blocks before `terraform validate`

Some modules need an extra provider block to satisfy `terraform validate`. Other repositories already generate that block by hand, so build it into the workflow instead so repository authors don't have to be aware of the specific quirks of this situation.
</out>
