import * as v from "valibot";

export const MultilineSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.description("User name\nMust be unique")),
    age: v.optional(v.pipe(v.number(), v.description("Age in years"))),
  }),
  v.description("A schema with\nmultiline description"),
);
