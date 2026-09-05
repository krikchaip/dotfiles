import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RealDate = Date;
const fixedTime = new RealDate("2026-01-02T03:04:05.678Z").valueOf();

export function restoreDate(): void {
  globalThis.Date = RealDate;
}

export default function installCollisionPrepare(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    const index = Number(process.env.PROVIDER_PAYLOAD_DEBUG_COLLISION_INDEX);
    (event.payload as Record<string, unknown>).collisionIndex = index;
    Object.defineProperty(ctx.sessionManager, "getSessionId", {
      configurable: true,
      value: () => "provider-payload-debug-collision-session",
    });
    globalThis.Date = class extends RealDate {
      constructor(value?: string | number) {
        super(value ?? fixedTime);
      }

      static now(): number {
        return fixedTime;
      }
    } as DateConstructor;
  });
}
