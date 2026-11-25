import { useState, useCallback } from "react";
import type { CISetupResult } from "../../types/revvy-state.js";
import type { GeneratedFileResult } from "../../utils/generated-file.js";
import { writeEditorFiles, writeGitHubWorkflow } from "./ci-files-writer.js";
import { FEATURE_FLAGS } from "../../feature-flags.js";
import { detectPackageManager } from "../../utils/package-manager.js";

export type CISetupChoice = "github" | "editor" | "both" | "skip";

interface CISetupState {
  step: "choosing" | "generating" | "done";
  results: GeneratedFileResult[];
  error?: string;
}

interface UseCISetupOptions {
  targetDir: string;
  language: "node" | "python" | "go";
  /** Providers detected in the project — used to tailor the editor rules so they only mention SDKs actually present. */
  detectedProviders?: readonly string[];
  onComplete: (result: CISetupResult) => void;
}

export function useCISetup({ targetDir, language, detectedProviders, onComplete }: UseCISetupOptions) {
  const [state, setState] = useState<CISetupState>({
    step: "choosing",
    results: [],
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

      setState({ step: "generating", results: [] });

      const results: GeneratedFileResult[] = [];
      const doGithub = (choice === "github" || choice === "both") && FEATURE_FLAGS.CI_GITHUB_ACTIONS;
      const doEditor = (choice === "editor" || choice === "both") && FEATURE_FLAGS.CI_EDITOR_RULES;

      try {
        if (doGithub) {
          const pmInfo = language === "node" ? await detectPackageManager(targetDir).catch(() => undefined) : undefined;
          results.push(await writeGitHubWorkflow(targetDir, pmInfo));
        }

        if (doEditor) {
          for await (const result of writeEditorFiles(targetDir, language, detectedProviders)) results.push(result);
        }

        setState({ step: "done", results });

        const result: CISetupResult = {
          githubAction: doGithub,
          editorRules: doEditor,
          generatedFiles: results.map((r) => r.file),
        };
        onComplete(result);
      } catch (err) {
        setState({
          step: "done",
          results,
          error: err instanceof Error ? err.message : "Failed to generate files",
        });
        onComplete({
          githubAction: false,
          editorRules: false,
          generatedFiles: results.map((r) => r.file),
        });
      }
    },
    [targetDir, language, detectedProviders, onComplete],
  );

  return { state, selectChoice };
}
