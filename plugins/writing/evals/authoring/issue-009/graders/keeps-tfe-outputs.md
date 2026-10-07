---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?tfe.{0,3}outputs'
flags: i
match: contains
---
The comparison to Terraform's data.tfe_outputs data source.
