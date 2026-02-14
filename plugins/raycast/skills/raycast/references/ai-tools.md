# AI Tools

Tools are entry points that AI can call, defined in `src/tools/<name>.ts` and registered in the `tools` array in `package.json`.

## Basic Tool

```ts
// src/tools/get-todos.ts

type Input = {
  /** Filter by completion status */
  isCompleted?: boolean;
};

export default async function (input: Input) {
  const todos = await fetchTodos();
  if (input.isCompleted !== undefined) {
    return todos.filter((t) => t.isCompleted === input.isCompleted);
  }
  return todos;
}
```

The default export receives a typed `Input` object and returns a value. JSDoc comments on `Input` properties teach the AI when and how to use the tool.

## Confirmation

Export a `confirmation` function for operations with side effects:

```ts
// src/tools/delete-todo.ts
import { Tool } from "@raycast/api";

type Input = {
  /** The ID of the todo to delete */
  id: string;
};

export default async function (input: Input) {
  await deleteTodo(input.id);
  return { success: true };
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const todo = await getTodo(input.id);
  return {
    message: `Delete "${todo.title}"?`,
    info: [
      { name: "Title", value: todo.title },
      { name: "Created", value: todo.createdAt },
    ],
  };
};
```

Return `undefined` from the confirmation to skip it conditionally (e.g., when an action is non-destructive).

The confirmation object supports:
- **message**: User-facing confirmation prompt
- **info**: Array of `{ name, value }` pairs for context
- **style**: `Action.Style` for visual emphasis (e.g., `Action.Style.Destructive`)
- **image**: Preview image URL or file icon

## Extension-Level Instructions

Add `ai.instructions` in `package.json` for guidance that applies across all tools:

```json
{
  "ai": {
    "instructions": "When creating todos, always ask for a due date if not provided."
  }
}
```

## Evals

Test tools with evals in `package.json` or a separate `ai.yaml`:

```json
{
  "ai": {
    "evals": [
      {
        "input": "@my-ext what are my open todos",
        "mocks": {
          "get-todos": [
            { "id": "1", "isCompleted": false, "title": "Buy milk" }
          ]
        },
        "expected": [
          { "callsTool": "get-todos" }
        ]
      }
    ]
  }
}
```

- **input**: User prompt with `@extension-name` mention
- **mocks**: Keyed by tool name, provides return values
- **expected**: Assertions like `{ "callsTool": "tool-name" }`

Run evals with `npx ray evals`.
