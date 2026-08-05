import * as v from "valibot";

// Root-level branded string
export const UserIdSchema = v.pipe(v.string(), v.brand("UserId"));

// Object with branded fields in several positions
export const UserSchema = v.object({
  id: v.pipe(v.string(), v.brand("UserId")),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
  score: v.pipe(v.number(), v.brand("Score")),
  tags: v.array(v.pipe(v.string(), v.brand("Tag"))),
  optionalTag: v.optional(v.pipe(v.string(), v.brand("Tag"))),
  lookup: v.record(v.string(), v.pipe(v.string(), v.brand("Tag"))),
});

// Flavored types behave like brands, but only nominally
export const EmailSchema = v.pipe(v.string(), v.email(), v.flavor("Email"));
