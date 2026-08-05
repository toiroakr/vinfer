import * as v from "valibot";

/**
 * Valibot's wrapper schemas, which differ from Zod's chained modifiers.
 */
export const WrappedSchema = v.object({
  // Key may be missing or explicitly undefined
  optional: v.optional(v.string()),
  // Key may be missing, but not explicitly undefined
  exactOptional: v.exactOptional(v.string()),
  nullable: v.nullable(v.string()),
  nullish: v.nullish(v.string()),
  undefinedable: v.undefinedable(v.string()),
  required: v.string(),
});

/**
 * Defaults make the key optional on input and always present on output.
 */
export const DefaultedSchema = v.object({
  withDefault: v.optional(v.string(), "fallback"),
  withNullishDefault: v.nullish(v.number(), 0),
  withComputedDefault: v.optional(v.date(), () => new Date()),
});

/**
 * v.fallback() replaces invalid values, so the output type is unchanged.
 */
export const FallbackSchema = v.object({
  count: v.fallback(v.number(), 0),
});

/**
 * The non-* wrappers strip undefined / null back out.
 */
export const NonWrappedSchema = v.object({
  value: v.nonOptional(v.optional(v.string())),
  other: v.nonNullish(v.nullish(v.number())),
});
