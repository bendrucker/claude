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

Assume modern Terraform (1.x). Key features by version:
- **1.0+**: Stability guarantees, no breaking changes within 1.x
- **1.3+**: Optional object attributes, `terraform test` command
- **1.5+**: `import` blocks (preferred over CLI import), `check` blocks
- **1.6+**: Test mocking, config-driven `remove` blocks
- **1.7+**: Enhanced `removed` block support, improved variable validation
- **1.8+**: Provider functions

If the project uses Terraform < 1.0, note the version and adjust recommendations accordingly, but optimize guidance for 1.x features.

## Core Principles

**Always format before committing**:
```bash
terraform fmt -recursive
```

**File organization**:
```
main.tf           # Primary resources
variables.tf      # Input variable declarations
outputs.tf        # Output value declarations
versions.tf       # Terraform and provider version constraints
terraform.tfvars  # Variable values (gitignored if sensitive)
```

For larger modules, split by logical component: `compute.tf`, `networking.tf`, `security.tf`, `data.tf`, `locals.tf`.

**Style**:
- Use 2-space indentation (enforced by `fmt`)
- Use snake_case for all identifiers
- Quote string values; leave boolean/number values unquoted
- Prefer implicit dependencies (attribute references) over explicit `depends_on`
- Use `for_each` for resource sets; `count` only for conditional creation
- Always declare variable types explicitly
- Mark sensitive outputs with `sensitive = true`

**Workflow**:
```bash
terraform init      # Initialize providers/modules
terraform validate  # Check syntax
terraform plan      # Preview changes
terraform apply     # Apply changes
```

**State management**:
- Never edit state files manually
- Use `import` blocks (1.5+) to import existing resources
- Use `terraform state` commands for state manipulation

**Security**:
- Never commit secrets to git
- Use variable validation for input constraints
- Scan configurations with `tfsec`, `checkov`, or `terrascan`

## Detailed References

- **Language Patterns**: See `language.md` for HCL configuration patterns, variables, iteration, data sources, and locals
- **Operations**: See `operations.md` for CLI workflows, modules, state management, testing, and troubleshooting
- **Documentation**: See `docs.md` for navigating official Terraform documentation
- **Registry**: See `registry.md` for finding and using providers/modules
