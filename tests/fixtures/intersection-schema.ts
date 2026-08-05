import * as v from "valibot";

const BaseSchema = v.object({
  id: v.string(),
});

const TimestampSchema = v.object({
  createdAt: v.date(),
  updatedAt: v.date(),
});

const MetadataSchema = v.object({
  version: v.number(),
});

/**
 * Intersection using v.intersect
 */
export const EntitySchema = v.intersect([BaseSchema, TimestampSchema]);

/**
 * Merging by spreading entries (Valibot has no `.merge()`)
 */
export const MergedSchema = v.object({
  ...BaseSchema.entries,
  ...TimestampSchema.entries,
});

/**
 * Intersection of three schemas
 */
export const AndSchema = v.intersect([BaseSchema, MetadataSchema]);
