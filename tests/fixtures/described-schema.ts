import * as v from "valibot";

/**
 * Schema with field descriptions using v.description()
 */
export const UserSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.uuid(), v.description("Unique user identifier")),
    name: v.pipe(v.string(), v.minLength(1), v.description("User's display name")),
    email: v.pipe(v.string(), v.email(), v.description("User's email address")),
    age: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(1), v.description("User's age in years")),
    ),
    role: v.pipe(
      v.picklist(["admin", "user", "guest"]),
      v.description("User's role in the system"),
    ),
  }),
  v.description("User account information"),
);

/**
 * Schema with nested object descriptions
 */
export const AddressSchema = v.object({
  street: v.pipe(v.string(), v.description("Street address")),
  city: v.pipe(v.string(), v.description("City name")),
  country: v.pipe(v.string(), v.description("Country code (ISO 3166-1 alpha-2)")),
  zipCode: v.pipe(v.optional(v.string()), v.description("Postal/ZIP code")),
});

/**
 * Schema with nested objects
 */
export const ProfileSchema = v.object({
  user: v.pipe(UserSchema, v.description("User information")),
  address: v.pipe(v.optional(AddressSchema), v.description("User's primary address")),
  tags: v.pipe(v.array(v.string()), v.description("User tags for categorization")),
});

/**
 * v.metadata({ description }) is honored as well
 */
export const MetadataDescribedSchema = v.object({
  token: v.pipe(v.string(), v.metadata({ description: "Opaque access token" })),
});
