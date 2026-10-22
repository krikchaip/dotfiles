import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

type NamingSessionManager = ExtensionContext["sessionManager"] & {
  onSessionNameChanged(callback: () => void): () => void;
};

type ActiveSession = {
  sessionRef: string | null;
  unsubscribe?: () => void;
};

export default function (pi: ExtensionAPI) {
  if (
    process.env.HERDR_ENV !== "1" ||
    !process.env.HERDR_SOCKET_PATH ||
    !process.env.HERDR_PANE_ID ||
    process.env.OMPCODE === "1"
  )
    return;

  const helper = join(
    homedir(),
    ".config/herdr/session-titles/session_titles.py",
  );
  let active: ActiveSession | undefined;
  const runHelper = promisify(execFile);
  let queue = Promise.resolve();
  let sequence = 0;
  let reportedError = false;

  function reportError(error: unknown): void {
    if (reportedError) return;
    reportedError = true;
    console.error(`[herdr-session-title] ${String(error)}`);
  }

  function publish(
    name: string | undefined | null,
    sessionRef: string | null,
  ): void {
    // Capture ordering at the event, not when the queued subprocess starts.
    sequence = Math.max(sequence + 1, Date.now() * 1000);
    const payload = JSON.stringify({
      agent: "omp",
      name: name ?? null,
      session_ref: sessionRef,
      seq: sequence,
    });
    queue = queue
      .then(async () => {
        await runHelper("python3", [helper, "publish", payload], {
          timeout: 3000,
        });
      })
      .catch(reportError);
  }

  function stop(): void {
    const previous = active;
    active = undefined;
    if (!previous) return;
    try {
      previous.unsubscribe?.();
    } catch (error) {
      reportError(error);
    }
    publish(null, previous.sessionRef);
  }

  function activate(ctx: ExtensionContext): void {
    stop();
    if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
    try {
      const manager = ctx.sessionManager;
      const file = manager.getSessionFile();
      const session: ActiveSession = {
        sessionRef:
          file && isAbsolute(file) ? file : manager.getSessionId() || null,
      };
      active = session;
      // OMP 18.8.0 exposes this concrete listener, but omits it from its readonly public type.
      const namingManager = manager as NamingSessionManager;
      session.unsubscribe = namingManager.onSessionNameChanged(() => {
        if (active !== session) return;
        try {
          publish(pi.getSessionName(), session.sessionRef);
        } catch (error) {
          reportError(error);
        }
      });
      publish(pi.getSessionName(), session.sessionRef);
    } catch (error) {
      reportError(error);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    activate(ctx);
    return queue;
  });
  pi.on("session_switch", (_event, ctx) => {
    activate(ctx);
    return queue;
  });
  pi.on("session_shutdown", () => {
    stop();
    return queue;
  });
}
