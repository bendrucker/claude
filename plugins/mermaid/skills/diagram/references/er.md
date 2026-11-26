# Entity-Relationship Diagram Reference

## Basic Syntax

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "appears in"
```

Quote a relationship label that contains spaces.

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

Attribute markers are `PK` (primary key), `FK` (foreign key), and `UK` (unique key).

## Relationship Cardinality

```
ENTITY1 <left-cardinality>--<right-cardinality> ENTITY2 : "label"
```

Left side | Right side | Meaning
----------|------------|--------
`\|o` | `o\|` | Zero or one
`\|\|` | `\|\|` | Exactly one
`}o` | `o{` | Zero or more
`}\|` | `\|{` | One or more
