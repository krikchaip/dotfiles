import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  cleanupSuite,
  CYCLE_ID,
  CURRENT_ID,
  PARENT_ID,
  readHeader,
  reportSuite,
  scenario,
  scenarioPaths,
  type SessionSeed,
  withHarness,
} from "./fixture/session-topology-harness.ts";

try {
  await scenario("parent-manage-and-jump", async () => {
    const paths = scenarioPaths("parent-manage-and-jump");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      name: "Autocomplete Child Candidate",
      messages: [{ role: "user", text: "CURRENT_BODY" }],
    };
    const parent: SessionSeed = {
      id: PARENT_ID,
      path: paths.parent,
      cwd: paths.cwd,
      name: "Parent Session",
      messages: [{ role: "user", text: "PARENT_BODY" }],
    };
    const cycle: SessionSeed = {
      id: CYCLE_ID,
      path: paths.cycle,
      cwd: paths.cwd,
      parentSession: paths.current,
      name: "Cycle Session",
    };
    await withHarness(
      "parent-manage-and-jump",
      {
        extensions: ["extensions/parent-session.ts"],
        session: current,
        sessions: [parent, cycle],
      },
      async (harness) => {
        await harness.sendLiteral("/parent ");
        const autocomplete = await harness.waitFor(
          "Remove current parent link",
        );
        harness.assert(
          autocomplete.includes("Parent Session"),
          "Parent completion omitted session name",
        );
        harness.assert(
          autocomplete.includes(PARENT_ID.slice(0, 8)),
          "Parent completion omitted UUID segment",
        );
        await harness.sendKeys("C-u");

        await harness.submitCommand(`/parent ${PARENT_ID.slice(0, 8)}`);
        await harness.waitFor("Parent session set: Parent Session");
        harness.assert(
          readHeader(paths.current).parentSession === paths.parent,
          "Parent header was not set",
        );

        await harness.submitCommand(`/parent ${CURRENT_ID}`);
        await harness.waitFor("Current session cannot be its own parent");
        harness.assert(
          readHeader(paths.current).parentSession === paths.parent,
          "Self-parent guard changed header",
        );

        await harness.submitCommand(`/parent ${CYCLE_ID.slice(0, 8)}`);
        await harness.waitFor("Parent link would create a cycle");
        harness.assert(
          readHeader(paths.current).parentSession === paths.parent,
          "Cycle guard changed header",
        );

        await harness.submitCommand("/parent --rm");
        await harness.waitFor("Removed parent link: Parent Session");
        harness.assert(
          readHeader(paths.current).parentSession === undefined,
          "Parent header was not removed",
        );
        await harness.submitCommand("/parent");
        await harness.waitFor("No parent session linked");

        await harness.submitCommand(`/parent ${PARENT_ID}`);
        await harness.waitFor("Parent session set: Parent Session");
        await harness.submitCommand("/parent");
        const switched = await harness.waitFor(
          "SESSION TOPOLOGY READY 22222222",
        );
        harness.assert(
          switched.includes("PARENT_BODY"),
          "Parent jump did not load parent active branch",
        );
        harness.assert(
          switched.includes("Parent Session"),
          "Parent jump did not load parent session metadata",
        );

        await harness.tmux("clear-history", "-t", harness.paneId);
        await harness.sendLiteral("/parent ");
        const switchedAutocomplete = await harness.waitFor(
          "Autocomplete Child Candidate",
        );
        harness.assert(
          switchedAutocomplete.includes(CURRENT_ID.slice(0, 8)),
          "Parent autocomplete after session switch used the stale session context",
        );
        await harness.sendKeys("C-u");
        console.log("PASS parent-session autocomplete-after-switch-376e6fb6");
      },
    );
  });

  await scenario("parent-ephemeral-and-invalid", async () => {
    await withHarness(
      "parent-ephemeral-and-invalid",
      { extensions: ["extensions/parent-session.ts"], ephemeral: true },
      async (harness) => {
        await harness.submitCommand("/parent not-an-id");
        await harness.waitFor(
          "Current session is ephemeral; no parent session",
        );
      },
    );
  });

  await scenario("parent-resolution-errors", async () => {
    const paths = scenarioPaths("parent-resolution-errors");
    const duplicateA = join(dirname(paths.current), "duplicate-a.jsonl");
    const duplicateB = join(dirname(paths.current), "duplicate-b.jsonl");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: [{ role: "user", text: "RESOLUTION_CURRENT" }],
    };
    const duplicates: SessionSeed[] = [
      {
        id: "44444444-1111-7111-8111-111111111111",
        path: duplicateA,
        cwd: paths.cwd,
        name: "Duplicate A",
      },
      {
        id: "44444444-2222-7222-8222-222222222222",
        path: duplicateB,
        cwd: paths.cwd,
        name: "Duplicate B",
      },
    ];
    await withHarness(
      "parent-resolution-errors",
      {
        extensions: ["extensions/parent-session.ts"],
        session: current,
        sessions: duplicates,
      },
      async (harness) => {
        const before = readFileSync(paths.current, "utf8");
        await harness.submitCommand("/parent bad-id");
        await harness.waitFor("Usage: /parent [--rm|<session-id>]");
        await harness.submitCommand("/parent deadbeef");
        await harness.waitFor("No session found matching: deadbeef");
        await harness.submitCommand("/parent 44444444");
        await harness.waitFor(
          "Ambiguous session id in current project: 44444444",
        );
        harness.assert(
          readFileSync(paths.current, "utf8") === before,
          "Resolution guard changed current session",
        );
      },
    );
  });

  await scenario("parent-header-body-preservation", async () => {
    const paths = scenarioPaths("parent-header-body-preservation");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: [{ role: "user", text: "BODY_MUST_STAY_BYTE_IDENTICAL" }],
    };
    const parent: SessionSeed = {
      id: PARENT_ID,
      path: paths.parent,
      cwd: paths.cwd,
    };
    await withHarness(
      "parent-header-body-preservation",
      {
        extensions: ["extensions/parent-session.ts"],
        session: current,
        sessions: [parent],
      },
      async (harness) => {
        const bodyBefore = readFileSync(paths.current, "utf8").slice(
          readFileSync(paths.current, "utf8").indexOf("\n"),
        );
        await harness.submitCommand(`/parent ${PARENT_ID}`);
        await harness.waitFor("Parent session set:");
        const afterSet = readFileSync(paths.current, "utf8");
        harness.assert(
          afterSet.slice(afterSet.indexOf("\n")) === bodyBefore,
          "Setting parent rewrote conversation bytes",
        );
        await harness.submitCommand("/parent --rm");
        await harness.waitFor("Removed parent link:");
        const afterRemove = readFileSync(paths.current, "utf8");
        harness.assert(
          afterRemove.slice(afterRemove.indexOf("\n")) === bodyBefore,
          "Removing parent rewrote conversation bytes",
        );
      },
    );
  });

  await scenario("parent-concurrent-append", async () => {
    const paths = scenarioPaths("parent-concurrent-append");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: [{ role: "user", text: "CONCURRENT_CURRENT" }],
    };
    const parent: SessionSeed = {
      id: PARENT_ID,
      path: paths.parent,
      cwd: paths.cwd,
    };
    await withHarness(
      "parent-concurrent-append",
      {
        extensions: ["extensions/parent-session.ts"],
        session: current,
        sessions: [parent],
      },
      async (harness) => {
        appendFileSync(
          paths.current,
          `${JSON.stringify({ type: "custom", id: "large-entry", parentId: null, timestamp: new Date().toISOString(), data: "x".repeat(8_000_000) })}\n`,
        );
        const concurrentEntry = JSON.stringify({
          type: "session_info",
          id: "concurrent-append",
          parentId: null,
          timestamp: new Date().toISOString(),
          name: "Concurrent append must survive",
        });
        const watcherReady = join(
          dirname(paths.current),
          "parent-watcher.ready",
        );
        const watcherOutcome = join(
          dirname(paths.current),
          "parent-watcher.outcome",
        );
        const watcher = Bun.spawn([
          process.execPath,
          join(import.meta.dir, "fixture/parent-concurrent-watcher.ts"),
          paths.current,
          watcherReady,
          watcherOutcome,
          concurrentEntry,
        ]);

        try {
          await harness.waitUntil(
            "parent race watcher readiness",
            () => existsSync(watcherReady),
            3_000,
          );
          await harness.submitCommand(`/parent ${PARENT_ID}`);
          await harness.waitFor("Parent session set:", 15_000);
          await harness.waitUntil(
            "bounded parent race injection outcome",
            () => existsSync(watcherOutcome),
            6_000,
          );
          const outcome = readFileSync(watcherOutcome, "utf8").trim();
          harness.assert(
            outcome.startsWith("appended-via-"),
            `Parent race injection was not established: ${outcome}`,
          );
          harness.assert(
            readFileSync(paths.current, "utf8").includes(
              '"id":"concurrent-append"',
            ),
            "Parent header rewrite lost a concurrent session append",
          );
        } finally {
          try {
            watcher.kill();
          } catch {}
          const stopped = await Promise.race([
            watcher.exited.then(() => true),
            Bun.sleep(1_000).then(() => false),
          ]);
          if (!stopped) {
            try {
              watcher.kill(9);
            } catch {}
            await Promise.race([watcher.exited, Bun.sleep(1_000)]);
          }
        }
      },
    );
  });

  reportSuite("parent-session");
} finally {
  await cleanupSuite();
}
