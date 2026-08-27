import * as v from "valibot";
import type { Wrapper } from "./wrapper";

export const TypeofQuerySchema: v.GenericSchema<Wrapper, Wrapper> = v.any();
