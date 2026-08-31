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
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The schema version shared by Side Quests persisted state files. */
export const STORE_VERSION = 1;

/**
 * Provides private, atomic JSON file operations for Side Quests stores.
 */
export class JsonStore {
  /**
   * Writes one JSON value through a private temporary file and atomic rename.
   */
  public static write(path: string, value: unknown): void {
    JsonStore.writeText(path, `${JSON.stringify(value)}\n`);
  }

  /**
   * Writes JSON Lines through a private temporary file and atomic rename.
   */
  public static writeLines(path: string, values: readonly unknown[]): void {
    JsonStore.writeText(
      path,
      `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    );
  }

  /**
   * Writes one JSON value asynchronously through an atomic rename.
   */
  public static async writeAsync(path: string, value: unknown): Promise<void> {
    await JsonStore.writeTextAsync(path, `${JSON.stringify(value)}\n`);
  }

  /**
   * Writes pre-serialized private text asynchronously through an atomic rename.
   */
  public static async writeTextAsync(
    path: string,
    content: string,
  ): Promise<void> {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const directory = dirname(path);

    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await unlink(temporary).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOENT") throw cause;
      });
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

  /**
   * Writes private text through a temporary file and atomic rename.
   */
  private static writeText(path: string, content: string): void {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;

    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);

    try {
      writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, path);
      chmodSync(path, 0o600);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
