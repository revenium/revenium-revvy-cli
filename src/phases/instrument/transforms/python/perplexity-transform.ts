/**
 * Transform for Python files using the Perplexity API via the OpenAI SDK.
 *
 * Adds:
 * 1. import revenium_middleware.perplexity (auto-patches OpenAI SDK for Perplexity)
 * 2. Commented usage_metadata reference block
 *
 * Install: pip install "revenium-python-sdk[perplexity]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { hasImport, insertPythonImport, insertPythonBlock, buildPythonCommentBlock } from "./base-python-transform.js";

const REVENIUM_IMPORT = `import revenium_middleware.perplexity  # Revenium: auto-patches OpenAI SDK for Perplexity`;

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
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "revenium_middleware.perplexity")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (Perplexity)"],
    };
  }

  result = insertPythonImport(result, REVENIUM_IMPORT);
  changes.push("Added revenium_middleware.perplexity import (auto-patches OpenAI SDK)");

  const commentBlock = buildPythonCommentBlock(ctx.design, "perplexity", ctx.filePath);
  result = insertPythonBlock(result, commentBlock);
  changes.push("Added usage_metadata reference (commented — uncomment to enable business context)");

  return { content: result, modified: changes.length > 0, changes };
}
