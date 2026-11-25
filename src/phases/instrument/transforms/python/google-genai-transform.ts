/**
 * Transform for Python files using Google GenAI or Vertex AI: adds
 * `import revenium_middleware.google` (auto-patches on import) and a commented
 * usage_metadata reference.
 *
 * Install: pip install "revenium-python-sdk[google-genai]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { instrumentPythonMiddleware } from "./base-python-transform.js";

export function transformPythonGoogleGenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return instrumentPythonMiddleware(content, ctx, {
    module: "revenium_middleware.google",
    importLine: `import revenium_middleware.google  # Revenium: auto-patches Google GenAI / Vertex AI on import`,
    commentKey: "google-genai",
    label: "Google GenAI",
  });
}
