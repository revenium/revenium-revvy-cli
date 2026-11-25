import { readFile } from "fs/promises";
import { join } from "path";
import { detectDependencies, detectCallSites, detectExistingInstrumentation, detectImportedProviderPackages } from "../../scan/detectors/index.js";
import { buildAllProviders, normalizeProviderName } from "../../scan/build-all-providers.js";
import type { CallSite, DetectedProvider } from "../../../types/scan-result.js";
import type { SupportedLanguage } from "../../../constants/languages.js";
import { REVENIUM_SDK_PACKAGES } from "../../../constants/detection.js";
import { GO_PATTERNS } from "../../scan/patterns/go-patterns.js";
import { getPatternsForLanguage } from "../../scan/patterns/index.js";
import { loadConfig, type ReveniumCheckConfig } from "./loadConfig.js";
import { detectMultiEntryPointWarnings, type EntryPointWarning } from "./entry-point-detector.js";
import { detectPythonMiddlewareActivation, type PythonMiddlewareActivation } from "../../scan/detectors/python-activation.js";

/**
 * `provider-sdk-client`: the middleware is in place, but the call is made on
 * the provider SDK's own client, which a wrapper-pattern middleware never
 * meters. `no-wrapped-equivalent`: the call is one the wrapped client cannot
 * make, so Revenium cannot meter it. `no-middleware`: nothing that runs loads
 * the middleware for it.
 */
export type UnmeteredReason = "provider-sdk-client" | "no-wrapped-equivalent" | "no-middleware";
import { countGoCallsWithUsageMetadata } from "./go-usage-metadata.js";

export interface UnwrappedCallSite extends CallSite {
  suggestion: string;
  reason: UnmeteredReason;
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
  /** Calls that pass the check: metered ones plus `excludedCount`. */
  wrappedCount: number;
  /** Calls that pass only because `.reveniumrc` ignores their file or skips their provider. */
  excludedCount: number;
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

type Verdict = { metered: true } | { metered: false; reason: UnmeteredReason; suggestion: string };

function classifyCallSites(
  callSites: CallSite[],
  config: ReveniumCheckConfig,
  judge: (site: CallSite) => Verdict,
): { wrapped: CallSite[]; excludedCount: number; unwrapped: UnwrappedCallSite[] } {
  const wrapped: CallSite[] = [];
  const unwrapped: UnwrappedCallSite[] = [];
  let excludedCount = 0;

  for (const site of callSites) {
    if (isIgnored(site.filePath, config.ignore ?? []) || config.skipProviders?.includes(site.provider)) {
      wrapped.push(site);
      excludedCount++;
      continue;
    }
    const verdict = judge(site);
    if (verdict.metered) {
      wrapped.push(site);
    } else {
      unwrapped.push({ ...site, reason: verdict.reason, suggestion: verdict.suggestion });
    }
  }

  return { wrapped, excludedCount, unwrapped };
}

const SDK_CLIENT_FIXES: Record<string, string> = {
  openai:
    "Calls on the SDK's own OpenAI client are not metered: @revenium/middleware/openai wraps the client, it does not patch it. Call the wrapped client instead (the `openai` export of the generated revenium-config helper, or GetClient() after Initialize()) with method chains and the metadata as the 2nd argument: openai.chat().completions().create(params, metadata). A client pointed at api.perplexity.ai takes GetClient() from @revenium/middleware/perplexity instead. revvy marks each client it can resolve with a TODO(revenium) comment",
  "azure-openai":
    "Calls on the SDK's own Azure OpenAI client are not metered: @revenium/middleware/openai wraps the client (it detects Azure from its config), it does not patch it. Call the wrapped client instead (the `openai` export of the generated revenium-config helper, or GetClient() after Initialize()): openai.chat().completions().create(params, metadata)",
  "fal-ai":
    "Calls on @fal-ai/client are not metered: @revenium/middleware/fal wraps the client, it does not patch it. Call GetClient() from @revenium/middleware/fal after Initialize(), with the metadata as the last argument of run / subscribe / stream",
};

function providerSdkClientVerdict(provider: string): Verdict {
  return {
    metered: false,
    reason: "provider-sdk-client",
    suggestion: SDK_CLIENT_FIXES[provider] ?? SDK_CLIENT_FIXES.openai!,
  };
}

function noWrappedEquivalentVerdict(site: CallSite): Verdict {
  return {
    metered: false,
    reason: "no-wrapped-equivalent",
    suggestion: `The Revenium wrapped client has no equivalent of ${site.method}, so this call cannot be metered. If that is acceptable, list the file under \`ignore\` (or the provider under \`skipProviders\`) in .reveniumrc`,
  };
}

/**
 * Node and Go: a call counts as metered when its own file imports the
 * middleware, or, for a wrapper-pattern provider, when it is made on the
 * wrapped client (which may come from another module, such as the generated
 * helper). Anthropic's Node patch is process-wide in principle, but it depends
 * on import order and does not reliably reach workers, tests or isolated
 * scripts.
 */
function perFileImportJudge(
  instrumentedFiles: Map<string, Set<string>>,
  hasReveniumSdk: boolean,
  language: SupportedLanguage,
): (site: CallSite) => Verdict {
  return (site) => {
    if (site.client === "no-wrapped-equivalent") return noWrappedEquivalentVerdict(site);
    if (!hasReveniumSdk) {
      return {
        metered: false,
        reason: "no-middleware",
        suggestion: `Install ${reveniumSdkFor(language, site.provider)} and add instrumentation for ${site.provider}`,
      };
    }
    if (site.client === "provider-sdk") return providerSdkClientVerdict(site.provider);
    const fileInstrumentation = instrumentedFiles.get(site.filePath);
    const importedHere = fileInstrumentation?.has(site.provider) || fileInstrumentation?.has("*");
    if (site.client === "revenium-wrapped" || importedHere) return { metered: true };
    return {
      metered: false,
      reason: "no-middleware",
      suggestion: `Add Revenium instrumentation import for ${site.provider} in this file`,
    };
  };
}

function pythonActivationJudge(
  activation: PythonMiddlewareActivation,
  hasReveniumSdk: boolean,
): (site: CallSite) => Verdict {
  return (site) => {
    const meteredAsPerplexity = activation.activated.has("perplexity") && activation.perplexityClientCalls.has(`${site.filePath}:${site.lineNumber}`);
    if (hasReveniumSdk && (activation.activated.has(site.provider) || meteredAsPerplexity)) return { metered: true };
    const importLine = instrumentationImportFor("python", site.provider) ?? "import revenium_middleware";
    const suggestion = activation.onlyInUnimportedHelper.has(site.provider)
      ? `revenium_config.py has \`${importLine}\`, but no module imports revenium_config, so the patch never loads. Import revenium_config (or add \`${importLine}\`) once in the module that starts your app; the patch is process-wide and then covers every file`
      : hasReveniumSdk
        ? `No module in the project runs \`${importLine}\`. Add it once in the module that starts your app, before the first ${site.provider} call; the patch is process-wide and then covers every file`
        : `Install revenium-python-sdk and add \`${importLine}\` once in the module that starts your app`;
    return { metered: false, reason: "no-middleware", suggestion };
  };
}

/**
 * Check if any detected AI provider SDKs are installed without the
 * corresponding Revenium middleware package.
 */
function goMiddlewareModule(providerName: string, normalized: string): string {
  const pattern =
    GO_PATTERNS.find((p) => p.provider === providerName) ??
    GO_PATTERNS.find((p) => p.provider === normalized);
  return pattern?.installModule ?? pattern?.instrumentationImports[0] ?? "github.com/revenium/revenium-go-sdk";
}

function instrumentationImportFor(language: SupportedLanguage, provider: string): string | undefined {
  const pattern = getPatternsForLanguage(language).find((p) => p.provider === provider);
  const marker = pattern?.instrumentationImports[0];
  if (!marker) return undefined;
  return language === "python" ? `import ${marker}` : marker;
}

function reveniumSdkFor(language: SupportedLanguage, provider: string): string {
  if (language === "node") return "@revenium/middleware";
  if (language === "python") return "revenium-python-sdk";
  return goMiddlewareModule(provider, normalizeProviderName(provider));
}

function isPackageImported(packageName: string, importedPackages: Set<string>): boolean {
  if (importedPackages.has(packageName)) return true;
  for (const imported of importedPackages) {
    if (imported.startsWith(`${packageName}/`)) return true;
  }
  return false;
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
    if (!isPackageImported(provider.packageName, importedPackages)) continue;

    const middlewarePkg = reveniumSdkFor(language, provider.name);

    const hasCallSites =
      callSiteProviders.has(normalized) || callSiteProviders.has(provider.name);

    if (hasCallSites) {
      // Case 2: Package imported AND call sites detected AND missing middleware
      // — keep the current warning behavior.
      results.push({
        provider: provider.displayName,
        packageName: provider.packageName,
        suggestion: language === "go"
          ? `Import ${middlewarePkg} to instrument ${provider.displayName} calls`
          : hasAnySdk
            ? `Add instrumentation import for ${provider.displayName} (e.g. ${instrumentationImportFor(language, normalized) ?? middlewarePkg})`
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

  const pythonActivation =
    language === "python" ? await detectPythonMiddlewareActivation(targetDir, callSiteResult.scannedFiles, callSiteResult.callSites) : null;

  const { wrapped, excludedCount, unwrapped } = classifyCallSites(
    callSiteResult.callSites,
    config,
    pythonActivation
      ? pythonActivationJudge(pythonActivation, instrumentation.detected)
      : perFileImportJudge(instrumentedFiles, instrumentation.detected, language),
  );

  // Providers whose middleware is present somewhere. For Python that includes
  // an import only the never-imported helper has: its call sites are already
  // reported above, with the fix, so a second warning would only repeat it.
  const instrumentedProviders = pythonActivation
    ? new Set([...pythonActivation.activated, ...pythonActivation.onlyInUnimportedHelper])
    : new Set([...instrumentedFiles.values()].flatMap((providers) => [...providers]));

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
        if (/usage_metadata|usageMetadata|createUsageMetadata\(/.test(trimmed)) {
          filesWithMetadata.add(site.filePath);
          break;
        }
      }
    } catch {
      // File read failed, skip
    }
  }

  // Count wrapped calls in files that have metadata
  const withMetadataCount = language === "go"
    ? await countGoCallsWithUsageMetadata(targetDir, wrapped)
    : wrapped.filter(s => filesWithMetadata.has(s.filePath)).length;

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
    excludedCount,
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
