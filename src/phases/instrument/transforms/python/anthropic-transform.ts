/**
 * Transform for Python files using the Anthropic SDK: adds
 * `import revenium_middleware.anthropic` (auto-patches on import) and a
 * commented usage_metadata reference.
 *
 * Install: pip install "revenium-python-sdk[anthropic]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { instrumentPythonMiddleware } from "./base-python-transform.js";

export function transformPythonAnthropic(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return instrumentPythonMiddleware(content, ctx, {
    module: "revenium_middleware.anthropic",
    importLine: `import revenium_middleware.anthropic  # Revenium: auto-patches Anthropic SDK on import`,
    commentKey: "anthropic",
    label: "Anthropic",
  });
}
