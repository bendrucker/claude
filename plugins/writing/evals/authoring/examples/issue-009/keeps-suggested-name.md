---
fail: [keeps-suggested-name]
---
<out>
Title: Rename

Remote state refers to the process of fetching a complete Terraform state and extracting the outputs. Remote state describes the mechanism rather than the result. In Terraform `data.terraform_remote_state` and `data.tfe_outputs` can return the same data. This action acts like the latter, bypassing the generic concept of Terraform state/backends in favor of a Cloud-specific abstraction for outputs.
</out>
