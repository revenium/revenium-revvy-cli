import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../../constants/colors.js";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useInstrument, type PreviewAction } from "./useInstrument.js";
import type { ScanResult } from "../../types/scan-result.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { InstrumentationResult } from "./instrumenter.js";

interface InstrumentProps {
  targetDir: string;
  scanResult: ScanResult;
  meteringDesign: MeteringDesign;
  apiKey?: string;
  onComplete: (result: InstrumentationResult, installCmd: string) => void;
}

/** Preview confirmation select — inline, no Question component needed. */
function PreviewSelect({
  listWritten,
  onSelect,
}: {
  listWritten: boolean;
  onSelect: (action: PreviewAction) => void;
}) {
  const options: Array<{ label: string; value: PreviewAction }> = [
    { label: "Apply all changes (backups will be created)", value: "apply" },
    { label: "Show me an example first", value: "show-example" },
  ];
  if (!listWritten) {
    options.push({ label: "Write change list to revvy-changes.txt", value: "write-list" });
  } else {
    options.push({ label: "Change list written to revvy-changes.txt", value: "write-list" });
  }
  options.push({ label: "Cancel — don't modify any files", value: "cancel" });

  const [idx, setIdx] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIdx((p) => (p > 0 ? p - 1 : options.length - 1));
    if (key.downArrow) setIdx((p) => (p < options.length - 1 ? p + 1 : 0));
    if (key.return) {
      const selected = options[idx]!;
      if (selected.value === "write-list" && listWritten) return;
      onSelect(selected.value);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text color={colors.primary} bold>?</Text>
        <Text bold>How would you like to proceed?</Text>
      </Box>
      {options.map((opt, i) => (
        <Box key={opt.value} gap={1}>
          <Text color={i === idx ? colors.primary : colors.muted}>
            {i === idx ? "❯" : " "}
          </Text>
          <Text
            color={i === idx ? colors.primary : undefined}
            bold={i === idx}
            strikethrough={opt.value === "write-list" && listWritten}
          >
            {opt.value === "write-list" && listWritten ? "✓ " : ""}{opt.label}
          </Text>
        </Box>
      ))}
      <Text dimColor>{"\n"}  Use arrow keys to select, Enter to confirm</Text>
    </Box>
  );
}

export function Instrument({
  targetDir,
  scanResult,
  meteringDesign,
  apiKey,
  onComplete,
}: InstrumentProps) {
  const state = useInstrument({
    targetDir,
    scanResult,
    meteringDesign,
    apiKey,
    onComplete,
  });

  // Pending result — wait for keypress after instrumentation completes
  const [acknowledged, setAcknowledged] = useState(false);

  useInput((_input, key) => {
    // "Press any key" when no files need changes (0 modifications)
    if (
      state.step === "awaiting-confirm" &&
      state.preview?.totalFiles === 0 &&
      (key.return || _input)
    ) {
      const emptyResult = { filesModified: 0, totalChanges: 0, changes: [], errors: [] };
      onComplete(emptyResult, state.installCommand);
      return;
    }
    // "Press any key" after instrumentation completes
    if (state.step === "done" && state.result && !acknowledged && (key.return || _input)) {
      setAcknowledged(true);
      onComplete(state.result, state.installCommand);
    }
  });

  // --- Preview screen ---
  if (state.step === "previewing") {
    return (
      <Box flexDirection="column" gap={0}>
        <Text bold>Analyzing your codebase...</Text>
        <Box flexDirection="column" marginTop={1}>
          <Spinner label="Calculating which files need changes..." />
        </Box>
      </Box>
    );
  }

  if (state.step === "awaiting-confirm" && state.preview) {
    const { preview } = state;

    if (preview.totalFiles === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Instrumentation Preview</Text>
          <StatusLine icon="ℹ" label="No files need modification — your code is already instrumented or no transforms are available." status="info" />
          <Text dimColor>{"\n"}  Press any key to continue...</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" gap={0}>
        <Text bold>Instrumentation Preview</Text>
        <Text dimColor>
          {"  "}{preview.totalFiles} file{preview.totalFiles > 1 ? "s" : ""} will be modified ({preview.totalChanges} changes):
        </Text>

        <Box flexDirection="column" marginTop={1}>
          {preview.files.map((file) => (
            <Box key={file.filePath} flexDirection="column" marginLeft={2}>
              <Text color={colors.primary}>{file.filePath}</Text>
              {file.changes.map((desc, i) => (
                <Text key={i} dimColor>
                  {"  "}+ {desc}
                </Text>
              ))}
            </Box>
          ))}
        </Box>

        {state.showingExample && (
          <Box marginTop={1} marginLeft={2}>
            <StatusLine icon="✓" label="Example written to revvy-example.txt — open it to see the before/after diff." status="success" />
          </Box>
        )}

        <PreviewSelect
          listWritten={state.listWritten}
          onSelect={state.confirmAction}
        />
      </Box>
    );
  }

  // --- Instrumentation in progress ---
  if (state.step === "instrumenting") {
    return (
      <Box flexDirection="column" gap={0}>
        <Text bold>Instrumenting your codebase...</Text>
        <Box flexDirection="column" marginTop={1}>
          <Spinner label="Rewriting source files with Revenium instrumentation..." />
        </Box>
      </Box>
    );
  }

  // --- Done screen ---
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>Instrumentation complete</Text>
      <Box flexDirection="column" marginTop={1}>
        {state.result && (
          <>
            {state.result.filesModified > 0 ? (
              <StatusLine
                icon="✓"
                label={`Modified ${state.result.filesModified} file${state.result.filesModified > 1 ? "s" : ""} (${state.result.totalChanges} changes)`}
                status="success"
              />
            ) : (
              <StatusLine icon="ℹ" label="No files were modified" status="info" />
            )}

            {state.result.changes.map((change) => (
              <Box key={change.filePath} flexDirection="column" marginLeft={2}>
                <Text color={colors.primary}>{change.filePath}</Text>
                {change.changes.map((desc, i) => (
                  <Text key={i} dimColor>{"  "}+ {desc}</Text>
                ))}
                <Text dimColor>{"  "}Backup: {change.backupPath}</Text>
              </Box>
            ))}

            {state.result.errors.map((err) => (
              <StatusLine key={err.filePath} icon="✗" label={`${err.filePath}: ${err.error}`} status="error" />
            ))}
          </>
        )}

        {state.step === "setting-env" && (
          <Spinner label="Setting up environment variables..." />
        )}
        {state.envUpdated && (
          <StatusLine icon="✓" label="Added REVENIUM_METERING_API_KEY to .env" status="success" />
        )}

        {state.step === "done" && state.result && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Run this to install the Revenium SDK:</Text>
            <Text color={colors.primary}>  {state.installCommand}</Text>
            <Text dimColor>{"\n"}  Press any key to continue...</Text>
          </Box>
        )}

        {state.error && (
          <StatusLine icon="✗" label={state.error} status="error" />
        )}
      </Box>
    </Box>
  );
}
