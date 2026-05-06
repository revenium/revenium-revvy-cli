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
import { renderTemplate } from "../../utils/template-engine.js";
import { safeWriteFile, fileExists, ensureDir } from "../../utils/fs-helpers.js";
import { buildEnvContent } from "../../utils/env-helpers.js";
import { detectPackageManager } from "../../utils/package-manager.js";
import {
  instrumentCallSites,
  previewInstrumentation,
  getInstallCommand,
} from "../instrument/instrumenter.js";
import { GITHUB_ACTION_WORKFLOW, buildGitHubActionWorkflow } from "../ci-setup/templates/githubAction.js";
import { writeMonorepoTodo, getMonorepoTodoFilename } from "./monorepo-todo-writer.js";
import { getEditorRules } from "../ci-setup/templates/editorRules.js";
import { AGENT_PROMPT } from "../ci-setup/templates/agentPrompt.js";
import { readFile, writeFile, appendFile } from "fs/promises";
import { join, relative, resolve } from "path";
import { createPatch } from "diff";
import type { ScanResult } from "../../types/scan-result.js";

import nodeTemplate from "../generate/templates/node-ts/revenium-config.ts.ejs";
import pythonTemplate from "../generate/templates/python/revenium_config.py.ejs";

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

  // 1. Validate API key (skip for dry-run)
  if (args.apiKey) {
    log("...", "Validating API key...");
    const client = new ReveniumApiClient({ apiKey: args.apiKey, baseUrl: args.baseUrl });
    const keyResult = await client.validateApiKey();
    if (!keyResult.ok || !keyResult.data?.valid) {
      throw new Error(keyResult.error ?? "Invalid API key");
    }
    if (keyResult.data.meteringOnly) {
      log("✓", "API key valid (metering-only key — org lookup skipped)");
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
  const utilityFile = design.detectedLanguage === "python"
    ? "revenium_config.py"
    : "src/revenium-config.ts";

  // Build template data once — shared between write and dry-run paths.
  const template = design.detectedLanguage === "python" ? pythonTemplate : nodeTemplate;
  const templateData = {
    providers: design.detectedProviders,
    organization: design.organization,
    products: design.products,
    agents: design.agents,
    taskTypes: design.taskTypes,
    trackingGoal: design.trackingGoal,
    outcomeTracking: design.outcomeTracking,
    centralizedCallPattern: design.centralizedCallPattern,
  };

  if (!args.dryRun) {
    await writeMeteringDesign(targetDir, design);
    log("✓", `Created ${getDesignFilename(design.detectedLanguage)}`);

    // NOTE: The call-site manifest is written AFTER `instrumentCallSites` runs
    // (further down the pipeline). That way the `line` field for each entry
    // reflects the post-instrumentation file an agent will actually navigate
    // — the comment block revvy injects shifts every call site downward by
    // ~30 lines. Writing the manifest pre-instrumentation gave stale line
    // numbers that would land an agent in the middle of the reference comment.

    if (!pmInfo?.isMonorepo) {
      // Single-package project — write helper directly. Layout is unambiguous.
      const utilityContent = renderTemplate(template, templateData);
      await safeWriteFile(join(targetDir, utilityFile), utilityContent);
      log("✓", `Created ${utilityFile}`);
    } else {
      log("ℹ", `Skipped writing ${utilityFile} at repo root (monorepo) — see ${getMonorepoTodoFilename()} for placement instructions.`);
    }
  }

  // 5. Instrument (or dry-run preview)
  if (args.dryRun) {
    // Build config file contents for "would create" display
    const utilityContent = renderTemplate(template, templateData);
    const designContent = JSON.stringify(design, null, 2);
    // Dry-run preview shows pre-instrumentation line numbers (the file hasn't
    // been edited yet). On a real run we re-scan after instrumentCallSites and
    // emit post-instrumentation lines; that's documented at the write site.
    const manifestContent = JSON.stringify(buildCallSiteManifest(scanResult, design), null, 2);
    const envContent = buildEnvContent(args.apiKey ?? "");
    // Redact API key in .env preview
    const envPreview = envContent.replace(/REVENIUM_METERING_API_KEY=.+/, "REVENIUM_METERING_API_KEY=rev_mk_***");

    const preview = await previewInstrumentation(targetDir, scanResult, design);
    // Files always created: metering-design + call-sites manifest = 2.
    // In single-package: + config helper + .env = 4.
    // In monorepo: + revenium-monorepo-todo.md (helper + .env held back) = 3.
    const baseFiles = pmInfo?.isMonorepo ? 3 : 4;
    const ciFileCount = args.skipCi ? 0 : 1 + 4 * 2;
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
    const maxPreviewLines = 20;

    if (!pmInfo?.isMonorepo) {
      console.log(`── Would create: ${utilityFile} (${ utilityContent.split("\n").length} lines) ${"─".repeat(Math.max(0, 40 - utilityFile.length))}`);
      const utilityLines = utilityContent.split("\n");
      const utilityPreview = utilityLines.slice(0, maxPreviewLines).join("\n");
      console.log(utilityPreview);
      if (utilityLines.length > maxPreviewLines) {
        console.log(`... (${utilityLines.length - maxPreviewLines} more lines)`);
      }
      console.log("");
    }

    const designFileName = getDesignFilename(design.detectedLanguage);
    console.log(`── Would create: ${designFileName} ${"─".repeat(Math.max(0, 52 - designFileName.length))}`);
    const designLines = designContent.split("\n");
    const designPreview = designLines.slice(0, maxPreviewLines).join("\n");
    console.log(designPreview);
    if (designLines.length > maxPreviewLines) {
      console.log(`... (${designLines.length - maxPreviewLines} more lines)`);
    }
    console.log("");

    const manifestFileName = getManifestFilename(design.detectedLanguage);
    console.log(`── Would create: ${manifestFileName} ${"─".repeat(Math.max(0, 52 - manifestFileName.length))}`);
    const manifestLines = manifestContent.split("\n");
    const manifestPreview = manifestLines.slice(0, maxPreviewLines).join("\n");
    console.log(manifestPreview);
    if (manifestLines.length > maxPreviewLines) {
      console.log(`... (${manifestLines.length - maxPreviewLines} more lines)`);
    }
    console.log("");

    if (pmInfo?.isMonorepo) {
      // Preview the monorepo TODO file in place of .env + config helper.
      const { buildMonorepoTodoContent } = await import("./monorepo-todo-writer.js");
      const todoContent = buildMonorepoTodoContent(design, pmInfo, args.apiKey ?? "");
      const todoLines = todoContent.split("\n");
      console.log(`── Would create: revenium-monorepo-todo.md (${todoLines.length} lines) ${"─".repeat(20)}`);
      console.log(todoLines.slice(0, maxPreviewLines).join("\n"));
      if (todoLines.length > maxPreviewLines) {
        console.log(`... (${todoLines.length - maxPreviewLines} more lines)`);
      }
      console.log("");
      console.log(`(In a monorepo, \`.env\` and the config helper are NOT written at repo root — see \`revenium-monorepo-todo.md\` for guided placement.)`);
      console.log("");
    } else {
      console.log(`── Would create: .env ${"─".repeat(44)}`);
      console.log(envPreview.trim());
      console.log("");
    }

    if (!args.skipCi) {
      const ghContent = pmInfo ? buildGitHubActionWorkflow(pmInfo) : GITHUB_ACTION_WORKFLOW;
      const ghPath = ".github/workflows/revenium-check.yml";
      console.log(`── Would create: ${ghPath} ${"─".repeat(Math.max(0, 40 - ghPath.length))}`);
      const ghLines = ghContent.split("\n");
      console.log(ghLines.slice(0, maxPreviewLines).join("\n"));
      if (ghLines.length > maxPreviewLines) {
        console.log(`... (${ghLines.length - maxPreviewLines} more lines)`);
      }
      console.log("");

      const editorDirs = [".cursor", ".claude", ".gemini", ".codex"];
      console.log(`── Would create: editor rules + agent prompts ${"─".repeat(20)}`);
      for (const dir of editorDirs) {
        console.log(`   ${dir}/rules/revenium.md`);
        console.log(`   ${dir}/revvy-agent.md`);
      }
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
    await writeCallSiteManifest(targetDir, postScanResult, design);
    log("✓", `Created ${getManifestFilename(design.detectedLanguage)} (${postScanResult.callSites.length} call sites, post-instrumentation line numbers)`);

    // .env — single-package only. In a monorepo, the runtime .env almost
    // always lives inside a workspace (apps/<app>/.env) — guessing wrong
    // means metering silently fails because the runtime never reads our key.
    let envCreated = false;
    if (!pmInfo?.isMonorepo) {
      const envPath = join(targetDir, ".env");
      const envContent = buildEnvContent(args.apiKey as string);
      if (await fileExists(envPath)) {
        const existing = await readFile(envPath, "utf-8");
        if (!existing.includes("REVENIUM_METERING_API_KEY")) {
          await appendFile(envPath, envContent);
          log("✓", "Added REVENIUM_METERING_API_KEY to .env");
        }
      } else {
        await writeFile(envPath, envContent.trimStart(), "utf-8");
        log("✓", "Created .env with REVENIUM_METERING_API_KEY");
        envCreated = true;
      }
    } else {
      log("ℹ", `Skipped writing .env at repo root (monorepo) — see ${getMonorepoTodoFilename()} for placement instructions.`);
    }

    // Monorepo placement TODO — written when the layout is ambiguous and the
    // agent (or a careful human) needs to decide where the helper + .env go.
    if (pmInfo?.isMonorepo) {
      const todoPath = await writeMonorepoTodo({
        targetDir,
        design,
        pmInfo,
        apiKey: args.apiKey as string,
      });
      log("✓", `Created ${todoPath.split("/").pop()} — read it before installing the SDK`);
    }

    // Track CI/editor-rules files so they can be included in the modified-files
    // manifest (otherwise it underreports what revvy created — agents using the
    // manifest for cleanup/uninstall would miss them).
    const ciAndEditorFiles: string[] = [];

    // 6. CI setup (unless skipped) — runs BEFORE the modified-files manifest
    // so the manifest can capture the full file list.
    if (!args.skipCi) {
      const ghPath = join(targetDir, ".github/workflows/revenium-check.yml");
      await ensureDir(ghPath);
      const ghContent = pmInfo ? buildGitHubActionWorkflow(pmInfo) : GITHUB_ACTION_WORKFLOW;
      await writeFile(ghPath, ghContent, "utf-8");
      log("✓", "Created .github/workflows/revenium-check.yml");
      ciAndEditorFiles.push(".github/workflows/revenium-check.yml");

      const editorRulesContent = getEditorRules(depResult.language, design.detectedProviders);
      const editorDirs = [".cursor", ".claude", ".gemini", ".codex"];

      for (const dir of editorDirs) {
        const rulesPath = join(targetDir, dir, "rules/revenium.md");
        await ensureDir(rulesPath);
        await writeFile(rulesPath, editorRulesContent, "utf-8");
        ciAndEditorFiles.push(`${dir}/rules/revenium.md`);

        const agentPath = join(targetDir, dir, "revvy-agent.md");
        await ensureDir(agentPath);
        await writeFile(agentPath, AGENT_PROMPT, "utf-8");
        ciAndEditorFiles.push(`${dir}/revvy-agent.md`);
      }
      log("✓", "Created editor rules + agent prompts (Cursor, Claude, Gemini, Codex)");
    }

    // Modified files manifest — written LAST so it captures every file revvy
    // created in this run (helper, .env, CI workflow, editor rules, agent prompts,
    // monorepo TODO, etc). Agents and audit scripts can rely on this manifest
    // to know exactly what revvy touched.
    const modifiedManifestPath = await writeModifiedFilesManifest(targetDir, {
      instrumentResult,
      language: design.detectedLanguage,
      envCreated,
      isMonorepo: pmInfo?.isMonorepo === true,
      extraGeneratedFiles: ciAndEditorFiles,
    });
    if (modifiedManifestPath) {
      log("✓", "Created revenium-modified-files.json");
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
    console.log("  ✓ Basic metering active");
    console.log("    Tokens, model, and cost are tracked automatically via middleware imports.");
    console.log("");
    console.log("  ℹ Revvy intentionally adds imports + a reference comment, but does NOT modify");
    console.log("    your AI call sites — that's left to you (or your AI coding agent), because");
    console.log("    static call-site mutation across the SDK matrix is error-prone.");
    console.log("    See the comment block revvy inserted in the modified file(s) for the exact");
    console.log("    usageMetadata to copy into your .create() calls.");
    console.log("");
    console.log("Next steps:");
    console.log("  1. Install the SDK (see install command above)");
    console.log("  2. Add usage_metadata to your AI calls for business-context metering");
    console.log("  3. Run `revvy check` to verify coverage");
  }
}
