import { join } from "path";
import { safeWriteFile } from "../../../utils/fs-helpers.js";
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
): Promise<string> {
  const filename = getDesignFilename(design.detectedLanguage);
  const filePath = join(targetDir, filename);
  const content = JSON.stringify(design, null, 2) + "\n";
  await safeWriteFile(filePath, content);
  return filePath;
}
