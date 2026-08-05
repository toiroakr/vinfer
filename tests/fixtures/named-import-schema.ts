// Named-import style: `import { object, string } from "valibot"` instead of a
// namespace import. Schema detection and reference analysis must work the same.
import { array, boolean, number, object, optional, pipe, string, transform } from "valibot";

export const NamedAddressSchema = object({
  street: string(),
  city: string(),
});

export const NamedUserSchema = object({
  name: string(),
  active: boolean(),
  address: NamedAddressSchema,
  previousAddresses: optional(array(NamedAddressSchema)),
  visits: pipe(
    string(),
    transform((value) => Number(value)),
  ),
  score: optional(number()),
});
