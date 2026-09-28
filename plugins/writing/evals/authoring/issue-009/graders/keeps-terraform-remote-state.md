---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?terraform.{0,3}remote.{0,3}state'
flags: i
match: contains
---
The comparison to Terraform's data.terraform_remote_state data source.
