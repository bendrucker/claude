---
name: terraform
description: Working with Terraform configuration, CLI, modules, and providers. Use when writing or reviewing HCL configuration, managing infrastructure as code, debugging Terraform plans/applies, or working with Terraform-related tools.
---
# Terraform

## Version-Specific Guidance

**CRITICAL**: Before providing any language syntax or CLI advice, run `terraform version` to determine the project's Terraform version.

```bash
terraform version
```

Assume Terraform 1.12+ (current: 1.14). All standard features are available:
- Optional object attributes with defaults
- Built-in testing with `terraform test`
- `import` blocks for importing resources
- `check` blocks for runtime validation
- `removed` blocks for lifecycle management
- Provider functions

If the project uses Terraform < 1.12, note the version and check feature availability.

## Core Principles

### Formatting

Always format before committing:
```bash
terraform fmt -recursive
```

### File Organization

```
main.tf           # Primary resources
variables.tf      # Input variable declarations
outputs.tf        # Output value declarations
versions.tf       # Terraform and provider version constraints
terraform.tfvars  # Variable values (gitignored if sensitive)
```

For larger modules, split by logical component: `compute.tf`, `networking.tf`, `security.tf`, `data.tf`, `locals.tf`.

### Style

- Use 2-space indentation (enforced by `fmt`)
- Use snake_case for all identifiers
- Quote string values; leave boolean/number values unquoted
- Prefer implicit dependencies (attribute references) over explicit `depends_on`
- Use `for_each` for resource sets; `count` only for conditional creation
- Always declare variable types explicitly
- Mark sensitive outputs with `sensitive = true`

### Working with Terraform

- Work declaratively through configuration files (`.tf` files)
- Never execute write operations (`apply`, `destroy`, `import`, `state mv`, etc.)
- Provide commands as output for the user to run
- Read-only commands (`plan`, `validate`, `fmt`, `state list`, `show`) are safe to run
- When refactoring, use `moved` blocks instead of state manipulation

### State Management

- Never edit state files manually
- Never use `terraform state` write commands
- Use `import` blocks to import existing resources
- Use `removed` blocks to remove resources from state
- Use `moved` blocks to refactor resource addresses

### Security

- Never commit secrets to git
- Use variable validation for input constraints
- Scan configurations with `tfsec`, `checkov`, or `terrascan`

## Declarative Patterns

### Import Existing Resources

```hcl
import {
  to = aws_instance.web
  id = "i-1234567890abcdef0"
}
```

### Remove Resources from State

Without destroying infrastructure:
```hcl
removed {
  from = aws_instance.old
  lifecycle {
    destroy = false
  }
}
```

### Refactor Resource Addresses

```hcl
moved {
  from = aws_instance.old
  to   = aws_instance.new
}
```

## Detailed References

- **Language Patterns**: See `language.md` for HCL configuration patterns, variables, iteration, data sources, and locals
- **State**: See `state.md` for read-only state inspection and remote state data sources
- **Documentation**: See `docs.md` for navigating official Terraform documentation
- **Registry**: See `registry.md` for finding and using providers/modules
