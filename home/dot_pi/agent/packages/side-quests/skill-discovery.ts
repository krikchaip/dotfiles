import { dirname } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";

import { PiPackageResources } from "./package-resources.ts";

/**
 * Discovers native skills without executing extensions or loading other resources.
 */
export async function discoverPiSkills(
  options: Readonly<{
    /** Selects the native global agent-resource directory. */
    agentDirectory: string;

    /** Selects the new child's project resource scope. */
    cwd: string;
  }>,
): Promise<readonly Skill[]> {
  const settingsManager = SettingsManager.create(
    options.cwd,
    options.agentDirectory,
  );
  const loader = new DefaultResourceLoader({
    agentDir: options.agentDirectory,
    cwd: options.cwd,
    settingsManager,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  // Pi 0.85.1 exposes no package-manager injection option. Keep this versioned
  // adapter on our loader only; never change normal parent package resolution.
  const { packageManager } = loader as unknown as {
    packageManager: DefaultPackageManager;
  };
  new PiPackageResources(
    packageManager,
    settingsManager,
    options.agentDirectory,
    false,
  );
  await loader.reload();
  return loader.getSkills().skills;
}

/**
 * Freezes parent-loaded remote skills, including relative references and dependencies.
 * Local skills remain live files. Native package metadata stays attached to each copy.
 */
export function createPiSkillSnapshot(options: {
  agentDirectory: string;
  cwd: string;
}): (skills: readonly Skill[]) => Promise<readonly Skill[]> {
  const cached = new WeakMap<Skill, Promise<Skill>>();
  return (skills) => {
    const settingsManager = SettingsManager.create(
      options.cwd,
      options.agentDirectory,
    );
    const manager = new DefaultPackageManager({
      agentDir: options.agentDirectory,
      cwd: options.cwd,
      settingsManager,
    });
    const resources = new PiPackageResources(
      manager,
      settingsManager,
      options.agentDirectory,
    );
    return Promise.all(
      skills.map((skill) => {
        const existing = cached.get(skill);
        if (existing) return existing;
        const frozen = (async () => {
          const filePath = await resources.freeze(
            skill.filePath,
            skill.sourceInfo,
          );
          if (filePath === skill.filePath) return skill;
          const packageRoot = skill.sourceInfo.baseDir;
          return {
            ...skill,
            filePath,
            baseDir: dirname(filePath),
            sourceInfo: {
              ...skill.sourceInfo,
              path: filePath,
              baseDir: packageRoot
                ? await resources.freeze(packageRoot, skill.sourceInfo)
                : undefined,
            },
          };
        })();
        cached.set(skill, frozen);
        void frozen.catch(() => {
          if (cached.get(skill) === frozen) cached.delete(skill);
        });
        return frozen;
      }),
    );
  };
}
