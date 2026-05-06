import type { CheckResult } from "./runCheck.js";

export function formatCheckResult(result: CheckResult, ci: boolean, warnOnly: boolean = false): string {
  const lines: string[] = [];

  // Banner up top so the warn-only soft-fail is visible at a glance in CI
  // logs. We only show it when warn-only is on AND we'd otherwise have failed —
  // a successful run doesn't need a "warn-only is active" reminder.
  if (warnOnly && !result.passed) {
    const msg =
      "Warn-only mode: issues found but not failing the build. Remove --warn-only to enforce blocking.";
    if (ci) {
      lines.push(`::warning::${msg}`);
    } else {
      lines.push(`⚠ ${msg}`);
      lines.push("");
    }
  }

  // Surface instrumentation regressions FIRST — they're the highest-priority
  // signal because they imply previously-valid code is now broken.
  if (result.instrumentationRegressions.length > 0) {
    lines.push(
      `❌ ${result.instrumentationRegressions.length} instrumentation regression${result.instrumentationRegressions.length === 1 ? "" : "s"} detected`,
    );
    lines.push("");
    for (const reg of result.instrumentationRegressions) {
      if (ci) {
        const msg =
          reg.reason === "parse-failed"
            ? `File no longer parses — ${reg.suggestion}`
            : `Expected ${reg.expectedCallSites ?? "?"} AI call site(s), found 0 in current scan — ${reg.suggestion}`;
        lines.push(`::error file=${reg.filePath}::${msg}`);
      } else {
        const tag = reg.reason === "parse-failed" ? "file no longer parses" : "expected calls missing";
        lines.push(`  → ${reg.filePath} (${tag})`);
        lines.push(`    💡 ${reg.suggestion}`);
        lines.push("");
      }
    }
  }

  if (result.totalCallSites === 0 && result.providersWithoutMiddleware.length === 0 && result.instrumentationRegressions.length === 0) {
    lines.push("ℹ No AI API calls detected in this codebase.");
    return lines.join("\n");
  }

  // Config info
  if (result.config.ignore?.length) {
    lines.push(`ℹ Ignoring ${result.config.ignore.length} pattern(s) from .reveniumrc`);
    lines.push("");
  }

  // Unwrapped call sites
  if (result.unwrappedCount > 0) {
    lines.push(
      `❌ ${result.unwrappedCount} AI call${result.unwrappedCount === 1 ? "" : "s"} not wrapped by Revenium`,
    );
    lines.push("");

    if (ci) {
      for (const site of result.unwrapped) {
        lines.push(
          `::error file=${site.filePath},line=${site.lineNumber}::AI call not wrapped by Revenium: ${site.provider} ${site.method} — ${site.suggestion}`,
        );
      }
    } else {
      // group by provider so the suggestion appears once per provider
      const byProvider = new Map<string, typeof result.unwrapped>();
      for (const site of result.unwrapped) {
        const group = byProvider.get(site.provider) ?? [];
        group.push(site);
        byProvider.set(site.provider, group);
      }

      const DISPLAY_NAMES: Record<string, string> = {
        openai: "OpenAI",
        anthropic: "Anthropic",
        "google-genai": "Google GenAI",
        "vertex-ai": "Vertex AI",
        bedrock: "Bedrock",
        perplexity: "Perplexity",
        ollama: "Ollama",
        litellm: "LiteLLM",
      };

      for (const [provider, sites] of byProvider) {
        const label = DISPLAY_NAMES[provider] ?? provider;
        lines.push(`  ${label} (${sites.length} call${sites.length === 1 ? "" : "s"}):`);
        for (const site of sites) {
          lines.push(`    → ${site.filePath}:${site.lineNumber} — ${site.method}`);
        }
        // Strip trailing "in this file" since multiple files may be listed above
        const suggestion = sites[0]!.suggestion.replace(/ in this file$/, "");
        lines.push(`    💡 ${suggestion}`);
        lines.push("");
      }
    }
  }

  // Providers without middleware
  if (result.providersWithoutMiddleware.length > 0) {
    lines.push("");
    lines.push(
      `⚠ ${result.providersWithoutMiddleware.length} AI provider${result.providersWithoutMiddleware.length === 1 ? "" : "s"} detected without Revenium middleware`,
    );
    lines.push("");

    for (const p of result.providersWithoutMiddleware) {
      if (ci) {
        lines.push(
          `::warning::${p.provider} SDK (${p.packageName}) installed without Revenium middleware — ${p.suggestion}`,
        );
      } else {
        lines.push(`  ⚠ ${p.provider} (${p.packageName})`);
        lines.push(`    💡 ${p.suggestion}`);
        lines.push("");
      }
    }
  }

  // Multi-entry-point check
  if (result.entryPointWarnings.length > 0) {
    if (!ci) {
      lines.push("");
      lines.push("⚠ Multi-entry-point check");
      lines.push("");
    }
    for (const w of result.entryPointWarnings) {
      // Honest remediation hint: tell the user EXACTLY what "no middleware
      // import was found" might mean, including the case where revvy looked
      // for the middleware but ALSO scanned for AI calls and found nothing
      // (which is the silent-failure mode — the SDK is imported but the call
      // shape isn't in our pattern table).
      const msg =
        `⚠ ${w.subdir}/ contains its own package manifest (${w.manifestFile}) but no Revenium middleware import was found in its subtree. ` +
        `If it runs as a separate entry point, its AI calls are reported as wrapped above but will NOT be metered at runtime.\n` +
        `    To instrument: \`cd ${w.subdir} && revvy --non-interactive --setup-mode instrumentation ...\`\n` +
        `    If that command finds 0 call sites, the SDK pattern isn't in revvy's scanner — open an issue with the call shape ` +
        `(e.g. \`client.foo.bar.create\`) so it can be added to \`node-patterns.ts\`. ` +
        `Don't assume "0 calls = clean" — check the source manually first.`;
      if (ci) {
        lines.push(`::warning::${msg.replace(/\n\s*/g, " ")}`);
      } else {
        lines.push(`  ${msg}`);
        lines.push("");
      }
    }
  }

  // Partial success: some wrapped, some not — show count to make the partial state clear
  // (when fully passed, the "All passed" summary below carries the message instead.)
  if (result.wrappedCount > 0 && result.unwrappedCount > 0) {
    lines.push(
      `✅ ${result.wrappedCount} call${result.wrappedCount === 1 ? "" : "s"} properly wrapped (basic metering)`,
    );
  }

  // Usage metadata coverage
  if (result.wrappedCount > 0) {
    const withoutMetadata = result.wrappedCount - result.withMetadataCount;
    if (result.withMetadataCount > 0) {
      lines.push(
        `✅ ${result.withMetadataCount} call${result.withMetadataCount === 1 ? "" : "s"} with usage_metadata (business context)`,
      );
    }
    if (withoutMetadata > 0) {
      lines.push(
        `ℹ ${withoutMetadata} call${withoutMetadata === 1 ? "" : "s"} without usage_metadata — add business context (org, product, agent) for full metering`,
      );
    }
  }

  // 0 call sites but providers detected — make the silent state explicit
  // (otherwise the user sees provider warnings with no acknowledgement that the scan completed)
  if (result.totalCallSites === 0 && result.providersWithoutMiddleware.length > 0) {
    lines.push("");
    lines.push(
      "ℹ 0 AI call sites matched our patterns — see warnings above for likely reasons (e.g. deferred-binding, dynamic imports, or unsupported call shapes).",
    );
  }

  // Pass/partial-pass summary. We have to be careful here: "All N AI calls
  // properly wrapped ✅" is misleading when there are entry-point-warnings
  // (= subtrees where revvy can't make a strong claim of completeness — could
  // be that the SDK or call pattern isn't supported, in which case the count
  // we have is a lower bound, not a complete tally). Reframe based on
  // confidence:
  //   - confident pass: 0 unwrapped, 0 entry-point-warnings, 0 regressions → All N wrapped ✅
  //   - qualified pass: 0 unwrapped + entry-point-warnings present → "All N detected calls wrapped, but…"
  //   - other paths handled by the unwrapped / regressions branches above
  if (result.passed && result.totalCallSites > 0) {
    const verb = result.totalCallSites === 1 ? "is" : "are";
    if (result.entryPointWarnings.length === 0) {
      lines.push(
        `✅ All ${result.totalCallSites} AI call${result.totalCallSites === 1 ? "" : "s"} ${verb} properly wrapped by Revenium.`,
      );
    } else {
      // Qualified pass — surface the "we may be missing some" caveat alongside the green checkmark.
      lines.push(
        `✅ All ${result.totalCallSites} *detected* AI call${result.totalCallSites === 1 ? "" : "s"} ${verb} properly wrapped — but ${result.entryPointWarnings.length} workspace(s) above had AI SDK imports without any matching call patterns. The total may be incomplete (see "Multi-entry-point check" warnings).`,
      );
    }
  }

  // SDK not detected at all
  if (!result.instrumentationDetected) {
    lines.push("");
    lines.push(
      "💡 Revenium SDK not detected. Run `npx @revenium/revvy` to set up instrumentation.",
    );
  }

  return lines.join("\n");
}

export function formatCheckResultJson(result: CheckResult, warnOnly: boolean = false): string {
  return JSON.stringify(
    {
      passed: result.passed,
      warnOnly,
      language: result.language,
      totalCallSites: result.totalCallSites,
      wrappedCount: result.wrappedCount,
      unwrappedCount: result.unwrappedCount,
      withMetadataCount: result.withMetadataCount,
      instrumentationDetected: result.instrumentationDetected,
      unwrapped: result.unwrapped.map((s) => ({
        file: s.filePath,
        line: s.lineNumber,
        provider: s.provider,
        method: s.method,
        operationType: s.operationType,
        suggestion: s.suggestion,
      })),
      providersWithoutMiddleware: result.providersWithoutMiddleware.map((p) => ({
        provider: p.provider,
        packageName: p.packageName,
        suggestion: p.suggestion,
      })),
      entryPointWarnings: result.entryPointWarnings.map((w) => ({
        subdir: w.subdir,
        manifestFile: w.manifestFile,
      })),
      instrumentationRegressions: result.instrumentationRegressions.map((r) => ({
        file: r.filePath,
        reason: r.reason,
        expectedCallSites: r.expectedCallSites,
        suggestion: r.suggestion,
      })),
    },
    null,
    2,
  );
}
