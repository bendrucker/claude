Refine this into an issue:

After you open the delete dialog from a document viewer's kebab menu and cancel it, the whole page stops responding to clicks until you reload. The dialog closes but leaves `pointer-events: none` on `<body>`, because the kebab menu and the dialog both set it and the dialog's cleanup runs before the menu's.

Suggested fix and test from the investigation: render the dialog outside the menu so the menu unmounts first, and add a Playwright spec that opens the delete dialog from the viewer kebab, cancels, and asserts `document.body` has `pointer-events` of `auto`.

Files:
- components/viewer/ViewerMenu.tsx (kebab DropdownMenu renders DeleteDialog inside its content)
- components/dialogs/DeleteDialog.tsx (AlertDialog with Cancel and Delete)
- e2e/viewer.spec.ts (existing viewer specs)

Sources:
- Upstream report of the same nested menu and dialog bug: https://github.com/example-ui/primitives/issues/1241
