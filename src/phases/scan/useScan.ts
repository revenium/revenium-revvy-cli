import { useState, useEffect } from "react";
import { relative } from "path";
import type { ScanResult } from "../../types/scan-result.js";
import {
  detectDependencies,
  detectCallSites,
  detectExistingInstrumentation,
} from "./detectors/index.js";
import { discoverCustomerCandidates } from "./discoveries/customer-discovery.js";
import { discoverCentralizedUtility } from "./discoveries/centralized-utility-discovery.js";

interface UseScanOptions {
  targetDir: string;
  onComplete: (result: ScanResult) => void;
}

type ScanStep =
  | "detecting-dependencies"
  | "scanning-call-sites"
  | "checking-instrumentation"
  | "running-discoveries"
  | "done";

interface ScanState {
  step: ScanStep;
  language?: string;
  providersFound: number;
  callSitesFound: number;
  filesScanned: number;
  existingInstrumentation: boolean;
  centralizedDetected: boolean;
  customerCandidatesFound: number;
  error?: string;
}

export function useScan({ targetDir, onComplete }: UseScanOptions) {
  const [state, setState] = useState<ScanState>({
    step: "detecting-dependencies",
    providersFound: 0,
    callSitesFound: 0,
    filesScanned: 0,
    existingInstrumentation: false,
    centralizedDetected: false,
    customerCandidatesFound: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function runScan() {
      try {
        setState((prev) => ({ ...prev, step: "detecting-dependencies" }));

        const depResult = await detectDependencies(targetDir);

        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          language: depResult.language,
          providersFound: depResult.providers.length,
        }));

        setState((prev) => ({ ...prev, step: "scanning-call-sites" }));

        const callSiteResult = await detectCallSites(
          targetDir,
          depResult.language,
        );

        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          callSitesFound: callSiteResult.callSites.length,
          filesScanned: callSiteResult.totalFiles,
        }));

        setState((prev) => ({ ...prev, step: "checking-instrumentation" }));

        const instrResult = await detectExistingInstrumentation(
          targetDir,
          depResult.language,
        );

        if (cancelled) return;

        // Step 4: Auto-discoveries (customer ID + centralized utility) — these
        // power the consultation phase by replacing blind text questions with
        // confirmation prompts.
        setState((prev) => ({
          ...prev,
          existingInstrumentation: instrResult.detected,
          step: "running-discoveries",
        }));

        const customerCandidates = await discoverCustomerCandidates(
          callSiteResult.scannedFiles,
          depResult.language,
          (absolute) => relative(targetDir, absolute),
        );

        const centralized = discoverCentralizedUtility({
          callSites: callSiteResult.callSites,
        });

        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          step: "done",
          centralizedDetected: centralized.primary !== null,
          customerCandidatesFound: customerCandidates.length,
        }));

        const result: ScanResult = {
          language: depResult.language,
          projectName: depResult.projectName,
          providers: depResult.providers,
          callSites: callSiteResult.callSites,
          existingInstrumentation: instrResult,
          totalFiles: callSiteResult.totalFiles,
          filesWithAICalls: callSiteResult.filesWithAICalls,
          customerCandidates,
          centralizedUtility: centralized.primary,
          alternativeCentralizedUtilities: centralized.alternatives,
        };

        onComplete(result);
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            step: "done",
            error:
              error instanceof Error
                ? error.message
                : "Scan failed unexpectedly",
          }));
        }
      }
    }

    runScan();

    return () => {
      cancelled = true;
    };
  }, [targetDir]);

  return state;
}
