import { useState, useEffect, useCallback } from "react";
import { readFile, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import type { ScanResult } from "../../types/scan-result.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import {
  previewInstrumentation,
  instrumentCallSites,
  getInstallCommand,
  generateEnvContent,
  type PreviewResult,
  type InstrumentationResult,
} from "./instrumenter.js";
import { fileExists } from "../../utils/fs-helpers.js";

interface UseInstrumentOptions {
  targetDir: string;
  scanResult: ScanResult;
  meteringDesign: MeteringDesign;
  apiKey?: string;
  onComplete: (result: InstrumentationResult, installCmd: string) => void;
}

export type InstrumentStep =
  | "previewing"
  | "awaiting-confirm"
  | "instrumenting"
  | "setting-env"
  | "done";

export type PreviewAction = "apply" | "show-example" | "write-list" | "cancel";

interface InstrumentState {
  step: InstrumentStep;
  preview: PreviewResult | null;
  result: InstrumentationResult | null;
  installCommand: string;
  envUpdated: boolean;
  listWritten: boolean;
  showingExample: boolean;
  error?: string;
}

export function useInstrument({
  targetDir,
  scanResult,
  meteringDesign,
  apiKey,
  onComplete,
}: UseInstrumentOptions) {
  const [state, setState] = useState<InstrumentState>({
    step: "previewing",
    preview: null,
    result: null,
    installCommand: "",
    envUpdated: false,
    listWritten: false,
    showingExample: false,
  });

  // Step 1: Run preview (dry-run) on mount
  useEffect(() => {
    let cancelled = false;

    async function runPreview() {
      try {
        const preview = await previewInstrumentation(
          targetDir,
          scanResult,
          meteringDesign,
        );

        if (cancelled) return;

        const installCmd = getInstallCommand(meteringDesign);

        setState((prev) => ({
          ...prev,
          step: "awaiting-confirm",
          preview,
          installCommand: installCmd,
        }));
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            step: "done",
            error: error instanceof Error ? error.message : "Preview failed",
          }));
        }
      }
    }

    runPreview();
    return () => { cancelled = true; };
  }, [targetDir, scanResult, meteringDesign]);

  // Step 2: User confirms → run actual instrumentation
  const confirmAction = useCallback(
    async (action: PreviewAction) => {
      if (action === "cancel") {
        const emptyResult: InstrumentationResult = {
          filesModified: 0,
          totalChanges: 0,
          changes: [],
          errors: [],
        };
        onComplete(emptyResult, state.installCommand);
        return;
      }

      if (action === "show-example") {
        if (state.preview?.example) {
          const ex = state.preview.example;
          const exampleContent = [
            `# Revvy Example: ${ex.filePath}`,
            "# This shows what the instrumented code will look like.",
            "",
            "=".repeat(60),
            "BEFORE (original code):",
            "=".repeat(60),
            "",
            ex.before,
            "",
            "=".repeat(60),
            "AFTER (with Revenium instrumentation):",
            "=".repeat(60),
            "",
            ex.after,
          ].join("\n");
          await writeFile(join(targetDir, "revvy-example.txt"), exampleContent, "utf-8");
        }
        setState((prev) => ({ ...prev, showingExample: true }));
        return;
      }

      if (action === "write-list") {
        const lines = (state.preview?.files ?? []).map((f) => {
          const changes = f.changes.map((c) => `  + ${c}`).join("\n");
          return `${f.filePath} (${f.providers.join(", ")})\n${changes}`;
        });
        const content = [
          "# Revvy Instrumentation Preview",
          `# ${state.preview?.totalFiles ?? 0} files, ${state.preview?.totalChanges ?? 0} changes`,
          "",
          ...lines,
          "",
        ].join("\n");
        await writeFile(join(targetDir, "revvy-changes.txt"), content, "utf-8");
        setState((prev) => ({ ...prev, listWritten: true }));
        return;
      }

      // action === "apply"
      setState((prev) => ({ ...prev, step: "instrumenting", preview: null, showingExample: false }));

      try {
        const instrumentResult = await instrumentCallSites(
          targetDir,
          scanResult,
          meteringDesign,
        );

        setState((prev) => ({
          ...prev,
          result: instrumentResult,
          step: "setting-env",
        }));

        const envPath = join(targetDir, ".env");
        const envContent = generateEnvContent(apiKey);

        if (await fileExists(envPath)) {
          const existing = await readFile(envPath, "utf-8");
          if (!existing.includes("REVENIUM_METERING_API_KEY")) {
            await appendFile(envPath, envContent);
            setState((prev) => ({ ...prev, envUpdated: true }));
          }
        } else {
          await writeFile(envPath, envContent.trimStart(), "utf-8");
          setState((prev) => ({ ...prev, envUpdated: true }));
        }

        setState((prev) => ({ ...prev, step: "done" }));
        onComplete(instrumentResult, state.installCommand);
      } catch (error) {
        setState((prev) => ({
          ...prev,
          step: "done",
          error: error instanceof Error ? error.message : "Instrumentation failed",
        }));
      }
    },
    [targetDir, scanResult, meteringDesign, apiKey, onComplete, state.installCommand, state.preview],
  );

  return { ...state, confirmAction };
}
