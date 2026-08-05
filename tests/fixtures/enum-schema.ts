import * as v from "valibot";

/**
 * Picklist of string literals
 */
export const DirectionSchema = v.picklist(["north", "south", "east", "west"]);

/**
 * Native enum (TypeScript enum)
 */
enum Color {
  Red = "red",
  Green = "green",
  Blue = "blue",
}

export const ColorSchema = v.enum(Color);

/**
 * Numeric native enum
 */
enum Priority {
  Low = 0,
  Medium = 1,
  High = 2,
}

export const PrioritySchema = v.enum(Priority);
