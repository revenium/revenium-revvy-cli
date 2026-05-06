import { join } from "path";
import { writeFile } from "fs/promises";
import type { InstrumentationResult } from "../../instrument/instrumenter.js";
import { getDesignFilename } from "./design-writer.js";
import { getManifestFilename } from "./manifest-writer.js";
import { getMonorepoTodoFilename } from "../../non-interactive/monorepo-todo-writer.js";

const FILENAME = "revenium-modified-files.json";

export interface ModifiedFilesManifest {
  version: "1.0";
  modifiedFiles: Array<{ file: string; changes: string[] }>;
  generatedFiles: string[];
  /**
   * In a monorepo, the config helper and `.env` aren't written at the repo
   * root because the right location depends on the workspace layout. When
   * this is true, agents should consult `revenium-monorepo-todo.md` for the
   * intended placement instead of expecting `src/revenium-config.ts` /
   * `.env` to exist at the root.
   */
  monorepo?: boolean;
}

export interface ModifiedFilesManifestArgs {
  instrumentResult: InstrumentationResult;
  language: "node" | "python" | "go";
  envCreated: boolean;
  /** Set true when the project layout is a monorepo (helper + .env held back). */
  isMonorepo?: boolean;
  /**
   * Extra files generated outside the core helper/manifest set — e.g. the CI
   * workflow YAML and the per-editor rule + agent-prompt files. Passed in by
   * the pipeline because the manifest is written before/after the CI step
   * depending on flow, and we want the manifest to be a complete record.
   */
  extraGeneratedFiles?: string[];
}

export function buildModifiedFilesManifest(args: ModifiedFilesManifestArgs): ModifiedFilesManifest {
  const { instrumentResult, language, envCreated, isMonorepo, extraGeneratedFiles } = args;

  const generatedFiles: string[] = [
    getDesignFilename(language),
    getManifestFilename(language),
  ];

  if (isMonorepo) {
    // In a monorepo, revvy intentionally skips writing the config helper +
    // `.env` at the root and writes `revenium-monorepo-todo.md` instead.
    // Reflect that here so the manifest doesn't claim files exist that don't.
    generatedFiles.push(getMonorepoTodoFilename());
  } else {
    generatedFiles.push(language === "python" ? "revenium_config.py" : "src/revenium-config.ts");
    if (envCreated) generatedFiles.push(".env");
  }

  if (extraGeneratedFiles) {
    for (const f of extraGeneratedFiles) generatedFiles.push(f);
  }

  generatedFiles.push(FILENAME);

  return {
    version: "1.0",
    modifiedFiles: instrumentResult.changes.map((c) => ({
      file: c.filePath,
      changes: c.changes,
    })),
    generatedFiles,
    ...(isMonorepo ? { monorepo: true as const } : {}),
  };
}

export async function writeModifiedFilesManifest(
  targetDir: string,
  args: ModifiedFilesManifestArgs,
): Promise<string | null> {
  if (args.instrumentResult.filesModified === 0) return null;

  const manifest = buildModifiedFilesManifest(args);
  const filePath = join(targetDir, FILENAME);
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return filePath;
}
