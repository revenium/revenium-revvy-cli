/**
 * Transform for Python files using the Perplexity API via the OpenAI SDK: adds
 * `import revenium_middleware.perplexity` (auto-patches the OpenAI SDK for
 * Perplexity) and a commented usage_metadata reference.
 *
 * Install: pip install "revenium-python-sdk[perplexity]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { instrumentPythonMiddleware } from "./base-python-transform.js";

/**
 * Heuristic: does this file look like it's using the Perplexity API?
 */
export function isPythonPerplexityFile(content: string): boolean {
  return (
    content.includes("perplexity.ai") ||
    content.includes("PERPLEXITY_API_KEY") ||
    content.includes("PERPLEXITY_KEY") ||
    /model\s*[=:]\s*["']sonar/.test(content)
  );
}

export function transformPythonPerplexity(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return instrumentPythonMiddleware(content, ctx, {
    module: "revenium_middleware.perplexity",
    importLine: `import revenium_middleware.perplexity  # Revenium: auto-patches OpenAI SDK for Perplexity`,
    commentKey: "perplexity",
    label: "Perplexity",
  });
}
