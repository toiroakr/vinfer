import * as v from "valibot";

/**
 * Multiple exported schemas in a single file.
 * Used to test schema detection and multi-schema extraction.
 */

export const UserSchema = v.object({
  id: v.string(),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
});

export const PostSchema = v.object({
  id: v.string(),
  title: v.string(),
  content: v.string(),
  authorId: v.string(),
  publishedAt: v.optional(v.date()),
});

export const CommentSchema = v.object({
  id: v.string(),
  content: v.string(),
  postId: v.string(),
  authorId: v.string(),
  createdAt: v.date(),
});

/**
 * Non-exported schema - should NOT be exported in the generated output
 */
const InternalHelperSchema = v.object({
  internal: v.boolean(),
});

/**
 * Schema with transform - input and output types differ
 */
export const DateStringSchema = v.object({
  date: v.pipe(
    v.string(),
    v.transform((s) => new Date(s)),
  ),
});

// Re-export for testing (should still be detected only once)
export { InternalHelperSchema as AliasedSchema };
