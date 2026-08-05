import * as v from "valibot";

export const functionSchema: v.GenericSchema<Function, Function> = v.custom<Function>(
  (value) => typeof value === "function",
);
