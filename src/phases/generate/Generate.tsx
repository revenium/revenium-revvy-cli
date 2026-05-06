import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../../constants/colors.js";
import { Spinner } from "../../components/Spinner.js";
import { StatusLine } from "../../components/StatusLine.js";
import { useGenerate } from "./useGenerate.js";
import { getDesignFilename } from "./utils/design-writer.js";
import { getInstallCommand } from "../instrument/instrumenter.js";
import { detectPackageManager, type PackageManagerInfo } from "../../utils/package-manager.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { ScanResult } from "../../types/scan-result.js";

interface GenerateProps {
  targetDir: string;
  meteringDesign: MeteringDesign;
  scanResult: ScanResult;
  onComplete: (files: string[]) => void;
}

export function Generate({
  targetDir,
  meteringDesign,
  scanResult,
  onComplete,
}: GenerateProps) {
  const state = useGenerate({
    targetDir,
    meteringDesign,
    scanResult,
    onComplete,
  });

  const designFilename = getDesignFilename(meteringDesign.detectedLanguage);

  const [pmInfo, setPmInfo] = useState<PackageManagerInfo | undefined>(undefined);
  useEffect(() => {
    if (meteringDesign.detectedLanguage === "node") {
      detectPackageManager(targetDir).then(setPmInfo).catch(() => undefined);
    }
  }, [targetDir, meteringDesign.detectedLanguage]);

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>Generating Revenium configuration...</Text>
      <Box flexDirection="column" marginTop={1}>
        {state.step === "writing-design" && (
          <Spinner label="Writing metering design..." />
        )}
        {state.generatedFiles.includes(designFilename) && (
          <StatusLine
            icon="✓"
            label={`Created ${designFilename}`}
            status="success"
          />
        )}

        {state.step === "generating-utility" && (
          <Spinner label="Generating instrumentation utility..." />
        )}

        {state.step === "writing-files" && (
          <Spinner label="Writing files..." />
        )}

        {state.step === "done" && !state.error && (
          <>
            {state.generatedFiles
              .filter((f) => f !== designFilename)
              .map((file) => (
                <StatusLine
                  key={file}
                  icon="✓"
                  label={`Created ${file}`}
                  status="success"
                />
              ))}
          </>
        )}

        {state.error && (
          <StatusLine icon="✗" label={state.error} status="error" />
        )}
      </Box>

      {state.step === "done" && !state.error && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            Next: Install the Revenium SDK package in your project:
          </Text>
          <Text color={colors.primary}>
            {"  "}{getInstallCommand(meteringDesign, pmInfo)}
          </Text>
          {pmInfo?.isMonorepo && (
            <Text dimColor>
              {"  "}↳ monorepo detected — scope to your runtime workspace if needed
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
