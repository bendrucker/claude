Posting a comment feels sluggish right now. The new comment only appears after the server round trip finishes, so there's a visible delay between hitting submit and seeing the comment. Add optimistic updates so the comment shows up immediately and rolls back if the server rejects it.

Here is the relevant part of the frontend. It is a React + TypeScript app using TanStack Query (react-query v5) for data fetching, with a shared `apiClient` for HTTP calls.

```
src/
  api/
    client.ts          # apiClient.get/post wrappers around fetch
    comments.ts        # fetchComments(postId), createComment(postId, body)
  hooks/
    useComments.ts     # useQuery for the comments list
    usePostComment.ts  # useMutation hook (below)
  components/
    CommentList.tsx     # renders comments + the composer (below)
    CommentItem.tsx
    Composer.tsx        # textarea + submit button, calls onSubmit(body)
  types.ts             # Comment, NewComment
```

`hooks/usePostComment.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createComment } from "../api/comments";
import type { Comment } from "../types";

export function usePostComment(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string): Promise<Comment> =>
      createComment(postId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    },
  });
}
```

`components/CommentList.tsx`:

```tsx
import { useComments } from "../hooks/useComments";
import { usePostComment } from "../hooks/usePostComment";
import { CommentItem } from "./CommentItem";
import { Composer } from "./Composer";

export function CommentList({ postId }: { postId: string }) {
  const { data: comments = [], isLoading } = useComments(postId);
  const { mutate, isPending } = usePostComment(postId);

  if (isLoading) return <p>Loading comments…</p>;

  return (
    <section>
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
      <Composer disabled={isPending} onSubmit={(body) => mutate(body)} />
    </section>
  );
}
```

A `Comment` has `{ id: string; postId: string; body: string; author: string; createdAt: string }`. The server assigns `id`, `author`, and `createdAt`; the client only sends `body`. The comments query is keyed `["comments", postId]`. Only the comment posting flow needs this. Plan the implementation.
