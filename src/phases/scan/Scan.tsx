import { Box, Text } from "ink";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useScan } from "./useScan.js";
import type { ScanResult } from "../../types/scan-result.js";

interface ScanProps {
  targetDir: string;
  onComplete: (result: ScanResult) => void;
}

export function Scan({ targetDir, onComplete }: ScanProps) {
  const state = useScan({ targetDir, onComplete });

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>Scanning your codebase...</Text>
      <Box flexDirection="column" marginTop={1}>
        {state.step === "detecting-dependencies" && (
          <Spinner label="Detecting AI provider SDKs..." />
        )}
        {state.language && (
          <StatusLine
            icon="✓"
            label={`Language: ${state.language === "node" ? "Node.js / TypeScript" : state.language === "python" ? "Python" : "Go"}`}
            status="success"
          />
        )}
        {state.providersFound > 0 && state.step !== "detecting-dependencies" && (
          <StatusLine
            icon="✓"
            label={`Found ${state.providersFound} AI provider SDK${state.providersFound > 1 ? "s" : ""}`}
            status="success"
          />
        )}
        {state.providersFound === 0 &&
          state.step !== "detecting-dependencies" && (
            <StatusLine
              icon="⚠"
              label="No AI provider SDKs detected in dependencies"
              status="warning"
            />
          )}

        {state.step === "scanning-call-sites" && (
          <Spinner label="Scanning for AI call sites..." />
        )}
        {state.callSitesFound > 0 && state.step !== "scanning-call-sites" && (
          <StatusLine
            icon="✓"
            label={`Found ${state.callSitesFound} AI call site${state.callSitesFound > 1 ? "s" : ""} across ${state.filesScanned} files`}
            status="success"
          />
        )}

        {state.step === "checking-instrumentation" && (
          <Spinner label="Checking for existing Revenium instrumentation..." />
        )}
        {(state.step === "running-discoveries" || state.step === "done") &&
          !state.existingInstrumentation && (
            <StatusLine
              icon="ℹ"
              label="No existing Revenium instrumentation found"
              status="info"
            />
          )}
        {(state.step === "running-discoveries" || state.step === "done") &&
          state.existingInstrumentation && (
            <StatusLine
              icon="⚠"
              label="Existing Revenium instrumentation detected — will avoid double-wrapping"
              status="warning"
            />
          )}

        {state.step === "running-discoveries" && (
          <Spinner label="Discovering customer ID patterns + shared AI utility..." />
        )}
        {state.step === "done" && state.customerCandidatesFound > 0 && (
          <StatusLine
            icon="✓"
            label={`Found ${state.customerCandidatesFound} candidate customer ID pattern${state.customerCandidatesFound > 1 ? "s" : ""}`}
            status="success"
          />
        )}
        {state.step === "done" && state.centralizedDetected && (
          <StatusLine
            icon="✓"
            label="Detected a centralized AI utility — will suggest single-point instrumentation"
            status="success"
          />
        )}
        {state.step === "done" &&
          !state.centralizedDetected &&
          state.callSitesFound > 0 && (
            <StatusLine
              icon="ℹ"
              label="AI calls look scattered across files — will instrument each call site"
              status="info"
            />
          )}

        {state.error && (
          <StatusLine icon="✗" label={state.error} status="error" />
        )}
      </Box>
    </Box>
  );
}
