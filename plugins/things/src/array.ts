/**
 * JXA arrays (like the result of list.toDos()) are not JavaScript arrays.
 * They have .length and can be indexed, but don't have .filter(), .map(), etc.
 */
export interface JXAArray<T> {
  length: number;
  [index: number]: T;
}
