/**
 * Transform for Python files using the Ollama SDK: adds
 * `import revenium_middleware.ollama` (auto-patches on import) and a commented
 * usage_metadata reference.
 *
 * Install: pip install "revenium-python-sdk[ollama]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { instrumentPythonMiddleware } from "./base-python-transform.js";

export function transformPythonOllama(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return instrumentPythonMiddleware(content, ctx, {
    module: "revenium_middleware.ollama",
    importLine: `import revenium_middleware.ollama  # Revenium: auto-patches Ollama SDK on import`,
    commentKey: "ollama",
    label: "Ollama",
  });
}
