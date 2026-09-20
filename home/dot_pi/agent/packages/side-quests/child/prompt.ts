import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Registers frozen child prompt content after Pi has assembled native sections.
 */
export function registerChildPrompt(
  pi: ExtensionAPI,
  suffix: string | undefined,
): void {
  if (!suffix) return;

  pi.on("before_agent_start", (event) => ({
    systemPrompt: appendChildPrompt(event.systemPrompt, suffix),
  }));
}

/**
 * Appends the frozen child suffix to Pi's finalized structured system prompt.
 */
export function appendChildPrompt(
  systemPrompt: string,
  suffix: string,
): string {
  return systemPrompt ? `${systemPrompt}\n\n${suffix}` : suffix;
}
