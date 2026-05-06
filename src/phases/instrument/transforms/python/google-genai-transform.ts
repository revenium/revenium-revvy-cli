/**
 * Transform for Python files using the Google GenAI or Vertex AI SDK.
 *
 * Adds:
 * 1. import revenium_middleware.google (auto-patches on import)
 * 2. Commented usage_metadata reference block
 *
 * Install: pip install "revenium-python-sdk[google-genai]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { hasImport, insertPythonImport, insertPythonBlock, buildPythonCommentBlock } from "./base-python-transform.js";

const REVENIUM_IMPORT = `import revenium_middleware.google  # Revenium: auto-patches Google GenAI / Vertex AI on import`;

export function transformPythonGoogleGenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  const changes: string[] = [];
  let result = content;

  if (hasImport(result, "revenium_middleware.google")) {
    return {
      content: result,
      modified: false,
      changes: ["Already instrumented with Revenium (Google GenAI)"],
    };
  }

  result = insertPythonImport(result, REVENIUM_IMPORT);
  changes.push("Added revenium_middleware.google import (auto-patches)");

  const commentBlock = buildPythonCommentBlock(ctx.design, "google-genai", ctx.filePath);
  result = insertPythonBlock(result, commentBlock);
  changes.push("Added usage_metadata reference (commented — uncomment to enable business context)");

  return { content: result, modified: changes.length > 0, changes };
}
