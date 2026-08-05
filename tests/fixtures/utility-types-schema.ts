import * as v from "valibot";

const UserSchema = v.object({
  id: v.string(),
  name: v.string(),
  email: v.string(),
  age: v.number(),
});

/**
 * Partial - all fields optional
 */
export const PartialUserSchema = v.partial(UserSchema);

/**
 * Pick - select specific fields
 */
export const UserIdNameSchema = v.pick(UserSchema, ["id", "name"]);

/**
 * Omit - exclude specific fields
 */
export const UserWithoutEmailSchema = v.omit(UserSchema, ["email"]);

/**
 * Required - make all fields required (opposite of partial)
 */
export const RequiredUserSchema = v.required(v.partial(UserSchema));

/**
 * Keyof - the entry names as a picklist
 */
export const UserKeySchema = v.keyof(UserSchema);

/**
 * Nested objects
 */
export const NestedSchema = v.object({
  user: UserSchema,
  settings: v.object({
    theme: v.string(),
    notifications: v.boolean(),
  }),
});

/**
 * Deep partial (manual - Valibot's partial is shallow)
 */
export const DeepPartialNestedSchema = v.partial(
  v.object({
    user: v.partial(UserSchema),
    settings: v.partial(
      v.object({
        theme: v.string(),
        notifications: v.boolean(),
      }),
    ),
  }),
);
