import * as v from "valibot";

/**
 * Basic object schema where input and output types are identical.
 */
export const UserSchema = v.object({
  id: v.string(),
  name: v.string(),
  age: v.optional(v.number()),
});
