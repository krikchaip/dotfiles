import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);

async function finish(harness: PiTuiHarness): Promise<void> {
  try {
    await harness.finish();
  } catch (error) {
    await harness.abort();
    throw error;
  }
}

try {
  const capturePath = `${runDirectory}/skill-expansion-provider.json`;
  const harness = await PiTuiHarness.start({
    name: "skill-expansion",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/test/e2e/fixture/skill-expansion-inputs.ts",
      "extensions/skill-expansion.ts",
    ],
    skills: ["extensions/test/e2e/fixture/skills/alpha/SKILL.md"],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify([
        "E2E SKILL RESPONSE ONE",
        "E2E SKILL RESPONSE TWO",
        "E2E SKILL RESPONSE THREE",
        "E2E SKILL RESPONSE FOUR",
      ]),
    },
  });

  await harness.submit("Use /skill:alpha without expanding it");
  await harness.waitFor("E2E SKILL RESPONSE ONE");
  await harness.submit("/skill:alpha");
  await harness.waitFor("E2E SKILL RESPONSE TWO");
  await harness.submit("Use bare /alpha without expanding it");
  await harness.waitFor("E2E SKILL RESPONSE THREE");
  await harness.sendLiteral("/e2e-custom-skill");
  await harness.sendKeys("Enter");
  await harness.waitFor("E2E SKILL RESPONSE FOUR");

  const captures = JSON.parse(readFileSync(capturePath, "utf8"));
  const payload = JSON.stringify(captures[0]);
  harness.assert(
    payload.includes("Use /skill:alpha without expanding it"),
    "Provider payload lost the literal skill marker",
  );
  harness.assert(
    payload.includes("referenced skill paths:"),
    "Provider payload lacks the hidden skill path block",
  );
  harness.assert(
    payload.includes("piSkillReferencePaths"),
    "Provider payload lacks the hidden skill path tag",
  );
  harness.assert(
    !payload.includes("# Alpha"),
    "Native skill content polluted the provider payload",
  );
  const exactPayload = JSON.stringify(captures[1]);
  harness.assert(exactPayload.includes("/skill:alpha"), "Whole-message skill marker was expanded before provider input");
  harness.assert(exactPayload.includes("piSkillReferencePaths"), "Whole-message skill marker lacks hidden path metadata");
  harness.assert(!exactPayload.includes("# Alpha"), "Whole-message skill marker polluted provider input with skill body");
  const barePayload = JSON.stringify(captures[2]);
  harness.assert(barePayload.includes("Use bare /alpha"), "Bare skill marker was not retained");
  harness.assert(barePayload.includes("piSkillReferencePaths"), "Bare skill marker lacks hidden path metadata");
  const customPayload = JSON.stringify(captures[3]);
  harness.assert(customPayload.includes("CUSTOM_SKILL_MARKER /alpha"), "Custom message did not reach provider context");
  harness.assert(customPayload.includes("piSkillReferencePaths"), "Custom message lacks hidden skill path metadata");
  await finish(harness);

  const persistedFiles = [...new Bun.Glob("**/*.jsonl").scanSync(runDirectory)];
  for (const file of persistedFiles) {
    const persisted = readFileSync(`${runDirectory}/${file}`, "utf8");
    harness.assert(!persisted.includes("piSkillReferencePaths"), "Hidden skill path metadata leaked into session history");
    harness.assert(!persisted.includes("referenced skill paths:"), "Hidden skill path block leaked into session history");
  }

  const readCapture = `${runDirectory}/skill-read-provider.jsonl`;
  const readDoc = resolve(root, "extensions/test/e2e/fixture/skill-reference-doc.md");
  const readHarness = await PiTuiHarness.start({
    name: "skill-expansion-read-result",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/skill-expansion-read-provider.ts",
      "extensions/skill-expansion.ts",
    ],
    skills: ["extensions/test/e2e/fixture/skills/alpha/SKILL.md"],
    model: "skill-expansion-read-e2e/fake",
    environment: {
      PI_E2E_SKILL_READ_CAPTURE: readCapture,
      PI_E2E_SKILL_READ_PATH: readDoc,
    },
  });
  await readHarness.submit("READ_SKILL_DOC");
  await readHarness.waitFor("SKILL READ COMPLETE", 15_000);
  readHarness.assert(existsSync(readCapture), "Read-result provider did not capture context");
  const readCaptures = readFileSync(readCapture, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const secondReadPayload = JSON.stringify(readCaptures[1]);
  readHarness.assert(secondReadPayload.includes("Follow `/alpha`"), "Read tool result was not present in provider context");
  readHarness.assert(secondReadPayload.includes("referenced skill paths:"), "Read result lacks hidden skill path message");
  readHarness.assert(secondReadPayload.includes("piSkillReferencePaths"), "Read result lacks hidden block marker");
  await finish(readHarness);
  console.log("PASS skill-expansion user, custom, read-result, and persistence suite");
} finally {
  await cleanupRun(runDirectory);
}
