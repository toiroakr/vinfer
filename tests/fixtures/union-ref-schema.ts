import * as v from "valibot";

/**
 * Individual member schemas for union
 */
export const DogSchema = v.object({
  kind: v.literal("dog"),
  name: v.string(),
  breed: v.string(),
});

export const CatSchema = v.object({
  kind: v.literal("cat"),
  name: v.string(),
  indoor: v.boolean(),
});

export const BirdSchema = v.object({
  kind: v.literal("bird"),
  name: v.string(),
  canFly: v.boolean(),
});

/**
 * Variant using schema references
 */
export const PetSchema = v.variant("kind", [DogSchema, CatSchema, BirdSchema]);

/**
 * Regular union using schema references
 */
export const AnimalSchema = v.union([DogSchema, CatSchema]);
