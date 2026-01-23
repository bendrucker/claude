/**
 * JXA arrays (like the result of list.toDos()) are not JavaScript arrays.
 * They have .length and can be indexed, but don't have .filter(), .map(), etc.
 *
 * This helper converts JXA arrays to JavaScript arrays so you can use
 * normal array methods.
 */

export interface JXAArray<T> {
  length: number;
  [index: number]: T;
}

/**
 * Convert a JXA array to a JavaScript array
 *
 * @example
 * const list = app.lists.byId("TMTodayListSource");
 * const todos = toArray<Things3.ToDo>(list.toDos());
 * const filtered = todos.filter(t => t.notes().length > 0);
 */
export function toArray<T>(jxaArr: JXAArray<T>): T[] {
  const arr: T[] = [];
  for (let i = 0; i < jxaArr.length; i++) {
    arr.push(jxaArr[i] as T);
  }
  return arr;
}
