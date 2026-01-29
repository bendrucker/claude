# Entity-Relationship Diagram Reference

## Basic Syntax

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "appears in"
```

## Entities

Define entities with attributes:

```mermaid
erDiagram
    CUSTOMER {
        int id PK
        string name
        string email UK
        datetime created_at
    }

    ORDER {
        int id PK
        int customer_id FK
        decimal total
        string status
    }
```

Attribute markers:
- `PK` — Primary key
- `FK` — Foreign key
- `UK` — Unique key

## Relationship Cardinality

Left side | Right side | Meaning
----------|------------|--------
`\|o` | `o\|` | Zero or one
`\|\|` | `\|\|` | Exactly one
`}o` | `o{` | Zero or more
`}\|` | `\|{` | One or more

## Relationship Syntax

```
ENTITY1 <left-cardinality>--<right-cardinality> ENTITY2 : "label"
```

Examples:

| Syntax | Meaning |
|--------|---------|
| `\|\|--\|\|` | One to one |
| `\|\|--o{` | One to zero or more |
| `\|\|--\|{` | One to one or more |
| `o\|--o{` | Zero or one to zero or more |

## Example: Blog Schema

```mermaid
erDiagram
    USER {
        int id PK
        string username UK
        string email UK
        string password_hash
        datetime created_at
    }

    POST {
        int id PK
        int author_id FK
        string title
        text content
        datetime published_at
        string status
    }

    COMMENT {
        int id PK
        int post_id FK
        int user_id FK
        text content
        datetime created_at
    }

    TAG {
        int id PK
        string name UK
    }

    POST_TAG {
        int post_id FK
        int tag_id FK
    }

    USER ||--o{ POST : writes
    USER ||--o{ COMMENT : writes
    POST ||--o{ COMMENT : has
    POST ||--o{ POST_TAG : tagged
    TAG ||--o{ POST_TAG : tags
```

## Best Practices

- Use uppercase for entity names (convention)
- Include key markers (PK, FK, UK) for clarity
- Use quoted labels when relationship names have spaces
- Group related entities visually
- Show only essential attributes—full schemas belong in docs
