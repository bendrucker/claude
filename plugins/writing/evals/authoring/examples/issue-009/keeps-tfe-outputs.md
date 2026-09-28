---
fail: [keeps-tfe-outputs]
---
<out>
Title: Rename

This action should be `terraform-cloud-outputs-action` or similar. Remote state refers to the process of fetching a complete Terraform state and extracting the outputs. Remote state describes the mechanism rather than the result, and this is different from what `data.terraform_remote_state` returns. This action bypasses the generic concept of Terraform state/backends in favor of a Cloud-specific abstraction for outputs.
</out>
