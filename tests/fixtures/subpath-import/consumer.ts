import * as v from "valibot";
import { SharedSchema, AnotherSharedSchema } from "#/shared.js";

export const ConsumerSchema = v.object({
  shared: SharedSchema,
  another: AnotherSharedSchema,
  extra: v.boolean(),
});
