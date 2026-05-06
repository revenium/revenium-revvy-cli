/**
 * Transform for Python files using the LiteLLM client SDK.
 *
 * Adds:
 * 1. import revenium_middleware.litellm.client.middleware (auto-patches on import)
 * 2. Commented usage_metadata reference block
 *
 * Install: pip install "revenium-python-sdk[litellm]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { hasImport, insertPythonImport, insertPythonBlock, buildPythonCommentBlock } from "./base-python-transform.js";

const REVENIUM_IMPORT = `import revenium_middleware.litellm.client.middleware  # Revenium: auto-patches LiteLLM SDK on import`;

export function transformPythonLiteLLM(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (
    hasImport(result, "revenium_middleware.litellm") ||
    hasImport(result, "revenium_middleware_litellm")
  ) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (LiteLLM)"],
    };
  }

  // 1. Add middleware import
  result = insertPythonImport(result, REVENIUM_IMPORT);
  changes.push("Added revenium_middleware.litellm.client.middleware import (auto-patches)");

  // 2. Add commented usage_metadata reference
  const commentBlock = buildPythonCommentBlock(ctx.design, "litellm", ctx.filePath);
  result = insertPythonBlock(result, commentBlock);
  changes.push("Added usage_metadata reference (commented — uncomment to enable business context)");

  return { content: result, modified: changes.length > 0, changes };
}
