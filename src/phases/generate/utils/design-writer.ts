import { writeGeneratedFile, type GeneratedFileResult } from "../../../utils/generated-file.js";
import type { MeteringDesign } from "../../../types/metering-design.js";

/**
 * Returns the design filename based on the detected language.
 * Python projects use snake_case (revenium_metering_design.json) to
 * match Python naming conventions; all others use kebab-case.
 */
export function getDesignFilename(language?: string): string {
  return language === "python"
    ? "revenium_metering_design.json"
    : "revenium-metering-design.json";
}

export async function writeMeteringDesign(
  targetDir: string,
  design: MeteringDesign
): Promise<GeneratedFileResult> {
  const content = JSON.stringify(design, null, 2) + "\n";
  return writeGeneratedFile(targetDir, getDesignFilename(design.detectedLanguage), content);
}
