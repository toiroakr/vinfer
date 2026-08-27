import * as v from "valibot";
import type { Wrapper } from "./wrapper";

export const QualifiedSchema: v.GenericSchema<Wrapper, Wrapper> = v.any();
