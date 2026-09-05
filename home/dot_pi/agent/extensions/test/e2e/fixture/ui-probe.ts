import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const item = (value: string, description: string): AutocompleteItem => ({
  value,
  label: value,
  description,
});

export default function uiProbe(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-dialog", {
    description: "Open the E2E border probe",
    handler: async (_args, context) => {
      const choice = await context.ui.select("E2E BORDER PROBE", ["Close probe"]);
      context.ui.notify(`E2E BORDER RESULT ${choice ?? "cancelled"}`, "info");
    },
  });

  pi.registerCommand("e2e-command", {
    description: "Visible command for slash highlighting",
    handler: async (_args, context) => {
      context.ui.notify("E2E COMMAND RAN", "info");
    },
  });

  pi.registerCommand("e2e-multi", {
    description: "Two-step argument completion probe",
    getArgumentCompletions: (prefix) => {
      if (prefix === "") return [item("alpha", "E2E FIRST ARGUMENT")];
      if (prefix.trim() === "alpha") {
        return [item("alpha beta", "E2E SECOND ARGUMENT")];
      }
      return null;
    },
    handler: async (args, context) => {
      context.ui.notify(`E2E MULTI RESULT ${args}`, "info");
    },
  });

  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    context.ui.setWidget("ui-probe", ["UI PROBE READY"]);
  });
}
