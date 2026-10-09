import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  formatMCPConnectionStatusMessage,
  type McpConnectionStatusEvent,
} from "@oh-my-pi/pi-coding-agent/mcp/startup-events";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes";
import {
  cfgStatusLineLeftSegments,
  cfgStatusLinePreset,
  cfgStatusLineRightSegments,
} from "@oh-my-pi/pi-coding-agent/modes/settings";
import { SPINNER_ADVANCE_MS } from "@oh-my-pi/pi-tui";
import {
  SEGMENTS,
  type SegmentContext,
  type StatusLineSegment,
} from "@oh-my-pi/pi-tui/status-line";
import { theme } from "@oh-my-pi/pi-tui/theme";

let active = false;

interface McpSegment extends Omit<StatusLineSegment, "id"> {
  id: "mcp";
}

const registry = SEGMENTS as Record<
  string,
  StatusLineSegment | McpSegment | undefined
>;

// The native welcome banner stays visible; only configured layouts render MCP.
// There is no MCP-only renderer hook: this process-local wrapper hides only
// the native MCP summary and MCP-only mount notices. Shutdown restores it.
export default function (pi: ExtensionAPI) {
  if (active) return;
  active = true;

  type State = "connecting" | "ready" | "failed";
  type Server = { state: State; error?: string; sourcePath?: string };

  const servers = new Map<string, Server>();

  let state: State | undefined;
  let color: "error" | "success" | "muted" = "muted";
  let context: ExtensionContext | undefined;
  let interactive: InteractiveMode | undefined;
  let animation: ReturnType<ExtensionContext["setInterval"]> | undefined;
  let installed = false;
  let nativeSummary: string | undefined;

  function configured() {
    if (
      !interactive ||
      cfgStatusLinePreset.get(interactive.settings) !== "custom"
    )
      return false;

    const left: readonly string[] = cfgStatusLineLeftSegments.get(
      interactive.settings,
    );
    const right: readonly string[] = cfgStatusLineRightSegments.get(
      interactive.settings,
    );

    return left.includes("mcp") || right.includes("mcp");
  }

  function repaint() {
    interactive?.statusLine.invalidate();
    interactive?.ui.requestRender();
  }

  function syncAnimation() {
    const animate = installed && state === "connecting" && configured();
    if (!animate && animation !== undefined) {
      context!.clearTimer(animation);
      animation = undefined;
    } else if (animate && animation === undefined) {
      animation = context!.setInterval(() => {
        syncAnimation();
        if (animation !== undefined) repaint();
      }, SPINNER_ADVANCE_MS);
    }
  }

  function label(ctx: SegmentContext) {
    let icon: string;

    if (state === "connecting") {
      const frames = theme.getSpinnerFrames("activity");
      icon =
        frames[
          Math.floor((ctx.now?.getTime() ?? Date.now()) / SPINNER_ADVANCE_MS) %
            frames.length
        ] ?? "";
    } else {
      icon = state === "ready" ? theme.status.success : theme.status.error;
    }

    return `${icon ? `${icon} ` : ""}MCP ${state}`;
  }

  const segment: McpSegment = {
    id: "mcp",
    render(ctx) {
      syncAnimation();
      if (!state) return { content: "", visible: false };
      return { content: theme.fg(color, label(ctx)), visible: true };
    },
    describe(ctx) {
      syncAnimation();
      return state ? { spans: [{ t: label(ctx), s: color }] } : null;
    },
  };

  const originalShowStatus = InteractiveMode.prototype.showStatus;

  const filteredShowStatus: typeof originalShowStatus = function (
    message,
    options,
  ) {
    if (message === nativeSummary) {
      interactive = this;
      syncAnimation();
      repaint();
      return;
    }

    if (message.startsWith("xdev: xd://: ")) {
      const parts = message.slice("xdev: xd://: ".length).split("; ");
      const onlyMcp = parts.every((part) => {
        const names = part.replace(/^(mounted|unmounted) /, "").split(", ");
        return names.every((name) => name.startsWith("mcp__"));
      });

      if (onlyMcp) return;
    }

    originalShowStatus.call(this, message, options);
  };

  InteractiveMode.prototype.showStatus = filteredShowStatus;

  const unsubscribe = pi.events.on("mcp:connection-status", (data) => {
    const event = data as McpConnectionStatusEvent;
    if (event.type === "connecting") {
      servers.clear();
      for (const name of event.serverNames)
        servers.set(name, { state: "connecting" });
    } else {
      servers.set(
        event.serverName,
        event.type === "failed"
          ? {
              state: "failed",
              error: event.error,
              sourcePath: event.sourcePath,
            }
          : { state: event.type === "connected" ? "ready" : "connecting" },
      );
    }

    const pendingServers: string[] = [];
    const connectedServers: string[] = [];
    const failedServers: {
      serverName: string;
      error: string;
      sourcePath?: string;
    }[] = [];

    for (const [name, server] of servers) {
      if (server.state === "connecting") pendingServers.push(name);
      else if (server.state === "ready") connectedServers.push(name);
      else
        failedServers.push({
          serverName: name,
          error: server.error!,
          sourcePath: server.sourcePath,
        });
    }

    nativeSummary = formatMCPConnectionStatusMessage({
      pendingServers,
      connectedServers,
      failedServers,
    });

    state =
      failedServers.length > 0
        ? "failed"
        : pendingServers.length > 0
          ? "connecting"
          : connectedServers.length > 0
            ? "ready"
            : undefined;
    color =
      state === "failed" ? "error" : state === "ready" ? "success" : "muted";

    syncAnimation();
    repaint();
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || ctx.agent.kind !== "main" || installed) return;

    context = ctx;
    registry.mcp = segment;
    installed = true;

    syncAnimation();
    repaint();
  });

  pi.on("session_shutdown", () => {
    unsubscribe();

    if (animation !== undefined) context!.clearTimer(animation);
    animation = undefined;

    if (installed && registry.mcp === segment) delete registry.mcp;
    installed = false;

    context = undefined;
    interactive = undefined;

    if (InteractiveMode.prototype.showStatus === filteredShowStatus) {
      InteractiveMode.prototype.showStatus = originalShowStatus;
    }

    active = false;
  });
}
