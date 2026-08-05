import * as v from "valibot";

/**
 * Schema with transform where input and output types differ.
 */
export const DateSchema = v.object({
  createdAt: v.pipe(
    v.string(),
    v.transform((s) => new Date(s)),
  ),
  count: v.pipe(
    v.string(),
    v.transform((s) => parseInt(s, 10)),
  ),
});
