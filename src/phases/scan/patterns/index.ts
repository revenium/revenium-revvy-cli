import { NODE_PATTERNS } from "./node-patterns.js";
import { PYTHON_PATTERNS } from "./python-patterns.js";
import { GO_PATTERNS } from "./go-patterns.js";
import type { ProviderPattern } from "./node-patterns.js";
import type { SupportedLanguage } from "../../../constants/languages.js";

export type { ProviderPattern, CallPattern, OperationType } from "./node-patterns.js";

export const PATTERNS_BY_LANGUAGE: Record<SupportedLanguage, ProviderPattern[]> = {
  node: NODE_PATTERNS,
  python: PYTHON_PATTERNS,
  go: GO_PATTERNS,
};

export function getPatternsForLanguage(language: SupportedLanguage): ProviderPattern[] {
  return PATTERNS_BY_LANGUAGE[language] || [];
}

export function getAllPatterns(): ProviderPattern[] {
  return [...NODE_PATTERNS, ...PYTHON_PATTERNS, ...GO_PATTERNS];
}
