---
paths:
  - "**/*.tf"
  - "**/*.tfvars"
---

# Terraform

Run `terraform version` before giving syntax or CLI advice. Assume 1.12 or newer unless it reports older.

## Operations

- Run read-only commands (`plan`, `validate`, `fmt`, `state list`, `show`) freely.
- Never run a write operation (`apply`, `destroy`, `import`, `state mv`). Print the command for the user to run instead.
- Run `terraform fmt -recursive` before committing.
- Change state only through blocks, never by editing state files. Use `import` to adopt, `moved` to rename an address, and `removed` with `lifecycle { destroy = false }` to drop from state without destroying.

## Style

- Prefer attribute references over explicit `depends_on`.
- Use `for_each` for sets of resources. Use `count` only for conditional creation.
- Declare every variable's type. Mark sensitive outputs `sensitive = true`.
