# Conflict Markers

Git conflict markers indicate where changes from different branches overlap.

## Format

```
<<<<<<< HEAD
Current branch content (ours)
=======
Incoming branch content (theirs)
>>>>>>> branch-name
```

## Marker Meanings

| Marker | Description |
|--------|-------------|
| `<<<<<<< HEAD` | Start of current branch content |
| `=======` | Separator between versions |
| `>>>>>>> branch` | End of incoming branch content |

## Extended Format (diff3)

With `merge.conflictStyle = diff3`:

```
<<<<<<< HEAD
Current branch content
||||||| parent
Original content before both changes
=======
Incoming branch content
>>>>>>> branch-name
```

The `|||||||` section shows the common ancestor, helping understand what each branch changed.

## Resolution

Remove all markers and keep the desired content:

```diff
-<<<<<<< HEAD
-Current branch content (ours)
-=======
 Incoming branch content (theirs)
->>>>>>> branch-name
```

Or combine both:

```diff
-<<<<<<< HEAD
 Current branch content (ours)
-=======
-Incoming branch content (theirs)
+Additional merged content
->>>>>>> branch-name
```
