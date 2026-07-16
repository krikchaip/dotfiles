/**
 * Kitty graphics inside tmux, via Unicode placeholders (U=1).
 *
 * pi-tui disables image protocols under tmux (`detectCapabilities()` returns
 * `images: null` when `$TMUX` is set) and, when forced on, its `Image`
 * component emits direct placements (`a=T`). Direct placements break under
 * tmux: kitty draws at absolute window pixels, so images ghost on scroll,
 * bleed across panes, and re-transmit the full payload every frame (lag).
 *
 * This extension fixes all of that by:
 *
 *   1. Forcing `getCapabilities().images = "kitty"` (so pi constructs `Image`
 *      components at all) via the exported `setCapabilities()`.
 *   2. Overriding `Image.prototype.render` to use the kitty Unicode-placeholder
 *      protocol instead of `a=T`:
 *        - transmit the image ONCE per id (`a=t`, no display),
 *        - create a virtual placement (`a=p,U=1,c,r`),
 *        - return real text cells made of U+10EEEE + row/col diacritics, with
 *          the image id encoded in the cell foreground color.
 *      tmux tracks those cells as ordinary text, so the image scrolls with the
 *      content, clips to the pane, and never re-transmits on scroll.
 *   3. Patching Pi TUI overlay composition only for U=1 placeholder lines,
 *      preserving the unmasked image cells around every overlay.
 *   4. Wrapping `process.stdout.write` to envelope Kitty APCs in tmux DCS
 *      passthrough and clear only visible placements before scroll-region
 *      repaints.
 *
 * These patches apply to every Pi TUI surface — chat history,
 * tool results, the startup banner, and pi-paster's draft preview all go
 * through `new Image(...)`.
 *
 * Requirements: outer terminal speaks kitty graphics (kitty / ghostty /
 * wezterm) and tmux has `set -g allow-passthrough on`.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

type ImageProtocol = "kitty" | "iterm2" | null;

interface Capabilities {
  images: ImageProtocol;
  trueColor: boolean;
  hyperlinks: boolean;
}

interface CellSize {
  widthPx: number;
  heightPx: number;
}

interface PixelDimensions {
  widthPx: number;
  heightPx: number;
}

// Minimal shape of pi-tui's Image component we rely on.
interface ImageInstance {
  base64Data: string;
  mimeType: string;
  dimensions: PixelDimensions;
  options: { maxWidthCells?: number; maxHeightCells?: number };
  imageId?: number;
  cachedLines?: string[];
  cachedWidth?: number;
  __u1ImageId?: number;
  __u1PlacementId?: number;
  __u1PlacementKey?: string;
  render(width: number): string[];
}

interface ImageCtor {
  new (...args: unknown[]): ImageInstance;
  prototype: ImageInstance;
}

interface TuiInstance {
  compositeLineAt(
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string;
}

interface PiTuiModule {
  Image: ImageCtor;
  TUI: { prototype: TuiInstance };
  getCapabilities(): Capabilities;
  setCapabilities(caps: Capabilities): void;
  getCellDimensions(): CellSize;
  visibleWidth(text: string): number;
  truncateToWidth(
    text: string,
    width: number,
    suffix: string,
    strict: boolean,
  ): string;
}

// Kitty Unicode-placeholder constants (graphics protocol spec).
const PLACEHOLDER = String.fromCodePoint(0x10eeee);
const DELETE_VISIBLE_PLACEMENTS = "\x1b_Ga=d,d=a,q=2\x1b\\";
const SYNCHRONIZED_OUTPUT_BEGIN = "\x1b[?2026h";
const SCROLL_REGION = /\x1b\[\d+;\d+r/;
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

// Byte-exact ordered list: index N → diacritic encoding row/column number N.
// Source: kitty tools/utils/images/rowcolumn_diacritics.go (297 entries).
const DIACRITICS = [
  0x305, 0x30d, 0x30e, 0x310, 0x312, 0x33d, 0x33e, 0x33f, 0x346, 0x34a, 0x34b,
  0x34c, 0x350, 0x351, 0x352, 0x357, 0x35b, 0x363, 0x364, 0x365, 0x366, 0x367,
  0x368, 0x369, 0x36a, 0x36b, 0x36c, 0x36d, 0x36e, 0x36f, 0x483, 0x484, 0x485,
  0x486, 0x487, 0x592, 0x593, 0x594, 0x595, 0x597, 0x598, 0x599, 0x59c, 0x59d,
  0x59e, 0x59f, 0x5a0, 0x5a1, 0x5a8, 0x5a9, 0x5ab, 0x5ac, 0x5af, 0x5c4, 0x610,
  0x611, 0x612, 0x613, 0x614, 0x615, 0x616, 0x617, 0x657, 0x658, 0x659, 0x65a,
  0x65b, 0x65d, 0x65e, 0x6d6, 0x6d7, 0x6d8, 0x6d9, 0x6da, 0x6db, 0x6dc, 0x6df,
  0x6e0, 0x6e1, 0x6e2, 0x6e4, 0x6e7, 0x6e8, 0x6eb, 0x6ec, 0x730, 0x732, 0x733,
  0x735, 0x736, 0x73a, 0x73d, 0x73f, 0x740, 0x741, 0x743, 0x745, 0x747, 0x749,
  0x74a, 0x7eb, 0x7ec, 0x7ed, 0x7ee, 0x7ef, 0x7f0, 0x7f1, 0x7f3, 0x816, 0x817,
  0x818, 0x819, 0x81b, 0x81c, 0x81d, 0x81e, 0x81f, 0x820, 0x821, 0x822, 0x823,
  0x825, 0x826, 0x827, 0x829, 0x82a, 0x82b, 0x82c, 0x82d, 0x951, 0x953, 0x954,
  0xf82, 0xf83, 0xf86, 0xf87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17,
  0x1a75, 0x1a76, 0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b,
  0x1b6d, 0x1b6e, 0x1b6f, 0x1b70, 0x1b71, 0x1b72, 0x1b73, 0x1cd0, 0x1cd1,
  0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4, 0x1dc5,
  0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3,
  0x1dd4, 0x1dd5, 0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb, 0x1ddc,
  0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1, 0x1de2, 0x1de3, 0x1de4, 0x1de5,
  0x1de6, 0x1dfe, 0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7, 0x20db,
  0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0,
  0x2de1, 0x2de2, 0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9,
  0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee, 0x2def, 0x2df0, 0x2df1, 0x2df2,
  0x2df3, 0x2df4, 0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa, 0x2dfb,
  0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d, 0xa6f0, 0xa6f1,
  0xa8e0, 0xa8e1, 0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7, 0xa8e8,
  0xa8e9, 0xa8ea, 0xa8eb, 0xa8ec, 0xa8ed, 0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1,
  0xaab0, 0xaab2, 0xaab3, 0xaab7, 0xaab8, 0xaabe, 0xaabf, 0xaac1, 0xfe20,
  0xfe21, 0xfe22, 0xfe23, 0xfe24, 0xfe25, 0xfe26, 0x10a0f, 0x10a38, 0x1d185,
  0x1d186, 0x1d187, 0x1d188, 0x1d189, 0x1d1aa, 0x1d1ab, 0x1d1ac, 0x1d1ad,
  0x1d242, 0x1d243, 0x1d244,
].map((cp) => String.fromCodePoint(cp));

// ESC _ G <params;payload> ESC \  — payload never contains ESC.
const KITTY_APC = /\x1b_G([^\x1b]*)\x1b\\/g;

const KITTY_CHUNK = 4096;

function inTmux(): boolean {
  return (
    Boolean(process.env.TMUX) ||
    (process.env.TERM ?? "").toLowerCase().startsWith("tmux")
  );
}

function outerTerminalSupportsKitty(): boolean {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();

  if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") return true;
  if (termProgram === "ghostty" || process.env.GHOSTTY_RESOURCES_DIR)
    return true;
  if (termProgram === "wezterm" || process.env.WEZTERM_PANE) return true;

  return false;
}

/** Mirror of pi-tui's calculateImageCellSize so placeholder grid == reserved rows. */
function imageCellSize(
  dims: PixelDimensions,
  maxWidthCells: number,
  maxHeightCells: number | undefined,
  cell: CellSize,
): { columns: number; rows: number } {
  const maxW = Math.max(1, Math.floor(maxWidthCells));
  const maxH =
    maxHeightCells === undefined
      ? undefined
      : Math.max(1, Math.floor(maxHeightCells));

  const imgW = Math.max(1, dims.widthPx);
  const imgH = Math.max(1, dims.heightPx);

  const widthScale = (maxW * cell.widthPx) / imgW;
  const heightScale =
    maxH === undefined ? widthScale : (maxH * cell.heightPx) / imgH;
  const scale = Math.min(widthScale, heightScale);

  const columns = Math.ceil((imgW * scale) / cell.widthPx);
  const rows = Math.ceil((imgH * scale) / cell.heightPx);

  return {
    columns: Math.max(1, Math.min(maxW, columns)),
    rows: Math.max(1, maxH === undefined ? rows : Math.min(maxH, rows)),
  };
}

const transmittedIds = new Set<number>();

// Same image bytes should share one transmitted image id, while each rendered
// cell size gets its own virtual placement id.  In U=1 mode, image id is
// encoded in foreground color and placement id in underline color.
const dataHashToU1Id = new Map<string, number>();
const placementKeyToU1PlacementId = new Map<string, number>();

function hashForDedup(base64Data: string): string {
  // Use first 64 + last 64 chars + length as a fast dedup key.
  // Collisions are harmless (just share an ID).
  const head = base64Data.slice(0, 64);
  const tail = base64Data.slice(-64);
  return `${base64Data.length}:${head}:${tail}`;
}

// Kitty image ids are terminal-global and can outlive a pi popup process.
// Start each process in a random 24-bit range instead of replaying id=1,2,3...
let nextU1Id = randomInt(1, 0x1000000);
let nextU1PlacementId = randomInt(1, 0x1000000);

function allocU1Id(): number {
  // 24-bit so the id fits entirely in a truecolor foreground (no 3rd diacritic).
  for (let attempt = 0; attempt < 0xffffff; attempt++) {
    const id = nextU1Id;
    nextU1Id = (nextU1Id % 0xffffff) + 1;
    if (!transmittedIds.has(id)) return id;
  }

  return randomInt(1, 0x1000000);
}

function allocU1PlacementId(): number {
  // 24-bit so the id fits entirely in underline truecolor.
  const id = nextU1PlacementId;
  nextU1PlacementId = (nextU1PlacementId % 0xffffff) + 1;
  return id;
}

/** One-time `a=t` transmit (no display) for an image id; chunked for >4 KB. */
function transmitImage(id: number, base64: string): void {
  if (transmittedIds.has(id)) return;
  transmittedIds.add(id);

  let out = "";

  if (base64.length <= KITTY_CHUNK) {
    out = `\x1b_Gi=${id},f=100,t=d,a=t,q=2;${base64}\x1b\\`;
  } else {
    let offset = 0;
    let first = true;

    while (offset < base64.length) {
      const chunk = base64.slice(offset, offset + KITTY_CHUNK);

      offset += KITTY_CHUNK;

      const more = offset < base64.length ? 1 : 0;

      out += first
        ? `\x1b_Gi=${id},f=100,t=d,a=t,q=2,m=${more};${chunk}\x1b\\`
        : `\x1b_Gm=${more};${chunk}\x1b\\`;

      first = false;
    }
  }

  process.stdout.write(out); // wrapped for tmux passthrough by patchStdout()
}

/** Create/refresh the virtual placement for an id at the given cell size. */
let hasVirtualPlacements = false;

function placeVirtual(
  imageId: number,
  placementId: number,
  columns: number,
  rows: number,
): void {
  hasVirtualPlacements = true;
  process.stdout.write(
    `\x1b_Ga=p,U=1,i=${imageId},p=${placementId},c=${columns},r=${rows},q=2\x1b\\`,
  );
}

/** Build the placeholder text grid: `rows` lines of `columns` cells. */
function placeholderLines(
  imageId: number,
  placementId: number,
  columns: number,
  rows: number,
): string[] {
  const fg = `\x1b[38;2;${(imageId >> 16) & 0xff};${(imageId >> 8) & 0xff};${imageId & 0xff}m`;
  const underline = `\x1b[58;2;${(placementId >> 16) & 0xff};${(placementId >> 8) & 0xff};${placementId & 0xff}m`;
  const lines: string[] = [];

  for (let r = 0; r < rows; r++) {
    const rowMark = DIACRITICS[r] ?? "";
    let line = `${fg}${underline}`;

    for (let c = 0; c < columns; c++) {
      line += PLACEHOLDER + rowMark + (DIACRITICS[c] ?? "");
    }

    lines.push(`${line}\x1b[39;59m`);
  }

  return lines;
}

function sliceAnsiColumns(
  mod: PiTuiModule,
  text: string,
  startCol: number,
  length: number,
): string {
  if (length <= 0) return "";

  const endCol = startCol + length;
  const tokens = text.split(/(\x1b\[[0-9;?]*[ -/]*[@-~])/g);
  let col = 0;
  let result = "";
  let pendingAnsi = "";

  tokenLoop: for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith("\x1b[")) {
      if (col >= startCol && col < endCol) result += token;
      else if (col < startCol) pendingAnsi += token;
      continue;
    }

    for (const { segment } of graphemeSegmenter.segment(token)) {
      const width = Math.max(0, mod.visibleWidth(segment));
      if (col >= startCol && col < endCol && col + width <= endCol) {
        if (pendingAnsi) {
          result += pendingAnsi;
          pendingAnsi = "";
        }
        result += segment;
      }
      col += width;
      if (col >= endCol) break tokenLoop;
    }
  }

  return result;
}

function installU1OverlayComposition(mod: PiTuiModule): void {
  const proto = mod.TUI.prototype;
  const original = proto.compositeLineAt;

  proto.compositeLineAt = function (
    baseLine,
    overlayLine,
    startCol,
    overlayWidth,
    totalWidth,
  ) {
    if (!baseLine.includes(PLACEHOLDER)) {
      return original.call(
        this,
        baseLine,
        overlayLine,
        startCol,
        overlayWidth,
        totalWidth,
      );
    }

    const afterStart = startCol + overlayWidth;
    const before = sliceAnsiColumns(mod, baseLine, 0, startCol);
    const after = sliceAnsiColumns(
      mod,
      baseLine,
      afterStart,
      Math.max(0, totalWidth - afterStart),
    );
    const beforePad = " ".repeat(
      Math.max(0, startCol - mod.visibleWidth(before)),
    );
    const overlay = mod.truncateToWidth(overlayLine, overlayWidth, "", true);
    const overlayPad = " ".repeat(
      Math.max(0, overlayWidth - mod.visibleWidth(overlay)),
    );
    const composed = `${before}\x1b[0m${beforePad}${overlay}${overlayPad}\x1b[0m${after}\x1b[0m`;
    const truncated = mod.truncateToWidth(composed, totalWidth, "", true);
    return (
      truncated +
      " ".repeat(Math.max(0, totalWidth - mod.visibleWidth(truncated)))
    );
  };
}

function installU1Renderer(mod: PiTuiModule): void {
  const proto = mod.Image.prototype;
  const original = proto.render;

  proto.render = function (this: ImageInstance, width: number): string[] {
    const caps = mod.getCapabilities();
    if (caps.images !== "kitty") {
      return original.call(this, width);
    }

    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    try {
      const cell = mod.getCellDimensions();

      const maxWidth = Math.max(
        1,
        Math.min(width - 2, this.options.maxWidthCells ?? 60),
      );
      const defaultMaxHeight = Math.max(
        1,
        Math.ceil((maxWidth * cell.widthPx) / cell.heightPx),
      );

      const maxHeight = this.options.maxHeightCells ?? defaultMaxHeight;
      const size = imageCellSize(this.dimensions, maxWidth, maxHeight, cell);

      const dataKey = hashForDedup(this.base64Data);
      if (this.__u1ImageId === undefined) {
        // Reuse an existing transmitted image id for identical image bytes.
        const existing = dataHashToU1Id.get(dataKey);
        if (existing !== undefined) {
          this.__u1ImageId = existing;
          this.imageId = existing;
        } else {
          this.__u1ImageId = allocU1Id();
          this.imageId = this.__u1ImageId;
          dataHashToU1Id.set(dataKey, this.__u1ImageId);
        }
      }

      const placementKey = `${dataKey}:${size.columns}x${size.rows}`;
      if (this.__u1PlacementKey !== placementKey) {
        this.__u1PlacementKey = placementKey;
        const existing = placementKeyToU1PlacementId.get(placementKey);
        if (existing !== undefined) {
          this.__u1PlacementId = existing;
        } else {
          this.__u1PlacementId = allocU1PlacementId();
          placementKeyToU1PlacementId.set(placementKey, this.__u1PlacementId);
        }
      }

      transmitImage(this.__u1ImageId, this.base64Data);
      placeVirtual(
        this.__u1ImageId,
        this.__u1PlacementId!,
        size.columns,
        size.rows,
      );

      const lines = placeholderLines(
        this.__u1ImageId,
        this.__u1PlacementId!,
        size.columns,
        size.rows,
      );

      this.cachedLines = lines;
      this.cachedWidth = width;

      return lines;
    } catch {
      return original.call(this, width);
    }
  };
}

let stdoutPatched = false;
let originalWrite: ((...args: unknown[]) => boolean) | undefined;

function prepareViewportRepaint(text: string): string {
  if (
    !hasVirtualPlacements ||
    !text.includes(SYNCHRONIZED_OUTPUT_BEGIN) ||
    !SCROLL_REGION.test(text)
  )
    return text;
  return text.replace(
    SYNCHRONIZED_OUTPUT_BEGIN,
    `${SYNCHRONIZED_OUTPUT_BEGIN}${DELETE_VISIBLE_PLACEMENTS}`,
  );
}

function wrapKittyForTmux(text: string): string {
  if (!text.includes("\x1b_G")) return text;
  return text.replace(
    KITTY_APC,
    (_m, content: string) => `\x1bPtmux;\x1b\x1b_G${content}\x1b\x1b\\\x1b\\`,
  );
}

function patchStdout(): void {
  if (stdoutPatched) return;
  stdoutPatched = true;

  const stream = process.stdout as NodeJS.WriteStream & {
    write: (...a: unknown[]) => boolean;
  };

  originalWrite = stream.write.bind(stream);

  stream.write = (...args: unknown[]): boolean => {
    const chunk = args[0];

    if (typeof chunk === "string") {
      args[0] = wrapKittyForTmux(prepareViewportRepaint(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      const asString = chunk.toString("latin1");
      args[0] = Buffer.from(
        wrapKittyForTmux(prepareViewportRepaint(asString)),
        "latin1",
      );
    }

    return args.length > 1 ? originalWrite!(...args) : originalWrite!(args[0]);
  };
}

let exitCleanupRegistered = false;

function registerExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;

  const deleteAll = (): void => {
    try {
      process.stdout.write("\x1b_Ga=d,d=A,q=2\x1b\\");
    } catch {
      // best effort during teardown
    }
  };

  process.once("exit", deleteAll);
  process.once("SIGINT", deleteAll);
  process.once("SIGTERM", deleteAll);
}

function loadPiTui(): Promise<PiTuiModule> {
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate pi entrypoint");

  const require = createRequire(pathToFileURL(realpathSync(entry)));
  const resolved = require.resolve("@earendil-works/pi-tui");

  return import(pathToFileURL(resolved).href) as Promise<PiTuiModule>;
}

export default function tmuxKittyImages(pi: ExtensionAPI): void {
  if (!inTmux() || !outerTerminalSupportsKitty()) return;

  let sessionGeneration = 0;

  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    const generation = ++sessionGeneration;
    try {
      const mod = await loadPiTui();
      const current = mod.getCapabilities();

      mod.setCapabilities({
        images: "kitty",
        trueColor: true,
        hyperlinks: current.hyperlinks,
      });

      installU1OverlayComposition(mod);
      installU1Renderer(mod);
      patchStdout();
      registerExitCleanup();
    } catch (error) {
      if (generation === sessionGeneration) {
        ctx.ui.notify(
          `tmux-kitty-images failed: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
  });

  pi.on("session_shutdown", () => {
    sessionGeneration++;
  });
}
