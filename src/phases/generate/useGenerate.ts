import { useState, useEffect } from "react";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { ScanResult } from "../../types/scan-result.js";
import { writeGeneratedFile, type GeneratedFileResult } from "../../utils/generated-file.js";
import { describeGitignoreUpdate, ensureRevvyFilesIgnored, trackedFilesWarning } from "../../utils/gitignore.js";
import { writeMeteringDesign } from "./utils/design-writer.js";
import { configHelperFileName, renderConfigHelper } from "./config-helper.js";

interface UseGenerateOptions {
  targetDir: string;
  meteringDesign: MeteringDesign;
  scanResult: ScanResult;
  onComplete: (files: string[]) => void;
}

type GenerateStep =
  | "writing-design"
  | "generating-utility"
  | "writing-files"
  | "done";

interface GenerateState {
  step: GenerateStep;
  results: GeneratedFileResult[];
  gitignoreSummary?: string;
  trackedWarning?: string;
  error?: string;
}

export function useGenerate({
  targetDir,
  meteringDesign,
  scanResult: _scanResult,
  onComplete,
}: UseGenerateOptions) {
  const [state, setState] = useState<GenerateState>({
    step: "writing-design",
    results: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      const results: GeneratedFileResult[] = [];

      try {
        const gitignoreUpdate = await ensureRevvyFilesIgnored(targetDir);
        setState((prev) => ({
          ...prev,
          step: "writing-design",
          gitignoreSummary: describeGitignoreUpdate(gitignoreUpdate),
          trackedWarning: trackedFilesWarning(gitignoreUpdate) ?? undefined,
        }));
        results.push(await writeMeteringDesign(targetDir, meteringDesign));
        setState((prev) => ({ ...prev, results: [...results] }));

        if (cancelled) return;

        setState((prev) => ({ ...prev, step: "generating-utility" }));

        const utilityContent = renderConfigHelper(meteringDesign);
        const fileName = configHelperFileName(meteringDesign.detectedLanguage);

        if (cancelled) return;

        setState((prev) => ({ ...prev, step: "writing-files" }));
        results.push(await writeGeneratedFile(targetDir, fileName, utilityContent));

        if (cancelled) return;

        setState((prev) => ({ ...prev, step: "done", results: [...results] }));

        onComplete(results.map((r) => r.file));
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            step: "done",
            error:
              error instanceof Error
                ? error.message
                : "Generation failed unexpectedly",
          }));
        }
      }
    }

    generate();

    return () => {
      cancelled = true;
    };
  }, [targetDir, meteringDesign]);

  return state;
}
