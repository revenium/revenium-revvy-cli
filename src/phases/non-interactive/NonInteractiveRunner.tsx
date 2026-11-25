/**
 * Non-interactive runner — executes the full pipeline without user interaction.
 * Used when --non-interactive is passed with all required CLI arguments.
 */
import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import { colors } from "../../constants/colors.js";
import { StatusLine } from "../../components/StatusLine.js";
import { Spinner } from "../../components/Spinner.js";
import { ReveniumApiClient } from "../../services/reveniumApi.js";
import {
  detectDependencies,
  detectCallSites,
  detectExistingInstrumentation,
} from "../scan/detectors/index.js";
import { buildAllProviders, formatProviderSummary } from "../scan/build-all-providers.js";
import { discoverCustomerCandidates } from "../scan/discoveries/customer-discovery.js";
import { discoverCentralizedUtility } from "../scan/discoveries/centralized-utility-discovery.js";
import { buildDesignFromArgs, type CliDesignArgs } from "../consultation/design-builder.js";
import { writeMeteringDesign, getDesignFilename } from "../generate/utils/design-writer.js";
import { writeCallSiteManifest, buildCallSiteManifest, getManifestFilename } from "../generate/utils/manifest-writer.js";
import { writeModifiedFilesManifest } from "../generate/utils/modified-files-writer.js";
import { detectPackageManager } from "../../utils/package-manager.js";
import { configHelperFileName, renderConfigHelper } from "../generate/config-helper.js";
import { describeEnvWrite, writeMeteringEnv } from "../../utils/env-helpers.js";
import {
  describeGeneratedFile,
  describeGeneratedGroup,
  writeGeneratedFile,
  type GeneratedFileResult,
} from "../../utils/generated-file.js";
import {
  describeGitignoreUpdate,
  ensureRevvyFilesIgnored,
  trackedFilesWarning,
  type GitignoreUpdate,
} from "../../utils/gitignore.js";
import {
  instrumentCallSites,
  previewInstrumentation,
  getInstallCommand,
} from "../instrument/instrumenter.js";
import { EDITOR_GROUP_LABEL, writeEditorFiles, writeGitHubWorkflow } from "../ci-setup/ci-files-writer.js";
import { NOTHING_SET_UP_EXIT_CODE, hasNothingToSetUp, nothingToSetUpLines } from "../scan/no-ai-calls.js";
import { relative, resolve } from "path";
import type { ScanResult } from "../../types/scan-result.js";
import { CALL_SITE_NOTE, assessMeteringStatus, type MeteringStatusLine } from "../ci-setup/check/metering-status.js";

export interface NonInteractiveArgs {
  apiKey: string;
  baseUrl?: string;
  targetDir: string;
  setupMode: "instrumentation" | "both";
  customerIdExpression?: string;
  productNames?: string;
  agentNames?: string;
  centralizedUtility?: string;
  skipCi?: boolean;
  dryRun?: boolean;
  /** Glob patterns to exclude from AI-call scanning (gitignore syntax). */
  excludePatterns?: string[];
}

type RunnerStep =
  | "validating"
  | "scanning"
  | "building-design"
  | "generating"
  | "instrumenting"
  | "ci-setup"
  | "done";

interface LogEntry {
  message: string;
  isError?: boolean;
}

interface RunnerState {
  step: RunnerStep;
  error?: string;
  nothingToSetUp?: string[];
  utilityFile?: string;
  logs: LogEntry[];
  meteringStatus: MeteringStatusLine[];
  nothingToMeter?: boolean;
}

const STATUS_COLORS: Record<MeteringStatusLine["tone"], string | undefined> = {
  success: colors.success,
  warning: colors.warning,
  detail: undefined,
};

export function NonInteractiveRunner({ args }: { args: NonInteractiveArgs }) {
  const { exit } = useApp();
  const [state, setState] = useState<RunnerState>({
    step: "validating",
    logs: [],
    meteringStatus: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const targetDir = resolve(args.targetDir);
      const log = (message: string, isError = false) =>
        setState((prev) => ({ ...prev, logs: [...prev.logs, { message, isError }] }));

      try {
        // 1. Validate API key (skip for dry-run without key)
        let keyUnverified = false;
        setState((prev) => ({ ...prev, step: "validating" }));
        if (args.apiKey) {
          const client = new ReveniumApiClient({ apiKey: args.apiKey, baseUrl: args.baseUrl });
          const keyResult = await client.validateApiKey();
          if (!keyResult.ok || !keyResult.data?.valid) {
            throw new Error(keyResult.error ?? "Invalid API key");
          }
          if (cancelled) return;
          if (keyResult.data.meteringOnly) {
            if (keyResult.data.unverified) {
              keyUnverified = true;
              log(`Could not verify the metering key — ${keyResult.error ?? "API unreachable"}. Continuing; metering may not work.`, true);
            } else {
              log("API key verified against the metering API");
            }
          } else {
            log(`API key valid (org: ${keyResult.data.orgName ?? "unknown"})`);
          }
        } else if (args.dryRun) {
          log("Dry run — skipping API key validation");
        }

        // 2. Scan codebase
        setState((prev) => ({ ...prev, step: "scanning" }));
        const depResult = await detectDependencies(targetDir);
        const callSiteResult = await detectCallSites(targetDir, depResult.language, args.excludePatterns);
        const instrumentation = await detectExistingInstrumentation(targetDir, depResult.language);
        const customerCandidates = await discoverCustomerCandidates(
          callSiteResult.scannedFiles,
          depResult.language,
          (absolute: string) => relative(targetDir, absolute),
        );
        const centralizedUtility = discoverCentralizedUtility({ callSites: callSiteResult.callSites });

        if (cancelled) return;

        // Build union of manifest-detected providers + source-import-detected providers.
        const providerAgg = buildAllProviders(depResult.providers, callSiteResult.callSites, depResult.language);
        const allProviders = providerAgg.allProviders;

        const scanResult: ScanResult = {
          language: depResult.language,
          providers: allProviders,
          callSites: callSiteResult.callSites,
          existingInstrumentation: instrumentation,
          totalFiles: callSiteResult.totalFiles,
          filesWithAICalls: callSiteResult.filesWithAICalls,
          customerCandidates,
          centralizedUtility: centralizedUtility.primary,
          alternativeCentralizedUtilities: centralizedUtility.alternatives,
        };

        log(`Scanned: ${depResult.language}, ${formatProviderSummary(providerAgg)}, ${callSiteResult.callSites.length} AI calls`);

        if (hasNothingToSetUp(scanResult)) {
          setState((prev) => ({ ...prev, step: "done", nothingToSetUp: nothingToSetUpLines(scanResult, args.dryRun === true) }));
          setTimeout(() => {
            process.exitCode = NOTHING_SET_UP_EXIT_CODE;
            exit();
          }, 100);
          return;
        }

        // Log auto-detection of customer ID when not explicitly provided
        if (!args.customerIdExpression && customerCandidates.length > 0) {
          const top = customerCandidates[0]!;
          log(`Auto-detected customer ID expression: ${top.expression} (${top.filesFound} file${top.filesFound === 1 ? "" : "s"}, ${top.occurrences} occurrence${top.occurrences === 1 ? "" : "s"})`);
        }

        // 3. Build metering design from CLI args
        setState((prev) => ({ ...prev, step: "building-design" }));
        const designArgs: CliDesignArgs = {
          customerIdExpression: args.customerIdExpression,
          productNames: args.productNames,
          agentNames: args.agentNames,
          centralizedUtility: args.centralizedUtility,
        };
        const design = buildDesignFromArgs(designArgs, scanResult);
        if (cancelled) return;
        log("Metering design built");

        // 4. Generate config files (skip writes in dry-run mode)
        setState((prev) => ({ ...prev, step: "generating" }));

        const utilityFile = configHelperFileName(design.detectedLanguage);
        setState((prev) => ({ ...prev, utilityFile }));

        let gitignoreUpdate: GitignoreUpdate | undefined;
        if (!args.dryRun) {
          gitignoreUpdate = await ensureRevvyFilesIgnored(targetDir);
          log(describeGitignoreUpdate(gitignoreUpdate));
          const trackedWarning = trackedFilesWarning(gitignoreUpdate);
          if (trackedWarning) log(trackedWarning, true);

          log(describeGeneratedFile(await writeMeteringDesign(targetDir, design)));

          const manifestResult = await writeCallSiteManifest(targetDir, scanResult, design);
          log(describeGeneratedFile(manifestResult, `(${scanResult.callSites.length} call sites)`));

          log(describeGeneratedFile(await writeGeneratedFile(targetDir, utilityFile, renderConfigHelper(design))));
        }
        if (cancelled) return;

        // 5. Instrument (or dry-run)
        if (args.dryRun) {
          const preview = await previewInstrumentation(targetDir, scanResult, design);
          const manifest = buildCallSiteManifest(scanResult, design);
          log(`Dry run: ${preview.totalFiles} files would be modified, 4 files would be created`);
          for (const file of preview.files) {
            log(`  ${file.filePath} — ${file.changes.length} change(s)`);
          }
          log(`  Would create: ${utilityFile}`);
          log(`  Would create: ${getDesignFilename(design.detectedLanguage)}`);
          log(`  Would create: ${getManifestFilename(design.detectedLanguage)} (${manifest.totalCallSites} call sites)`);
          log(`  Would create: .env`);
        } else {
          setState((prev) => ({ ...prev, step: "instrumenting" }));
          const instrumentResult = await instrumentCallSites(
            targetDir,
            scanResult,
            design,
          );
          if (cancelled) return;
          log(`Instrumented ${instrumentResult.filesModified} files (${instrumentResult.totalChanges} changes)`);

          const envResult = await writeMeteringEnv(targetDir, args.apiKey, args.baseUrl, { keyVerified: !keyUnverified });
          log(describeEnvWrite(envResult));

          // Modified files manifest
          const modifiedManifestResult = await writeModifiedFilesManifest(targetDir, {
            instrumentResult,
            language: design.detectedLanguage,
            envCreated: envResult.created,
            envWrite: envResult,
            gitignoreUpdate,
          });
          if (modifiedManifestResult) {
            log(describeGeneratedFile(modifiedManifestResult));
          }
        }

        // 6. CI setup (unless skipped)
        if (!args.skipCi && !args.dryRun) {
          setState((prev) => ({ ...prev, step: "ci-setup" }));

          log(describeGeneratedFile(await writeGitHubWorkflow(targetDir, design.detectedLanguage === "node" ? await detectPackageManager(targetDir) : undefined)));

          const editorResults: GeneratedFileResult[] = [];
          for await (const result of writeEditorFiles(targetDir, depResult.language, design.detectedProviders)) {
            editorResults.push(result);
          }
          if (cancelled) return;
          log(describeGeneratedGroup(EDITOR_GROUP_LABEL, editorResults));
        }

        const installCmd = getInstallCommand(design);
        log(`Install SDK: ${installCmd}`);

        if (!args.dryRun) {
          const { lines, check } = await assessMeteringStatus(targetDir, args.excludePatterns, keyUnverified);
          if (cancelled) return;
          const nothingToMeter = check?.totalCallSites === 0;
          if (nothingToMeter) process.exitCode = 1;
          setState((prev) => ({ ...prev, meteringStatus: lines, nothingToMeter }));
        }

        setState((prev) => ({ ...prev, step: "done" }));
        setTimeout(() => exit(), 100);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          step: "done",
          error: msg,
          logs: [...prev.logs, { message: msg, isError: true }],
        }));
        setTimeout(() => {
          process.exitCode = 1;
          exit();
        }, 100);
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>Revvy — Non-interactive mode</Text>
      <Box flexDirection="column" marginTop={1}>
        {state.logs.map((entry, i) => (
          <StatusLine
            key={i}
            icon={entry.isError ? "✗" : "✓"}
            label={entry.message}
            status={entry.isError ? "error" : "success"}
          />
        ))}

        {state.nothingToSetUp && (
          <Box flexDirection="column" marginTop={1}>
            {state.nothingToSetUp.map((line, i) => (
              <Text key={i} color={i === 0 ? colors.error : undefined}>{line}</Text>
            ))}
          </Box>
        )}

        {state.step !== "done" && (
          <Spinner label={
            state.step === "validating" ? "Validating API key..." :
            state.step === "scanning" ? "Scanning codebase..." :
            state.step === "building-design" ? "Building metering design..." :
            state.step === "generating" ? "Generating configuration..." :
            state.step === "instrumenting" ? "Instrumenting code..." :
            state.step === "ci-setup" ? "Setting up CI guardrails..." :
            "Processing..."
          } />
        )}

        {state.step === "done" && !state.error && !state.nothingToSetUp && args.dryRun && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Dry-run preview complete. No files were written.</Text>
          </Box>
        )}

        {state.step === "done" && !state.error && !state.nothingToSetUp && !args.dryRun && (
          <Box flexDirection="column" marginTop={1}>
            {state.nothingToMeter
              ? <Text bold color={colors.warning}>Setup incomplete — no AI calls found.</Text>
              : <Text bold color={colors.success}>Setup complete!</Text>}
            <Text>{""}</Text>
            {state.meteringStatus.map((line, i) => (
              <Text key={`status-${i}`} color={STATUS_COLORS[line.tone]} dimColor={line.tone === "detail"}>
                {"  "}{line.text}
              </Text>
            ))}
            <Text>{""}</Text>
            {CALL_SITE_NOTE.map((line, i) => (
              <Text key={`note-${i}`} color={i === 0 ? colors.accent : undefined} dimColor={i > 0}>
                {"  "}{line}
              </Text>
            ))}
            <Text>{""}</Text>
            <Text bold>Next steps:</Text>
            <Text dimColor>  1. Install the SDK (see install command above)</Text>
            <Text dimColor>  2. Add usage_metadata to your AI calls for business-context metering</Text>
            <Text dimColor>  3. Run <Text color={colors.primary}>revvy check</Text> to verify coverage</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
