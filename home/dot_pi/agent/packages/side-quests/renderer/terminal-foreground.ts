import type {
  ExtensionAPI,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_QUERY_TIMEOUT_MS = 250;
const OSC_10_QUERY = "\u001b]10;?\u0007";
const OSC_10_RESPONSE_PREFIX = "\u001b]10;";

export type Rgb = Readonly<{ r: number; g: number; b: number }>;

type QueryOptions = Readonly<{
  timeoutMs?: number;
  write?: (data: string) => void;
}>;

const foregrounds = new WeakMap<Theme, Rgb>();
let currentForeground: Rgb | undefined;

/** Queries the effective terminal text color when an interactive session starts. */
export function registerTerminalForegroundQuery(
  pi: ExtensionAPI,
  options: QueryOptions = {},
): void {
  pi.on("session_start", async (_event, context) => {
    if (context.mode !== "tui" || !usesTerminalForeground(context.ui.theme))
      return;

    const foreground = await queryTerminalForeground(context.ui, options);
    if (foreground) {
      currentForeground = foreground;
      foregrounds.set(context.ui.theme, foreground);
    }
  });
}

/** Returns the terminal default foreground remembered for this theme instance. */
export function terminalForeground(theme: Theme): Rgb | undefined {
  return foregrounds.get(theme) ?? currentForeground;
}

function usesTerminalForeground(theme: Theme): boolean {
  if (typeof theme.getFgAnsi !== "function") return true;
  const ansi = theme.getFgAnsi("customMessageText");
  if (!ansi.startsWith("\u001b[") || !ansi.endsWith("m")) return false;
  const parameters = ansi.slice(2, -1).split(";").map(Number);
  return (
    parameters.length === 0 || parameters.includes(0) || parameters.includes(39)
  );
}

function queryTerminalForeground(
  ui: Pick<ExtensionUIContext, "onTerminalInput">,
  options: QueryOptions,
): Promise<Rgb | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const write =
    options.write ?? ((data: string) => void process.stdout.write(data));

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (foreground: Rgb | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(foreground);
    };

    unsubscribe = ui.onTerminalInput((data) => {
      const payload = osc10Payload(data);
      if (payload === undefined) return undefined;
      finish(parseColor(payload));
      return { consume: true };
    });

    const timer = setTimeout(() => finish(undefined), timeoutMs);

    try {
      write(OSC_10_QUERY);
    } catch {
      finish(undefined);
    }
  });
}

function osc10Payload(data: string): string | undefined {
  if (!data.startsWith(OSC_10_RESPONSE_PREFIX)) return undefined;

  const payloadEnd = data.endsWith("\u0007")
    ? data.length - 1
    : data.endsWith("\u001b\\")
      ? data.length - 2
      : undefined;
  if (payloadEnd === undefined) return undefined;

  const payload = data.slice(OSC_10_RESPONSE_PREFIX.length, payloadEnd);
  return payload.includes("\u0007") || payload.includes("\u001b")
    ? undefined
    : payload;
}

function parseColor(value: string): Rgb | undefined {
  const normalized = value.trim();
  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    const channelLength = hex.length === 6 ? 2 : hex.length === 12 ? 4 : 0;
    if (channelLength === 0) return undefined;
    return parseChannels(
      hex.slice(0, channelLength),
      hex.slice(channelLength, channelLength * 2),
      hex.slice(channelLength * 2),
    );
  }

  const [red, green, blue] = normalized.replace(/^rgba?:/i, "").split("/");
  return red === undefined || green === undefined || blue === undefined
    ? undefined
    : parseChannels(red, green, blue);
}

function parseChannels(
  red: string,
  green: string,
  blue: string,
): Rgb | undefined {
  const r = parseChannel(red);
  const g = parseChannel(green);
  const b = parseChannel(blue);
  return r === undefined || g === undefined || b === undefined
    ? undefined
    : { r, g, b };
}

function parseChannel(channel: string): number | undefined {
  if (!/^[0-9a-f]+$/i.test(channel)) return undefined;
  const maximum = 16 ** channel.length - 1;
  if (maximum <= 0) return undefined;
  return Math.round((Number.parseInt(channel, 16) / maximum) * 255);
}
