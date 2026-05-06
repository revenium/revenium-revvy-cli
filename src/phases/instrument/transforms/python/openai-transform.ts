/**
 * Transform for Python files using the OpenAI SDK.
 *
 * Adds:
 * 1. import revenium_middleware.openai.middleware (auto-patches on import)
 * 2. Commented usage_metadata reference block (developer uncomments what they need)
 *
 * The middleware starts capturing basic metering (tokens, model, cost) on import.
 * The usage_metadata block adds business context (org, product, agent) — optional.
 *
 * Install: pip install "revenium-python-sdk[openai]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { hasImport, insertPythonImport, insertPythonBlock, buildPythonCommentBlock } from "./base-python-transform.js";

const REVENIUM_IMPORT = `import revenium_middleware.openai.middleware  # Revenium: auto-patches OpenAI SDK on import`;

export function transformPythonOpenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (
    hasImport(result, "revenium_middleware.openai") ||
    hasImport(result, "revenium_middleware_openai")
  ) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium"],
    };
  }

  // 1. Add middleware import
  result = insertPythonImport(result, REVENIUM_IMPORT);
  changes.push("Added revenium_middleware.openai import (auto-patches)");

  // 2. Add commented usage_metadata reference
  const commentBlock = buildPythonCommentBlock(ctx.design, "openai", ctx.filePath);
  result = insertPythonBlock(result, commentBlock);
  changes.push("Added usage_metadata reference (commented — uncomment to enable business context)");

  return { content: result, modified: changes.length > 0, changes };
}
