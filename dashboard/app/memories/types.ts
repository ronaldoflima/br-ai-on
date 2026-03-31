export type { MemoryType, Memory } from "../lib/memory-parser";

export interface Project {
  slug: string;
  name: string;
  memoryCount: number;
  path: string;
}
