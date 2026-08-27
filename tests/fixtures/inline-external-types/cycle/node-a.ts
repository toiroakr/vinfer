import type { NodeB } from "./node-b";

export type NodeA = {
  value: string;
  next?: NodeB;
};
