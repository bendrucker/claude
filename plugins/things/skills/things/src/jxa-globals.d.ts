/**
 * JXA global functions available in osascript
 */

declare function Application(name: string): any;

declare namespace Application {
  function currentApplication(): any;
}

declare const console: {
  log(...args: any[]): void;
};

declare function encodeURIComponent(str: string): string;
