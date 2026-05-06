import { useState, useCallback } from "react";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import type { CISetupResult } from "../../types/revvy-state.js";
import { buildGitHubActionWorkflow } from "./templates/githubAction.js";
import { getEditorRules } from "./templates/editorRules.js";
import { AGENT_PROMPT } from "./templates/agentPrompt.js";
import { FEATURE_FLAGS } from "../../feature-flags.js";
import { detectPackageManager } from "../../utils/package-manager.js";

export type CISetupChoice = "github" | "editor" | "both" | "skip";

interface CISetupState {
  step: "choosing" | "generating" | "done";
  generatedFiles: string[];
  error?: string;
}

interface UseCISetupOptions {
  targetDir: string;
  language: "node" | "python" | "go";
  /** Providers detected in the project — used to tailor the editor rules so they only mention SDKs actually present. */
  detectedProviders?: readonly string[];
  onComplete: (result: CISetupResult) => void;
}

async function ensureDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

export function useCISetup({ targetDir, language, detectedProviders, onComplete }: UseCISetupOptions) {
  const [state, setState] = useState<CISetupState>({
    step: "choosing",
    generatedFiles: [],
  });

  const selectChoice = useCallback(
    async (choice: CISetupChoice) => {
      if (choice === "skip") {
        const result: CISetupResult = {
          githubAction: false,
          editorRules: false,
          generatedFiles: [],
        };
        onComplete(result);
        return;
      }

      setState({ step: "generating", generatedFiles: [] });

      const files: string[] = [];
      const doGithub = (choice === "github" || choice === "both") && FEATURE_FLAGS.CI_GITHUB_ACTIONS;
      const doEditor = (choice === "editor" || choice === "both") && FEATURE_FLAGS.CI_EDITOR_RULES;

      try {
        if (doGithub) {
          const path = join(targetDir, ".github/workflows/revenium-check.yml");
          await ensureDir(path);
          const pmInfo = language === "node" ? await detectPackageManager(targetDir).catch(() => undefined) : undefined;
          await writeFile(path, buildGitHubActionWorkflow(pmInfo), "utf-8");
          files.push(".github/workflows/revenium-check.yml");
        }

        if (doEditor) {
          const editorRulesContent = getEditorRules(language, detectedProviders);

          for (const dir of [".cursor", ".claude", ".gemini", ".codex"]) {
            const rulesPath = join(targetDir, `${dir}/rules/revenium.md`);
            await ensureDir(rulesPath);
            await writeFile(rulesPath, editorRulesContent, "utf-8");
            files.push(`${dir}/rules/revenium.md`);
          }

          // agent prompt — teaches AI assistants how to use revvy CLI
          for (const dir of [".claude", ".cursor", ".gemini", ".codex"]) {
            const agentPath = join(targetDir, dir, "revvy-agent.md");
            await ensureDir(agentPath);
            await writeFile(agentPath, AGENT_PROMPT, "utf-8");
            files.push(`${dir}/revvy-agent.md`);
          }
        }

        setState({ step: "done", generatedFiles: files });

        const result: CISetupResult = {
          githubAction: doGithub,
          editorRules: doEditor,
          generatedFiles: files,
        };
        onComplete(result);
      } catch (err) {
        setState({
          step: "done",
          generatedFiles: files,
          error: err instanceof Error ? err.message : "Failed to generate files",
        });
        onComplete({
          githubAction: false,
          editorRules: false,
          generatedFiles: files,
        });
      }
    },
    [targetDir, language, detectedProviders, onComplete],
  );

  return { state, selectChoice };
}
