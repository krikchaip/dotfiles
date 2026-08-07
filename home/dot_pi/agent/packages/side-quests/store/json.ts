import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/** The schema version shared by Side Quests persisted state files. */
export const STORE_VERSION = 1;

/**
 * Provides private, atomic JSON file operations for Side Quests stores.
 */
export class JsonStore {
  /**
   * Writes JSON through a private temporary file and atomic rename.
   */
  public static write(path: string, value: unknown): void {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;

    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);

    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporary, path);
      chmodSync(path, 0o600);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  /**
   * Reads a JSON object record, or returns nothing for an invalid value.
   */
  public static readRecord(path: string): Record<string, unknown> | undefined {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Reports whether a file exists at an exact path.
   */
  public static exists(path: string): boolean {
    return existsSync(path);
  }

  /**
   * Deletes a file while tolerating a concurrent or prior deletion.
   */
  public static remove(path: string): void {
    if (existsSync(path)) unlinkSync(path);
  }
}
