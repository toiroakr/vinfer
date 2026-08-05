import * as v from "valibot";

export const AsyncAddressSchema = v.objectAsync({
  street: v.string(),
});

export const AsyncUserSchema = v.objectAsync({
  name: v.string(),
  address: AsyncAddressSchema,
  addresses: v.arrayAsync(AsyncAddressSchema),
  nickname: v.optionalAsync(v.string()),
  age: v.pipeAsync(
    v.string(),
    v.transformAsync(async (value) => Number(value)),
  ),
});
