/**
 * Transform for Python files using the Anthropic SDK.
 *
 * Adds:
 * 1. import revenium_middleware.anthropic (auto-patches on import)
 * 2. Commented usage_metadata reference block
 *
 * Install: pip install "revenium-python-sdk[anthropic]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { hasImport, insertPythonImport, insertPythonBlock, buildPythonCommentBlock } from "./base-python-transform.js";

const REVENIUM_IMPORT = `import revenium_middleware.anthropic  # Revenium: auto-patches Anthropic SDK on import`;

export function transformPythonAnthropic(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (
    hasImport(result, "revenium_middleware.anthropic") ||
    hasImport(result, "revenium_middleware_anthropic")
  ) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium"],
    };
  }

  result = insertPythonImport(result, REVENIUM_IMPORT);
  changes.push("Added revenium_middleware.anthropic import (auto-patches)");

  const commentBlock = buildPythonCommentBlock(ctx.design, "anthropic", ctx.filePath);
  result = insertPythonBlock(result, commentBlock);
  changes.push("Added usage_metadata reference (commented — uncomment to enable business context)");

  return { content: result, modified: changes.length > 0, changes };
}
