import * as v from "valibot";

/**
 * Validation actions never change the piped type.
 */
export const ValidatedSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(255)),
  slug: v.pipe(v.string(), v.regex(/^[a-z-]+$/), v.minLength(1)),
  count: v.pipe(v.number(), v.integer(), v.minValue(0)),
  items: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(10)),
  checked: v.pipe(
    v.string(),
    v.check((value) => value.length > 0),
  ),
});

/**
 * A pipe that ends in another schema is typed by that last schema.
 */
export const CoercedSchema = v.object({
  parsed: v.pipe(
    v.string(),
    v.transform((value) => Number(value)),
    v.number(),
    v.minValue(0),
  ),
});

/**
 * Metadata actions leave the type alone as well.
 */
export const AnnotatedSchema = v.object({
  id: v.pipe(v.string(), v.title("Identifier"), v.metadata({ internal: true })),
});
