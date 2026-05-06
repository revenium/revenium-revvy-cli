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
import { renderTemplate } from "../../utils/template-engine.js";
import { safeWriteFile, fileExists, ensureDir } from "../../utils/fs-helpers.js";
import { buildEnvContent } from "../../utils/env-helpers.js";
import {
  instrumentCallSites,
  previewInstrumentation,
  getInstallCommand,
} from "../instrument/instrumenter.js";
import { GITHUB_ACTION_WORKFLOW } from "../ci-setup/templates/githubAction.js";
import { getEditorRules } from "../ci-setup/templates/editorRules.js";
import { AGENT_PROMPT } from "../ci-setup/templates/agentPrompt.js";
import { readFile, writeFile, appendFile } from "fs/promises";
import { join, relative, resolve } from "path";
import type { ScanResult } from "../../types/scan-result.js";

// Templates loaded as strings
import nodeTemplate from "../generate/templates/node-ts/revenium-config.ts.ejs";
import pythonTemplate from "../generate/templates/python/revenium_config.py.ejs";

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
  utilityFile?: string;
  logs: LogEntry[];
}

export function NonInteractiveRunner({ args }: { args: NonInteractiveArgs }) {
  const { exit } = useApp();
  const [state, setState] = useState<RunnerState>({
    step: "validating",
    logs: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const targetDir = resolve(args.targetDir);
      const log = (message: string) =>
        setState((prev) => ({ ...prev, logs: [...prev.logs, { message }] }));

      try {
        // 1. Validate API key (skip for dry-run without key)
        setState((prev) => ({ ...prev, step: "validating" }));
        if (args.apiKey) {
          const client = new ReveniumApiClient({ apiKey: args.apiKey, baseUrl: args.baseUrl });
          const keyResult = await client.validateApiKey();
          if (!keyResult.ok || !keyResult.data?.valid) {
            throw new Error(keyResult.error ?? "Invalid API key");
          }
          if (cancelled) return;
          if (keyResult.data.meteringOnly) {
            log("API key valid (metering-only key — org lookup skipped)");
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

        const utilityFile = design.detectedLanguage === "python"
          ? "revenium_config.py"
          : "src/revenium-config.ts";
        setState((prev) => ({ ...prev, utilityFile }));

        if (!args.dryRun) {
          await writeMeteringDesign(targetDir, design);
          log(`Created ${getDesignFilename(design.detectedLanguage)}`);

          await writeCallSiteManifest(targetDir, scanResult, design);
          log(`Created ${getManifestFilename(design.detectedLanguage)} (${scanResult.callSites.length} call sites)`);

          const template = design.detectedLanguage === "python" ? pythonTemplate : nodeTemplate;
          const utilityContent = renderTemplate(template, {
            providers: design.detectedProviders,
            organization: design.organization,
            products: design.products,
            agents: design.agents,
            taskTypes: design.taskTypes,
            trackingGoal: design.trackingGoal,
            outcomeTracking: design.outcomeTracking,
            centralizedCallPattern: design.centralizedCallPattern,
          });

          await safeWriteFile(join(targetDir, utilityFile), utilityContent);
          log(`Created ${utilityFile}`);
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

          // .env
          let envCreated = false;
          const envPath = join(targetDir, ".env");
          const envContent = buildEnvContent(args.apiKey);
          if (await fileExists(envPath)) {
            const existing = await readFile(envPath, "utf-8");
            if (!existing.includes("REVENIUM_METERING_API_KEY")) {
              await appendFile(envPath, envContent);
              log("Added REVENIUM_METERING_API_KEY to .env");
            }
          } else {
            await writeFile(envPath, envContent.trimStart(), "utf-8");
            log("Created .env with REVENIUM_METERING_API_KEY");
            envCreated = true;
          }

          // Modified files manifest
          const modifiedManifestPath = await writeModifiedFilesManifest(targetDir, {
            instrumentResult,
            language: design.detectedLanguage,
            envCreated,
          });
          if (modifiedManifestPath) {
            log("Created revenium-modified-files.json");
          }
        }

        // 6. CI setup (unless skipped)
        if (!args.skipCi && !args.dryRun) {
          setState((prev) => ({ ...prev, step: "ci-setup" }));

          // GitHub Actions
          const ghPath = join(targetDir, ".github/workflows/revenium-check.yml");
          await ensureDir(ghPath);
          await writeFile(ghPath, GITHUB_ACTION_WORKFLOW, "utf-8");
          log("Created .github/workflows/revenium-check.yml");

          // Editor rules + agent prompt (language-aware + provider-aware)
          const editorRulesContent = getEditorRules(depResult.language, design.detectedProviders);
          const editorDirs = [".cursor", ".claude", ".gemini", ".codex"];

          for (const dir of editorDirs) {
            const rulesPath = join(targetDir, dir, "rules/revenium.md");
            await ensureDir(rulesPath);
            await writeFile(rulesPath, editorRulesContent, "utf-8");

            const agentPath = join(targetDir, dir, "revvy-agent.md");
            await ensureDir(agentPath);
            await writeFile(agentPath, AGENT_PROMPT, "utf-8");
          }
          if (cancelled) return;
          log("Created editor rules + agent prompts (Cursor, Claude, Gemini, Codex)");
        }

        const installCmd = getInstallCommand(design);
        log(`Install SDK: ${installCmd}`);

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

        {state.step === "done" && !state.error && args.dryRun && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Dry-run preview complete. No files were written.</Text>
          </Box>
        )}

        {state.step === "done" && !state.error && !args.dryRun && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={colors.success}>Setup complete!</Text>
            <Text>{""}</Text>
            <Text color={colors.success}>  ✓ Basic metering active</Text>
            <Text dimColor>    Tokens, model, and cost are tracked automatically via middleware imports.</Text>
            <Text>{""}</Text>
            <Text color={colors.accent}>  ℹ Revvy intentionally adds imports + a reference comment, but does NOT modify</Text>
            <Text dimColor>    your AI call sites — that's left to you (or your AI coding agent), because</Text>
            <Text dimColor>    static call-site mutation across the SDK matrix is error-prone.</Text>
            <Text dimColor>    See the comment block revvy inserted in the modified file(s) for the exact</Text>
            <Text dimColor>    usageMetadata to copy into your .create() calls.</Text>
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
