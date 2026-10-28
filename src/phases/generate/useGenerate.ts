import { useState, useEffect } from "react";
import { join } from "path";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { ScanResult } from "../../types/scan-result.js";
import { safeWriteFile } from "../../utils/fs-helpers.js";
import { writeMeteringDesign, getDesignFilename } from "./utils/design-writer.js";
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
  generatedFiles: string[];
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
    generatedFiles: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      const generatedFiles: string[] = [];

      try {
        setState((prev) => ({ ...prev, step: "writing-design" }));
        await writeMeteringDesign(targetDir, meteringDesign);
        generatedFiles.push(getDesignFilename(meteringDesign.detectedLanguage));

        if (cancelled) return;

        setState((prev) => ({ ...prev, step: "generating-utility" }));

        const utilityContent = renderConfigHelper(meteringDesign);
        const fileName = configHelperFileName(meteringDesign.detectedLanguage);
        const filePath = join(targetDir, fileName);

        if (cancelled) return;

        setState((prev) => ({ ...prev, step: "writing-files" }));
        await safeWriteFile(filePath, utilityContent);
        generatedFiles.push(fileName);

        if (cancelled) return;

        setState({
          step: "done",
          generatedFiles,
        });

        onComplete(generatedFiles);
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
