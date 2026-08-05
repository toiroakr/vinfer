import * as v from "valibot";
import { SharedSchema } from "#/shared";

export const SuffixConsumerSchema = v.object({
  shared: SharedSchema,
  name: v.pipe(v.string(), v.description("The user's name")),
});
