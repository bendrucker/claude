/**
 * JXA global functions available in osascript
 */

/** The Things3 sdef surface these scripts reach through, as JXA exposes it. */
type JXAThings3 = {
  lists: {
    byId(id: string): {
      toDos(): import("./array").JXAArray<import("./Things3").Things3.ToDo>;
    };
  };
};

declare function Application(name: string): JXAThings3;

declare namespace Application {
  function currentApplication(): unknown;
}

declare const console: {
  log(...args: unknown[]): void;
};

declare function encodeURIComponent(str: string): string;
