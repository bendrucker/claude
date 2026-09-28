---
fail: [keeps-terraform-remote-state]
---
<out>
Title: Rename

This action should be `terraform-cloud-outputs-action` or similar. Remote state describes the mechanism rather than the result. `data.tfe_outputs` returns the same data this action fetches. This action bypasses the generic concept of Terraform state/backends in favor of a Cloud-specific abstraction for outputs.
</out>
