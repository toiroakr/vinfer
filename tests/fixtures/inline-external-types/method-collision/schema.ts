import * as v from "valibot";
import type { Wrapper } from "./wrapper";

export const MethodCollisionSchema: v.GenericSchema<Wrapper, Wrapper> = v.any();
