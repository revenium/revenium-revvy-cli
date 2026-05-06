import { useState, useEffect } from "react";
import { join } from "path";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { ScanResult } from "../../types/scan-result.js";
import { renderTemplate } from "../../utils/template-engine.js";
import { safeWriteFile } from "../../utils/fs-helpers.js";
import { writeMeteringDesign, getDesignFilename } from "./utils/design-writer.js";

// Templates are loaded as strings via tsup's .ejs loader.
import nodeTemplate from "./templates/node-ts/revenium-config.ts.ejs";
import pythonTemplate from "./templates/python/revenium_config.py.ejs";

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

function getTemplateData(design: MeteringDesign) {
  return {
    providers: design.detectedProviders,
    organization: design.organization,
    products: design.products,
    agents: design.agents,
    taskTypes: design.taskTypes,
    trackingGoal: design.trackingGoal,
    outcomeTracking: design.outcomeTracking,
    centralizedCallPattern: design.centralizedCallPattern,
  };
}

function getUtilityFilePath(
  targetDir: string,
  language: string
): { filePath: string; fileName: string } {
  switch (language) {
    case "python":
      return {
        filePath: join(targetDir, "revenium_config.py"),
        fileName: "revenium_config.py",
      };
    case "go":
      return {
        filePath: join(targetDir, "revenium_config.go"),
        fileName: "revenium_config.go",
      };
    case "node":
    default:
      return {
        filePath: join(targetDir, "src", "revenium-config.ts"),
        fileName: "src/revenium-config.ts",
      };
  }
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

        const templateData = getTemplateData(meteringDesign);
        const language = meteringDesign.detectedLanguage;

        let template: string;
        switch (language) {
          case "python":
            template = pythonTemplate;
            break;
          case "node":
          default:
            template = nodeTemplate;
            break;
        }

        const utilityContent = renderTemplate(template, templateData);
        const { filePath, fileName } = getUtilityFilePath(
          targetDir,
          language
        );

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
