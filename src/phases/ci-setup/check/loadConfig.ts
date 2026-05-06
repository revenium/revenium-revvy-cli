import { readFile } from "fs/promises";
import { join } from "path";

export interface ReveniumCheckConfig {
  /** Files or glob patterns to ignore (e.g. wrapper files, test files) */
  ignore?: string[];
  /** Additional import patterns that count as "wrapped" */
  customWrapperImports?: string[];
  /** Providers to skip checking (e.g. if you use a custom gateway) */
  skipProviders?: string[];
}

const CONFIG_FILENAMES = [".reveniumrc", ".reveniumrc.json"];

export async function loadConfig(targetDir: string): Promise<ReveniumCheckConfig> {
  for (const filename of CONFIG_FILENAMES) {
    try {
      const content = await readFile(join(targetDir, filename), "utf-8");
      return JSON.parse(content) as ReveniumCheckConfig;
    } catch {
      // file not found or invalid JSON — try next
    }
  }
  return {};
}
