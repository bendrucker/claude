import { z } from "zod";

export const CaseRecord = z.object({
  id: z.string(),
  host: z.string(),
  session_id: z.string(),
  project: z.string(),
  tags: z.array(z.string()),
  prefix: z.string(),
  redirect: z.string(),
  original_plan: z.string(),
});
export type CaseRecord = z.infer<typeof CaseRecord>;

export const CaseFile = z.array(CaseRecord);
