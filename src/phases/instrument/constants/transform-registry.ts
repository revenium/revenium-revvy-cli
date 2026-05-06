/**
 * Registry mapping "language:provider" keys to their transform function
 * and the feature flag that gates them.
 *
 * Adding a new provider?
 * 1. Create the transform in transforms/python/ or transforms/node/
 * 2. Export it from the subfolder's index.ts
 * 3. Add the entry here with its feature flag
 */

import type { TransformContext, TransformResult } from "../transforms/index.js";
import { FEATURE_FLAGS } from "../../../feature-flags.js";
import {
  transformNodeOpenAI,
  transformNodeAnthropic,
  transformNodeGoogleGenAI,
  transformNodeVertexAI,
  transformNodePerplexity,
} from "../transforms/node/index.js";
import {
  transformPythonOpenAI,
  transformPythonAnthropic,
  transformPythonOllama,
  transformPythonLiteLLM,
  transformPythonPerplexity,
  transformPythonGoogleGenAI,
} from "../transforms/python/index.js";

export type TransformFn = (content: string, ctx: TransformContext) => TransformResult;

type TransformFlagKey = keyof typeof FEATURE_FLAGS;

export interface TransformEntry {
  fn: TransformFn;
  flag: TransformFlagKey;
}

/**
 * Registry of all transforms, keyed by "language:provider".
 * Each entry includes its function and the feature flag that gates it.
 */
export const TRANSFORM_REGISTRY: Record<string, TransformEntry> = {
  // ── Node ──────────────────────────────────────────────────────────
  "node:openai":        { fn: transformNodeOpenAI,         flag: "TRANSFORM_NODE_OPENAI" },
  "node:azure-openai":  { fn: transformNodeOpenAI,         flag: "TRANSFORM_NODE_OPENAI" },
  "node:anthropic":     { fn: transformNodeAnthropic,      flag: "TRANSFORM_NODE_ANTHROPIC" },
  "node:google-genai":  { fn: transformNodeGoogleGenAI,    flag: "TRANSFORM_NODE_GOOGLE_GENAI" },
  "node:vertex-ai":     { fn: transformNodeVertexAI,       flag: "TRANSFORM_NODE_VERTEX_AI" },
  "node:perplexity":    { fn: transformNodePerplexity,     flag: "TRANSFORM_NODE_PERPLEXITY" },

  // ── Python ────────────────────────────────────────────────────────
  "python:openai":       { fn: transformPythonOpenAI,       flag: "TRANSFORM_PYTHON_OPENAI" },
  "python:anthropic":    { fn: transformPythonAnthropic,    flag: "TRANSFORM_PYTHON_ANTHROPIC" },
  "python:ollama":       { fn: transformPythonOllama,       flag: "TRANSFORM_PYTHON_OLLAMA" },
  "python:litellm":      { fn: transformPythonLiteLLM,      flag: "TRANSFORM_PYTHON_LITELLM" },
  "python:perplexity":   { fn: transformPythonPerplexity,   flag: "TRANSFORM_PYTHON_PERPLEXITY" },
  "python:google-genai": { fn: transformPythonGoogleGenAI,  flag: "TRANSFORM_PYTHON_GOOGLE_GENAI" },
  "python:vertex-ai":    { fn: transformPythonGoogleGenAI,  flag: "TRANSFORM_PYTHON_GOOGLE_GENAI" },
};

/**
 * Looks up the transform function for a language:provider pair.
 * Returns null if no transform exists or the feature flag is disabled.
 */
export function getTransform(
  language: string,
  provider: string,
): TransformFn | null {
  const key = `${language}:${provider}`;
  const entry = TRANSFORM_REGISTRY[key];
  if (!entry) return null;
  if (!FEATURE_FLAGS[entry.flag]) return null;
  return entry.fn;
}
