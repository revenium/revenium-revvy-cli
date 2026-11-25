import type { ScanResult } from "../../types/scan-result.js";

/** Exit code the agent guide documents for "nothing was set up". */
export const NOTHING_SET_UP_EXIT_CODE = 1;

export function hasNothingToSetUp(scanResult: ScanResult): boolean {
  return scanResult.callSites.length === 0;
}

export function nothingToSetUpLines(scanResult: ScanResult, dryRun: boolean): string[] {
  const declared = scanResult.providers.map((p) => p.displayName);
  return [
    dryRun
      ? "Nothing to set up — no AI calls found. A real run would write no files."
      : "Nothing to set up — no AI calls found. No files were written.",
    "",
    `  Scanned ${scanResult.totalFiles} files and found no ${scanResult.language} AI SDK calls.`,
    ...(declared.length > 0
      ? [`  Declared AI SDK dependencies (${declared.join(", ")}) have no call sites revvy recognises.`]
      : []),
    "",
    "  Check that --target-dir points at the project that makes the AI calls,",
    "  and that --exclude / .revvyignore aren't filtering them out.",
  ];
}
