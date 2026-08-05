import * as v from "valibot";

export const SharedSchema = v.object({
  id: v.pipe(v.string(), v.description("Shared identifier")),
});
