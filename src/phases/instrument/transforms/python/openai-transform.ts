/**
 * Transform for Python files using the OpenAI SDK: adds
 * `import revenium_middleware.openai` (auto-patches on import) and a commented
 * usage_metadata reference.
 *
 * Install: pip install "revenium-python-sdk[openai]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { instrumentPythonMiddleware } from "./base-python-transform.js";

export function transformPythonOpenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return instrumentPythonMiddleware(content, ctx, {
    module: "revenium_middleware.openai",
    importLine: `import revenium_middleware.openai  # Revenium: auto-patches OpenAI SDK on import`,
    commentKey: "openai",
    label: "OpenAI",
  });
}
