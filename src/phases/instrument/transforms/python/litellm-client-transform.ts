/**
 * Transform for Python files using the LiteLLM client: adds
 * `import revenium_middleware.litellm.client.middleware` (auto-patches on
 * import) and a commented usage_metadata reference.
 *
 * Install: pip install "revenium-python-sdk[litellm]"
 */

import type { TransformContext, TransformResult } from "./base-python-transform.js";
import { instrumentPythonMiddleware } from "./base-python-transform.js";

export function transformPythonLiteLLM(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return instrumentPythonMiddleware(content, ctx, {
    module: "revenium_middleware.litellm",
    importLine: `import revenium_middleware.litellm.client.middleware  # Revenium: auto-patches LiteLLM SDK on import`,
    commentKey: "litellm",
    label: "LiteLLM",
    alsoInstrumentedBy: ["revenium_middleware_litellm"],
  });
}
