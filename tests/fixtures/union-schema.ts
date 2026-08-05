import * as v from "valibot";

/**
 * Union type schema - literal union
 */
export const StatusSchema = v.union([
  v.literal("active"),
  v.literal("inactive"),
  v.literal("pending"),
]);

/**
 * Variant schema (Valibot's discriminated union)
 */
export const ResultSchema = v.variant("type", [
  v.object({ type: v.literal("success"), data: v.string() }),
  v.object({ type: v.literal("error"), message: v.string() }),
]);

/**
 * Simple union of different types
 */
export const StringOrNumberSchema = v.union([v.string(), v.number()]);

/**
 * Picklist - the idiomatic literal union
 */
export const RoleSchema = v.picklist(["admin", "user", "guest"]);
