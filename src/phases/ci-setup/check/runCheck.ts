import { readFile } from "fs/promises";
import { join } from "path";
import { detectDependencies, detectCallSites, detectExistingInstrumentation, detectImportedProviderPackages } from "../../scan/detectors/index.js";
import { buildAllProviders } from "../../scan/build-all-providers.js";
import type { CallSite, DetectedProvider } from "../../../types/scan-result.js";
import type { SupportedLanguage } from "../../../constants/languages.js";
import { REVENIUM_SDK_PACKAGES } from "../../../constants/detection.js";
import { loadConfig, type ReveniumCheckConfig } from "./loadConfig.js";
import { detectMultiEntryPointWarnings, type EntryPointWarning } from "./entry-point-detector.js";

export interface UnwrappedCallSite extends CallSite {
  suggestion: string;
}

export interface ProviderWithoutMiddleware {
  provider: string;
  packageName: string;
  suggestion: string;
}

export interface InstrumentationRegression {
  filePath: string;
  /** Why we believe the file is broken: parse failure, or missing call sites that the manifest claims exist. */
  reason: "parse-failed" | "calls-missing";
  /** For "calls-missing": how many call sites the manifest claimed at the time of instrumentation. */
  expectedCallSites?: number;
  /** Diagnostic suggestion to display to the user. */
  suggestion: string;
}

export interface CheckResult {
  language: SupportedLanguage;
  totalCallSites: number;
  wrappedCount: number;
  unwrappedCount: number;
  unwrapped: UnwrappedCallSite[];
  /** Number of wrapped calls that also have usage_metadata (business context) */
  withMetadataCount: number;
  instrumentationDetected: boolean;
  providersWithoutMiddleware: ProviderWithoutMiddleware[];
  /** Subdirectories that have their own package manifest but no middleware import in their subtree. */
  entryPointWarnings: EntryPointWarning[];
  /**
   * Files that revvy modified during instrumentation but no longer scan as
   * containing the AI calls the manifest recorded. The most common cause is
   * a syntax error introduced by the auto-instrument transform itself.
   * Surfaced as a hard fail so `revvy check` doesn't false-pass on broken code.
   */
  instrumentationRegressions: InstrumentationRegression[];
  passed: boolean;
  config: ReveniumCheckConfig;
}

function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (filePath === pattern) return true;
    // Simple glob: "src/utils/*" matches "src/utils/anything.ts"
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (filePath.startsWith(prefix)) return true;
    }
    // Match by filename anywhere: "*.test.ts" matches "src/foo.test.ts"
    if (pattern.startsWith("*") && filePath.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function classifyCallSites(
  callSites: CallSite[],
  instrumentedFiles: Map<string, Set<string>>,
  hasReveniumSdk: boolean,
  config: ReveniumCheckConfig,
): { wrapped: CallSite[]; unwrapped: UnwrappedCallSite[] } {
  const wrapped: CallSite[] = [];
  const unwrapped: UnwrappedCallSite[] = [];

  for (const site of callSites) {
    if (isIgnored(site.filePath, config.ignore ?? [])) {
      wrapped.push(site);
      continue;
    }

    if (config.skipProviders?.includes(site.provider)) {
      wrapped.push(site);
      continue;
    }

    const fileInstrumentation = instrumentedFiles.get(site.filePath);
    const isWrapped =
      hasReveniumSdk &&
      fileInstrumentation != null &&
      (fileInstrumentation.has(site.provider) || fileInstrumentation.has("*"));

    if (isWrapped) {
      wrapped.push(site);
    } else {
      unwrapped.push({
        ...site,
        suggestion: hasReveniumSdk
          ? `Add Revenium instrumentation import for ${site.provider} in this file`
          : `Install @revenium/middleware and add instrumentation for ${site.provider}`,
      });
    }
  }

  return { wrapped, unwrapped };
}

/**
 * Check if any detected AI provider SDKs are installed without the
 * corresponding Revenium middleware package.
 */
/**
 * Maps from a DetectedProvider.name (derived from the npm package name, e.g.
 * "anthropic-ai-sdk") to the canonical provider key used in patterns and
 * instrumentation detection (e.g. "anthropic").
 */
const PROVIDER_NAME_ALIASES: Record<string, string> = {
  "anthropic-ai-sdk": "anthropic",
  "google-genai": "google-genai",
  "google-generative-ai": "google-genai",
  "google-cloud-vertexai": "vertex-ai",
  "aws-sdk-client-bedrock-runtime": "bedrock",
  "azure-openai": "openai",
};

function normalizeProviderName(name: string): string {
  return PROVIDER_NAME_ALIASES[name] ?? name;
}

function findProvidersWithoutMiddleware(
  providers: DetectedProvider[],
  language: SupportedLanguage,
  instrumentationDetected: boolean,
  instrumentedProviders: Set<string>,
  importedPackages: Set<string>,
  callSiteProviders: Set<string>,
): ProviderWithoutMiddleware[] {
  if (instrumentationDetected && providers.length === 0) return [];

  const sdkPackages = REVENIUM_SDK_PACKAGES[language];
  const hasAnySdk = sdkPackages.length > 0;

  const results: ProviderWithoutMiddleware[] = [];

  for (const provider of providers) {
    const normalized = normalizeProviderName(provider.name);
    const isInstrumented =
      instrumentedProviders.has(normalized) || instrumentedProviders.has(provider.name);

    if (isInstrumented) continue;

    // Case 1: Package is NOT imported anywhere in source code — suppress the
    // warning entirely. The package is installed but not actually used.
    const isImported = importedPackages.has(provider.packageName);
    if (!isImported) continue;

    const middlewarePkg = language === "node"
      ? "@revenium/middleware"
      : language === "python"
        ? "revenium-python-sdk"
        : `revenium-middleware-${normalized}-go`;

    const hasCallSites =
      callSiteProviders.has(normalized) || callSiteProviders.has(provider.name);

    if (hasCallSites) {
      // Case 2: Package imported AND call sites detected AND missing middleware
      // — keep the current warning behavior.
      results.push({
        provider: provider.displayName,
        packageName: provider.packageName,
        suggestion: hasAnySdk
          ? `Add instrumentation import for ${provider.displayName} (e.g. @revenium/middleware/${normalized})`
          : `Install ${middlewarePkg} to instrument ${provider.displayName} calls`,
      });
    } else {
      // Case 3: Package imported AND 0 call sites detected AND missing middleware
      // — likely a deferred-binding or dynamic-import pattern.
      results.push({
        provider: provider.displayName,
        packageName: provider.packageName,
        suggestion: `Imported but no call sites matched our patterns. Likely a deferred-binding or dynamic-import pattern (e.g. \`completion = client.chat.completions.create\` then \`completion(...)\`). Instrument manually — see .claude/revvy-agent.md.`,
      });
    }
  }

  return results;
}

export async function runCheck(targetDir: string, excludePatterns?: string[]): Promise<CheckResult> {
  const [depResult, config] = await Promise.all([
    detectDependencies(targetDir),
    loadConfig(targetDir),
  ]);
  const language = depResult.language;

  const [callSiteResult, instrumentation, importedPackages] = await Promise.all([
    detectCallSites(targetDir, language, excludePatterns),
    detectExistingInstrumentation(targetDir, language),
    detectImportedProviderPackages(targetDir, language, excludePatterns),
  ]);

  // detectMultiEntryPointWarnings runs after callSiteResult is available so it
  // can apply Fix 7 (skip subdirs with no AI activity) and Fix 6 (respect
  // ignore patterns). It also receives excludePatterns for .gitignore / .revvyignore.
  const entryPointWarnings = await detectMultiEntryPointWarnings(targetDir, {
    excludePatterns,
    callSites: callSiteResult.callSites,
    language,
  });

  // Build a map of file → set of providers that are instrumented in that file
  const instrumentedFiles = new Map<string, Set<string>>();
  for (const site of instrumentation.callSites) {
    if (!instrumentedFiles.has(site.filePath)) {
      instrumentedFiles.set(site.filePath, new Set());
    }
    instrumentedFiles.get(site.filePath)!.add(site.provider);
  }

  // Monkey-patching SDKs (Python only):
  // If the middleware is imported ANYWHERE in the project, all calls to that
  // provider are covered globally — the import patches the SDK prototype.
  //
  // For Node: ALL providers (including Anthropic) require per-file imports.
  // While Anthropic technically uses monkey-patching, it depends on import
  // order and doesn't work reliably in workers, tests, or isolated scripts.
  const globallyPatched = new Set<string>();
  for (const [, providers] of instrumentedFiles) {
    for (const p of providers) {
      if (language === "python") {
        globallyPatched.add(p);
      }
    }
  }
  if (globallyPatched.size > 0) {
    for (const site of callSiteResult.callSites) {
      if (globallyPatched.has(site.provider)) {
        if (!instrumentedFiles.has(site.filePath)) {
          instrumentedFiles.set(site.filePath, new Set());
        }
        instrumentedFiles.get(site.filePath)!.add(site.provider);
      }
    }
  }

  const { wrapped, unwrapped } = classifyCallSites(
    callSiteResult.callSites,
    instrumentedFiles,
    instrumentation.detected,
    config,
  );

  // Collect all providers that have instrumentation somewhere
  const instrumentedProviders = new Set<string>();
  for (const [, providers] of instrumentedFiles) {
    for (const p of providers) instrumentedProviders.add(p);
  }

  // Collect provider keys that have at least one detected call site
  const callSiteProviders = new Set<string>();
  for (const site of callSiteResult.callSites) {
    callSiteProviders.add(site.provider);
  }

  // Merge manifest-declared + source-imported providers so import-only
  // providers (e.g. ollama imported but not in requirements.txt) are also checked.
  const providerAgg = buildAllProviders(depResult.providers, callSiteResult.callSites, language);

  const providersWithoutMiddleware = findProvidersWithoutMiddleware(
    providerAgg.allProviders,
    language,
    instrumentation.detected,
    instrumentedProviders,
    importedPackages,
    callSiteProviders,
  );

  // Count how many wrapped call files actually use usage_metadata (business context)
  const filesCheckedForMetadata = new Set<string>();
  const filesWithMetadata = new Set<string>();
  for (const site of wrapped) {
    if (filesCheckedForMetadata.has(site.filePath)) continue;
    filesCheckedForMetadata.add(site.filePath);
    try {
      const fileContent = await readFile(join(targetDir, site.filePath), "utf-8");
      // Check for uncommented usage_metadata (not inside comments)
      const lines = fileContent.split("\n");
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
        if (trimmed.includes("usage_metadata") || trimmed.includes("usageMetadata")) {
          filesWithMetadata.add(site.filePath);
          break;
        }
      }
    } catch {
      // File read failed, skip
    }
  }

  // Count wrapped calls in files that have metadata
  const withMetadataCount = wrapped.filter(s => filesWithMetadata.has(s.filePath)).length;

  // ── Detect instrumentation regressions ──────────────────────────────
  // Two signals:
  //  1. AST parser reported a parse failure on a file we expected to read.
  //     Almost always means a previous instrumentation pass introduced
  //     syntactically invalid code (e.g. injected an import inside a
  //     destructure block).
  //  2. The call-site manifest (revenium-call-sites.json) records N call
  //     sites in file X, but the current scan finds 0 in that file. Either
  //     the file was deleted (legitimate), or the file is parsing but the
  //     scanner can no longer locate the calls — also a likely regression.
  //
  // Surfaced as a hard fail so users don't get a false ✅ on broken code.
  const instrumentationRegressions: InstrumentationRegression[] = [];

  for (const filePath of callSiteResult.parseFailures) {
    if (isIgnored(filePath, config.ignore ?? [])) continue;
    instrumentationRegressions.push({
      filePath,
      reason: "parse-failed",
      suggestion: `File no longer parses as valid ${language === "node" ? "TypeScript/JavaScript" : language}. Most common cause: an instrumentation pass injected an import or comment inside an existing destructured-import block. Inspect the file and restore from \`${filePath}.revvy-backup\` if available.`,
    });
  }

  // Cross-reference with the call-site manifest if it exists.
  try {
    const manifestPath = join(targetDir, language === "python" ? "revenium_call_sites.json" : "revenium-call-sites.json");
    const manifestRaw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestRaw) as {
      callSites?: Array<{ file: string }>;
    };

    if (Array.isArray(manifest.callSites)) {
      // Group manifest entries by file: file → expected-call-count
      const manifestByFile = new Map<string, number>();
      for (const entry of manifest.callSites) {
        if (typeof entry?.file !== "string") continue;
        manifestByFile.set(entry.file, (manifestByFile.get(entry.file) ?? 0) + 1);
      }
      // Build the same map for current scan.
      const currentByFile = new Map<string, number>();
      for (const site of callSiteResult.callSites) {
        currentByFile.set(site.filePath, (currentByFile.get(site.filePath) ?? 0) + 1);
      }
      // Files the manifest claimed had calls but the current scan doesn't see.
      const alreadyFlagged = new Set(instrumentationRegressions.map((r) => r.filePath));
      for (const [filePath, expected] of manifestByFile) {
        if (alreadyFlagged.has(filePath)) continue; // parse failure already surfaced this
        if (isIgnored(filePath, config.ignore ?? [])) continue;
        const found = currentByFile.get(filePath) ?? 0;
        if (found < expected) {
          // If the file is gone, the user deleted it — not a regression.
          // We can detect "file gone" by checking if it's in scannedFiles.
          const stillExists = callSiteResult.scannedFiles.some(
            (f) => f.endsWith(filePath) || f === join(targetDir, filePath),
          );
          if (!stillExists) continue;

          instrumentationRegressions.push({
            filePath,
            reason: "calls-missing",
            expectedCallSites: expected,
            suggestion: `Manifest recorded ${expected} AI call site${expected === 1 ? "" : "s"} in this file, but the current scan finds ${found}. Check whether the file's call sites were renamed, the SDK import was removed, or the file was edited in a way that defeats the scanner's pattern.`,
          });
        }
      }
    }
  } catch {
    // No manifest, or it's malformed — no cross-reference possible. Silent.
  }

  const passed =
    unwrapped.length === 0 &&
    providersWithoutMiddleware.length === 0 &&
    instrumentationRegressions.length === 0;

  return {
    language,
    totalCallSites: callSiteResult.callSites.length,
    wrappedCount: wrapped.length,
    unwrappedCount: unwrapped.length,
    unwrapped,
    withMetadataCount,
    instrumentationDetected: instrumentation.detected,
    providersWithoutMiddleware,
    entryPointWarnings,
    instrumentationRegressions,
    passed,
    config,
  };
}
