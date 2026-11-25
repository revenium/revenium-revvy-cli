/**
 * Transform for Node.js/TypeScript files using the OpenAI SDK (OpenAI and
 * Azure OpenAI). `@revenium/middleware/openai` is a client wrapper, so see
 * wrapper-client-transform.ts for what this adds and why.
 */

import type { TransformContext, TransformResult } from "./base-node-transform.js";
import { transformNodeWrapperClient } from "./wrapper-client-transform.js";

export function transformNodeOpenAI(
  content: string,
  ctx: TransformContext,
): TransformResult {
  return transformNodeWrapperClient(content, ctx, "openai");
}
