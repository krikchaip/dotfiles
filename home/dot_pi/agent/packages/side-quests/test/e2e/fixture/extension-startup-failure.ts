/**
 * Fails during selected extension startup before child readiness can succeed.
 */
export default function extensionStartupFailure(): never {
  throw new Error("E2E selected extension factory exploded");
}
