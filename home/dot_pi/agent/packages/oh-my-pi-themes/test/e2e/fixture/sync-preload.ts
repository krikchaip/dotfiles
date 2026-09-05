const upstreamBase = process.env.PI_E2E_UPSTREAM_BASE;
if (!upstreamBase) throw new Error("PI_E2E_UPSTREAM_BASE is required");
const fetchMode = process.env.PI_E2E_FETCH_MODE ?? "ok";
const nativeFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const fixture = url.endsWith("/index.ts")
    ? "index"
    : url.endsWith("/themes/sample.json")
      ? "theme"
      : url.endsWith("/LICENSE")
        ? "license"
        : "missing";
  return nativeFetch(`${upstreamBase}${fixture}?mode=${encodeURIComponent(fetchMode)}`, init);
}) as typeof fetch;

if (process.env.PI_E2E_FAIL_STAGED_README === "1") {
  const originalWrite = Bun.write.bind(Bun);
  (Bun as unknown as { write: typeof Bun.write }).write = (async (
    destination: Parameters<typeof Bun.write>[0],
    data: Parameters<typeof Bun.write>[1],
    options?: Parameters<typeof Bun.write>[2],
  ) => {
    const path = String(destination);
    if (/\.themes-sync-[^/]+\/README\.md$/.test(path)) {
      return typeof data === "string" ? Buffer.byteLength(data) : 0;
    }
    return originalWrite(destination, data, options as never);
  }) as typeof Bun.write;
}
