/**
 * Example: Get non-repeating todos from Today with notes
 */

import { toArray } from "./array";
import type { Things3 } from "./Things3";

const app = Application("Things3");
const list = app.lists.byId("TMTodayListSource");

const todos = toArray<Things3.ToDo>(list.toDos());

// Filter for non-repeating todos (creation date not at midnight)
const nonRepeating = todos.filter((t) => {
  const cd = t.creationDate();
  if (!cd) return true;
  return cd.getHours() !== 0 || cd.getMinutes() !== 0 || cd.getSeconds() !== 0;
});

const withNotes = nonRepeating.filter((t) => t.notes() && t.notes().length > 0);

const result = withNotes.map((t) => ({
  id: t.id(),
  name: t.name(),
  notes: t.notes(),
}));

console.log(JSON.stringify(result, null, 2));
