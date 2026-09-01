import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

const DESCRIPTION = "Ownership trigger E2E";
const CHILD_READY = "Title ownership child is ready.";

function ownershipScenario(
  name: string,
  override: (harness: E2EHarness, paneId: string) => Promise<void>,
  expected: string,
): Scenario {
  return {
    name,
    process: {
      lifecycle: "interactive",
      managed: true,
      positionalPrompt: "Delegate the title-ownership E2E task now.",
    },
    timeoutMs: 45_000,
    configureProvider({ faux, role }) {
      if (role === "child") {
        faux.setResponses([fauxAssistantMessage(fauxText(CHILD_READY))]);
        return;
      }

      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("Agent", {
            description: DESCRIPTION,
            interactive: true,
            prompt: "Stay open for title ownership E2E.",
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("First ownership child is open.")),
        fauxAssistantMessage(
          fauxToolCall("Agent", {
            description: "Ownership launch E2E",
            interactive: true,
            prompt: "Stay open after title ownership transfers.",
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("Second ownership child is open.")),
      ]);
    },
    async run(harness: E2EHarness) {
      const paneId = await harness.childPane();
      await harness.waitFor(CHILD_READY, 10_000, paneId);
      await override(harness, paneId);
      await Bun.sleep(1_500);

      const readState = async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            paneId,
            "#{window_name}\t#{automatic-rename}\t#{automatic-rename-format}\t#{@side_quests_title_owner}",
          )
        ).trim();
      harness.assert(
        (await readState()) === expected,
        `Title override was not preserved: expected ${JSON.stringify(expected)}, got ${JSON.stringify(await readState())}.`,
      );

      await harness.sendParent("Launch after title ownership transfer.", true);
      await harness.waitUntil(
        "two managed panes after title ownership transfer",
        async () => (await harness.childPanes()).length === 2,
        10_000,
      );
      await Bun.sleep(1_500);
      harness.assert(
        (await readState()) === expected,
        `Detached launch changed title ownership: ${JSON.stringify(await readState())}.`,
      );

      await harness.sendParent("/reload", true);
      await Bun.sleep(1_500);
      harness.assert(
        (await readState()) === expected,
        `Parent reload changed title ownership: ${JSON.stringify(await readState())}.`,
      );
    },
  };
}

export const windowTitleAutomaticRenameOff = ownershipScenario(
  "window-title-automatic-rename-off",
  async (harness, paneId) => {
    await harness.tmux(
      "set-option",
      "-w",
      "-t",
      paneId,
      "automatic-rename",
      "off",
    );
  },
  `${DESCRIPTION}\t0\t${DESCRIPTION}\tuser`,
);

const USER_FORMAT = "User automatic title";

export const windowTitleFormatOverride = ownershipScenario(
  "window-title-format-override",
  async (harness, paneId) => {
    await harness.tmux(
      "set-option",
      "-w",
      "-t",
      paneId,
      "automatic-rename-format",
      USER_FORMAT,
      ";",
      "set-option",
      "-w",
      "-t",
      paneId,
      "automatic-rename",
      "off",
      ";",
      "set-option",
      "-w",
      "-t",
      paneId,
      "automatic-rename",
      "on",
    );
  },
  `${USER_FORMAT}\t1\t${USER_FORMAT}\tuser`,
);
