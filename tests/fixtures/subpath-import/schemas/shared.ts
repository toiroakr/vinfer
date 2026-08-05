import * as v from "valibot";

export const SharedSchema = v.object({
  id: v.string(),
  name: v.string(),
});

export const AnotherSharedSchema = v.object({
  value: v.number(),
});
