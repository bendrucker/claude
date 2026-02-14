# Hooks

All hooks from `@raycast/utils`. Install with `npm install @raycast/utils`.

## useFetch

Fetch data from a URL with automatic JSON parsing:

```tsx
import { List } from "@raycast/api";
import { useFetch } from "@raycast/utils";

export default function Command() {
  const { isLoading, data } = useFetch<Item[]>("https://api.example.com/items");

  return (
    <List isLoading={isLoading}>
      {(data || []).map((item) => (
        <List.Item key={item.id} title={item.title} />
      ))}
    </List>
  );
}
```

With search and `keepPreviousData` to prevent flickering:

```tsx
const [query, setQuery] = useState("");
const { isLoading, data } = useFetch(
  `https://api.example.com/search?q=${encodeURIComponent(query)}`,
  { keepPreviousData: true, execute: query.length > 0 }
);
```

With pagination:

```tsx
const { isLoading, data, pagination } = useFetch(
  (options) => `https://api.example.com/items?page=${options.page + 1}`,
  {
    mapResult(result: PageResult) {
      return { data: result.items, hasMore: result.page < result.totalPages };
    },
    keepPreviousData: true,
    initialData: [],
  }
);

return <List isLoading={isLoading} pagination={pagination}>...</List>;
```

Key options: `keepPreviousData`, `initialData`, `execute`, `mapResult`, `parseResponse`, `onData`, `onError`.

## usePromise

Wrap any async function:

```tsx
import { usePromise } from "@raycast/utils";

const { isLoading, data, revalidate } = usePromise(
  async (projectId: string) => {
    const response = await fetch(`https://api.example.com/projects/${projectId}`);
    return response.json();
  },
  ["my-project"]
);
```

Key options: `execute`, `abortable` (pass a `useRef<AbortController>()` to cancel stale requests), `onData`, `onError`.

## useCachedPromise

Like `usePromise` with stale-while-revalidate caching across command runs:

```tsx
import { useCachedPromise } from "@raycast/utils";

const { isLoading, data } = useCachedPromise(
  async (repo: string) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`);
    return response.json();
  },
  ["raycast/extensions"],
  { keepPreviousData: true }
);
```

Cached data must be JSON-serializable. Returns cached data immediately, then revalidates in the background.

## useForm

Form state management with validation:

```tsx
import { useForm, FormValidation } from "@raycast/utils";

const { handleSubmit, itemProps, values, setValue, reset } = useForm<FormValues>({
  onSubmit(values) { /* handle submission */ },
  initialValues: { title: "", priority: "medium" },
  validation: {
    title: FormValidation.Required,
    email: (value) => {
      if (value && !value.includes("@")) return "Invalid email";
    },
  },
});
```

Spread `itemProps.<field>` onto form items. `handleSubmit` only fires `onSubmit` when all validations pass.

## useLocalStorage

Persistent key-value storage:

```tsx
import { useLocalStorage } from "@raycast/utils";

const { value: favorites, setValue: setFavorites, isLoading } = useLocalStorage<string[]>(
  "favorites",
  []
);

async function toggleFavorite(id: string) {
  const updated = favorites?.includes(id)
    ? favorites.filter((f) => f !== id)
    : [...(favorites || []), id];
  await setFavorites(updated);
}
```

Returns `value`, `setValue`, `removeValue`, and `isLoading`.

## useExec

Execute shell commands with stale-while-revalidate caching:

```tsx
import { useExec } from "@raycast/utils";

const { isLoading, data } = useExec("brew", ["info", "--json=v2", "--installed"], {
  parseOutput({ stdout }) {
    return JSON.parse(stdout).formulae;
  },
});
```

Key options: `shell` (boolean or path), `cwd`, `env`, `input`, `timeout` (default 10s), `encoding`, `parseOutput`, `keepPreviousData`, `execute`.
