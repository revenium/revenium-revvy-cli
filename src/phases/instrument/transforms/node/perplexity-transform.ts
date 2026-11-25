/**
 * Transform for Node.js/TypeScript files using Perplexity via the OpenAI SDK.
 * `@revenium/middleware/perplexity` is a client wrapper, so see
 * wrapper-client-transform.ts for what this adds and why.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { transformNodeWrapperClient } from "./wrapper-client-transform.js";

/**
 * Heuristic: does this Node/TS file look like it's using the Perplexity API?
 */
export function isNodePerplexityFile(content: string): boolean {
  return (
    content.includes("perplexity.ai") ||
    content.includes("PERPLEXITY_API_KEY") ||
    content.includes("PERPLEXITY_KEY") ||
    /model\s*:\s*["'`]sonar/.test(content)
  );
}

export function transformNodePerplexity(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return transformNodeWrapperClient(content, ctx, "perplexity");
}
