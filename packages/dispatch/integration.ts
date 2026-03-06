export type Mode = "plan" | "review" | "prefill";

export type Source = { type: string; [key: string]: unknown };
export type FetchedContext = { type: string; source: Source; [key: string]: unknown };

export interface Integration {
  type: string;
  mode: "plan" | "review";
  parse(url: string): Source | null;
  fetch(source: Source): Promise<FetchedContext>;
  format(context: FetchedContext): string;
  resolveRepo(context: FetchedContext): Promise<string>;
}
