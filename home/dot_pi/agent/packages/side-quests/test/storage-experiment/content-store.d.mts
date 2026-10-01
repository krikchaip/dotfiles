/**
 * Identifies the process that must keep its prototype generation alive.
 */
export type Owner = Readonly<{
  /** Records the owning process, with conservative PID reuse handling. */
  pid: number;
  /** Separates independent leases held by the same process. */
  token: string;
}>;

/**
 * Describes a stored immutable generation in the test-only module.
 */
export type Generation = Readonly<{
  /** Identifies the generation directory. */
  id: string;
  /** Identifies the content independently of installation paths. */
  content: string;
  /** Supplies native module paths for the stored Package. */
  path: string;
}>;

/**
 * Captures an immutable generation inside the test-owned temporary directory.
 */
export function capture(
  source: string,
  root: string,
  owner: Owner,
  expected?: string,
): Generation;

/**
 * Hashes parent provenance without creating storage.
 */
export function prepare(
  source: string,
): Readonly<{ content: string; entries: readonly unknown[] }>;

/**
 * Keeps one saved owner independent of its parent process lease.
 */
export function pin(root: string, graph: string, session: string): void;

/**
 * Releases a test-owned process lease without removing saved ownership.
 */
export function release(root: string, graph: string, owner: Owner): void;

/**
 * Collects only proven-unreferenced prototype generations.
 */
export function collect(
  root: string,
): Readonly<{ removed: readonly string[]; blocked?: string }>;
