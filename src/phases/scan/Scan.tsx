import { useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { colors } from "../../constants/colors.js";
import { NOTHING_SET_UP_EXIT_CODE } from "./no-ai-calls.js";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useScan } from "./useScan.js";
import type { ScanResult } from "../../types/scan-result.js";

interface ScanProps {
  targetDir: string;
  onComplete: (result: ScanResult) => void;
  /**
   * Called instead of exiting when no AI calls are found but an earlier phase
   * already set something up (billing providers in "both" mode).
   */
  onNothingToSetUp?: () => void;
}

export function Scan({ targetDir, onComplete, onNothingToSetUp }: ScanProps) {
  const state = useScan({ targetDir, onComplete });
  const { exit } = useApp();

  useEffect(() => {
    if (!state.nothingToSetUp || onNothingToSetUp) return;
    process.exitCode = NOTHING_SET_UP_EXIT_CODE;
    exit();
  }, [state.nothingToSetUp]);

  useInput(
    () => onNothingToSetUp?.(),
    { isActive: Boolean(state.nothingToSetUp && onNothingToSetUp) },
  );

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

        {state.nothingToSetUp && (
          <Box flexDirection="column" marginTop={1}>
            {state.nothingToSetUp.map((line, i) => (
              <Text key={i} color={i === 0 ? colors.error : undefined}>{line}</Text>
            ))}
            {onNothingToSetUp && <Text dimColor>{"\n"}  Press any key to continue...</Text>}
          </Box>
        )}
      </Box>
    </Box>
  );
}
