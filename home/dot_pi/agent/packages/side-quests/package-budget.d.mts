import type { Stats } from "node:fs";

export declare const PUBLICATION_BYTES: number;

export declare function resourceBudget(): number;

export declare function entryBytes(stat: Stats): number;

export declare function treeBytes(
  root: string,
  limit: number,
  dereference?: boolean,
  inodes?: Set<string>,
): number;

export declare function withResourceAllocation<T>(
  agentDirectory: string,
  run: () => T,
): T;

export declare function reserveContent(
  agentDirectory: string,
  required: number,
  metadata?: number,
): number;
