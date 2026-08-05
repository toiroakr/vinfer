import * as v from "valibot";
import { SharedSchema } from "./index.js";

// Uses a schema imported through re-exports
export const ReExportConsumerSchema = v.object({
  shared: SharedSchema,
  timestamp: v.date(),
});
