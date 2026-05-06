/**
 * Merges manifest-detected providers with source-import-detected providers.
 * Used by both runPipeline.ts and NonInteractiveRunner.tsx.
 */

import type { SupportedLanguage } from "../../constants/languages.js";
import type { DetectedProvider, CallSite } from "../../types/scan-result.js";
import { getPatternsForLanguage } from "./patterns/index.js";

export interface ProviderAggregation {
  allProviders: DetectedProvider[];
  declaredCount: number;
  importedOnlyCount: number;
}

// Maps manifest-derived provider names to canonical pattern keys so dedup
// works across naming conventions (e.g. "anthropic-ai-sdk" → "anthropic").
const PROVIDER_NAME_ALIASES: Record<string, string> = {
  "anthropic-ai-sdk": "anthropic",
  "google-generative-ai": "google-genai",
  "google-cloud-vertexai": "vertex-ai",
  "aws-sdk-client-bedrock-runtime": "bedrock",
  "azure-openai": "openai",
};

function normalizeProviderName(name: string): string {
  return PROVIDER_NAME_ALIASES[name] ?? name;
}

export function buildAllProviders(
  manifestProviders: DetectedProvider[],
  callSites: CallSite[],
  language: SupportedLanguage,
): ProviderAggregation {
  // Build a set of canonical provider keys from the manifest so dedup
  // correctly matches "anthropic-ai-sdk" (manifest) against "anthropic" (call-site).
  const manifestCanonicalNames = new Set(
    manifestProviders.map((p) => normalizeProviderName(p.name)),
  );
  const allPatterns = getPatternsForLanguage(language);
  const patternByProvider = new Map(allPatterns.map((p) => [p.provider, p]));
  const extraProviders = [...new Set(callSites.map((c) => c.provider))]
    .filter((p) => !manifestCanonicalNames.has(p))
    .map((p) => {
      const pattern = patternByProvider.get(p);
      return {
        name: p,
        displayName: pattern?.displayName ?? p,
        packageName: pattern?.packageNames[0] ?? p,
      };
    });

  return {
    allProviders: [...manifestProviders, ...extraProviders],
    declaredCount: manifestProviders.length,
    importedOnlyCount: extraProviders.length,
  };
}

export function formatProviderSummary(agg: ProviderAggregation): string {
  return agg.importedOnlyCount > 0
    ? `${agg.allProviders.length} providers (${agg.declaredCount} declared, ${agg.importedOnlyCount} imported-only)`
    : `${agg.allProviders.length} providers`;
}
