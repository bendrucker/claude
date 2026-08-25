---
paths:
  - "**/*.tf"
  - "**/*.tfvars"
---

# Terraform

Run `terraform version` before giving language syntax or CLI advice. Assume 1.12+ (current 1.14) unless it reports older, which makes optional object attributes, `terraform test`, `import`/`check`/`removed` blocks, and provider functions available.

## Operations

- Work declaratively through `.tf` files.
- Never execute write operations (`apply`, `destroy`, `import`, `state mv`). Provide the command as output for the user to run.
- Read-only commands (`plan`, `validate`, `fmt`, `state list`, `show`) are safe to run.
- Run `terraform fmt -recursive` before committing.
- Never edit state files manually or use `terraform state` write commands. Use `import` blocks to import, `removed` blocks to drop from state, and `moved` blocks to refactor addresses.

```hcl
import {
  to = aws_instance.web
  id = "i-1234567890abcdef0"
}

# Remove from state without destroying infrastructure
removed {
  from = aws_instance.old
  lifecycle {
    destroy = false
  }
}

moved {
  from = aws_instance.old
  to   = aws_instance.new
}
```

## File Organization

```
main.tf           # Primary resources
variables.tf      # Input variable declarations
outputs.tf        # Output value declarations
versions.tf       # Terraform and provider version constraints
terraform.tfvars  # Variable values (gitignored if sensitive)
```

Split larger modules by logical component: `compute.tf`, `networking.tf`, `security.tf`, `data.tf`, `locals.tf`.

## Style

- 2-space indentation (enforced by `fmt`), snake_case identifiers.
- Quote string values; leave boolean and number values unquoted.
- Prefer implicit dependencies (attribute references) over explicit `depends_on`.
- Use `for_each` for resource sets, `count` only for conditional creation.
- Always declare variable types explicitly, and mark sensitive outputs with `sensitive = true`.
- Never commit secrets. Use variable validation for input constraints, and scan with `tfsec`, `checkov`, or `terrascan`.
