/**
 * Things URL Scheme type definitions
 * Used for validating url.js via TypeScript
 */

/** Commands that require auth-token */
export type AuthRequiredCommand = "update" | "update-project" | "json";

/** Commands that don't require auth-token */
export type PublicCommand = "add" | "add-project" | "show" | "search" | "version";

/** All valid Things URL scheme commands */
export type Command = AuthRequiredCommand | PublicCommand;

/** When values for scheduling */
export type WhenValue = "today" | "tomorrow" | "evening" | "anytime" | "someday" | string; // Also accepts ISO dates, natural language

/** Parameters for 'add' command */
export interface AddParams {
  title?: string;
  titles?: string;
  notes?: string;
  when?: WhenValue;
  deadline?: string;
  tags?: string;
  "checklist-items"?: string;
  list?: string;
  "list-id"?: string;
  heading?: string;
  "heading-id"?: string;
  completed?: "true" | "false";
  canceled?: "true" | "false";
  reveal?: "true" | "false";
}

/** Parameters for 'add-project' command */
export interface AddProjectParams {
  title?: string;
  notes?: string;
  when?: WhenValue;
  deadline?: string;
  tags?: string;
  area?: string;
  "area-id"?: string;
  "to-dos"?: string;
  completed?: "true" | "false";
  canceled?: "true" | "false";
  reveal?: "true" | "false";
}

/** Parameters for 'update' command */
export interface UpdateParams {
  id: string;
  "auth-token": string;
  title?: string;
  notes?: string;
  "prepend-notes"?: string;
  "append-notes"?: string;
  when?: WhenValue;
  deadline?: string;
  tags?: string;
  "add-tags"?: string;
  "checklist-items"?: string;
  "prepend-checklist-items"?: string;
  "append-checklist-items"?: string;
  list?: string;
  "list-id"?: string;
  heading?: string;
  "heading-id"?: string;
  completed?: "true" | "false";
  canceled?: "true" | "false";
  duplicate?: "true" | "false";
  reveal?: "true" | "false";
}

/** Parameters for 'update-project' command */
export interface UpdateProjectParams extends UpdateParams {
  area?: string;
  "area-id"?: string;
}

/** Parameters for 'show' command */
export interface ShowParams {
  id?: string;
  query?: string;
  filter?: string;
}

/** Parameters for 'search' command */
export interface SearchParams {
  query?: string;
}

/** Parameters for 'json' command */
export interface JsonParams {
  "auth-token"?: string;
  data: string;
  reveal?: "true" | "false";
}

/** Map of commands to their parameter types */
export interface CommandParamsMap {
  add: AddParams;
  "add-project": AddProjectParams;
  update: UpdateParams;
  "update-project": UpdateProjectParams;
  show: ShowParams;
  search: SearchParams;
  json: JsonParams;
  version: Record<string, never>;
}

/** JXA Application with standard additions */
export interface JXAApplication {
  includeStandardAdditions: boolean;
  doShellScript(command: string): string;
  openLocation(url: string): void;
}

/** Built-in list IDs for 'show' command */
export type BuiltInListId =
  | "inbox"
  | "today"
  | "anytime"
  | "upcoming"
  | "someday"
  | "logbook"
  | "tomorrow"
  | "deadlines"
  | "repeating"
  | "all-projects"
  | "logged-projects";
