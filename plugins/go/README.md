# Go Plugin

Go language coding standards, best practices, and testing patterns for Claude Code.

## Contents

- **Skill**: Guidance on Go coding conventions, table-style tests, and language features
- **Hook**: Blocks modification of generated Go files (files with `// Code generated ... DO NOT EDIT.` marker)

## Activation

The skill activates when working with Go code, `go.mod` files, or discussing Go language features.

The hook runs on Edit, MultiEdit, and Write operations targeting `.go` files.

## Testing

```bash
cd plugins/go && shellspec spec.sh
```
