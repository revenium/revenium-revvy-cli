/**
 * Transform for Python files using the Ollama SDK.
 *
 * Adds:
 * 1. import revenium_middleware.ollama (auto-patches on import)
 * 2. Commented usage_metadata reference block
 *
 * Install: pip install "revenium-python-sdk[ollama]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { hasImport, insertPythonImport, insertPythonBlock, buildPythonCommentBlock } from "./base-python-transform.js";

const REVENIUM_IMPORT = `import revenium_middleware.ollama  # Revenium: auto-patches Ollama SDK on import`;

export function transformPythonOllama(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "revenium_middleware.ollama")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (Ollama)"],
    };
  }

  result = insertPythonImport(result, REVENIUM_IMPORT);
  changes.push("Added revenium_middleware.ollama import (auto-patches)");

  const commentBlock = buildPythonCommentBlock(ctx.design, "ollama", ctx.filePath);
  result = insertPythonBlock(result, commentBlock);
  changes.push("Added usage_metadata reference (commented — uncomment to enable business context)");

  return { content: result, modified: changes.length > 0, changes };
}
