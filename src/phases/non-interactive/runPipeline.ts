/**
 * Plain-text non-interactive pipeline — runs the same logic as NonInteractiveRunner
 * but outputs plain console.log instead of Ink/React components.
 * Used when stdout is not a TTY (e.g., piped output, AI agents, CI).
 */
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
import { safeReadFile } from "../../utils/fs-helpers.js";
import { buildEnvContent, describeEnvWrite, writeMeteringEnv, type EnvWriteResult } from "../../utils/env-helpers.js";
import { describeGeneratedFile, describeGeneratedGroup, writeGeneratedFile } from "../../utils/generated-file.js";
import {
  REVVY_IGNORED_ENTRIES,
  describeGitignoreUpdate,
  ensureRevvyFilesIgnored,
  missingIgnoreEntries,
  trackedFilesWarning,
  type GitignoreUpdate,
} from "../../utils/gitignore.js";
import { detectPackageManager } from "../../utils/package-manager.js";
import {
  instrumentCallSites,
  previewInstrumentation,
  getInstallCommand,
} from "../instrument/instrumenter.js";
import {
  EDITOR_GROUP_LABEL,
  GITHUB_WORKFLOW_PATH,
  editorFilePaths,
  githubWorkflowContent,
  writeEditorFiles,
  writeGitHubWorkflow,
} from "../ci-setup/ci-files-writer.js";
import type { GeneratedFileResult } from "../../utils/generated-file.js";
import { writeMonorepoTodo, getMonorepoTodoFilename } from "./monorepo-todo-writer.js";
import { NOTHING_SET_UP_EXIT_CODE, hasNothingToSetUp, nothingToSetUpLines } from "../scan/no-ai-calls.js";
import { join, relative, resolve } from "path";
import { createPatch } from "diff";
import type { ScanResult } from "../../types/scan-result.js";

import { configHelperFileName, renderConfigHelper } from "../generate/config-helper.js";
import { CALL_SITE_NOTE, assessMeteringStatus } from "../ci-setup/check/metering-status.js";
import { hasAutomaticTransform } from "../instrument/constants/transform-registry.js";

export interface PipelineArgs {
  apiKey?: string;
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

function log(icon: string, message: string) {
  console.log(`${icon} ${message}`);
}

export async function runPipeline(args: PipelineArgs): Promise<void> {
  const targetDir = resolve(args.targetDir);
  console.log("Revvy — Non-interactive mode\n");

  // Set when the key looked well-formed but the API never answered, so the
  // closing summary can avoid asserting that metering works.
  let keyUnverified = false;

  // 1. Validate API key (skip for dry-run)
  if (args.apiKey) {
    log("...", "Validating API key...");
    const client = new ReveniumApiClient({ apiKey: args.apiKey, baseUrl: args.baseUrl });
    const keyResult = await client.validateApiKey();
    if (!keyResult.ok || !keyResult.data?.valid) {
      throw new Error(keyResult.error ?? "Invalid API key");
    }
    if (keyResult.data.meteringOnly) {
      if (keyResult.data.unverified) {
        // The key shape is right but the API didn't answer. Say so instead of
        // reporting a check that never completed.
        keyUnverified = true;
        log("⚠", `Could not verify the metering key — ${keyResult.error ?? "API unreachable"}. Continuing; metering may not work.`);
      } else {
        log("✓", "API key verified against the metering API");
      }
    } else {
      log("✓", `API key valid (org: ${keyResult.data.orgName ?? "unknown"})`);
    }
  } else if (args.dryRun) {
    log("ℹ", "Dry run — skipping API key validation");
  } else {
    throw new Error("API key is required when not running in dry-run mode");
  }

  // 2. Scan codebase
  log("...", "Scanning codebase...");
  const depResult = await detectDependencies(targetDir);
  const callSiteResult = await detectCallSites(targetDir, depResult.language, args.excludePatterns);
  const instrumentation = await detectExistingInstrumentation(targetDir, depResult.language);
  const customerCandidates = await discoverCustomerCandidates(
    callSiteResult.scannedFiles,
    depResult.language,
    (absolute: string) => relative(targetDir, absolute),
  );
  const centralizedUtility = discoverCentralizedUtility({ callSites: callSiteResult.callSites });

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

  log("✓", `Scanned: ${depResult.language}, ${formatProviderSummary(providerAgg)}, ${callSiteResult.callSites.length} AI calls`);

  // Detect package manager + monorepo layout for Node projects (used downstream for
  // install command, CI workflow YAML, and dry-run hints).
  const pmInfo = depResult.language === "node" ? await detectPackageManager(targetDir) : undefined;
  if (pmInfo?.isMonorepo) {
    log("ℹ", `Monorepo detected (${pmInfo.manager}) — file placements revvy suggests assume repo root; place \`.env\` and the config helper in your runtime workspace if different.`);
  }

  if (hasNothingToSetUp(scanResult)) {
    console.log("");
    for (const line of nothingToSetUpLines(scanResult, args.dryRun === true)) console.log(line);
    process.exitCode = NOTHING_SET_UP_EXIT_CODE;
    return;
  }

  // log auto-detection of customer ID when not explicitly provided
  if (!args.customerIdExpression && customerCandidates.length > 0) {
    const top = customerCandidates[0]!;
    log("ℹ", `Auto-detected customer ID expression: ${top.expression} (${top.filesFound} file${top.filesFound === 1 ? "" : "s"}, ${top.occurrences} occurrence${top.occurrences === 1 ? "" : "s"})`);
  } else if (!args.customerIdExpression) {
    // No flag, no auto-detect. The instrumented code will use the placeholder
    // string "your-org" — usable for a smoke test but a footgun if shipped.
    // Print a loud warning + the exact fix so an agent can't miss it.
    console.warn("");
    console.warn("⚠  No --customer-id-expression provided and no candidate auto-detected.");
    console.warn("   Instrumentation will use the literal placeholder \"your-org\" for organizationName.");
    console.warn("   This works for a quick smoke test, but ships meaningless cost-attribution data");
    console.warn("   if it reaches production. Re-run with one of:");
    console.warn("     --customer-id-expression \"<code expression>\"   (e.g. req.user.orgId, input.teamId)");
    console.warn("     --customer-id-literal    \"<string constant>\"   (e.g. \"internal\", for CLI tools / single-tenant apps)");
    console.warn("");
  }

  // 3. Build metering design
  const designArgs: CliDesignArgs = {
    customerIdExpression: args.customerIdExpression,
    productNames: args.productNames,
    agentNames: args.agentNames,
    centralizedUtility: args.centralizedUtility,
  };
  const design = buildDesignFromArgs(designArgs, scanResult);
  log("✓", "Metering design built");

  // 4. Generate config files (skip in dry-run)
  const utilityFile = configHelperFileName(design.detectedLanguage);
  const utilityContent = renderConfigHelper(design);

  let gitignoreUpdate: GitignoreUpdate | undefined;
  if (!args.dryRun) {
    gitignoreUpdate = await ensureRevvyFilesIgnored(targetDir);
    log("✓", describeGitignoreUpdate(gitignoreUpdate));
    const trackedWarning = trackedFilesWarning(gitignoreUpdate);
    if (trackedWarning) log("⚠", trackedWarning);

    log("✓", describeGeneratedFile(await writeMeteringDesign(targetDir, design)));

    // NOTE: The call-site manifest is written AFTER `instrumentCallSites` runs
    // (further down the pipeline). That way the `line` field for each entry
    // reflects the post-instrumentation file an agent will actually navigate
    // — the comment block revvy injects shifts every call site downward by
    // ~30 lines. Writing the manifest pre-instrumentation gave stale line
    // numbers that would land an agent in the middle of the reference comment.

    if (!pmInfo?.isMonorepo) {
      // Single-package project — write helper directly. Layout is unambiguous.
      log("✓", describeGeneratedFile(await writeGeneratedFile(targetDir, utilityFile, utilityContent)));
    } else {
      log("ℹ", `Skipped writing ${utilityFile} at repo root (monorepo) — see ${getMonorepoTodoFilename()} for placement instructions.`);
    }
  }

  // 5. Instrument (or dry-run preview)
  if (args.dryRun) {
    const designContent = JSON.stringify(design, null, 2);
    // Dry-run preview shows pre-instrumentation line numbers (the file hasn't
    // been edited yet). On a real run we re-scan after instrumentCallSites and
    // emit post-instrumentation lines; that's documented at the write site.
    const manifestContent = JSON.stringify(buildCallSiteManifest(scanResult, design), null, 2);
    const envContent = buildEnvContent(args.apiKey ?? "", args.baseUrl);
    // Redact API key in .env preview
    const envPreview = envContent.replace(/REVENIUM_METERING_API_KEY=.+/, "REVENIUM_METERING_API_KEY=rev_mk_***");

    const preview = await previewInstrumentation(targetDir, scanResult, design);
    // Files always created: metering-design + call-sites manifest = 2.
    // In single-package: + config helper + .env = 4.
    // In monorepo: + revenium-monorepo-todo.md (helper + .env held back) = 3.
    const baseFiles = pmInfo?.isMonorepo ? 3 : 4;
    const ciFileCount = args.skipCi ? 0 : 1 + editorFilePaths().length;
    const createdCount = baseFiles + ciFileCount;
    const totalModified = preview.totalFiles;
    const suffix = totalModified === 1 ? "file" : "files";
    console.log(`\nDry run: ${totalModified} ${suffix} would be modified, ${createdCount} files would be created\n`);
    if (pmInfo?.isMonorepo) {
      console.log(`(monorepo detected — \`.env\` and the config helper will NOT be written at repo root; instead, \`revenium-monorepo-todo.md\` will guide placement.)\n`);
    }
    if (!args.skipCi) {
      console.log(`(includes ${ciFileCount} CI/editor-rules files — pass \`--skip-ci\` to suppress them.)\n`);
    }

    // Show unified diffs for each modified file
    for (const file of preview.files) {
      const separator = `── Modified: ${file.filePath} ${"─".repeat(Math.max(0, 60 - file.filePath.length))}`;
      console.log(separator);
      const patch = createPatch(
        file.filePath,
        file.before,
        file.after,
        "",
        "",
        { context: 3 }
      );
      // Strip the two file header lines that createPatch prepends
      const patchLines = patch.split("\n").slice(2);
      console.log(patchLines.join("\n"));
      console.log("");
    }

    // Show "would create" for generated files. In a monorepo, the config helper
    // and .env are intentionally held back (we'd be guessing the wrong location);
    // a `revenium-monorepo-todo.md` is written instead so the agent picks the right
    // workspace path. Reflect that here so the dry-run preview matches the real run.
    // Files are printed in full: agents apply the dry run as the specification.

    if (!pmInfo?.isMonorepo) {
      console.log(`── Would create: ${utilityFile} (${ utilityContent.split("\n").length} lines) ${"─".repeat(Math.max(0, 40 - utilityFile.length))}`);
      console.log(utilityContent);
      console.log("");
    }

    const designFileName = getDesignFilename(design.detectedLanguage);
    console.log(`── Would create: ${designFileName} ${"─".repeat(Math.max(0, 52 - designFileName.length))}`);
    console.log(designContent);
    console.log("");

    const manifestFileName = getManifestFilename(design.detectedLanguage);
    console.log(`── Would create: ${manifestFileName} ${"─".repeat(Math.max(0, 52 - manifestFileName.length))}`);
    console.log(manifestContent);
    console.log("");

    if (pmInfo?.isMonorepo) {
      // Preview the monorepo TODO file in place of .env + config helper.
      const { buildMonorepoTodoContent } = await import("./monorepo-todo-writer.js");
      const todoContent = buildMonorepoTodoContent(design, pmInfo, args.apiKey ?? "", args.baseUrl);
      const todoLines = todoContent.split("\n");
      console.log(`── Would create: revenium-monorepo-todo.md (${todoLines.length} lines) ${"─".repeat(20)}`);
      console.log(todoContent);
      console.log("");
      console.log(`(In a monorepo, \`.env\` and the config helper are NOT written at repo root — see \`revenium-monorepo-todo.md\` for guided placement.)`);
      console.log("");
    } else {
      console.log(`── Would create: .env ${"─".repeat(44)}`);
      console.log(envPreview.trim());
      console.log("");
    }

    const unignored = missingIgnoreEntries(await safeReadFile(join(targetDir, ".gitignore")), REVVY_IGNORED_ENTRIES);
    if (unignored.length > 0) {
      console.log(`── Would add to .gitignore: ${unignored.join(", ")}`);
      console.log("");
    }

    if (!args.skipCi) {
      const ghContent = githubWorkflowContent(pmInfo);
      console.log(`── Would create: ${GITHUB_WORKFLOW_PATH} ${"─".repeat(Math.max(0, 40 - GITHUB_WORKFLOW_PATH.length))}`);
      console.log(ghContent);
      console.log("");

      console.log(`── Would create: editor rules + agent prompts ${"─".repeat(20)}`);
      for (const file of editorFilePaths()) console.log(`   ${file}`);
      console.log("");
    }
  } else {
    const instrumentResult = await instrumentCallSites(targetDir, scanResult, design);
    log("✓", `Instrumented ${instrumentResult.filesModified} files (${instrumentResult.totalChanges} changes)`);

    // Re-scan to capture POST-instrumentation line numbers, then write the
    // call-site manifest. The reference comment block revvy injects shifts
    // every call site downward by ~30 lines; without the re-scan, the
    // manifest's `line` field points to the pre-instrumentation source and
    // an agent navigating to "line 48" lands inside the new comment block.
    const postScanCallSites = await detectCallSites(targetDir, depResult.language, args.excludePatterns);
    const postScanResult: ScanResult = {
      ...scanResult,
      callSites: postScanCallSites.callSites,
    };
    const manifestResult = await writeCallSiteManifest(targetDir, postScanResult, design);
    log("✓", describeGeneratedFile(manifestResult, `(${postScanResult.callSites.length} call sites, post-instrumentation line numbers)`));

    // .env — single-package only. In a monorepo, the runtime .env almost
    // always lives inside a workspace (apps/<app>/.env) — guessing wrong
    // means metering silently fails because the runtime never reads our key.
    let envCreated = false;
    let envWrite: EnvWriteResult | undefined;
    if (!pmInfo?.isMonorepo) {
      const envResult = await writeMeteringEnv(targetDir, args.apiKey, args.baseUrl, { keyVerified: !keyUnverified });
      log("✓", describeEnvWrite(envResult));
      envCreated = envResult.created;
      envWrite = envResult;
    } else {
      log("ℹ", `Skipped writing .env at repo root (monorepo) — see ${getMonorepoTodoFilename()} for placement instructions.`);
    }

    // Monorepo placement TODO — written when the layout is ambiguous and the
    // agent (or a careful human) needs to decide where the helper + .env go.
    if (pmInfo?.isMonorepo) {
      const todoResult = await writeMonorepoTodo({
        targetDir,
        design,
        pmInfo,
        apiKey: args.apiKey as string,
        baseUrl: args.baseUrl,
      });
      log("✓", describeGeneratedFile(todoResult, "— read it before installing the SDK"));
    }

    // Track CI/editor-rules files so they can be included in the modified-files
    // manifest (otherwise it underreports what revvy created — agents using the
    // manifest for cleanup/uninstall would miss them).
    const ciAndEditorFiles: string[] = [];

    // 6. CI setup (unless skipped) — runs BEFORE the modified-files manifest
    // so the manifest can capture the full file list.
    if (!args.skipCi) {
      const workflowResult = await writeGitHubWorkflow(targetDir, pmInfo);
      log("✓", describeGeneratedFile(workflowResult));
      ciAndEditorFiles.push(workflowResult.file);

      const editorResults: GeneratedFileResult[] = [];
      for await (const result of writeEditorFiles(targetDir, depResult.language, design.detectedProviders)) {
        editorResults.push(result);
      }
      log("✓", describeGeneratedGroup(EDITOR_GROUP_LABEL, editorResults));
      ciAndEditorFiles.push(...editorResults.map((r) => r.file));
    }

    // Modified files manifest — written LAST so it captures every file revvy
    // created in this run (helper, .env, CI workflow, editor rules, agent prompts,
    // monorepo TODO, etc). Agents and audit scripts can rely on this manifest
    // to know exactly what revvy touched.
    const modifiedManifestResult = await writeModifiedFilesManifest(targetDir, {
      instrumentResult,
      language: design.detectedLanguage,
      envCreated,
      envWrite,
      isMonorepo: pmInfo?.isMonorepo === true,
      extraGeneratedFiles: ciAndEditorFiles,
      gitignoreUpdate,
    });
    if (modifiedManifestResult) {
      log("✓", describeGeneratedFile(modifiedManifestResult));
    }
  }

  const installCmd = getInstallCommand(design, pmInfo);
  log("✓", `Install SDK: ${installCmd}`);

  // Done summary
  console.log("");
  if (args.dryRun) {
    console.log("Dry-run preview complete. No files were written.");
  } else {
    console.log("Setup complete!");
    console.log("");
    const meteringStatus = await assessMeteringStatus(targetDir, args.excludePatterns, keyUnverified);
    for (const line of meteringStatus.lines) {
      console.log(`  ${line.text}`);
    }
    console.log("");
    if (hasAutomaticTransform(scanResult.language)) {
      for (const line of CALL_SITE_NOTE) console.log(`  ${line}`);
    } else {
      console.log("  ℹ Revvy modified none of your files. Wire each call with the generated helper:");
      console.log(`    ${utilityFile} shows the call pattern for each provider, and each entry in`);
      console.log(`    ${getManifestFilename(design.detectedLanguage)} carries the usageMetadataSnippet to pass at that call.`);
    }
    console.log("");
    console.log("Next steps:");
    console.log("  1. Install the SDK (see install command above)");
    console.log("  2. Add usage_metadata to your AI calls for business-context metering");
    console.log("  3. Run `revvy check` to verify coverage");
  }
}
