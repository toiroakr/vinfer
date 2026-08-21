// An explicit `v.GenericSchema<T>` annotation is printed as written, so
// Weird's own `typeof NodeSchemaInput` and `NodeSchemaInput(): string` land
// verbatim in this file's generated output - text that happens to spell out
// "NodeSchemaInput", the Input name NodeSchema below generates, without
// being a reference to it at all.
import * as v from "valibot";
import type { Weird } from "./typeof-and-method-name-collision-types";

export const NodeSchema = v.object({ label: v.string() });

export const WeirdSchema: v.GenericSchema<Weird, Weird> = v.any();
