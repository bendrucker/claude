# Components

All UI is built with React components from `@raycast/api`.

## List

Searchable list with built-in fuzzy filtering:

```tsx
import { List } from "@raycast/api";

export default function Command() {
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search items...">
      <List.EmptyView title="No Items Found" description="Try a different search" />
      <List.Section title="Recent">
        {items.map((item) => (
          <List.Item
            key={item.id}
            title={item.title}
            subtitle={item.category}
            icon={item.icon}
            accessories={[
              { tag: { value: item.status, color: Color.Green } },
              { date: item.updatedAt },
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser url={item.url} />
                <Action.CopyToClipboard content={item.url} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
```

Key props: `isLoading`, `searchBarPlaceholder`, `filtering` (boolean or `{ keepSectionOrder }`), `onSearchTextChange`, `isShowingDetail` (right-side detail panel), `searchBarAccessory` (dropdown filter), `pagination`.

## Grid

Image-focused layout with configurable columns:

```tsx
import { Grid } from "@raycast/api";

export default function Command() {
  return (
    <Grid columns={4} aspectRatio="16/9" isLoading={isLoading}>
      {images.map((img) => (
        <Grid.Item
          key={img.id}
          content={img.url}
          title={img.title}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url={img.url} />
            </ActionPanel>
          }
        />
      ))}
    </Grid>
  );
}
```

Key props: `columns` (1-8), `aspectRatio` (`"1"`, `"3/2"`, `"16/9"`, etc.), `fit` (`Grid.Fit.Contain` or `Grid.Fit.Fill`), `inset`.

## Detail

Renders CommonMark markdown with optional metadata:

```tsx
import { Detail } from "@raycast/api";

export default function Command() {
  return (
    <Detail
      isLoading={isLoading}
      markdown={`# Title\n\n${content}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Author" text={author} icon={authorIcon} />
          <Detail.Metadata.Link title="Repository" target={repoUrl} text="GitHub" />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="Tags">
            <Detail.Metadata.TagList.Item text="TypeScript" color={Color.Blue} />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={repoUrl} />
        </ActionPanel>
      }
    />
  );
}
```

## Form

Input forms with validation:

```tsx
import { Form, ActionPanel, Action, showToast, Toast } from "@raycast/api";
import { useForm, FormValidation } from "@raycast/utils";

interface FormValues {
  title: string;
  description: string;
  priority: string;
}

export default function Command() {
  const { handleSubmit, itemProps } = useForm<FormValues>({
    onSubmit(values) {
      showToast({ style: Toast.Style.Success, title: "Created", message: values.title });
    },
    validation: {
      title: FormValidation.Required,
      description: (value) => {
        if (value && value.length < 10) return "Must be at least 10 characters";
      },
    },
  });

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField title="Title" placeholder="Issue title" {...itemProps.title} />
      <Form.TextArea title="Description" placeholder="Describe the issue" {...itemProps.description} />
      <Form.Dropdown title="Priority" {...itemProps.priority}>
        <Form.Dropdown.Item value="high" title="High" />
        <Form.Dropdown.Item value="medium" title="Medium" />
        <Form.Dropdown.Item value="low" title="Low" />
      </Form.Dropdown>
    </Form>
  );
}
```

Form items: `TextField`, `TextArea`, `PasswordField`, `Checkbox`, `DatePicker`, `Dropdown`, `TagPicker`, `FilePicker`, `Separator`.

## ActionPanel

Actions are grouped in `ActionPanel`, optionally split into sections:

```tsx
<ActionPanel>
  <ActionPanel.Section title="Primary">
    <Action.Push title="View Details" target={<DetailView item={item} />} />
    <Action.OpenInBrowser url={item.url} />
  </ActionPanel.Section>
  <ActionPanel.Section title="Copy">
    <Action.CopyToClipboard title="Copy URL" content={item.url} />
    <Action.CopyToClipboard title="Copy Title" content={item.title} />
  </ActionPanel.Section>
</ActionPanel>
```

Built-in actions: `Action.Push` (navigation), `Action.OpenInBrowser`, `Action.CopyToClipboard`, `Action.Paste`, `Action.SubmitForm`, `Action.ShowInFinder`, `Action.Trash`.

Custom actions accept `title`, `icon`, `shortcut`, and `onAction`.

## Toasts

Show feedback with `showToast`:

```tsx
import { showToast, Toast } from "@raycast/api";

await showToast({ style: Toast.Style.Animated, title: "Loading..." });
await showToast({ style: Toast.Style.Success, title: "Done" });
await showToast({ style: Toast.Style.Failure, title: "Error", message: err.message });
```

## Navigation

Push views with `Action.Push` or `useNavigation().push()`. Pop with `useNavigation().pop()`. Return to root with `popToRoot()`.
