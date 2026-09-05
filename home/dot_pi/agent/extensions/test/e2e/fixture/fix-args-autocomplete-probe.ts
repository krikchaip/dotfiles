import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const item = (value: string, description: string): AutocompleteItem => ({
  value,
  label: value,
  description,
});

export default function fixArgsAutocompleteProbe(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-async", {
    description: "Delayed argument continuation probe",
    getArgumentCompletions: async (prefix) => {
      if (prefix === "") return [item("first", "E2E ASYNC FIRST")];
      if (prefix.trim() === "first") {
        await Bun.sleep(500);
        return [item("first second", "E2E ASYNC SECOND")];
      }
      return null;
    },
    handler: async (args, context) => {
      context.ui.notify(`E2E ASYNC RESULT ${args}`, "info");
    },
  });

  pi.registerCommand("e2e-reject", {
    description: "Rejected argument continuation probe",
    getArgumentCompletions: async (prefix) => {
      if (prefix === "") return [item("first", "E2E REJECT FIRST")];
      throw new Error("E2E intentional completion rejection");
    },
    handler: async (args, context) => {
      context.ui.notify(`E2E REJECT RESULT ${args}`, "info");
    },
  });
}
