/**
 * Reads each customer source file with AI calls, applies provider-specific
 * transforms, writes the result back, and keeps a `.revvy-backup` of the
 * original next to it. Also derives the install command + .env block the
 * Revvy's Complete screen displays.
 */

import { readFile, writeFile, copyFile } from "fs/promises";
import { join } from "path";
import type { ScanResult, CallSite } from "../../types/scan-result.js";
import type { MeteringDesign } from "../../types/metering-design.js";
import type { PackageManagerInfo } from "../../utils/package-manager.js";
import { installCommand as buildInstallVerb } from "../../utils/package-manager.js";
import type { TransformContext } from "./transforms/index.js";
import { isPythonPerplexityFile, isNodePerplexityFile } from "./transforms/index.js";
import { getTransform } from "./constants/transform-registry.js";

export interface InstrumentationChange {
  filePath: string;
  changes: string[];
  backupPath: string;
}

export interface InstrumentationResult {
  filesModified: number;
  totalChanges: number;
  changes: InstrumentationChange[];
  errors: Array<{ filePath: string; error: string }>;
}

/** Preview of what instrumentation WOULD do, without writing files. */
export interface PreviewFile {
  filePath: string;
  providers: string[];
  changes: string[];
  /** Before/after content for diff rendering. */
  before: string;
  after: string;
}

/** Before/after content of one file for the "Show me an example" feature. */
export interface PreviewExample {
  filePath: string;
  before: string;
  after: string;
}

export interface PreviewResult {
  files: PreviewFile[];
  totalFiles: number;
  totalChanges: number;
  /** Before/after of the first modified file (for "Show me an example"). */
  example: PreviewExample | null;
}

function groupCallSitesByFile(
  callSites: CallSite[],
): Map<string, CallSite[]> {
  const grouped = new Map<string, CallSite[]>();
  for (const site of callSites) {
    const existing = grouped.get(site.filePath) || [];
    existing.push(site);
    grouped.set(site.filePath, existing);
  }
  return grouped;
}

function getProvidersInFile(callSites: CallSite[]): string[] {
  return [...new Set(callSites.map((s) => s.provider))];
}

/** Shared logic: read file + run transforms in memory. Does NOT write. */
async function processFile(
  targetDir: string,
  relativeFilePath: string,
  callSites: CallSite[],
  scanResult: ScanResult,
  ctx: TransformContext,
): Promise<{ modified: boolean; changes: string[]; providers: string[]; before: string; after: string } | null> {
  const absolutePath = join(targetDir, relativeFilePath);

  try {
    const originalContent = await readFile(absolutePath, "utf-8");
    let content = originalContent;
    const allChanges: string[] = [];
    const providers = getProvidersInFile(callSites);

    for (const provider of providers) {
      let effectiveProvider = provider;
      if (
        provider === "openai" &&
        ((scanResult.language === "python" && isPythonPerplexityFile(content)) ||
         (scanResult.language === "node" && isNodePerplexityFile(content)))
      ) {
        effectiveProvider = "perplexity";
      }

      const transform = getTransform(scanResult.language, effectiveProvider);
      if (!transform) {
        allChanges.push(
          `Skipped ${provider}: no transform available for ${scanResult.language}`,
        );
        continue;
      }

      const transformResult = transform(content, { ...ctx, filePath: relativeFilePath });
      if (transformResult.modified) {
        content = transformResult.content;
        allChanges.push(...transformResult.changes);
      }
    }

    return {
      modified: content !== originalContent,
      changes: allChanges,
      providers,
      before: originalContent,
      after: content,
    };
  } catch {
    return null;
  }
}

/**
 * Filters call sites to only include the centralized utility file
 * if the user chose one during consultation. Otherwise returns all.
 */
function filterByCentralized(
  callSites: CallSite[],
  design: MeteringDesign,
): CallSite[] {
  if (design.centralizedCallPattern?.detected && design.centralizedCallPattern.filePath) {
    const target = design.centralizedCallPattern.filePath;
    const filtered = callSites.filter((s) => s.filePath === target);
    if (filtered.length === 0) {
      return callSites;
    }
    return filtered;
  }
  return callSites;
}

/**
 * Dry-run: runs all transforms in memory without writing any files.
 * Returns a preview of what would change.
 */
export async function previewInstrumentation(
  targetDir: string,
  scanResult: ScanResult,
  design: MeteringDesign,
): Promise<PreviewResult> {
  const filtered = filterByCentralized(scanResult.callSites, design);
  const fileGroups = groupCallSitesByFile(filtered);
  const ctx: TransformContext = {
    design,
    utilityImportPath:
      design.detectedLanguage === "python"
        ? "revenium_config"
        : "./revenium-config",
  };

  const files: PreviewFile[] = [];
  let totalChanges = 0;
  let example: PreviewExample | null = null;

  for (const [relativeFilePath, callSites] of fileGroups) {
    const result = await processFile(targetDir, relativeFilePath, callSites, scanResult, ctx);
    if (result?.modified) {
      files.push({
        filePath: relativeFilePath,
        providers: result.providers,
        changes: result.changes,
        before: result.before,
        after: result.after,
      });
      totalChanges += result.changes.length;

      // Capture before/after of the first modified file for "Show me an example"
      if (!example) {
        example = {
          filePath: relativeFilePath,
          before: result.before,
          after: result.after,
        };
      }
    }
  }

  return { files, totalFiles: files.length, totalChanges, example };
}

export async function instrumentCallSites(
  targetDir: string,
  scanResult: ScanResult,
  design: MeteringDesign,
): Promise<InstrumentationResult> {
  const result: InstrumentationResult = {
    filesModified: 0,
    totalChanges: 0,
    changes: [],
    errors: [],
  };

  const filtered = filterByCentralized(scanResult.callSites, design);
  const fileGroups = groupCallSitesByFile(filtered);
  const ctx: TransformContext = {
    design,
    utilityImportPath:
      design.detectedLanguage === "python"
        ? "revenium_config"
        : "./revenium-config",
  };

  for (const [relativeFilePath, callSites] of fileGroups) {
    const absolutePath = join(targetDir, relativeFilePath);

    try {
      const originalContent = await readFile(absolutePath, "utf-8");
      const backupPath = absolutePath + ".revvy-backup";
      await copyFile(absolutePath, backupPath);

      let content = originalContent;
      const allChanges: string[] = [];
      const providers = getProvidersInFile(callSites);

      for (const provider of providers) {
        let effectiveProvider = provider;
        if (
          provider === "openai" &&
          ((scanResult.language === "python" && isPythonPerplexityFile(content)) ||
           (scanResult.language === "node" && isNodePerplexityFile(content)))
        ) {
          effectiveProvider = "perplexity";
        }

        const transform = getTransform(scanResult.language, effectiveProvider);
        if (!transform) {
          allChanges.push(
            `Skipped ${provider}: no transform available for ${scanResult.language}`,
          );
          continue;
        }

        const transformResult = transform(content, { ...ctx, filePath: relativeFilePath });
        if (transformResult.modified) {
          content = transformResult.content;
          allChanges.push(...transformResult.changes);
        }
      }

      if (content !== originalContent) {
        await writeFile(absolutePath, content, "utf-8");
        result.filesModified++;
        result.totalChanges += allChanges.length;
        result.changes.push({
          filePath: relativeFilePath,
          changes: allChanges,
          backupPath,
        });
      }
    } catch (error) {
      result.errors.push({
        filePath: relativeFilePath,
        error:
          error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

/**
 * Returns the install command displayed at the end of Revvy. We always
 * pin the umbrella package (`@revenium/middleware` for Node,
 * `revenium-python-sdk[<provider>,...]` for Python) — provider-specific
 * subpaths come from the same single dependency.
 *
 * For Node, the optional `pmInfo` argument lets callers pass detected
 * package-manager + monorepo info so the printed command uses `pnpm add` /
 * `yarn add` / `bun add` instead of always `npm install`, and surfaces a
 * monorepo-scoping hint when applicable.
 */
export function getInstallCommand(design: MeteringDesign, pmInfo?: PackageManagerInfo): string {
  const language = design.detectedLanguage;
  const providers = design.detectedProviders;

  if (language === "node") {
    const peerDeps: string[] = ["@revenium/middleware", "dotenv"];
    if (
      providers.includes("OpenAI") ||
      providers.includes("Azure OpenAI") ||
      providers.includes("Perplexity")
    ) {
      peerDeps.push("openai");
    }
    if (providers.includes("Anthropic")) peerDeps.push("@anthropic-ai/sdk");
    if (
      providers.includes("Google GenAI") ||
      providers.includes("Google GenAI (legacy)")
    ) {
      peerDeps.push("@google/genai");
    }
    if (providers.includes("Vertex AI")) {
      peerDeps.push("@google-cloud/vertexai");
    }

    const manager = pmInfo?.manager ?? "npm";
    const baseCmd = buildInstallVerb(manager, peerDeps);
    if (pmInfo?.isMonorepo) {
      return `${baseCmd}   # monorepo: scope to your runtime workspace, e.g. \`${manager} --filter <pkg> add …\` or \`${manager} workspace <pkg> add …\``;
    }
    return baseCmd;
  }

  if (language === "python") {
    const extras: string[] = [];
    if (providers.includes("OpenAI") || providers.includes("Azure OpenAI"))
      extras.push("openai");
    if (providers.includes("Anthropic")) extras.push("anthropic");
    if (providers.includes("LiteLLM")) extras.push("litellm");
    if (providers.includes("Ollama")) extras.push("ollama");
    if (providers.includes("Perplexity")) extras.push("perplexity");
    if (
      providers.includes("Google GenAI") ||
      providers.includes("Google GenAI (legacy)") ||
      providers.includes("Vertex AI")
    ) {
      extras.push("google-genai");
    }
    const extrasFragment = extras.length ? `[${extras.join(",")}]` : "";
    return `pip install "revenium-python-sdk${extrasFragment}" python-dotenv`;
  }

  return "# Go: add revenium middleware modules to go.mod";
}

export function generateEnvContent(apiKey?: string): string {
  return [
    "",
    "# Revenium Metering (added by Revvy)",
    `REVENIUM_METERING_API_KEY=${apiKey || "your_api_key_here"}`,
    "",
  ].join("\n");
}
