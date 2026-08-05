import * as v from "valibot";
import { SharedSchema } from "#src/shared.js";

export const DescribedNamedConsumerSchema = v.object({
  shared: SharedSchema,
  name: v.pipe(v.string(), v.description("The user's name")),
});
