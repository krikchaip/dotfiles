import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

type MatrixRow = Readonly<{
  name: string;
  selection?: boolean | readonly string[];
  cliChild?: boolean;
  selectedChild?: boolean;
  packageChild?: boolean;
  rejected?: boolean;
}>;

const rows: readonly MatrixRow[] = [
  { name: "cli-omitted", cliChild: true },
  {
    name: "cli-relative",
    selection: ["+SELECTED"],
    cliChild: true,
    selectedChild: true,
  },
  { name: "cli-all", selection: true },
  { name: "cli-false", selection: false },
  { name: "cli-empty", selection: [] },
  { name: "cli-fixed", selection: ["SELECTED"], selectedChild: true },
  { name: "cli-reselect", selection: ["CLI"], cliChild: true },
  { name: "filter-all", selection: true },
  { name: "filter-fixed", selection: ["PACKAGE"], packageChild: true },
  {
    name: "filter-signed",
    selection: ["+PACKAGE"],
    cliChild: true,
    packageChild: true,
  },
  {
    name: "duplicate-path",
    selection: ["SELECTED", "SELECTED_ALIAS"],
    rejected: true,
  },
  {
    name: "conflict-path",
    selection: ["+SELECTED", "-SELECTED_ALIAS"],
    rejected: true,
  },
  { name: "empty-directory", selection: ["EMPTY"], rejected: true },
  { name: "empty-package", selection: ["EMPTY_PACKAGE"], rejected: true },
  { name: "missing-pattern", selection: ["PATTERN"], rejected: true },
  { name: "absent-removal", selection: ["-SELECTED"], rejected: true },
];

/**
 * Records one actual extension factory execution without registering any tools.
 */
function recorder(path: string, marker: string, label: string): void {
  writeFileSync(
    path,
    [
      'import { appendFileSync } from "node:fs";',
      "export default () => appendFileSync(",
      `  ${JSON.stringify(marker)},`,
      `  ${JSON.stringify(`${label}:`)} + (process.env.PI_SIDE_QUESTS_CHILD_ID ? "child" : "parent") + "\\n",`,
      ");",
    ].join("\n"),
  );
}

/**
 * Transcribes the live CLI, filter, manifest, and strict no-match acceptance rows.
 */
export const extensionSelectionMatrixScenarios: readonly Scenario[] = rows.map(
  (row) => {
    const cliArguments: string[] = [];
    return {
      name: `agent-extension-matrix-${row.name}`,
      process: {
        arguments: cliArguments,
        fauxProvider: true,
        managed: !row.rejected,
        positionalPrompt: "Delegate the extension selection-matrix task.",
      },
      async prepare(harness) {
        const scope = join(harness.workDirectory, ".pi");
        const marker = join(harness.stateDirectory, "matrix-loads.txt");
        mkdirSync(join(scope, "agents"), { recursive: true });
        const selected = join(scope, "selected.ts");
        const cli = join(harness.workDirectory, "one-off.ts");
        const packageRoot = join(harness.workDirectory, "package");
        const empty = join(harness.workDirectory, "empty");
        const emptyPackage = join(harness.workDirectory, "empty-package");
        for (const directory of [packageRoot, empty, emptyPackage])
          mkdirSync(directory);
        recorder(selected, marker, "selected");
        recorder(cli, marker, "cli");
        recorder(
          join(harness.stateDirectory, "extensions", "direct.ts"),
          marker,
          "direct",
        );
        recorder(join(packageRoot, "chosen.ts"), marker, "package");
        writeFileSync(
          join(packageRoot, "undeclared.ts"),
          'export default () => { throw new Error("Undeclared matrix extension executed"); };\n',
        );
        mkdirSync(join(packageRoot, "skills", "package-only"), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, "skills", "package-only", "SKILL.md"),
          "---\nname: package-only\ndescription: Unrelated package skill.\n---\nUNRELATED PACKAGE INSTRUCTIONS\n",
        );
        writeFileSync(
          join(packageRoot, "package.json"),
          JSON.stringify({
            name: "side-quests-selection-matrix",
            version: "1.0.0",
            pi: { extensions: ["chosen.ts"], skills: ["skills"] },
          }),
        );
        writeFileSync(
          join(emptyPackage, "package.json"),
          JSON.stringify({ pi: { extensions: [] } }),
        );
        const sources: Record<string, string> = {
          SELECTED: realpathSync(selected),
          SELECTED_ALIAS: "./selected.ts",
          CLI: cli,
          PACKAGE: packageRoot,
          EMPTY: empty,
          EMPTY_PACKAGE: emptyPackage,
          PATTERN: "./not-present-*.ts",
        };
        const selection = Array.isArray(row.selection)
          ? row.selection.map((value) => {
              const signed = value.startsWith("+") || value.startsWith("-");
              const prefix = signed ? value.slice(0, 1) : "";
              return prefix + sources[signed ? value.slice(1) : value];
            })
          : row.selection;
        writeFileSync(
          join(scope, "agents", "general-purpose.md"),
          [
            "---",
            "tools: [read]",
            ...(selection === undefined
              ? []
              : [`extensions: ${JSON.stringify(selection)}`]),
            "---",
            "",
          ].join("\n"),
        );
        writeFileSync(
          join(harness.stateDirectory, "settings.json"),
          JSON.stringify({
            packages: [
              {
                source: packageRoot,
                extensions: [],
                skills: [],
                prompts: [],
                themes: [],
              },
            ],
            defaultProjectTrust: "always",
            compaction: { enabled: false },
          }),
        );
        cliArguments.splice(0, cliArguments.length, "-e", cli);
      },
      configureProvider(context) {
        configureBasicDelegation(context, {
          childSystemPromptExcludes: [
            "<name>package-only</name>",
            "UNRELATED PACKAGE INSTRUCTIONS",
          ],
        });
      },
      async run(harness: E2EHarness) {
        if (row.rejected) {
          await harness.waitFor("The delegated work is in progress.");
          const view = await harness.capture();
          harness.assert(
            view.includes("is malformed") ||
              view.includes("Agent could not launch"),
            "Invalid extension selection was not rejected.",
          );
          harness.assert(
            harness.filesNamed("manifest.json").length === 0 &&
              (await harness.childPanes()).length === 0,
            "Rejected extension selection retained a child manifest or pane.",
          );
          return;
        }
        await harness.waitFor("SUBAGENT COMPLETED");
        const loads = harness
          .read(join(harness.stateDirectory, "matrix-loads.txt"))
          .trim()
          .split("\n");
        const count = (label: string) =>
          loads.filter((value) => value === label).length;
        harness.assert(
          count("cli:parent") === 1 && count("direct:parent") === 1,
          "The parent CLI or Direct baseline fixture did not execute once.",
        );
        harness.assert(
          count("direct:child") === 1 &&
            count("cli:child") === Number(!!row.cliChild),
          "The child CLI inheritance/Direct baseline policy did not match selection mode.",
        );
        harness.assert(
          count("selected:child") === Number(!!row.selectedChild) &&
            count("package:child") === Number(!!row.packageChild),
          "Fixed/signed sources or package filters did not match the selected extension surface.",
        );
      },
    };
  },
);
